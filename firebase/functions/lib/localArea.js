// Where local pickup is offered: Los Angeles County, by ZIP prefix
// (900–908, 910–918). 909 is the Inland Empire, 919+ San Diego, and 935
// (Lancaster/Palmdale) is left out since it's partly Kern County. The site's cart has its own copy of this rule
// (astro/src/lib/local-area.js); a test there keeps the two in step.

const ZIP = /^(\d{5})(?:-\d{4})?$/;

/**
 * @param {unknown} zip - a 5-digit ZIP or ZIP+4, from the shopper or Stripe
 * @returns {boolean}
 */
function isLocalZip(zip) {
  if (typeof zip !== 'string') {
    return false;
  }
  const match = ZIP.exec(zip.trim());
  if (!match) {
    return false;
  }
  const prefix = Number(match[1].slice(0, 3));
  return (prefix >= 900 && prefix <= 908) || (prefix >= 910 && prefix <= 918);
}

module.exports = { isLocalZip };
