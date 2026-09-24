// Shared inline-styled HTML page shell for any onRequest Cloud Function
// that renders a plain result page directly (no Astro route involved) --
// e.g. unsubscribe.js and confirmNewsletterSignup.js. Extracted so both
// use one copy instead of duplicating the same template literal.
function page(title, titleColor, bodyHtml) {
  return `
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h2 style="color: ${titleColor};">${title}</h2>
          ${bodyHtml}
        </body>
      </html>
    `;
}

module.exports = { page };
