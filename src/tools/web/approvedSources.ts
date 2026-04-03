/**
 * Approved documentation sources for web search and URL fetching.
 * The agent should prefer these domains when searching for documentation.
 */

export interface ApprovedSource {
  domain: string;
  description: string;
  platforms: string[]; // which platforms this source is relevant for
}

const APPROVED_SOURCES: ApprovedSource[] = [
  // Sitecore
  {
    domain: 'doc.sitecore.com',
    description: 'Official Sitecore documentation',
    platforms: ['sitecore'],
  },
  {
    domain: 'github.com/sitecore/jss',
    description: 'Sitecore JSS SDK repository and changelog',
    platforms: ['sitecore'],
  },
  {
    domain: 'github.com/sitecore/xmcloud-starter-js',
    description: 'Official XM Cloud starter template',
    platforms: ['sitecore'],
  },

  // Optimizely
  {
    domain: 'docs.developers.optimizely.com',
    description: 'Official Optimizely developer documentation',
    platforms: ['optimizely'],
  },
  {
    domain: 'github.com/remkoj/optimizely-saas-starter',
    description: 'Community Optimizely SaaS starter',
    platforms: ['optimizely'],
  },
  {
    domain: 'github.com/remkoj/optimizely-dxp-clients',
    description: '@remkoj package source and changelog',
    platforms: ['optimizely'],
  },

  // Next.js
  {
    domain: 'nextjs.org',
    description: 'Official Next.js documentation and upgrade guides',
    platforms: ['sitecore', 'optimizely'],
  },
  {
    domain: 'github.com/vercel/next.js',
    description: 'Next.js repository, issues, and release notes',
    platforms: ['sitecore', 'optimizely'],
  },

  // React
  {
    domain: 'react.dev',
    description: 'Official React documentation',
    platforms: ['sitecore', 'optimizely'],
  },

  // npm
  {
    domain: 'npmjs.com',
    description: 'npm package registry',
    platforms: ['sitecore', 'optimizely'],
  },

  // TypeScript
  {
    domain: 'typescriptlang.org',
    description: 'Official TypeScript documentation',
    platforms: ['sitecore', 'optimizely'],
  },

  // Tailwind CSS
  {
    domain: 'tailwindcss.com',
    description: 'Tailwind CSS documentation',
    platforms: ['sitecore', 'optimizely'],
  },

  // GraphQL
  {
    domain: 'graphql.org',
    description: 'GraphQL specification and documentation',
    platforms: ['sitecore', 'optimizely'],
  },

  // Vercel
  {
    domain: 'vercel.com/docs',
    description: 'Vercel deployment documentation',
    platforms: ['sitecore', 'optimizely'],
  },

  // MDN
  {
    domain: 'developer.mozilla.org',
    description: 'MDN Web Docs — web standards reference',
    platforms: ['sitecore', 'optimizely'],
  },

  // Stack Overflow
  {
    domain: 'stackoverflow.com',
    description: 'Stack Overflow Q&A',
    platforms: ['sitecore', 'optimizely'],
  },

  // GitHub Docs
  {
    domain: 'docs.github.com',
    description: 'GitHub documentation',
    platforms: ['sitecore', 'optimizely'],
  },
];

/**
 * Returns all approved sources, optionally filtered by platform.
 */
export function getApprovedSources(platform?: string): ApprovedSource[] {
  if (!platform) return APPROVED_SOURCES;
  return APPROVED_SOURCES.filter(
    (s) => s.platforms.includes(platform) || s.platforms.length === 0,
  );
}

/**
 * Returns just the domain list for filtering search results.
 */
export function getApprovedDomains(platform?: string): string[] {
  return getApprovedSources(platform).map((s) => s.domain);
}
