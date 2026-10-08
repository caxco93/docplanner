import { deleteSave, listSaves, type SaveEntry } from './storage.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Opens a modal; `build` fills it and calls `close` with the result. Escape or a click outside dismisses it with null. */
function modal<T>(label: string, build: (dialog: HTMLElement, close: (result: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = el('div', 'dialog-overlay');
    const dialog = el('div', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', label);
    overlay.append(dialog);

    const close = (result: T | null) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close(null);
    });

    document.body.append(overlay);
    build(dialog, close);
  });
}

function cancelButton(close: (result: null) => void): HTMLButtonElement {
  const cancel = el('button', 'dialog-cancel', 'Cancel');
  cancel.addEventListener('click', () => close(null));
  return cancel;
}

/** Shows the named saves and resolves with the one the user picks, or null if dismissed. */
export function pickSave(): Promise<SaveEntry | null> {
  return modal<SaveEntry>('Load a save', (dialog, close) => {
    const render = async () => {
      const saves = await listSaves();
      dialog.replaceChildren(el('h2', undefined, 'Load a save'));
      if (saves.length === 0) dialog.append(el('p', 'dialog-empty', 'No saves yet. Use Save to create one.'));

      for (const entry of saves) {
        const open = el('button', 'save-open');
        open.append(el('span', undefined, entry.name), el('small', undefined, new Date(entry.savedAt).toLocaleString()));
        open.addEventListener('click', () => close(entry));

        const remove = el('button', 'save-delete', 'Delete');
        remove.addEventListener('click', async () => {
          if (!confirm(`Delete the save "${entry.name}"?`)) return;
          await deleteSave(entry.name);
          await render();
        });

        const row = el('div', 'save-row');
        row.append(open, remove);
        dialog.append(row);
      }
      dialog.append(cancelButton(close));
    };
    void render();
  });
}

/**
 * Asks what to save as: type a new name, or pick an existing save to overwrite.
 * Resolves with the chosen name, or null if dismissed.
 */
export function askSaveName(initial: string): Promise<string | null> {
  return modal<string>('Save workspace', (dialog, close) => {
    const input = el('input', 'save-name');
    input.type = 'text';
    input.placeholder = 'Name this save';
    input.value = initial;
    input.maxLength = 80;

    const list = el('div', 'save-list');
    const confirmButton = el('button', 'dialog-confirm');
    let existing = new Set<string>();

    const sync = () => {
      const name = input.value.trim();
      const overwriting = existing.has(name);
      confirmButton.textContent = overwriting ? 'Overwrite' : 'Save';
      confirmButton.classList.toggle('danger', overwriting);
      confirmButton.disabled = name === '';
      for (const row of list.querySelectorAll<HTMLElement>('.save-open')) {
        row.classList.toggle('selected', row.dataset.name === name);
      }
    };
    const submit = () => {
      const name = input.value.trim();
      if (name) close(name);
    };

    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    confirmButton.addEventListener('click', submit);

    const actions = el('div', 'dialog-actions');
    actions.append(cancelButton(close), confirmButton);
    dialog.append(el('h2', undefined, 'Save workspace'), input, el('p', 'dialog-hint', 'Pick an existing save to overwrite it.'), list, actions);

    void listSaves().then((saves) => {
      existing = new Set(saves.map((s) => s.name));
      if (saves.length === 0) list.append(el('p', 'dialog-empty', 'No saves yet.'));
      for (const entry of saves) {
        const row = el('button', 'save-open');
        row.dataset.name = entry.name;
        row.append(el('span', undefined, entry.name), el('small', undefined, new Date(entry.savedAt).toLocaleString()));
        row.addEventListener('click', () => {
          input.value = entry.name;
          sync();
          input.focus();
        });
        list.append(row);
      }
      sync();
    });
    sync();
    input.focus();
    input.select();
  });
}
