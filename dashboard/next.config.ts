import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['repo-audit-delivery-agent'],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
