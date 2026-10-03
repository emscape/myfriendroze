import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Brevo escapes every {{ params.X }} it prints. lib/emailPayload.js already
// escapes these params itself (and ITEMS_TEXT carries <br> tags), so the
// templates must print them with |safe, or the email shows "&amp;",
// "&#39;" and literal "<br>" as text.
const CODE_ESCAPED = {
  'order-confirmation.html': ['ITEMS_TEXT', 'SHIPPING_ADDRESS'],
  'order-shipped.html': [
    'ORDER_NUMBER',
    'CARRIER',
    'TRACKING_NUMBER',
    'TRACKING_URL',
    'ESTIMATED_DELIVERY',
    'SHIPPING_ADDRESS',
  ],
};

function template(name) {
  return readFileSync(fileURLToPath(new URL(`../scripts/templates/${name}`, import.meta.url)), 'utf8');
}

describe('order email templates', () => {
  for (const [name, params] of Object.entries(CODE_ESCAPED)) {
    for (const param of params) {
      it(`${name} prints ${param} with |safe, since the code already escaped it`, () => {
        const uses = template(name).match(new RegExp(String.raw`\{\{\s*params\.${param}\b[^}]*\}\}`, 'g')) ?? [];

        expect(uses.length).toBeGreaterThan(0);
        for (const use of uses) {
          expect(use).toMatch(/\|\s*safe\s*\}\}$/);
        }
      });
    }
  }
});
