/**
 * Blog publishing rules. A post is live when it is not a draft and its publishDate has
 * arrived at build time. Future-dated posts are written ahead and go live on the first
 * build on or after their date; the deploy workflow rebuilds on a schedule for that.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/** Build time, fixed once per build so every page agrees on what is published. */
const BUILD_TIME = Date.now();

export function isPublished(data: Post['data'], now: number = BUILD_TIME): boolean {
  return !data.draft && data.publishDate.valueOf() <= now;
}

/** Published posts, newest first. */
export async function publishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => isPublished(data));
  return posts.sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());
}

/** Published posts that link to a given tool, newest first. */
export async function postsForTool(slug: string, limit = 4): Promise<Post[]> {
  return (await publishedPosts()).filter((p) => p.data.tools.includes(slug)).slice(0, limit);
}
