import type { NextConfig } from 'next';
import path from 'node:path';
import type { Configuration } from 'webpack';

const nextConfig: NextConfig = {
  transpilePackages: ['repo-audit-delivery-agent'],
  webpack: (config: Configuration) => {
    // Resolve @agent/* path alias to the agent core src directory.
    // Webpack handles cross-directory TypeScript imports reliably.
    if (config.resolve) {
      config.resolve.alias = {
        ...(config.resolve.alias as Record<string, string>),
        '@agent': path.resolve(__dirname, '../src'),
      };
    }
    return config;
  },
};

export default nextConfig;
