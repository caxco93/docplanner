import type { PageView } from './editor.ts';
import type { Rect, Store } from './model.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TITLE_OFFSET = 90; // arrows land at the target's title row

interface Point {
  x: number;
  y: number;
}

/** Cubic path from the edge of `src` (at the tag's height) to the nearest edge of `tgt`. */
function route(src: Rect, anchor: Point | null, tgt: Rect): string {
  const sy = anchor?.y ?? src.y + TITLE_OFFSET;
  let start: Point;
  let end: Point;
  let dir: Point;
  if (tgt.x >= src.x + src.w) {
    start = { x: src.x + src.w, y: sy };
    end = { x: tgt.x, y: tgt.y + TITLE_OFFSET };
    dir = { x: 1, y: 0 };
  } else if (tgt.x + tgt.w <= src.x) {
    start = { x: src.x, y: sy };
    end = { x: tgt.x + tgt.w, y: tgt.y + TITLE_OFFSET };
    dir = { x: -1, y: 0 };
  } else {
    const down = tgt.y >= src.y;
    const sx = anchor?.x ?? src.x + src.w / 2;
    start = { x: sx, y: down ? src.y + src.h : src.y };
    end = { x: tgt.x + tgt.w / 2, y: down ? tgt.y : tgt.y + tgt.h };
    dir = { x: 0, y: down ? 1 : -1 };
  }
  const k = Math.max(60, (Math.abs(end.x - start.x) * Math.abs(dir.x) + Math.abs(end.y - start.y) * Math.abs(dir.y)) / 2);
  const c1 = { x: start.x + dir.x * k, y: start.y + dir.y * k };
  const c2 = { x: end.x - dir.x * k, y: end.y - dir.y * k };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

/** Draws one arrow per relationship whose two pages are both open. */
export class Links {
  private frame = 0;

  constructor(
    private readonly layer: SVGGElement,
    private readonly store: () => Store,
    private readonly pages: Map<string, PageView>,
  ) {}

  schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const paths: SVGPathElement[] = [];
    for (const rel of this.store().data.relationships) {
      const src = this.pages.get(rel.from);
      const tgt = this.pages.get(rel.to);
      if (!src || !tgt) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', route(src.rect(), src.mentionAnchor(rel.to), tgt.rect()));
      path.setAttribute('class', 'link');
      path.setAttribute('marker-end', 'url(#arrow)');
      paths.push(path);
    }
    this.layer.replaceChildren(...paths);
  }
}
