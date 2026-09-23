// Escapes the five HTML-significant characters -- shared by any Brevo
// email payload builder that interpolates request-controlled text into a
// template body Brevo sends under this site's trusted sender identity.
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };
