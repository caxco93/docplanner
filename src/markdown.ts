/**
 * Live markdown for the page body. The source text is never changed: markers such as `**` and `#`
 * stay in the text and are only styled, so `serialize` keeps reading plain text back out.
 *
 * The body is a list of line <div>s. Each line carries a class for its block style (heading,
 * bullet) and, when it has markers, is rebuilt as text / `.md-mark` / `.md-bold` runs. Markers are
 * hidden by CSS except on the line holding the caret (`data-caret`).
 */

/** Stands in for a mention tag when a line is flattened to a string. */
const MENTION_UNIT = '￼';

const HEADING = /^(#{1,6})\s/;
const BULLET = /^[-*]\s/;
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;

type Leaf = Text | HTMLElement;

interface Run {
  text: string;
  kind: 'plain' | 'mark' | 'bold';
}

const isMention = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && node.classList.contains('mention');

/** The line's block style and the length of its marker (`## `, `- `), if any. */
function blockStyle(source: string): { cls: string; prefix: number } {
  const heading = HEADING.exec(source);
  // The page title is the top-level heading, so `#` in the body is the second level.
  if (heading) return { cls: `md-h${Math.min(heading[1].length + 1, 6)}`, prefix: heading[0].length };
  const bullet = BULLET.exec(source);
  return bullet ? { cls: 'md-li', prefix: bullet[0].length } : { cls: '', prefix: 0 };
}

function inlineRuns(source: string): Run[] {
  const runs: Run[] = [];
  const plain = (text: string) => text && runs.push({ text, kind: 'plain' });
  let last = 0;
  for (const m of source.matchAll(BOLD)) {
    plain(source.slice(last, m.index));
    runs.push({ text: '**', kind: 'mark' }, { text: m[1], kind: 'bold' }, { text: '**', kind: 'mark' });
    last = m.index + m[0].length;
  }
  plain(source.slice(last));
  return runs;
}

/** Text nodes and mention tags of a line, in order, looking through the styling spans. */
function leaves(parent: Node, out: Leaf[] = []): Leaf[] {
  parent.childNodes.forEach((node) => {
    if (node instanceof Text || isMention(node)) out.push(node);
    else if (node instanceof HTMLElement && node.tagName !== 'BR') leaves(node, out);
  });
  return out;
}

const leafLength = (leaf: Leaf) => (leaf instanceof Text ? leaf.length : 1);

/** Caret position within a line, counting a mention tag as one character. */
function caretOffset(line: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel?.isCollapsed || !sel.anchorNode || !line.contains(sel.anchorNode)) return null;
  const point = document.createRange();
  point.setStart(sel.anchorNode, sel.anchorOffset);
  let offset = 0;
  for (const leaf of leaves(line)) {
    if (leaf === sel.anchorNode) return offset + sel.anchorOffset;
    if (point.comparePoint(leaf, 0) < 0) offset += leafLength(leaf);
  }
  return offset;
}

function restoreCaret(line: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  let rest = offset;
  for (const leaf of leaves(line)) {
    if (leaf instanceof Text && rest <= leaf.length) return sel?.collapse(leaf, rest);
    rest -= leafLength(leaf);
    if (rest <= 0 && leaf.parentNode) {
      return sel?.collapse(leaf.parentNode, Array.prototype.indexOf.call(leaf.parentNode.childNodes, leaf) + 1);
    }
  }
  sel?.collapse(line, line.childNodes.length);
}

export function buildLine(nodes: Node[]): HTMLDivElement {
  const line = document.createElement('div');
  // An empty <div> has no height, so an empty line holds a placeholder <br>.
  if (nodes.length) line.append(...nodes);
  else line.append(document.createElement('br'));
  return line;
}

/** True when the body is already one plain-looking <div> per line. */
function isCanonical(body: HTMLElement): boolean {
  if (!body.firstChild || body.children.length !== body.childNodes.length) return false;
  return Array.from(body.children).every(
    (line) =>
      line.tagName === 'DIV' &&
      !line.querySelector('div, br:not(:last-child), :scope > :not(br, .mention, .md-mark, .md-bold)'),
  );
}

/**
 * Browsers leave the editable DOM in many shapes (loose text, <br>, nested <div>s, <b>...).
 * Re-lays it out as one <div> per line, moving (not copying) the text and tag nodes so the
 * caret, which refers to them, stays put.
 */
function canonicalise(body: HTMLElement): void {
  const sel = window.getSelection();
  const anchor = sel?.isCollapsed && sel.anchorNode && body.contains(sel.anchorNode) ? sel.anchorNode : null;
  const anchorOffset = sel?.anchorOffset ?? 0;
  let anchorLine = 0;

  const lines: Node[][] = [];
  let line: Node[] = [];
  let open = false;
  const endLine = () => {
    lines.push(line);
    line = [];
    open = false;
  };
  const walk = (node: Node) => {
    if (node === anchor) anchorLine = lines.length;
    if (node instanceof Text) {
      if (node.data) {
        line.push(node);
        open = true;
      }
    } else if (isMention(node)) {
      line.push(node);
      open = true;
    } else if (node instanceof HTMLElement) {
      if (node.tagName === 'BR') return endLine();
      const block = node.tagName === 'DIV' || node.tagName === 'P';
      if (block && open) endLine();
      node.childNodes.forEach(walk);
      if (block && open) endLine();
    }
  };
  body.childNodes.forEach(walk);
  if (open) endLine();
  if (!lines.length) lines.push([]);

  const divs = lines.map(buildLine);
  body.replaceChildren(...divs);
  if (!anchor) return;
  if (anchor instanceof Text && body.contains(anchor)) sel?.collapse(anchor, anchorOffset);
  else sel?.collapse(divs[Math.min(anchorLine, divs.length - 1)], 0);
}

function decorateLine(line: HTMLElement): void {
  const nodes = leaves(line);
  const source = nodes.map((n) => (n instanceof Text ? n.data : MENTION_UNIT)).join('');
  const { cls, prefix } = blockStyle(source);
  if (line.className !== cls) line.className = cls;

  const runs = inlineRuns(source.slice(prefix));
  if (prefix) runs.unshift({ text: source.slice(0, prefix), kind: 'mark' });
  const styled = line.querySelector('.md-mark, .md-bold') !== null;
  if (!styled && runs.every((r) => r.kind === 'plain')) return;

  const caret = caretOffset(line);
  const tags = nodes.filter((n): n is HTMLElement => !(n instanceof Text));
  const frag = document.createDocumentFragment();
  for (const run of runs) {
    let target: ParentNode = frag;
    if (run.kind !== 'plain') {
      const el = document.createElement(run.kind === 'bold' ? 'strong' : 'span');
      el.className = run.kind === 'bold' ? 'md-bold' : 'md-mark';
      frag.append(el);
      target = el;
    }
    run.text.split(MENTION_UNIT).forEach((part, i) => {
      const tag = i > 0 ? tags.shift() : undefined;
      if (tag) target.append(tag);
      if (part) target.append(part);
    });
  }
  line.replaceChildren(frag);
  if (caret !== null) restoreCaret(line, caret);
}

/** Marks the line holding the caret, which is the only one that shows its markers. */
export function markCaretLine(body: HTMLElement): void {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  let active: Element | null = null;
  if (node && body.contains(node) && document.activeElement === body) {
    active = node === body ? (body.children[sel.anchorOffset] ?? body.lastElementChild) : node.parentElement;
    while (active && active.parentElement !== body) active = active.parentElement;
  }
  for (const line of body.querySelectorAll('[data-caret]')) if (line !== active) line.removeAttribute('data-caret');
  active?.setAttribute('data-caret', '');
}

/** Brings the body into line-per-<div> shape and applies the markdown styling to every line. */
export function restyle(body: HTMLElement): void {
  if (!isCanonical(body)) canonicalise(body);
  for (const line of body.children) decorateLine(line as HTMLElement);
}
