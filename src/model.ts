export const PAGE_WIDTH = 794; // A4 @ 96dpi
export const PAGE_HEIGHT = 1123;
export const PAGE_GAP = 140;

/** A run of plain text (may contain "\n"), or a tag pointing at another document. */
export type Segment = string | { mention: string };

export interface DocRecord {
  id: string;
  title: string;
  content: Segment[];
  x: number;
  y: number;
  /** Whether the document is currently shown on the canvas. */
  open: boolean;
}

export interface Relationship {
  from: string;
  to: string;
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

/** The on-disk format: flat documents keyed by id, relationships kept in their own list. */
export interface Workspace {
  version: 1;
  rootId: string;
  documents: Record<string, DocRecord>;
  relationships: Relationship[];
  view: View;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const newId = () => crypto.randomUUID();

const isBlank = (content: Segment[]) =>
  content.every((s) => typeof s === 'string' && s.trim() === '');

export class Store {
  constructor(public data: Workspace) {}

  get(id: string): DocRecord | undefined {
    return this.data.documents[id];
  }

  all(): DocRecord[] {
    return Object.values(this.data.documents);
  }

  create(title: string, open = false): DocRecord {
    const doc: DocRecord = { id: newId(), title, content: [], x: 0, y: 0, open };
    this.data.documents[doc.id] = doc;
    return doc;
  }

  /** Finds the document a `@name` tag refers to, creating it if it does not exist yet. */
  resolveMention(name: string): DocRecord {
    const key = name.trim().toLowerCase();
    return this.all().find((d) => d.title.trim().toLowerCase() === key) ?? this.create(name);
  }

  /** Replaces the outgoing relationships of `from` with the given targets. */
  syncRelationships(from: string, targets: Set<string>): void {
    const rels = this.data.relationships.filter((r) => r.from !== from);
    for (const to of targets) {
      if (to !== from && this.get(to)) rels.push({ from, to });
    }
    this.data.relationships = rels;
    this.prune();
  }

  /** Drops documents that were only ever created by a tag that has since been removed. */
  private prune(): void {
    const referenced = new Set(this.data.relationships.flatMap((r) => [r.from, r.to]));
    for (const doc of this.all()) {
      if (!doc.open && doc.id !== this.data.rootId && isBlank(doc.content) && !referenced.has(doc.id)) {
        delete this.data.documents[doc.id];
      }
    }
  }

  allOpen(): boolean {
    return this.all().every((d) => d.open);
  }

  /** Opens every document: followed along relationships beside their sources, the rest in a new column. */
  expandAll(): void {
    const queue = this.all().filter((d) => d.open);
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      for (const rel of this.data.relationships) {
        const target = this.get(rel.to);
        if (rel.from !== doc.id || !target || target.open) continue;
        this.placeNextTo(doc.id, target.id);
        target.open = true;
        queue.push(target);
      }
    }
    const open = this.all().filter((d) => d.open);
    const x = Math.max(...open.map((d) => d.x)) + PAGE_WIDTH + PAGE_GAP;
    let y = Math.min(...open.map((d) => d.y));
    for (const doc of this.all().filter((d) => !d.open)) {
      doc.x = x;
      doc.y = y;
      doc.open = true;
      y += PAGE_HEIGHT + PAGE_GAP / 2;
    }
  }

  /** Closes everything except the root document. */
  contractAll(): void {
    for (const doc of this.all()) doc.open = doc.id === this.data.rootId;
  }

  /** Positions `target` to the right of `source`, stacking downwards past anything in the way. */
  placeNextTo(sourceId: string, targetId: string): void {
    const source = this.get(sourceId);
    const target = this.get(targetId);
    if (!source || !target) return;
    const others = this.all().filter((d) => d.open && d.id !== targetId);
    const x = source.x + PAGE_WIDTH + PAGE_GAP;
    let y = source.y;
    const collides = () =>
      others.some(
        (d) =>
          Math.abs(d.x - x) < PAGE_WIDTH + PAGE_GAP / 2 && Math.abs(d.y - y) < PAGE_HEIGHT + PAGE_GAP / 2,
      );
    while (collides()) y += PAGE_HEIGHT + PAGE_GAP / 2;
    target.x = x;
    target.y = y;
  }
}

export function createWorkspace(): Workspace {
  const store = new Store({
    version: 1,
    rootId: '',
    documents: {},
    relationships: [],
    view: { x: 0, y: 0, zoom: 1 },
  });
  const root = store.create('Welcome', true);
  const ideas = store.create('Ideas');
  store.data.rootId = root.id;
  root.content = [
    'Welcome to Doc Planner.\n\nType @ followed by a name and a space to tag another page, for example ',
    { mention: ideas.id },
    ' — double-click the highlighted tag to open that page beside this one.\n\n' +
      'Drag the background to pan. Scroll to pan, pinch or ctrl + scroll to zoom. Drag a page by its top bar to move it.',
  ];
  ideas.content = ['Anything you write here is its own page.'];
  store.data.relationships.push({ from: root.id, to: ideas.id });
  return store.data;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Parses and validates a saved file, throwing a readable error if it is not one of ours. */
export function parseWorkspace(raw: string): Workspace {
  const json: unknown = JSON.parse(raw);
  if (!isRecord(json) || json.version !== 1 || !isRecord(json.documents) || !Array.isArray(json.relationships)) {
    throw new Error('This is not a Doc Planner file.');
  }

  const documents: Record<string, DocRecord> = {};
  for (const [id, d] of Object.entries(json.documents)) {
    if (!isRecord(d) || typeof d.title !== 'string' || !Array.isArray(d.content)) {
      throw new Error(`Document "${id}" is malformed.`);
    }
    const content: Segment[] = d.content.flatMap((s): Segment[] => {
      if (typeof s === 'string') return [s];
      if (isRecord(s) && typeof s.mention === 'string') return [{ mention: s.mention }];
      return [];
    });
    documents[id] = { id, title: d.title, content, x: finite(d.x, 0), y: finite(d.y, 0), open: d.open === true };
  }

  const ids = Object.keys(documents);
  if (ids.length === 0) throw new Error('The file contains no documents.');
  const rootId = typeof json.rootId === 'string' && documents[json.rootId] ? json.rootId : ids[0];
  documents[rootId].open = true;

  const seen = new Set<string>();
  const relationships: Relationship[] = [];
  for (const r of json.relationships) {
    if (!isRecord(r) || typeof r.from !== 'string' || typeof r.to !== 'string') continue;
    const key = `${r.from}\u0000${r.to}`;
    if (!documents[r.from] || !documents[r.to] || seen.has(key)) continue;
    seen.add(key);
    relationships.push({ from: r.from, to: r.to });
  }

  const v = isRecord(json.view) ? json.view : {};
  const view = { x: finite(v.x, 0), y: finite(v.y, 0), zoom: finite(v.zoom, 1) };
  return { version: 1, rootId, documents, relationships, view };
}
