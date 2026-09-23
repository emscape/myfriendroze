#!/usr/bin/env node
// One-off maintenance CLI for pushing template body content to Brevo via
// their REST API, bypassing the drag-and-drop editor entirely. Not part of
// the deployed Cloud Functions — run locally by a human with a Brevo API
// key in a gitignored .env file (see .env.example).
//
// Uses BREVO_TEMPLATE_CLI_API_KEY, not BREVO_API_KEY -- the deployed
// Functions already bind BREVO_API_KEY as a secret via defineSecret(), and
// Firebase Functions refuses to deploy when the same name exists in both a
// local .env file and a bound secret. A separate name avoids that collision
// even though this script and the Functions may hold the same key value.
//
// Usage:
//   node scripts/brevo-template.js list
//   node scripts/brevo-template.js check --id 2
//   node scripts/brevo-template.js push --id 2 --file scripts/templates/order-confirmation.html
//   node scripts/brevo-template.js push --id 2 --file <path> --activate
//   node scripts/brevo-template.js push --id 3 --file <path> --name "Order Shipped" \
//     --subject "Your order is on its way!" --sender-email orders@myfriendroze.com --sender-name myfriendroze
//   node scripts/brevo-template.js create --file <path> --name "Event Notification" \
//     --subject "{{ params.EVENT_TITLE }}" --sender-email events@myfriendroze.com --sender-name myfriendroze
//
// create defaults isActive to false unless --activate is passed. push omits
// isActive entirely unless --activate is passed, leaving Brevo's existing
// active state untouched -- a push against a template Brevo may already be
// using in production should not go live (or be taken down) as a side
// effect of a content update; activation must be opted into explicitly.

const fs = require('fs');
const path = require('path');

// Minimal .env loader — no dotenv dependency needed for a one-off script.
// Only understands simple KEY=VALUE lines; good enough for this file's
// single BREVO_TEMPLATE_CLI_API_KEY entry.
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, activate: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--id') args.id = rest[++i];
    else if (arg === '--file') args.file = rest[++i];
    else if (arg === '--activate') args.activate = true;
    else if (arg === '--name') args.name = rest[++i];
    else if (arg === '--subject') args.subject = rest[++i];
    else if (arg === '--sender-email') args.senderEmail = rest[++i];
    else if (arg === '--sender-name') args.senderName = rest[++i];
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return args;
}

async function brevoFetch(url, method, apiKey, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Brevo API ${method} ${url} failed (${res.status}): ${text}`);
  }
  return json;
}

function brevoRequest(method, id, apiKey, body) {
  return brevoFetch(`https://api.brevo.com/v3/smtp/templates/${id}`, method, apiKey, body);
}

// Lists every transactional template in the account (up to 50 — this
// account has a handful, no pagination needed).
function brevoListTemplates(apiKey) {
  return brevoFetch('https://api.brevo.com/v3/smtp/templates?limit=50', 'GET', apiKey);
}

async function main() {
  loadEnv(path.join(__dirname, '..', '.env'));
  const apiKey = process.env.BREVO_TEMPLATE_CLI_API_KEY;
  if (!apiKey) {
    console.error(
      'BREVO_TEMPLATE_CLI_API_KEY not set. Copy .env.example to .env in firebase/functions/ and fill in the key.'
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const needsId = args.command === 'check' || args.command === 'push';
  if (!args.command || (needsId && !args.id)) {
    console.error(
      'Usage:\n' +
        '  node scripts/brevo-template.js list\n' +
        '  node scripts/brevo-template.js check --id <templateId>\n' +
        '  node scripts/brevo-template.js push --id <templateId> --file <path> [--activate] [--name ...] [--subject ...] [--sender-email ...] [--sender-name ...]\n' +
        '  node scripts/brevo-template.js create --file <path> --name <name> --subject <subject> --sender-email <email> [--sender-name <name>] [--activate]'
    );
    process.exit(1);
  }

  if (args.command === 'list') {
    // Read-only — no changes made.
    const { templates } = await brevoListTemplates(apiKey);
    for (const t of templates) {
      const hasContent = Boolean(t.htmlContent && t.htmlContent.trim());
      console.log(`#${t.id} "${t.name}" — active: ${t.isActive}, has content: ${hasContent}`);
    }
    return;
  }

  if (args.command === 'check') {
    // Read-only — confirms the key works and shows current template state
    // without changing anything.
    const template = await brevoRequest('GET', args.id, apiKey);
    console.log(`Template #${template.id}: "${template.name}"`);
    console.log(`  subject: ${template.subject}`);
    console.log(`  sender: ${template.sender?.name} <${template.sender?.email}>`);
    console.log(`  active: ${template.isActive}`);
    console.log(`  has content: ${Boolean(template.htmlContent && template.htmlContent.trim())}`);
    return;
  }

  if (args.command === 'push') {
    if (!args.file) {
      console.error('push requires --file <path to html>');
      process.exit(1);
    }
    const htmlContent = fs.readFileSync(args.file, 'utf8');
    const body = { htmlContent };
    // isActive is deliberately omitted unless --activate is passed, so a
    // plain content push to an already-active production template doesn't
    // send isActive: false and deactivate it. Brevo leaves the template's
    // current active state untouched when the key isn't in the request body.
    if (args.activate) body.isActive = true;
    // Metadata flags are optional — lets push double as "repurpose this
    // blank template for a new purpose" (rename + subject + sender + content
    // in one call) as well as the plain "just update the body" case.
    if (args.name) body.templateName = args.name;
    if (args.subject) body.subject = args.subject;
    if (args.senderEmail) body.sender = { email: args.senderEmail, name: args.senderName || args.senderEmail };
    await brevoRequest('PUT', args.id, apiKey, body);
    // Brevo's PUT returns 204 No Content on success, so re-fetch to confirm.
    const template = await brevoRequest('GET', args.id, apiKey);
    console.log(`Pushed content to template #${args.id}: "${template.name}"`);
    console.log(`  subject: ${template.subject}`);
    console.log(`  sender: ${template.sender?.name} <${template.sender?.email}>`);
    console.log(`  active: ${template.isActive}`);
    console.log(`  has content: ${Boolean(template.htmlContent && template.htmlContent.trim())}`);
    return;
  }

  if (args.command === 'create') {
    if (!args.file || !args.name || !args.subject || !args.senderEmail) {
      console.error(
        'create requires --file <path>, --name <name>, --subject <subject>, --sender-email <email> [--sender-name <name>]'
      );
      process.exit(1);
    }
    const htmlContent = fs.readFileSync(args.file, 'utf8');
    const created = await brevoFetch('https://api.brevo.com/v3/smtp/templates', 'POST', apiKey, {
      templateName: args.name,
      subject: args.subject,
      sender: { email: args.senderEmail, name: args.senderName || args.senderEmail },
      htmlContent,
      isActive: args.activate,
    });
    console.log(`Created template #${created.id}: "${args.name}"`);
    console.log(`  active: ${args.activate}`);
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
