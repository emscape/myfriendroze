import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// require(), not a static ESM import -- unsubscribe.js requires() this
// module via CJS at the top of its file (used in its tested handler), and
// an ESM import vs. a CJS require() of the same file create two separate
// module instances under this suite's v8 coverage provider. See
// lib/confirmationToken.test.mjs's identical comment for the full story.
const require = createRequire(import.meta.url);
const { page } = require('./htmlPage.js');

describe('page', () => {
  it('renders the title, title color, and body into the page shell', () => {
    const html = page('Invalid Token', '#e74c3c', '<p>Body content</p>');

    expect(html).toContain('Invalid Token');
    expect(html).toContain('color: #e74c3c;');
    expect(html).toContain('<p>Body content</p>');
  });
});
