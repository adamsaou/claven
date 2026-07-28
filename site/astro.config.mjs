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
  vite: {
    plugins: [tailwind()]
  }
})
