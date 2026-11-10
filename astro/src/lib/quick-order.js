// Quick order: a ProductCard button that goes straight to Stripe for that
// one piece. Stripe's checkout page collects the shopper's details. Used by
// the shop pages and the /reserved/<code> page. The button keeps its
// historical .product-card__add-to-cart class because the shop's
// sort/filter code reads price and stock from it.

import { requestCheckout } from './checkout-client.js';
import { clearCartCheckoutMark } from './cart-store.js';

/* v8 ignore start -- DOM wiring, checked in the browser */
export function wireQuickOrder() {
  document.querySelectorAll('.product-card__add-to-cart').forEach((button) => {
    button.addEventListener('click', async () => {
      const sku = button.dataset.productId;
      if (!sku || button.disabled) return;
      const label = button.textContent;
      const error = button.closest('.product-card__actions')?.querySelector('[data-quick-order-error]');
      button.disabled = true;
      button.textContent = 'opening checkout…';
      if (error) error.hidden = true;
      try {
        const { url } = await requestCheckout([{ sku, qty: 1 }]);
        // A quick order must never empty the cart on the success page.
        clearCartCheckoutMark();
        window.location.href = url;
      } catch (err) {
        if (error) {
          error.textContent = err instanceof Error ? err.message : String(err);
          error.hidden = false;
        }
        button.disabled = false;
        button.textContent = label;
      }
    });
  });
}
/* v8 ignore stop */
