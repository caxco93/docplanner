import { deleteSave, listSaves, type SaveEntry } from './storage.ts';

/** Shows the named saves in a modal and resolves with the one the user picks, or null if dismissed. */
export function pickSave(): Promise<SaveEntry | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Load a save');
    overlay.append(dialog);

    const close = (result: SaveEntry | null) => {
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

    const render = async () => {
      const saves = await listSaves();
      dialog.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = 'Load a save';
      dialog.append(heading);

      if (saves.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'dialog-empty';
        empty.textContent = 'No saves yet. Use Save to create one.';
        dialog.append(empty);
      }
      for (const entry of saves) {
        const row = document.createElement('div');
        row.className = 'save-row';

        const open = document.createElement('button');
        open.className = 'save-open';
        const name = document.createElement('span');
        name.textContent = entry.name;
        const time = document.createElement('small');
        time.textContent = new Date(entry.savedAt).toLocaleString();
        open.append(name, time);
        open.addEventListener('click', () => close(entry));

        const remove = document.createElement('button');
        remove.className = 'save-delete';
        remove.textContent = 'Delete';
        remove.addEventListener('click', async () => {
          if (!confirm(`Delete the save "${entry.name}"?`)) return;
          await deleteSave(entry.name);
          await render();
        });

        row.append(open, remove);
        dialog.append(row);
      }

      const cancel = document.createElement('button');
      cancel.className = 'dialog-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => close(null));
      dialog.append(cancel);
    };

    document.body.append(overlay);
    void render();
  });
}
