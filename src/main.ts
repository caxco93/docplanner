import './style.css';
import { Autocomplete } from './autocomplete.ts';
import { PageView, type PageHost } from './editor.ts';
import { Links } from './links.ts';
import { createWorkspace, parseWorkspace, Store, type Workspace } from './model.ts';
import { Viewport } from './viewport.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="toolbar">
    <strong class="brand">Doc Planner</strong>
    <button id="save">Save</button>
    <button id="load">Load</button>
    <span class="sep"></span>
    <button id="zoom-out" title="Zoom out">−</button>
    <span id="zoom-label" class="zoom-label"></span>
    <button id="zoom-in" title="Zoom in">+</button>
    <button id="reset-camera">Reset Camera</button>
    <button id="toggle-all"></button>
    <input id="file" type="file" accept="application/json,.json" hidden />
  </div>
  <div id="viewport" class="viewport">
    <div id="world" class="world">
      <svg class="links" width="1" height="1">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead" />
          </marker>
        </defs>
        <g id="link-layer"></g>
      </svg>
    </div>
  </div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewportEl = $('viewport');
const worldEl = $('world');
const zoomLabel = $('zoom-label');

let store = new Store(createWorkspace());
const pages = new Map<string, PageView>();
const links = new Links(document.getElementById('link-layer') as unknown as SVGGElement, () => store, pages);
const viewport = new Viewport(viewportEl, worldEl, store.data.view, (view) => {
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
});

function refreshToolbar(): void {
  $('toggle-all').textContent = store.allOpen() ? 'Contract All' : 'Expand All';
}

const host: PageHost = {
  get store() {
    return store;
  },
  autocomplete: new Autocomplete(),
  zoom: () => viewport.view.zoom,
  openMention(fromId, targetId) {
    const target = store.get(targetId);
    if (!target) return;
    const existing = pages.get(targetId);
    if (existing) {
      viewport.reveal(existing.rect(), true);
      existing.flash();
      return;
    }
    target.open = true;
    store.placeNextTo(fromId, targetId);
    const page = addPage(target.id);
    viewport.reveal(page.rect(), false);
    page.flash();
    links.schedule();
    refreshToolbar();
  },
  closePage(id) {
    const page = pages.get(id);
    if (!page) return;
    page.el.remove();
    pages.delete(id);
    page.doc.open = false;
    links.schedule();
    refreshToolbar();
  },
  titleChanged() {
    pages.forEach((p) => p.refreshMentions());
    links.schedule();
  },
  movePage: () => links.schedule(),
  layoutChanged() {
    links.schedule();
    refreshToolbar();
  },
};

function addPage(id: string): PageView {
  const page = new PageView(store.get(id)!, host);
  pages.set(id, page);
  worldEl.append(page.el);
  return page;
}

/** Makes the visible pages match which documents are open. */
function syncPages(): void {
  for (const [id, page] of pages) if (!store.get(id)?.open) host.closePage(page.doc.id);
  for (const doc of store.all()) if (doc.open && !pages.has(doc.id)) addPage(doc.id);
  links.schedule();
  refreshToolbar();
}

function showWorkspace(data: Workspace, fitToRoot: boolean): void {
  for (const page of pages.values()) page.el.remove();
  pages.clear();
  store = new Store(data);
  for (const doc of store.all()) if (doc.open) addPage(doc.id);
  viewport.setView(data.view);
  if (fitToRoot) viewport.reveal(pages.get(data.rootId)!.rect(), true, false);
  links.schedule();
  refreshToolbar();
}

function save(): void {
  store.data.view = { ...viewport.view };
  const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'docplanner.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function load(file: File): Promise<void> {
  try {
    showWorkspace(parseWorkspace(await file.text()), false);
  } catch (err) {
    alert(`Could not load file: ${err instanceof Error ? err.message : err}`);
  }
}

$('save').addEventListener('click', save);
$('load').addEventListener('click', () => $('file').click());
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void load(file);
});
$('zoom-in').addEventListener('click', () => viewport.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => viewport.zoomBy(0.8));
$('reset-camera').addEventListener('click', () => viewport.resetTo(pages.get(store.data.rootId)!.rect()));

$('toggle-all').addEventListener('click', () => {
  if (store.allOpen()) {
    store.contractAll();
    syncPages();
    viewport.reveal(pages.get(store.data.rootId)!.rect(), true);
  } else {
    store.expandAll();
    syncPages();
    viewport.fit([...pages.values()].map((p) => p.rect()));
  }
});

showWorkspace(store.data, true);
