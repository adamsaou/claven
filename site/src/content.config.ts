import { defineCollection } from 'astro:content'
// Not `from 'astro:content'` — that re-export is deprecated and on its way out.
import { z } from 'astro/zod'
import { glob } from 'astro/loaders'

/**
 * Docs and log entries are files in this repo, on purpose. A commit that
 * changes behaviour can change the page describing it, in the same diff, and
 * reviewers can see when it did not.
 */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Docs are ordered by hand. Alphabetical is never the reading order. */
    order: z.number().default(100)
  })
})

const log = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/log' }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    /** Which milestone this belongs to, if any. Free text — M0, M1, and so on. */
    milestone: z.string().optional(),
    summary: z.string(),
    /** Unfinished entries stay out of the index and the feed. */
    draft: z.boolean().default(false)
  })
})

export const collections = { docs, log }
