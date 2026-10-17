import type { Rect, View } from './model.ts';

const WIDTH = 200;
const HEIGHT = 140;
const PADDING = 10;

interface Source {
  rects(): Rect[];
  view(): View;
  /** Size of the visible area in screen pixels. */
  size(): { width: number; height: number };
  centerOn(worldX: number, worldY: number): void;
}

/** A bird's-eye overview of all pages with the visible area outlined; click or drag to move the camera. */
export class Minimap {
  readonly el = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private frame = 0;
  /** Maps world coordinates to minimap pixels, as of the last draw. */
  private scale = 1;
  private originX = 0;
  private originY = 0;

  constructor(private readonly source: Source) {
    const ratio = window.devicePixelRatio || 1;
    this.el.className = 'minimap';
    this.el.width = WIDTH * ratio;
    this.el.height = HEIGHT * ratio;
    this.ctx = this.el.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
    this.bind();
    this.schedule();
  }

  schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { ctx } = this;
    const rects = this.source.rects();
    const { x, y, zoom } = this.source.view();
    const { width, height } = this.source.size();
    const screen: Rect = { x: -x / zoom, y: -y / zoom, w: width / zoom, h: height / zoom };

    // Frame the pages and the current view together, so the view outline never leaves the map.
    const all = [...rects, screen];
    const minX = Math.min(...all.map((r) => r.x));
    const minY = Math.min(...all.map((r) => r.y));
    const maxX = Math.max(...all.map((r) => r.x + r.w));
    const maxY = Math.max(...all.map((r) => r.y + r.h));
    this.scale = Math.min((WIDTH - PADDING * 2) / (maxX - minX), (HEIGHT - PADDING * 2) / (maxY - minY));
    this.originX = (WIDTH - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.originY = (HEIGHT - (maxY - minY) * this.scale) / 2 - minY * this.scale;

    const style = getComputedStyle(this.el);
    const accent = style.getPropertyValue('--accent');
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = style.getPropertyValue('--muted');
    for (const r of rects) ctx.fillRect(...this.toMap(r));

    const [vx, vy, vw, vh] = this.toMap(screen);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  private toMap(r: Rect): [number, number, number, number] {
    return [r.x * this.scale + this.originX, r.y * this.scale + this.originY, r.w * this.scale, r.h * this.scale];
  }

  private bind(): void {
    const moveTo = (e: PointerEvent) => {
      const box = this.el.getBoundingClientRect();
      this.source.centerOn(
        (e.clientX - box.left - this.originX) / this.scale,
        (e.clientY - box.top - this.originY) / this.scale,
      );
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      moveTo(e);
      const up = () => {
        this.el.removeEventListener('pointermove', moveTo);
        this.el.removeEventListener('pointerup', up);
        this.el.removeEventListener('pointercancel', up);
      };
      this.el.addEventListener('pointermove', moveTo);
      this.el.addEventListener('pointerup', up);
      this.el.addEventListener('pointercancel', up);
    });
  }
}
