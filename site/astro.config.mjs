import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://yogine.dev',
  output: 'static',
  trailingSlash: 'always',
  compressHTML: false, // compression drops the space before inline links ("See our<a>")
  build: { format: 'directory' },
  integrations: [sitemap()],
});
