import './style.css';
import { Autocomplete } from './autocomplete.ts';
import { PageView, type PageHost } from './editor.ts';
import { Links } from './links.ts';
import { askSaveName, pickSave } from './saves-dialog.ts';
import { loadAutosave, putSave, writeAutosave } from './storage.ts';
import { coreData, createWorkspace, parseWorkspace, Store, type Workspace } from './model.ts';
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
    <button id="fit-contents"></button>
    <span class="sep"></span>
    <button id="copy" class="accent" title="Copy the pages and relationships to the clipboard">Copy for Agent</button>
    <span class="sep"></span>
    <button id="export" title="Download the workspace as a file">Export</button>
    <button id="import" title="Open a workspace file">Import</button>
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

function applyDisplayMode(): void {
  const { fitContents } = store.data;
  worldEl.classList.toggle('fit-contents', fitContents);
  $('fit-contents').textContent = fitContents ? 'Display as A4' : 'Fit contents';
  links.schedule();
}

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
  applyDisplayMode();
  if (fitToRoot) viewport.reveal(pages.get(data.rootId)!.rect(), true, false);
  links.schedule();
  refreshToolbar();
}

function serializeWorkspace(): string {
  store.data.view = { ...viewport.view };
  return JSON.stringify(store.data, null, 2);
}

function exportFile(): void {
  const blob = new Blob([serializeWorkspace()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'docplanner.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

let toastTimer: number | undefined;

function showToast(message: string, kind: 'success' | 'error'): void {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${kind} visible`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2000);
}

async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(coreData(store.data), null, 2));
    showToast('Copied to clipboard', 'success');
  } catch (err) {
    showToast(`Could not copy: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

async function importFile(file: File): Promise<void> {
  try {
    showWorkspace(parseWorkspace(await file.text()), false);
  } catch (err) {
    alert(`Could not import file: ${err instanceof Error ? err.message : err}`);
  }
}

let saveName = '';

async function saveLocally(): Promise<void> {
  const name = await askSaveName(saveName);
  if (!name) return;
  try {
    await putSave({ name, savedAt: Date.now(), data: serializeWorkspace() });
    saveName = name;
    showToast(`Saved "${name}"`, 'success');
  } catch (err) {
    showToast(`Could not save: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

async function loadLocally(): Promise<void> {
  try {
    const entry = await pickSave();
    if (!entry) return;
    showWorkspace(parseWorkspace(entry.data), false);
    saveName = entry.name;
  } catch (err) {
    showToast(`Could not load: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

/** Keeps the working copy in IndexedDB so the next visit resumes where this one left off. */
function startAutosave(): void {
  let last = serializeWorkspace();
  const flush = () => {
    const current = serializeWorkspace();
    if (current === last) return;
    last = current;
    void writeAutosave(current).catch((err) => console.error('Autosave failed', err));
  };
  setInterval(flush, 1000);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.hidden && flush());
}

async function restoreAutosave(): Promise<boolean> {
  try {
    const saved = await loadAutosave();
    if (!saved) return false;
    showWorkspace(parseWorkspace(saved), false);
    return true;
  } catch (err) {
    console.error('Could not restore the autosaved workspace', err);
    return false;
  }
}

// Dropping a workspace file anywhere on the page imports it.
const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
let dragDepth = 0;
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('file-dragging');
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('file-dragging');
  }
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('file-dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void importFile(file);
});

$('save').addEventListener('click', () => void saveLocally());
$('load').addEventListener('click', () => void loadLocally());
$('export').addEventListener('click', exportFile);
$('copy').addEventListener('click', () => void copyToClipboard());
$('import').addEventListener('click', () => $('file').click());
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void importFile(file);
});
$('zoom-in').addEventListener('click', () => viewport.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => viewport.zoomBy(0.8));
$('reset-camera').addEventListener('click', () => viewport.resetTo(pages.get(store.data.rootId)!.rect()));

$('fit-contents').addEventListener('click', () => {
  store.data.fitContents = !store.data.fitContents;
  applyDisplayMode();
});
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
void restoreAutosave().then(startAutosave);
