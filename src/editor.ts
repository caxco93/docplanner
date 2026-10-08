import type { DocRecord, Rect, Segment, Store } from './model.ts';

/** `@name` not glued to a preceding word character (so e-mail addresses are left alone). */
const MENTION_PATTERN = /(?<![\p{L}\p{N}_@])@([\p{L}\p{N}_-]+)/gu;

const mentionLabel = (title: string) => `@${title.trim() || 'Untitled'}`;

function createMention(docId: string, title: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'mention';
  span.contentEditable = 'false';
  span.dataset.doc = docId;
  span.title = 'Double-click to open';
  span.textContent = mentionLabel(title);
  return span;
}

/** Reads the editable DOM back into segments. Handles the <div>/<br> structure browsers produce. */
export function serialize(root: HTMLElement): Segment[] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let open = false;

  const endLine = () => {
    lines.push(line);
    line = [];
    open = false;
  };
  const walk = (node: Node) => {
    if (node instanceof Text) {
      if (node.data) {
        line.push(node.data.replace(/ /g, ' '));
        open = true;
      }
    } else if (node instanceof HTMLElement) {
      if (node.classList.contains('mention') && node.dataset.doc) {
        line.push({ mention: node.dataset.doc });
        open = true;
      } else if (node.tagName === 'BR') {
        endLine();
      } else {
        const block = node.tagName === 'DIV' || node.tagName === 'P';
        if (block && open) endLine();
        node.childNodes.forEach(walk);
        if (block && open) endLine();
      }
    }
  };
  root.childNodes.forEach(walk);
  if (open) endLine();

  const out: Segment[] = [];
  const push = (s: Segment) => {
    const last = out[out.length - 1];
    if (typeof s === 'string' && typeof last === 'string') out[out.length - 1] = last + s;
    else out.push(s);
  };
  lines.forEach((l, i) => {
    if (i > 0) push('\n');
    l.forEach(push);
  });
  return out;
}

export interface PageHost {
  readonly store: Store;
  zoom(): number;
  openMention(fromId: string, targetId: string): void;
  closePage(id: string): void;
  titleChanged(id: string): void;
  movePage(id: string): void;
  layoutChanged(): void;
}

export class PageView {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly titleInput: HTMLInputElement;
  private readonly gripLabel: HTMLElement;
  private readonly clip: HTMLElement;
  private readonly count: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;

  constructor(
    readonly doc: DocRecord,
    private readonly host: PageHost,
  ) {
    this.el = document.createElement('article');
    this.el.className = 'page';
    this.el.innerHTML = `
      <header class="grip"><span class="grip-label"></span><button class="close" title="Close page">×</button></header>
      <div class="page-main">
        <input class="page-title" placeholder="Untitled" spellcheck="false" />
        <div class="page-clip"><div class="page-body" contenteditable="true" spellcheck="false"></div></div>
      </div>
      <footer class="pager">
        <button class="prev" title="Previous page">‹</button>
        <span class="count"></span>
        <button class="next" title="Next page">›</button>
      </footer>`;
    this.gripLabel = this.el.querySelector('.grip-label')!;
    this.titleInput = this.el.querySelector('.page-title')!;
    this.body = this.el.querySelector('.page-body')!;
    this.clip = this.el.querySelector('.page-clip')!;
    this.count = this.el.querySelector('.count')!;
    this.prev = this.el.querySelector('.prev')!;
    this.next = this.el.querySelector('.next')!;

    this.titleInput.value = doc.title;
    this.updateLabel();
    this.render();
    this.place();
    this.bindTitle();
    this.bindBody();
    this.bindGrip();
    this.bindPager();
    if (doc.id === host.store.data.rootId) this.el.querySelector('.close')!.remove();
  }

  rect(): Rect {
    return { x: this.doc.x, y: this.doc.y, w: this.el.offsetWidth, h: this.el.offsetHeight };
  }

  /** Centre of the first tag pointing at `targetId`, in world coordinates. */
  mentionAnchor(targetId: string): { x: number; y: number } | null {
    const tag = this.body.querySelector<HTMLElement>(`.mention[data-doc="${CSS.escape(targetId)}"]`);
    if (!tag) return null;
    const zoom = this.host.zoom();
    const page = this.el.getBoundingClientRect();
    const r = tag.getBoundingClientRect();
    return {
      // Tags on other sheets sit in off-screen columns, so keep x on this page.
      x: this.doc.x + Math.min(Math.max((r.left + r.width / 2 - page.left) / zoom, 0), this.el.offsetWidth),
      y: this.doc.y + (r.top + r.height / 2 - page.top) / zoom,
    };
  }

  /** Re-labels tags after any document was renamed. */
  refreshMentions(): void {
    for (const tag of this.body.querySelectorAll<HTMLElement>('.mention')) {
      const target = this.host.store.get(tag.dataset.doc ?? '');
      tag.textContent = mentionLabel(target?.title ?? '');
    }
  }

  flash(): void {
    this.el.classList.remove('flash');
    void this.el.offsetWidth;
    this.el.classList.add('flash');
  }

  place(): void {
    this.el.style.transform = `translate3d(${this.doc.x}px, ${this.doc.y}px, 0)`;
  }

  private updateLabel(): void {
    this.gripLabel.textContent = this.doc.title.trim() || 'Untitled';
  }

  private render(): void {
    const { store } = this.host;
    const frag = document.createDocumentFragment();
    let trailingBreak = false;
    for (const seg of this.doc.content) {
      trailingBreak = false;
      if (typeof seg === 'string') {
        seg.split('\n').forEach((part, i) => {
          if (i > 0) frag.append(document.createElement('br'));
          if (part) frag.append(part);
        });
        trailingBreak = seg.endsWith('\n');
      } else {
        const target = store.get(seg.mention);
        frag.append(target ? createMention(target.id, target.title) : '@?');
      }
    }
    // A final <br> alone does not render an empty line, so add a placeholder.
    if (trailingBreak) frag.append(document.createElement('br'));
    this.body.replaceChildren(frag);
  }

  private bindTitle(): void {
    this.titleInput.addEventListener('input', () => {
      this.doc.title = this.titleInput.value;
      this.updateLabel();
      this.host.titleChanged(this.doc.id);
    });
    this.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.body.focus();
      }
    });
  }

  private bindBody(): void {
    const { body } = this;
    body.addEventListener('input', () => {
      this.convertMentions(true);
      this.commit();
    });
    body.addEventListener('blur', () => {
      this.convertMentions(false);
      this.commit();
    });
    body.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
    });
    body.addEventListener('drop', (e) => e.preventDefault());
    body.addEventListener('dblclick', (e) => {
      const tag = (e.target as HTMLElement).closest<HTMLElement>('.mention');
      if (!tag?.dataset.doc) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      this.host.openMention(this.doc.id, tag.dataset.doc);
    });
  }

  private bindGrip(): void {
    const grip = this.el.querySelector<HTMLElement>('.grip')!;
    this.el.querySelector('.close')?.addEventListener('click', () => this.host.closePage(this.doc.id));
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.close')) return;
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      let lastX = e.clientX;
      let lastY = e.clientY;
      const move = (ev: PointerEvent) => {
        const zoom = this.host.zoom();
        this.doc.x += (ev.clientX - lastX) / zoom;
        this.doc.y += (ev.clientY - lastY) / zoom;
        lastX = ev.clientX;
        lastY = ev.clientY;
        this.place();
        this.host.movePage(this.doc.id);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  }

  /**
   * The body is one CSS multi-column flow exactly one sheet wide; the clip shows one column
   * (sheet) at a time, so text overflowing the A4 height continues on the next sheet.
   */
  private bindPager(): void {
    const go = (index: number) => {
      this.clip.scrollLeft = index * this.clip.clientWidth;
    };
    this.prev.addEventListener('click', () => go(this.sheet().index - 1));
    this.next.addEventListener('click', () => go(this.sheet().index + 1));
    // The browser scrolls the clip to keep the caret visible; keep that aligned to whole sheets.
    this.clip.addEventListener('scroll', () => {
      const { index, step } = this.sheet();
      if (this.clip.scrollLeft !== index * step) this.clip.scrollLeft = index * step;
      this.updatePager();
    });
    new ResizeObserver(() => this.updatePager()).observe(this.clip);
  }

  private sheet(): { index: number; count: number; step: number } {
    const step = this.clip.clientWidth || 1;
    return {
      step,
      index: Math.round(this.clip.scrollLeft / step),
      count: Math.max(1, Math.round(this.clip.scrollWidth / step)),
    };
  }

  private updatePager(): void {
    const { index, count } = this.sheet();
    this.count.textContent = `${index + 1} / ${count}`;
    this.prev.disabled = index === 0;
    this.next.disabled = index >= count - 1;
  }

  private commit(): void {
    this.doc.content = serialize(this.body);
    const targets = new Set(
      Array.from(this.body.querySelectorAll<HTMLElement>('.mention'), (m) => m.dataset.doc ?? ''),
    );
    this.host.store.syncRelationships(this.doc.id, targets);
    this.updatePager();
    this.host.layoutChanged();
  }

  /**
   * Turns finished `@name` text into tag elements. While typing, the token the caret is still
   * attached to is left alone; with `keepCaret` false (e.g. on blur) every token is converted.
   */
  private convertMentions(keepCaret: boolean): void {
    const sel = window.getSelection();
    const walker = document.createTreeWalker(this.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement?.closest('.mention') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);

    while (texts.length) {
      const node = texts.shift()!;
      const caret = keepCaret && sel?.isCollapsed && sel.anchorNode === node ? sel.anchorOffset : null;
      const rest = this.convertFirstMention(node, caret);
      if (rest) texts.unshift(rest);
    }
  }

  /** Converts the first finished tag in `node`; returns the text node following it, if any. */
  private convertFirstMention(node: Text, caret: number | null): Text | null {
    for (const m of node.data.matchAll(MENTION_PATTERN)) {
      const start = m.index;
      const end = start + m[0].length;
      if (caret === end) continue; // still typing this one
      const target = this.host.store.resolveMention(m[1]);
      const after = node.splitText(end);
      node.splitText(start).replaceWith(createMention(target.id, target.title));
      if (caret !== null && caret > start) window.getSelection()?.collapse(after, Math.max(0, caret - end));
      return after;
    }
    return null;
  }
}
