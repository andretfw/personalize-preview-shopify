# Fruttata Product Personalizer

A Shopify app and theme app extension for previewing customer artwork and text directly on a product before the personalized item is added to cart.

## What it does

- Enables personalization per product with a boolean product metafield.
- Uses product-specific print-area metafields with theme-block defaults as a fallback.
- Lets customers upload PNG, JPEG, or WebP artwork.
- Lets customers position and scale artwork inside the configured print area.
- Lets customers add, style, resize, and position text.
- Stores the confirmed artwork in Shopify Files.
- Adds the confirmed customization data to the cart as line-item properties.

## Architecture

### Theme app extension

`extensions/product-customizer/`

The product block renders the personalization launcher and studio. The small `product-customizer.js` asset lazy-loads the larger editor implementation only when a customer opens the studio, keeping the theme extension's declared JavaScript asset small.

### Storefront app proxy

`app/routes/app-proxy.ts`

The storefront calls `/apps/personalize-preview`. The proxy endpoint authenticates Shopify app-proxy POST requests and handles only small JSON messages.

Artwork bytes do **not** pass through the app server:

1. The browser asks the app proxy for a Shopify staged-upload target.
2. The browser uploads the image directly to Shopify's staged storage.
3. The app proxy creates the permanent Shopify file with `fileCreate`.
4. The browser polls until Shopify returns the final image URL.

This keeps customer image uploads out of the application server and avoids proxy request-size problems.

## Product metafields

The theme extension expects these product metafields:

| Namespace/key | Type | Purpose |
| --- | --- | --- |
| `custom.personalize_enabled` | Boolean | Show the personalizer on this product |
| `custom.personalize_print_left` | Integer | Print-area left position, percent |
| `custom.personalize_print_top` | Integer | Print-area top position, percent |
| `custom.personalize_print_width` | Integer | Print-area width, percent |
| `custom.personalize_print_height` | Integer | Print-area height, percent |

## Local development

Requirements:

- Node.js matching `package.json`
- Shopify CLI
- A Shopify development store

Install dependencies:

```bash
npm ci
```

Start Shopify development mode:

```bash
npm run dev
```

Shopify CLI updates the development application and proxy URLs automatically because `automatically_update_urls_on_dev` is enabled in `shopify.app.toml`.

The app-proxy health endpoint can be checked on the storefront at:

```text
/apps/personalize-preview
```

A working proxy returns JSON containing `"ok": true`.

## Verification

Run the full local verification suite with:

```bash
npm run check
```

This runs TypeScript checks, ESLint, and a production build. The same verification runs in GitHub Actions for pull requests.

## Security and repository hygiene

This repository is intended to be safe for public visibility:

- Secrets and local environment files are excluded by `.gitignore`.
- Shopify API secrets and access tokens must only be supplied through environment variables or Shopify CLI.
- The storefront upload endpoint validates MIME type and file size server-side.
- Unexpected server errors are logged server-side and are not returned verbatim to storefront users.
- Storefront POST requests are authenticated with Shopify's app-proxy authentication.

Never commit `.env` files, access tokens, session databases, private keys, or Shopify API secrets.

## Main components

```text
app/routes/app-proxy.ts
app/shopify.server.ts
extensions/product-customizer/blocks/product-customizer.liquid
extensions/product-customizer/assets/product-customizer.js
extensions/product-customizer/assets/product-customizer-core.js
extensions/product-customizer/assets/product-customizer.css
shopify.app.toml
```

## License

No license is granted unless a license file is added to this repository.
