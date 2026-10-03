// Browser-side rendering for the /cart page. The logic it relies on lives
// in cart.js, cart-view.js and cart-store.js (all unit-tested); this file
// only turns a cart view into DOM and wires up the controls. Everything is
// built with textContent/attributes, never innerHTML, so product data can't
// inject markup.

import { setQuantity, removeFromCart } from './cart.js';
import { buildCartView, formatPrice, reconcileCart } from './cart-view.js';
import { loadCart, saveCart, onCartChange, markCartCheckoutStarted } from './cart-store.js';
import { requestCheckout } from './checkout-client.js';
import { isLocalZip, localZipHint } from './local-area.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readCatalog() {
  try {
    const parsed = JSON.parse(document.getElementById('cart-catalog')?.textContent ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderLine(line) {
  const item = el('li', `cart-line cart-line--${line.status}`);
  item.dataset.sku = line.sku;

  if (line.image) {
    const img = el('img', 'cart-line__image');
    img.src = line.image;
    img.alt = '';
    img.loading = 'lazy';
    item.append(img);
  } else {
    item.append(el('span', 'cart-line__image-placeholder'));
  }

  const info = el('div', 'cart-line__info');
  if (line.href) {
    const link = el('a', 'cart-line__title', line.title);
    link.href = line.href;
    info.append(link);
  } else {
    info.append(el('span', 'cart-line__title', line.title));
  }

  if (line.status === 'ok') {
    info.append(el('p', 'cart-line__detail', `${formatPrice(line.priceCents)} each`));
  } else if (line.status === 'sold-out') {
    info.append(el('p', 'cart-line__detail', 'Sold out'));
  }

  const controls = el('div', 'cart-line__controls');
  if (line.status === 'ok' && line.maxQty > 1) {
    const label = el('label', null, 'quantity');
    const select = el('select');
    select.dataset.action = 'qty';
    for (let n = 1; n <= line.maxQty; n++) {
      const option = el('option', null, String(n));
      option.value = String(n);
      option.selected = n === line.qty;
      select.append(option);
    }
    label.append(select);
    controls.append(label);
  } else if (line.status === 'ok') {
    controls.append(el('span', null, 'one of a kind'));
  }
  const remove = el('button', 'cart-line__remove', 'remove');
  remove.type = 'button';
  remove.dataset.action = 'remove';
  remove.setAttribute('aria-label', `Remove ${line.title}`);
  controls.append(remove);
  info.append(controls);
  item.append(info);

  if (line.status === 'ok') {
    item.append(el('p', 'cart-line__total', formatPrice(line.lineTotalCents)));
  }
  return item;
}

export function initCartPage() {
  const linesList = document.querySelector('[data-cart-lines]');
  const emptyNote = document.querySelector('[data-cart-empty]');
  const problemsNote = document.querySelector('[data-cart-problems]');
  const summary = document.querySelector('[data-cart-summary]');
  const subtotal = document.querySelector('[data-cart-subtotal]');
  const checkoutButton = document.querySelector('[data-cart-checkout]');
  const message = document.querySelector('[data-cart-message]');
  const localZipInput = /** @type {HTMLInputElement | null} */ (document.querySelector('[data-cart-local-zip]'));
  const localZipNote = document.querySelector('[data-cart-local-hint]');
  if (!linesList || !checkoutButton) return;

  localZipInput?.addEventListener('input', () => {
    localZipInput.value = localZipInput.value.replace(/\D/g, '').slice(0, 5);
    if (localZipNote) localZipNote.textContent = localZipHint(localZipInput.value);
  });

  const catalog = readCatalog();
  // The page was rendered with checkout disabled if the catalog failed to load.
  const catalogLoaded = !checkoutButton.disabled;
  let view = buildCartView(loadCart(), catalog);
  let submitting = false;

  const STORAGE_ERROR = "Couldn't save your cart. Your browser may be blocking site storage.";

  function render(stored) {
    // Adopt live categories and limits first, so the controls and the
    // post-payment cleanup agree with what's shown. Rendering carries on
    // with the reconciled cart either way (the first render runs before
    // onCartChange is listening); any nested re-render finds nothing left
    // to change.
    const { cart, changed } = reconcileCart(stored, catalog);
    // If the corrected cart can't be saved, checking it out would leave the
    // stored cart and the purchase out of step, so checkout stays off.
    const reconcileFailed = changed && !saveCart(cart);
    if (reconcileFailed) showMessage(STORAGE_ERROR);
    view = buildCartView(cart, catalog);
    // Re-rendering replaces the controls, so put keyboard focus back on the
    // equivalent control of the same line.
    const focused = /** @type {HTMLElement | null} */ (document.activeElement);
    const focusSku = focused?.closest('.cart-line')?.getAttribute('data-sku');
    const focusAction = focused?.dataset?.action;

    linesList.replaceChildren(...view.lines.map(renderLine));
    const empty = view.lines.length === 0;
    if (emptyNote) emptyNote.hidden = !empty;
    if (summary) summary.hidden = empty;
    if (problemsNote) problemsNote.hidden = !view.hasProblems;
    if (subtotal) subtotal.textContent = formatPrice(view.subtotalCents);
    checkoutButton.disabled =
      !catalogLoaded || submitting || reconcileFailed || view.hasProblems || view.checkoutItems.length === 0;

    if (focusSku && focusAction) {
      const line = [...linesList.children].find((li) => li.getAttribute('data-sku') === focusSku);
      /** @type {HTMLElement | null | undefined} */ (line?.querySelector(`[data-action="${focusAction}"]`))?.focus();
    }
  }

  function showMessage(text) {
    if (!message) return;
    message.textContent = text;
    message.hidden = !text;
  }

  linesList.addEventListener('change', (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    const sku = select.closest('.cart-line')?.getAttribute('data-sku');
    if (select.dataset.action === 'qty' && sku) {
      if (!saveCart(setQuantity(loadCart(), sku, Number(select.value)))) {
        // Put the control back to what's actually saved.
        showMessage(STORAGE_ERROR);
        render(loadCart());
      }
    }
  });

  linesList.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-action="remove"]');
    const sku = button?.closest('.cart-line')?.getAttribute('data-sku');
    if (sku) {
      if (!saveCart(removeFromCart(loadCart(), sku))) {
        showMessage(STORAGE_ERROR);
        return;
      }
      // The removed line's button is gone; keep focus in the cart.
      /** @type {HTMLElement | null} */ (linesList.querySelector('[data-action="remove"]') ?? checkoutButton)?.focus();
    }
  });

  // Straight to Stripe: its checkout page collects the shopper's details.
  checkoutButton.addEventListener('click', async () => {
    if (submitting || view.hasProblems || view.checkoutItems.length === 0) return;
    const items = view.checkoutItems;

    submitting = true;
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'opening checkout…';
    showMessage('');

    try {
      // Only an LA ZIP is sent; checkout re-checks it before offering local options.
      const zip = localZipInput?.value ?? '';
      const { url, sessionId } = await requestCheckout(items, undefined, undefined, isLocalZip(zip) ? zip : null);
      // So the success page for this checkout removes exactly these pieces.
      markCartCheckoutStarted(items, sessionId);
      window.location.href = url;
      return;
    } catch (error) {
      showMessage(error.message);
    }
    submitting = false;
    checkoutButton.textContent = 'check out';
    render(loadCart());
  });

  render(loadCart());
  onCartChange(render);
}
