export interface Suggestion {
  /** Existing document, or null for "create a new page with this title". */
  id: string | null;
  title: string;
  /** Positions of matched characters in `title`, highlighted in the list. */
  indices: number[];
}

/** A floating suggestion list. Lives outside the transformed canvas so it is never scaled. */
export class Autocomplete {
  private readonly el = document.createElement('div');
  private items: Suggestion[] = [];
  private active = 0;
  private onPick: (s: Suggestion) => void = () => {};

  constructor() {
    this.el.className = 'autocomplete';
    this.el.hidden = true;
    document.body.append(this.el);
    // Keep the editor focused while clicking an entry.
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    // The anchor goes stale as soon as the canvas moves or the user clicks elsewhere.
    window.addEventListener('wheel', () => this.hide(), { passive: true });
    window.addEventListener('resize', () => this.hide());
    window.addEventListener('pointerdown', (e) => {
      if (!this.el.contains(e.target as Node)) this.hide();
    }, true);
  }

  isOpen(): boolean {
    return !this.el.hidden;
  }

  show(anchor: DOMRect, items: Suggestion[], onPick: (s: Suggestion) => void): void {
    if (items.length === 0) return this.hide();
    this.items = items;
    this.onPick = onPick;
    this.active = 0;
    this.render();
    this.el.hidden = false;
    const { width, height } = this.el.getBoundingClientRect();
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight ? Math.max(8, anchor.top - height - 6) : below;
    this.el.style.top = `${top}px`;
    this.el.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }

  move(delta: number): void {
    this.active = (this.active + delta + this.items.length) % this.items.length;
    this.el.querySelectorAll('.active').forEach((e) => e.classList.remove('active'));
    const row = this.el.children[this.active];
    row.classList.add('active');
    row.scrollIntoView({ block: 'nearest' });
  }

  pickActive(): void {
    this.onPick(this.items[this.active]);
  }

  private render(): void {
    this.el.replaceChildren(
      ...this.items.map((item, i) => {
        const row = document.createElement('div');
        row.className = 'suggestion' + (i === this.active ? ' active' : '');
        if (item.id === null) {
          row.classList.add('create');
          row.append('Create ');
        }
        const marked = new Set(item.indices);
        item.title.split('').forEach((ch, at) => {
          if (!marked.has(at)) return row.append(ch);
          const b = document.createElement('b');
          b.textContent = ch;
          row.append(b);
        });
        row.addEventListener('click', () => this.onPick(item));
        row.addEventListener('mousemove', () => {
          if (this.active !== i) this.move(i - this.active);
        });
        return row;
      }),
    );
  }
}
