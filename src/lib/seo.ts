import { SITE, absoluteUrl } from './site';
import type { Tool, Category } from '@/data/tools';
import { toolPath, categoryPath } from '@/data/tools';

export interface Crumb {
  name: string;
  href: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

type JsonLd = Record<string, unknown>;

/** Title tag: page title + brand. Keeps under ~60 chars when the input is sized correctly. */
export function pageTitle(title?: string): string {
  if (!title) return `${SITE.name} - ${SITE.tagline}`;
  return title.endsWith(SITE.name) ? title : `${title} | ${SITE.name}`;
}

export function organizationLd(): JsonLd {
  return {
    '@type': 'Organization',
    '@id': `${SITE.url}/#organization`,
    name: SITE.name,
    url: SITE.url,
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl(SITE.logo),
    },
    sameAs: Object.values(SITE.social),
    contactPoint: {
      '@type': 'ContactPoint',
      email: SITE.email,
      contactType: 'customer support',
      availableLanguage: ['English'],
    },
  };
}

export function websiteLd(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': `${SITE.url}/#website`,
    url: SITE.url,
    name: SITE.name,
    description: SITE.description,
    publisher: { '@id': `${SITE.url}/#organization` },
    inLanguage: SITE.language,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.url}/tools/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbLd(crumbs: Crumb[]): JsonLd {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.href),
    })),
  };
}

export function faqLd(items: FaqItem[]): JsonLd | null {
  if (!items.length) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

export function softwareApplicationLd(tool: Tool, extra: { features?: string[]; dateModified?: string } = {}): JsonLd {
  const url = absoluteUrl(toolPath(tool));
  return {
    '@type': ['SoftwareApplication', 'WebApplication'],
    '@id': `${url}#app`,
    name: `${tool.name} by ${SITE.name}`,
    alternateName: tool.name,
    url,
    description: tool.description,
    applicationCategory: categoryToSchema(tool.category),
    operatingSystem: 'Any (web browser)',
    browserRequirements: 'Requires JavaScript',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: extra.features,
    datePublished: tool.since,
    dateModified: extra.dateModified ?? tool.since,
    publisher: { '@id': `${SITE.url}/#organization` },
    image: absoluteUrl(`/og/${tool.slug}.png`),
    keywords: tool.keywords.join(', '),
  };
}

export function howToLd(tool: Tool, steps: string[]): JsonLd | null {
  if (!steps.length) return null;
  return {
    '@type': 'HowTo',
    name: `How to use the ${tool.name}`,
    step: steps.map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })),
    tool: { '@type': 'HowToTool', name: tool.name },
  };
}

export function collectionPageLd(category: Category, tools: Tool[]): JsonLd {
  return {
    '@type': 'CollectionPage',
    name: category.title,
    description: category.description,
    url: absoluteUrl(categoryPath(category.slug)),
    isPartOf: { '@id': `${SITE.url}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: tools.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: t.name,
        url: absoluteUrl(toolPath(t)),
      })),
    },
  };
}

export function articleLd(input: {
  title: string;
  description: string;
  url: string;
  image: string;
  datePublished: string;
  dateModified?: string;
  author: string;
}): JsonLd {
  return {
    '@type': 'Article',
    headline: input.title,
    description: input.description,
    url: absoluteUrl(input.url),
    image: absoluteUrl(input.image),
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author: { '@type': 'Person', name: input.author },
    publisher: { '@id': `${SITE.url}/#organization` },
    mainEntityOfPage: absoluteUrl(input.url),
    inLanguage: SITE.language,
  };
}

/** Wrap a set of nodes in one @graph so a page emits a single JSON-LD script. */
export function graph(...nodes: (JsonLd | null | undefined)[]): string {
  const cleaned = nodes.filter((n): n is JsonLd => !!n).map(stripUndefined);
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': cleaned });
}

function stripUndefined(obj: JsonLd): JsonLd {
  return JSON.parse(JSON.stringify(obj));
}

function categoryToSchema(cat: Tool['category']): string {
  switch (cat) {
    case 'developer':
      return 'DeveloperApplication';
    case 'image':
    case 'pdf':
      return 'MultimediaApplication';
    default:
      return 'UtilitiesApplication';
  }
}
