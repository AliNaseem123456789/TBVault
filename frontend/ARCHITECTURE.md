# TBVault Frontend — Architecture & Page Guide

How the frontend is organized, and the exact steps to add a new page so it
stays consistent with everything already built. Pair this with
`STYLE_GUIDE.md` (the visual rules) — this file is about structure and
wiring.

Stack: React 19 + Vite, `react-router-dom` v7 for routing, `axios` for API
calls. No CSS framework — plain CSS files built on the design tokens in
`src/styles/tokens.css`. No component library — everything in
`src/components/ui/` is hand-built and small on purpose.

## 1. Folder map

```
src/
  api/                  Backend calls. One file per resource (auth.api.js
                         today). apiClient.js holds the shared axios
                         instance (base URL, interceptors, auth headers).

  components/
    ui/                 Small, reusable, page-agnostic pieces:
                         Button, Icon, ProductCard, Marquee, Reveal.
                         These know nothing about any specific page.
    layout/             Navbar, Footer, Layout (wraps public pages with
                         both). Also page-agnostic, but bigger/structural.

  features/auth/        Everything to do with authentication: Login,
                         Signup, Profile, password reset/verify flows,
                         AuthProvider (the auth context), ProtectedRoute.
                         This "feature folder" pattern predates this
                         change — keep auth-related screens here.

  pages/                Public storefront pages. One folder per page.
    Landing/
      Landing.jsx        Composes the page from sections/
      Landing.css         Page-specific layout only
      sections/           One component per section (Hero, Categories, ...)
                           plus placeholderData.js for mock content

  styles/
    tokens.css           Design tokens — see STYLE_GUIDE.md
    global.css            Reset, base tags, shared utility classes

  App.jsx                Route table
  main.jsx                Entry point (mounts App, imports index.css)
  index.css               Just `@import './styles/global.css'`
```

**Where does a new screen go?**
- Related to sign-in/account/password → `src/features/auth/` (existing
  pattern, keep using it).
- A public storefront screen (shop, product, cart, categories, about...) →
  new folder under `src/pages/`.

## 2. How pages connect — the Layout pattern

`src/components/layout/Layout.jsx` renders the announcement marquee, the
`Navbar`, an `<Outlet />` (React Router's placeholder for the matched child
route), and the `Footer`. In `App.jsx`, every public page is nested inside
one `<Route element={<Layout />}>` block:

```jsx
<Route element={<Layout />}>
  <Route path="/" element={<Landing />} />
  {/* add new public pages here, as siblings of Landing */}
</Route>
```

Anything inside that block automatically gets the marquee + nav + footer —
**a page component should never import Navbar or Footer itself.** Auth
screens (`/login`, `/sign-up`, etc.) intentionally sit outside that block
since they're full-screen forms without site chrome, matching how they
were already built.

The catch-all route (`path="*"`) redirects unknown URLs to `/` (the
homepage) rather than forcing everyone to `/login` — appropriate for a
public storefront where most visitors aren't signed in.

## 3. Adding a new page — step by step

Example: adding a `/shop` page.

1. **Create the folder:** `src/pages/Shop/`.
2. **Build it:** `Shop.jsx` + `Shop.css`. Compose it from:
   - Shared UI pieces (`Button`, `Icon`, `ProductCard`, `Marquee`) from
     `src/components/ui/`.
   - Utility classes from `global.css` (`.container`, `.section`, `.card`,
     `.badge`, `.section-heading`) instead of writing new ones.
   - Design tokens from `tokens.css` for anything page-specific
     (`var(--color-accent)`, `var(--space-6)`, etc.) — never a raw value.
3. **If the page has several large, distinct sections** (like Landing
   does), mirror that pattern: a `sections/` subfolder with one component
   per section, composed together in `Shop.jsx`. If it's a simple page,
   one file is fine.
4. **Animate section entrances** by wrapping each section (or each grid
   item, for a staggered effect) in `<Reveal>` — see STYLE_GUIDE.md § 5.
5. **Register the route** in `App.jsx`, inside the existing `<Layout />`
   block:
   ```jsx
   <Route element={<Layout />}>
     <Route path="/" element={<Landing />} />
     <Route path="/shop" element={<Shop />} />
   </Route>
   ```
6. **Link to it** — add an entry to `NAV_LINKS` in
   `src/components/layout/Navbar.jsx` and/or a link in
   `src/components/layout/Footer.jsx` if it should be discoverable from
   navigation.

## 4. Wiring up real data

Placeholder content (e.g. `src/pages/Landing/sections/placeholderData.js`)
stands in for a backend that doesn't have those endpoints yet. When a real
endpoint exists, follow the existing `auth` pattern instead of fetching
ad-hoc:

1. Add a file in `src/api/`, e.g. `products.api.js`, that uses the shared
   `apiClient` from `src/api/apiClient.js` — mirror the shape of
   `src/api/auth.api.js`.
2. Call it from the page with `useState` + `useEffect` (or a small custom
   hook if several pages need the same data), and pass the result into
   the same presentational components (`ProductCard`, etc.) that
   currently receive placeholder data — the components themselves don't
   need to change.
3. Delete the corresponding placeholder export once it's replaced.

## 5. Naming & file conventions

- Component files: `PascalCase.jsx`, with a co-located `PascalCase.css`
  when the component needs its own styles.
- CSS classes: lowercase, hyphenated, prefixed with the component name in
  BEM-ish form — `.product-card`, `.product-card__price`,
  `.product-card__price--old`. This avoids collisions since there's no
  CSS Modules/scoping in this project.
- One `.css` file per component or per page — don't split one component's
  styles across multiple files, and don't put unrelated components' styles
  in the same file.
- Reusable, page-agnostic pieces go in `components/ui` or
  `components/layout`. Anything specific to one page's layout stays in
  that page's own folder.

## 6. Before you consider a page "done"

- Every color/spacing/radius/font-size traces back to a token — no raw
  hex codes or magic pixel values.
- Layout checked at ≥1024px, ~768px, and ~375px widths.
- New sections wrapped in `<Reveal>` for a consistent entrance animation.
- Route added in `App.jsx`; nav/footer links added if the page should be
  discoverable.
- Every icon-only button has an `aria-label`.
- `npm run lint` passes.

## 5. Commerce features (added October 2026)

New feature folders, following the `features/auth` pattern:

```
features/cart/        CartProvider: server cart when signed in, browser (localStorage)
                      cart for guests, merged into the account on login
features/wishlist/    WishlistProvider: saved product ids, shared by every heart button
features/addresses/   AddressForm + AddressBook (profile page) + AddressSummary (checkout)
features/orders/      OrderView (shared by /orders/:id and /track/:token), OrderTimeline,
                      ReturnRequestForm, useOrderLoader (polls after Stripe redirects back)
features/store/       useStoreConfig (tax, free-shipping threshold, card payments on/off),
                      visitTracker (one anonymous visit per browser per day)
```

New pages: `Deals` (/deals), `Wishlist` (/wishlist), `Track` (/track and
/track/:token for guests), `Invoice` (printable receipt, outside Layout so
printing is clean). The admin dashboard has one component per tab in
`pages/Admin/` and keeps the active tab in `?tab=`.

**Prices are never computed in the browser for checkout.** The cart drawer
shows a display subtotal, but checkout totals (sales, coupon, shipping zone,
tax) come from `POST /order/quote`, and placing an order re-prices it on the
server. Use `unitPrice()` and `mapProductForCard()` in `utils/product.js` to
show a product's price, so sale prices and "From $x" for products with
options look the same everywhere.

## 6. Marketplace and store credit (added October 2026)

**Roles.** `CUSTOMER`, `SELLER`, `ADMIN`. Seller access is decided by an APPROVED row in
`sellers` (checked on every `/seller/*` request), not only by the role in the token, so
approving or suspending a seller works immediately. The store's own catalogue belongs to the
platform seller (`is_platform`), so every product has a seller.

| Who | Pages | API |
|---|---|---|
| Anyone | `/sell` (apply / status), `/stores/:slug` | `GET /stores/:slug`, `GET /products?sellerId=&brandId=` |
| Seller | `/seller` (overview, orders, products, earnings, store) | `/seller/products`, `/seller/orders`, `/seller/dashboard`, `/seller/transactions` |
| Admin | `/admin` tabs Sellers, Brands, Gift cards; credit in Customers | `/admin/sellers`, `/admin/brands`, `/admin/gift-cards`, `/admin/customers/:id/credits` |
| Customer | `/wallet`, "Use store credit" at checkout | `/wallet`, `/wallet/topup`, `/wallet/redeem`, `use_credits` on `/order` |

**Split orders.** An order gets one `seller_orders` row per seller (their items, commission
and earnings). Sellers move their part pending → confirmed → shipped → delivered; the order
follows the slowest part. Earnings reach the seller's balance once their part is delivered
and the order is paid; admins record payouts (money sent outside the site).

**Product screens are shared.** `AdminProducts` / `ProductEditor` / `VariantsEditor` read their
API from `CatalogApiContext` (`pages/Admin/catalogContext.js`): admin endpoints by default,
`sellerCatalog` inside the seller dashboard.

**Store credit.** `users.credit_balance` changes only together with a `credit_transactions` row
(`services/wallet/wallet.service.js`). Credit can pay part or all of an order; a card pays the
rest. Refunds go back the way they were paid, or to store credit when the admin chooses.
