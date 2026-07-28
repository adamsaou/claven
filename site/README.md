# claven.dev

The site, the docs and the log. Astro, static output, no server.

Its own package on purpose. `site/` is **not** an npm workspace — it has its own
`package.json` and lockfile and installs independently, so nothing here can
reach the app's dependency tree. Run everything from inside this directory.

```
cd site
npm install
npm run dev      # localhost:4321
npm run build    # static output in site/dist
npm run preview  # serve what was built
```

## Where things live

| | |
|---|---|
| `src/content/docs/` | Documentation. Ordered by the `order` field, not alphabetically. |
| `src/content/log/` | The devlog. `draft: true` keeps an entry out of the index and the feed. |
| `src/lib/roadmap.ts` | The milestones, shared by the landing page and `/roadmap`. |
| `src/styles/global.css` | Brand tokens, restated from `brand/BRAND.md`. Do not invent values here. |

Adding a doc or a log entry is adding a markdown file. Both are typed — a
missing `title` or a malformed date fails the build rather than rendering blank.

## The commit count

The one live number on the site. Asking GitHub for one commit per page makes the
last page number the total, and it comes back in the `Link` header — one
request, no token, no backend.

It is fetched twice: at build time, so the number is correct with JavaScript
switched off, and again in the browser, so it is correct between deploys.
Unauthenticated callers get 60 requests an hour per IP; when that runs out, or
the visitor is offline, the built-in number stays on screen. Nothing empties and
nothing flickers.

## Deploying

The output is plain static files, so any host works. Build command is
`npm run build`, output directory is `dist`, and the root directory is `site`.

`.node-version` is load-bearing, not decoration. Cloudflare Pages' v3 build
image explicitly does **not** read `package.json` → `engines`, so without that
file the Node version is whatever the platform defaults to that week — and
Astro 7 refuses to build below 22.12. It is pinned to 22.16.0 because that is
the documented default and therefore certain to exist in the image.

Pages are emitted as `/log/index.html` rather than `/log.html` deliberately —
the flat form needs a host that tries adding `.html` to a bare path, which
Cloudflare Pages and Netlify do and GitHub Pages does not.
