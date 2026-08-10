# Astro Website Development Sprint - myfriendroze

## Current State Analysis

### ✅ What's Already Built
- Product data schema with 3+ handcrafted planters (Blue Branches, Yellow Lined, Pineapple)
- Product Card component with images, pricing, in-stock status
- Shop page with filters (availability, price) and product grid
- API endpoints: `/api/orders`, `/api/products/sync`, `/api/products/bulk-sync`, `/api/shipping`, `/api/newsletter`, `/api/health`
- ShippingCalculator component (USPS integration)
- Tailwind CSS + responsive design system
- Brand colors: accent grays, gradient backgrounds
- Shopify theme compatibility styles

---

## Phase 1: Complete Shop Functionality (CRITICAL)

- [ ] **Product detail page** (`/products/[handle].astro`) - image gallery, full description, shipping calculator
- [ ] Shopping cart state management (client-side with Astro actions or Context)
- [ ] Add-to-cart functionality from ProductCard & detail pages
- [ ] Cart drawer/modal component
- [ ] Cart persistence (localStorage/sessionStorage)
- [ ] **Checkout flow** - connect to `/api/orders` endpoint (Firebase Functions)
- [ ] Order confirmation page with summary
- [ ] Client-side form validation before submission

---

## Phase 2: Product & Inventory

- [ ] Expand product database (currently only 3 items)
- [ ] Category pages (filter by category)
- [ ] Search functionality
- [ ] **Inventory sync from Firebase** - use `/api/products/bulk-sync` endpoint
- [ ] Display inventory status dynamically
- [ ] Low-stock warnings

---

## Phase 3: Checkout Integration

- [ ] Customer form (name, email, phone, address) - map to Firebase schema
- [ ] Order item validation before submission
- [ ] Error handling & user feedback
- [ ] Success page with order ID
- [ ] Email confirmation (handled by Firebase Functions)

---

## Phase 4: Content & Brand

- [ ] Homepage hero section
- [ ] About page (story, mission, craftmanship)
- [ ] Blog/updates section (Markdown)
- [ ] Gallery of ceramic work
- [ ] Contact form
- [ ] FAQ section

---

## Phase 5: Email & Engagement

- [ ] Newsletter signup integration (ConvertKit via `/api/newsletter`)
- [ ] Marketing banners (seasonal promotions)
- [ ] Email preference management
- [ ] Announce new products flow

---

## Phase 6: Polish & Performance

- [ ] Mobile responsiveness testing (tablet/phone)
- [ ] SEO optimization (meta tags, structured data, sitemaps)
- [ ] Image optimization & lazy loading
- [ ] Core Web Vitals (LCP, CLS, FID)
- [ ] Accessibility (WCAG 2.1 AA)
- [ ] Analytics integration
- [ ] Error pages (404, 500, etc)

---

## Technical Details

| Question | Answer |
|----------|--------|
| **Product Data** | JavaScript objects in `syncedProducts.js` (in-memory, syncs with Flutter via API) |
| **Cart Strategy** | Client-side state management (Astro Server mode enabled) |
| **Brand Colors** | Grays: `#f3f3f3`, `#e8e8e8`; Gradient backgrounds; Shopify theme compatible |
| **Payment** | Orders only - no payment processing yet (handled by Firebase) |
| **Inventory Sync** | API endpoints exist: `/api/products/sync` (single), `/api/products/bulk-sync` (batch) |
| **Shipping** | USPS integration ready via `ShippingCalculator` component & USPS API |
| **Newsletter** | ConvertKit integration via `/api/newsletter` |
| **Server Mode** | `output: 'server'` - SSR enabled for API routes |

---

## Implementation Priority

1. **Product detail pages** - highest ROI
2. **Shopping cart** (client-side context/store)
3. **Checkout flow** - connect to existing `/api/orders` Firebase endpoint
4. **Expand product catalog** and sync with Flutter
5. **Brand content** (about, gallery, blog)

---

## Notes for Developers

- ProductCard already links to `/products/{handle}` - just need the detail page template
- Orders API validates: customer (email, name), items (1-50), total, currency, notes
- ShippingCalculator uses USPS RateV4 API - weight needed for shipping quotes
- All products have: id, handle, title, description, price, compareAtPrice, images[], tags[], inStock, category, dimensions, features, weight, seoTitle, seoDescription
- Cart should persist across sessions for better UX
- Firebase Functions handle email confirmations - no need to implement in Astro

