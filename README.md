# Doc Planner

A DOM-based document canvas built with Vite and vanilla TypeScript. Write on A4 pages, tag other pages with `@Name`, and double-click a tag to open that page beside the current one, joined by an arrow.

## Features

- A4 pages that flow onto further sheets, with a page counter and arrows
- `@Name` tags, highlighted like links; double-click to open the tagged page
- Typing `@` opens fuzzy-searched suggestions, closest match first (arrows to move, Enter or Tab to accept, Esc to dismiss)
- Arrows from each mention to the page it points at
- Pan and zoom over the whole canvas using CSS 3D transforms
  - drag the background, or press space and drag within 500ms to pan over a page
  - scroll to pan, pinch or ctrl/cmd + scroll to zoom
- Expand All / Contract All
- Save and load as JSON: documents are stored flat, with a separate relationships list

## Development

```sh
npm install
npm run dev
```

```sh
npm run build
```

## Deployment

Coolify builds the `Dockerfile` (Vite build served by nginx). Bunny CDN sits in front as a pull zone so most requests never reach the VPS.

- `nginx.conf` sends `Cache-Control: public, max-age=31536000, immutable` for the fingerprinted files in `/assets/`, and `no-cache` for `index.html` so a new deploy is picked up straight away.
- Bunny pull zone: set the origin URL to the Coolify domain, leave caching on "Respect origin Cache-Control" (the default), and point the app's domain at the pull zone with a CNAME.
- No purge is needed after a deploy, since new builds produce new asset names and `index.html` is always revalidated.
