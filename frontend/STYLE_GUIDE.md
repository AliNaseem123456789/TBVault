# TBVault — Style Guide

This is the reference for how the site looks and feels. The **actual, live
source of truth is code**: `src/styles/tokens.css`. Every value below is
just a human-readable explanation of what's already defined there — if this
document and that file ever disagree, `tokens.css` wins (and this doc should
be updated to match).

> **Golden rule:** never hardcode a color, font size, spacing value, radius
> or animation timing in a component's CSS. Always reference a token —
> `color: var(--color-accent)`, not `color: #FF5A2E`. This is what keeps
> every future page consistent with zero extra effort.

---

## 1. Brand palette

| Token | Value | Use it for |
|---|---|---|
| `--color-bg` | `#FAF8F4` | Page background (warm off-white, not stark white) |
| `--color-surface` | `#FFFFFF` | Cards, nav bar, form fields |
| `--color-surface-alt` | `#F1EEE7` | Subtle section backgrounds, hover states |
| `--color-border` / `--color-border-strong` | `#E7E2D6` / `#D8D2C2` | Dividers, card outlines |
| `--color-ink` | `#15140F` | Headings, primary body text |
| `--color-ink-muted` | `#635F55` | Secondary text, captions |
| `--color-ink-faint` | `#A6A197` | Placeholders, disabled text |
| `--color-accent` | `#FF5A2E` | Primary brand color — main CTAs, links, highlights |
| `--color-accent-hover` | `#E44A20` | Hover state for accent buttons |
| `--color-accent-soft` | `#FFE7DB` | Badge backgrounds, light tints |
| `--color-secondary` | `#14532D` | Deep green — used for contrast sections (e.g. the promo banner) |
| `--color-star` | `#F5A524` | Rating stars only |

**Rule of thumb:** one accent color (orange) does almost all the work.
The secondary green is reserved for a small number of high-contrast
"banner" moments — don't scatter it everywhere or it stops feeling special.

## 2. Typography

Font: **Manrope** (loaded via Google Fonts in `index.html`), falling back to
system sans-serif. One family for everything — headings just use a heavier
weight (`--weight-extra`, 800) rather than switching fonts.

| Token | Size | Typical use |
|---|---|---|
| `--text-xs` | 12px | Fine print, uppercase labels |
| `--text-sm` | 14px | Captions, nav links |
| `--text-base` | 16px | Body copy |
| `--text-md` | 18px | Lead paragraphs, card titles |
| `--text-lg` | 20px | Small headings |
| `--text-xl` | 24px | Section sub-headings |
| `--text-2xl` | 30px | Section headings |
| `--text-3xl` | 36px | Page headings |
| `--text-hero` | fluid, ~36–68px | Hero headline only |

Headings (`h1`–`h4`) are `--weight-extra` (800) and tight line-height
(`--leading-tight`, 1.1) by default via the global reset — you don't need to
set this yourself. Body copy uses `--leading-normal` (1.6).

## 3. Spacing

4px base scale, exposed as `--space-1` (4px) through `--space-11` (104px).
Always use a token for margin/padding/gap — never a raw pixel value. Two
page-level rhythm classes are ready to use:

- `.section` — standard vertical padding between major sections (80px)
- `.section-tight` — smaller vertical padding (48px), for sections that sit
  close together

## 4. Radius & shadow

Rounded, soft shapes are part of the brand feel — nothing on the site is
sharp-cornered.

| Token | Value | Use it for |
|---|---|---|
| `--radius-sm` | 8px | Inputs, small chips |
| `--radius-md` | 14px | Compact buttons |
| `--radius-lg` | 22px | Cards, product art |
| `--radius-xl` | 32px | Hero art, large feature panels |
| `--radius-full` | 999px | Pills — all buttons and badges use this |

Shadows (`--shadow-sm/md/lg`) are soft and warm-toned (not pure black) —
use `--shadow-md` for resting card elevation and `--shadow-lg` for a
hover/lifted state. `--shadow-accent` is a colored glow reserved for the
primary CTA button.

## 5. Motion

- `--duration-fast` (150ms) for hovers, `--duration-base` (250ms) for most
  transitions, `--duration-slow` (500ms) for scroll-entrance animations.
- `--ease-out` is the default easing for anything entering or moving —
  it matches the "soft landing" feel used throughout.
- **Scroll-reveal:** wrap any new section (or grid item) in the `<Reveal>`
  component (`src/components/ui/Reveal.jsx`) instead of writing new
  animation CSS. It adds `.reveal` / `.is-visible` (defined in
  `global.css`) once the element scrolls into view. Use the `delay={1-4}`
  prop to stagger a row of cards.
- **Scrolling banners:** use the `<Marquee>` component
  (`src/components/ui/Marquee.jsx`) rather than a new `@keyframes` block.
- Everything above respects `prefers-reduced-motion` automatically (handled
  once, globally, in `global.css`) — you don't need to think about it per
  component.

## 6. Breakpoints

Plain CSS can't read custom properties inside `@media` queries, so these
are fixed numbers — always write media queries against these exact values
so responsive behavior stays consistent across pages:

```
xs: 0–479px    (default styles, mobile-first)
sm: 480–767px
md: 768–1023px
lg: 1024–1279px
xl: 1280px+
```

Most components only need one breakpoint (`max-width: 1023px` for
"collapse to mobile nav / stack the grid"). Only add more if a layout
specifically needs it.

## 7. Core components

- **Buttons** — always use `<Button>` (`src/components/ui/Button.jsx`),
  never a raw `<button className="btn ...">`. Variants: `primary` (solid
  accent, main CTA), `ghost` (outlined, secondary action), `light` (white,
  for use on dark/colored backgrounds). Sizes: default, `sm`, `lg`.
- **Cards** — apply `.card` for the base style and `.card-hover` to add the
  lift-on-hover interaction (used by `ProductCard` and the category tiles).
- **Badges** — `.badge` (accent tint) and `.badge-secondary` (green tint)
  for small status/label chips ("New", "Sale", "Trending now").
- **Icons** — `<Icon name="..." />` (`src/components/ui/Icon.jsx`). It's a
  small hand-drawn set with zero dependency; add new icons by adding an SVG
  path to the `paths` map in that file. Every icon-only button must still
  get an `aria-label`.
- **Product cards** — `<ProductCard product={...} />` is the standard tile
  for any product grid (landing page today, Shop/Category pages later).

## 8. Accessibility notes

- Every icon-only button (search, cart, menu) has an `aria-label`.
- Focus states are visible everywhere (`:focus-visible` gets a 2px accent
  outline, set once globally — don't remove it with `outline: none`).
- Motion respects `prefers-reduced-motion` automatically.
- Text-on-color combinations (accent orange, secondary green, ink black)
  were chosen to stay comfortably readable — if you introduce a new
  color pairing, check contrast before shipping it.

## 9. Do / Don't

- **Do** add new colors/sizes as a new token in `tokens.css` if a page
  genuinely needs one — then use the token everywhere, not a one-off hex.
- **Don't** import a second font family "just for this one heading."
- **Don't** write a new button style in a page's CSS — extend `Button.jsx`
  with a new variant instead, so every page benefits.
- **Don't** reach for a UI/animation library (Tailwind, Framer Motion, MUI,
  etc.) without a reason — the current system covers buttons, cards,
  badges, grids and scroll/marquee animation with zero extra dependencies.
  If a future page genuinely needs something this system doesn't cover,
  add it deliberately and document the decision here.
