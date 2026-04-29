import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['pdfkit'],
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: /[\\/](output|dist|\.repos|node_modules|\.next|\.git)[\\/]/,
      };
    }
    if (isServer) {
      config.externals = [...(config.externals || []), 'pdfkit'];
    }
    return config;
  },
};

export default nextConfig;
