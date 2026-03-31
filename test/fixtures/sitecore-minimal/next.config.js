const { withSitecoreConfig } = require('@sitecore-jss/sitecore-jss-nextjs');

const nextConfig = {
  images: {
    domains: ['cm.example.com'],
  },
  env: {
    SITECORE_API_HOST: process.env.SITECORE_API_HOST,
  },
  i18n: {
    locales: ['en'],
    defaultLocale: 'en',
  },
};

module.exports = withSitecoreConfig(nextConfig);
