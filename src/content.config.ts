import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Tool docs: one MDX per tool slug. The frontmatter feeds the page template and schema;
 * the body is the explainer rendered below the tool.
 */
const tools = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/tools' }),
  schema: z.object({
    /** Must match a slug in src/data/tools.ts */
    slug: z.string(),
    /** Numbered steps shown under "How to use" and emitted as HowTo schema. */
    howTo: z.array(z.string()).min(2).max(8),
    /** Short feature bullets, 4 to 8. */
    features: z.array(z.string()).min(3).max(10),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).min(3).max(10),
    updated: z.coerce.date(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(70),
    description: z.string().min(80).max(160),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Cuisdev Team'),
    tags: z.array(z.string()).default([]),
    /** Tool slugs this post should link to prominently. */
    tools: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    image: z.string().optional(),
  }),
});

export const collections = { tools, blog };
