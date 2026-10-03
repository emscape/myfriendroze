// The cart's copy of where local pickup is offered: Los
// Angeles County ZIPs, by prefix 900–908 and 910–918. Checkout decides from
// firebase/functions/lib/localArea.js; local-area.test.mjs keeps the two in
// step. This copy only tells the shopper what checkout will offer.

const ZIP = /^(\d{5})(?:-\d{4})?$/;

/** @param {unknown} zip */
export function isLocalZip(zip) {
  if (typeof zip !== 'string') return false;
  const match = ZIP.exec(zip.trim());
  if (!match) return false;
  const prefix = Number(match[1].slice(0, 3));
  return (prefix >= 900 && prefix <= 908) || (prefix >= 910 && prefix <= 918);
}

/**
 * The note shown under the cart's ZIP field.
 * @param {string} zip - what the shopper has typed so far
 */
export function localZipHint(zip) {
  if (!/^\d{5}$/.test(zip.trim())) return '';
  return isLocalZip(zip)
    ? 'Free local pickup will be offered at checkout.'
    : 'Local pickup is only for Los Angeles County ZIP codes. Shipping is available anywhere in the US.';
}
