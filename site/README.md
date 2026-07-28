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

Cloudflare Workers Builds, from `wrangler.jsonc`. Settings on the Cloudflare
side:

| | |
|---|---|
| Root directory | `site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**Root directory is the setting that matters.** Left empty, the build runs at
the repo root and builds the Electron app instead, and the deploy then fails
with no wrangler config in sight.

The Worker is assets-only — `wrangler.jsonc` has no `main`, because a script in
front of static files would be code running on every request in order to do
nothing. `html_handling: auto-trailing-slash` is what maps a bare `/log` onto
the emitted `/log/index.html`.

`.node-version` is load-bearing, not decoration. Neither Workers Builds nor
Pages reads `package.json` → `engines`, so without that file the Node version
is whatever the platform defaults to that week — and Astro 7 refuses to build
below 22.12. Pinned to 22.16.0 because that is the documented default for the
build image and therefore certain to be present rather than fetched.

The output is plain static files, so nothing here is Cloudflare-specific except
`wrangler.jsonc`. Any static host will serve `dist` as-is.

Pages are emitted as `/log/index.html` rather than `/log.html` deliberately —
the flat form needs a host that tries adding `.html` to a bare path, which
Cloudflare Pages and Netlify do and GitHub Pages does not.
