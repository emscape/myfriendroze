// Where /api/newsletter.js (running inside the ssrAstro Cloud Function)
// sends its server-to-server request to newsletterSignup. Unlike checkout,
// this hits the raw Cloud Functions URL directly in both environments --
// no Hosting rewrite needed, since (per the astro-ssr-stripe-golive-session
// history) a Hosting rewrite target still requires the same allUsers
// invoker access a raw URL does; it doesn't grant any privileged bypass.
// newsletterSignup.js declares invoker: 'public' for exactly this reason.
export function buildNewsletterSignupUrl({ isDevelopment, projectId, region }) {
  if (isDevelopment) {
    return `http://127.0.0.1:5001/${projectId}/${region}/newsletterSignup`;
  }
  return `https://${region}-${projectId}.cloudfunctions.net/newsletterSignup`;
}
