/**
 * Site-wide constants. Everything that appears in SEO tags, schema or the footer
 * should come from here so a rename is one edit.
 */
export const SITE = {
  name: 'Cuisdev',
  url: 'https://cuisdev.com',
  tagline: 'Free online tools that run in your browser',
  description:
    'Cuisdev is a collection of free, fast, privacy-first online tools for developers and professionals. Format JSON, convert files, edit images and more. Nothing leaves your browser.',
  locale: 'en_US',
  language: 'en',
  twitter: '@cuisdev',
  email: 'hello@cuisdev.com',
  foundingYear: 2025,
  logo: '/logo.svg',
  defaultOgImage: '/og/default.png',
  social: {
    github: 'https://github.com/cuisdev',
    x: 'https://x.com/cuisdev',
    linkedin: 'https://www.linkedin.com/company/cuisdev',
  },
} as const;

export const NAV = [
  { href: '/tools/', label: 'Tools' },
  { href: '/blog/', label: 'Blog' },
  { href: '/about/', label: 'About' },
] as const;

/** GA4 measurement ID. Env var wins so staging can point elsewhere; the production ID is the default. */
export const GA_ID: string = (import.meta.env.PUBLIC_GA_MEASUREMENT_ID as string | undefined) || 'G-TZH65SMVNE';
export const GSC_VERIFICATION = import.meta.env.PUBLIC_GSC_VERIFICATION as string | undefined;
export const BING_VERIFICATION = import.meta.env.PUBLIC_BING_VERIFICATION as string | undefined;

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${SITE.url}${clean}`;
}
