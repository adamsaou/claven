import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import tailwind from '@tailwindcss/vite'

/**
 * Static output, deliberately. Nothing here needs a server: the docs and the
 * log are files, and the one live number on the site is fetched by the browser
 * from GitHub's API directly. That keeps the whole thing hostable anywhere and
 * means the site cannot go down separately from its host.
 */
export default defineConfig({
  site: 'https://claven.dev',
  integrations: [mdx(), sitemap()],
  // Trailing slashes off, so /docs/files is the only URL that page has.
  trailingSlash: 'never',
  /**
   * Directory format — /log/index.html rather than /log.html.
   *
   * Not a style preference. The `file` format needs a host that will try adding
   * .html to a bare path, which Cloudflare Pages and Netlify do and GitHub
   * Pages does not. Directory output is served correctly by all three, and the
   * host has not been chosen yet.
   */
  build: { format: 'directory' },

  /**
   * Content Security Policy, emitted per page as a meta element.
   *
   * Astro fills in script-src and style-src itself with a hash of every script
   * and style it bundled, which is why this is worth more than a hand-written
   * header: the hashes change with the content and cannot go stale.
   *
   * The 'unsafe-inline' below is the one concession, and it is not optional.
   * The chrome sets motion and radius tokens through style="" attributes;
   * those are governed by style-src-attr, and hashes do not apply to
   * attributes — without it the layout loses its inline styles entirely.
   * `kind: 'attribute'` is what keeps the concession there and off style-src
   * itself, so <style> blocks stay on hashes.
   *
   * frame-ancestors is deliberately not here: it is ignored inside a meta
   * element. X-Frame-Options in public/_headers covers it instead.
   */
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        // `data:` is not optional here. Vite inlines any font subset under its
        // asset limit as a data URI, and several of the smaller Greek and
        // Cyrillic ranges land under it — with 'self' alone the browser
        // refuses exactly those and falls back to a system face for them,
        // quietly, on the ranges least likely to be noticed.
        "font-src 'self' data:",
        // The commit ticker's one call, and nothing else.
        "connect-src 'self' https://api.github.com",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'"
      ],
      styleDirective: {
        resources: [{ resource: "'unsafe-inline'", kind: 'attribute' }]
      }
    }
  },
  vite: {
    plugins: [tailwind()]
  }
})
