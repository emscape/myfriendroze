// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server', // Enable server-side rendering for API routes
  adapter: node({ mode: 'middleware' }),
  // The site doesn't use astro:assets image optimization, but server output
  // always routes /_image. The passthrough service serves source images
  // unchanged, so that endpoint never decodes images with sharp/libvips
  // (attack surface of GHSA-26w7-cxv4-gfx2 and similar image-parsing bugs).
  image: {
    service: passthroughImageService()
  },
  // Astro 7 defaults to 'jsx' whitespace rules, which drop the spaces
  // between inline elements that the templates rely on (e.g. breadcrumb and
  // nav link separators). `true` is the lossless compression Astro used by
  // default before v7, so pages render as they did on 5.x.
  compressHTML: true,
  vite: {
    plugins: [tailwindcss()]
  }
});