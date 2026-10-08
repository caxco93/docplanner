import type { Rect, View } from './model.ts';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const MARGIN = 60;
const SPACE_PAN_WINDOW_MS = 500;

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLInputElement);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Pan/zoom over a "world" element using a single CSS 3D transform. */
export class Viewport {
  view: View;
  private animation = 0;
  private spaceTimer = 0;
  private panArmed = false;
  private spaceLive = false;
  private spacePanned = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly world: HTMLElement,
    view: View,
    private readonly onChange: (view: View) => void,
  ) {
    this.view = { ...view };
    this.apply();
    this.bind();
    this.bindSpaceToPan();
  }

  setView(view: View): void {
    this.cancelAnimation();
    this.view = { ...view };
    this.apply();
  }

  zoomBy(factor: number): void {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    this.cancelAnimation();
    const r = this.el.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const zoom = clamp(this.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const ratio = zoom / this.view.zoom;
    this.view = { x: px - (px - this.view.x) * ratio, y: py - (py - this.view.y) * ratio, zoom };
    this.apply();
  }

  panBy(dx: number, dy: number): void {
    this.cancelAnimation();
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this.apply();
  }

  /** Frames all given rectangles. */
  fit(rects: Rect[], animate = true): void {
    if (rects.length === 0) return;
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const { width, height } = this.el.getBoundingClientRect();
    const zoom = clamp(
      Math.min((width - MARGIN * 2) / (maxX - minX), (height - MARGIN * 2) / (maxY - minY)),
      MIN_ZOOM,
      1,
    );
    this.goTo(
      {
        x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
        y: (height - (maxY - minY) * zoom) / 2 - minY * zoom,
        zoom,
      },
      animate,
    );
  }

  /** Scrolls so that `rect` is on screen (always, if `force`), keeping the current zoom. */
  reveal(rect: Rect, force: boolean, animate = true): void {
    const { width, height } = this.el.getBoundingClientRect();
    const { x, y, zoom } = this.view;
    const left = rect.x * zoom + x;
    const top = rect.y * zoom + y;
    const visible =
      left >= MARGIN && top >= MARGIN && left + rect.w * zoom <= width - MARGIN && top + rect.h * zoom <= height - MARGIN;
    if (visible && !force) return;
    const axis = (viewSize: number, start: number, size: number, pos: number) =>
      size * zoom > viewSize - MARGIN * 2 ? MARGIN - start * zoom : pos;
    this.goTo(
      {
        zoom,
        x: axis(width, rect.x, rect.w, width / 2 - (rect.x + rect.w / 2) * zoom),
        y: axis(height, rect.y, rect.h, height / 2 - (rect.y + rect.h / 2) * zoom),
      },
      animate,
    );
  }

  private goTo(target: View, animate: boolean): void {
    this.cancelAnimation();
    if (!animate) {
      this.view = target;
      this.apply();
      return;
    }
    const from = this.view;
    const start = performance.now();
    const duration = 350;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      this.view = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        zoom: from.zoom + (target.zoom - from.zoom) * e,
      };
      this.apply();
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  private cancelAnimation(): void {
    cancelAnimationFrame(this.animation);
  }

  private apply(): void {
    const { x, y, zoom } = this.view;
    this.world.style.transform = `translate3d(${x}px, ${y}px, 0) scale3d(${zoom}, ${zoom}, 1)`;
    this.el.style.setProperty('--vx', `${x}px`);
    this.el.style.setProperty('--vy', `${y}px`);
    this.el.style.setProperty('--vz', String(zoom));
    this.onChange(this.view);
  }

  private bind(): void {
    this.el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
        } else {
          this.panBy(-e.deltaX, -e.deltaY);
        }
      },
      { passive: false },
    );

    this.el.addEventListener('pointerdown', (e) => {
      const onPage = (e.target as HTMLElement).closest('.page');
      if (!(e.button === 0 && (!onPage || this.panArmed)) && e.button !== 1) return;
      if (this.panArmed) this.spacePanned = true;
      e.preventDefault();
      e.stopPropagation(); // wins over page controls (drag bar, tags, text selection)
      (document.activeElement as HTMLElement | null)?.blur();
      this.el.setPointerCapture(e.pointerId);
      this.el.classList.add('panning');
      let lastX = e.clientX;
      let lastY = e.clientY;
      const move = (ev: PointerEvent) => {
        this.panBy(ev.clientX - lastX, ev.clientY - lastY);
        lastX = ev.clientX;
        lastY = ev.clientY;
      };
      const up = () => {
        this.el.classList.remove('panning');
        this.el.removeEventListener('pointermove', move);
        this.el.removeEventListener('pointerup', up);
        this.el.removeEventListener('pointercancel', up);
      };
      this.el.addEventListener('pointermove', move);
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
    }, true);
  }

  /**
   * Pressing space opens a SPACE_PAN_WINDOW_MS window in which a left-drag pans, even over a page.
   * The space itself is held back during the window; if no drag started it is typed once the window
   * closes (or on release, for a tap) and from then on repeats behave normally.
   */
  private bindSpaceToPan(): void {
    const typeSpace = () => {
      if (isEditable(document.activeElement)) document.execCommand('insertText', false, ' ');
    };
    const closeWindow = () => {
      clearTimeout(this.spaceTimer);
      this.spaceTimer = 0;
      this.panArmed = false;
      this.el.classList.remove('pan-ready');
    };
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) {
        if (!this.spaceLive && isEditable(e.target)) e.preventDefault();
        return;
      }
      this.spaceLive = false;
      this.spacePanned = false;
      if (isEditable(e.target)) e.preventDefault();
      this.panArmed = true;
      this.el.classList.add('pan-ready');
      this.spaceTimer = window.setTimeout(() => {
        closeWindow();
        if (this.spacePanned) return;
        this.spaceLive = true;
        typeSpace();
      }, SPACE_PAN_WINDOW_MS);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return;
      const tap = this.spaceTimer !== 0 && !this.spacePanned;
      closeWindow();
      if (tap && isEditable(e.target)) typeSpace();
    });
    window.addEventListener('blur', closeWindow);
  }
}
