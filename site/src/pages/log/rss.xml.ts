import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import type { APIContext } from 'astro'

/**
 * The log, as a feed. Costs nothing and means nobody has to check the site to
 * find out whether anything happened — which, given there is no schedule, is
 * the only way to follow it without being annoyed.
 */
export async function GET(context: APIContext): Promise<Response> {
  const entries = (await getCollection('log', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  )

  return rss({
    title: 'Claven — log',
    description: 'Notes from building a code editor in public.',
    site: context.site ?? 'https://claven.dev',
    items: entries.map((entry) => ({
      title: entry.data.title,
      description: entry.data.summary,
      pubDate: entry.data.date,
      link: `/log/${entry.id}`
    })),
    customData: '<language>en</language>'
  })
}
