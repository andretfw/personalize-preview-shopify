# Shopify App Store submission pack

Prepared for the first public release of **LivePrint Preview**, developed by Fruttata.

The public app name is locked as **LivePrint Preview**. Internal technical identifiers such as the Worker URL and app-proxy path remain unchanged to avoid breaking the production integration.

---

## Recommended launch pricing

### Starter — $9.99/month

- 14-day free trial
- Unlimited personalized products
- Live artwork preview
- Customer image upload
- Custom text, font, color, size, and placement
- Product-specific printable areas
- Confirmed artwork saved in Shopify Files
- Customization details attached to cart/order data

Why this price: comparable Shopify product-personalization apps commonly start around $9-$10/month for live preview and file upload. A single launch plan avoids unnecessary feature gating in v1 and keeps merchant onboarding simple.

Use **Shopify App Pricing** in the Partner Dashboard. Set the welcome link to `/app`.

---

## App identity

- **Public app name:** LivePrint Preview
- **Developer / publisher:** Fruttata
- **Support email:** fruttataco@gmail.com

## App card subtitle

**Let shoppers preview custom artwork and text before they buy**

## App introduction (max 100 characters)

**Let shoppers preview artwork and text on products before ordering custom items.**

## App details (max 500 characters)

Let customers personalize products with their own artwork and text and see the result before adding to cart. Choose which products are personalizable, set a printable area for each product, and let shoppers move and resize their design in a live preview. Confirmed artwork is saved in Shopify Files and customization details are attached to the Shopify cart and order so fulfillment stays connected to the customer’s design.

## Feature list

- Live preview for customer artwork and custom text
- Product-specific printable areas configured in Shopify Admin
- PNG, JPG, and WebP customer artwork uploads up to 15 MB
- Move and resize artwork directly on the product preview
- Add text with font, color, size, and placement controls
- Save confirmed customer artwork in Shopify Files
- Attach confirmed customization details to cart and order data
- Enable personalization only on the products you choose

## Search terms

- product personalization
- live preview
- custom products
- image upload
- custom text

## Suggested category

Primary: **Selling products → Custom products**

Choose the most specific currently available structured tag for product personalization / custom file upload / live preview in the submission form.

## Languages

English for v1.

---

## Public resource URLs

After the production deployment containing the public-pages release:

- Privacy policy: `https://personalize-preview-shopify.tfwandre.workers.dev/privacy`
- Terms: `https://personalize-preview-shopify.tfwandre.workers.dev/terms`
- Support: `https://personalize-preview-shopify.tfwandre.workers.dev/support`
- Product website / landing page: `https://personalize-preview-shopify.tfwandre.workers.dev/`

Verify each URL in a private/incognito browser before submission.

---

## Listing image plan

Do not use browser chrome, desktop backgrounds, reviews, statistics, pricing, Shopify logos, or duplicate/near-duplicate images.

### App icon

- 1200 × 1200 PNG or JPEG
- Square corners; Shopify rounds them automatically
- Simple LivePrint Preview brand mark, no screenshot and no Shopify trademark

### Feature image

- 1600 × 900
- One clear focal point: a product with customer artwork shown inside the live print area
- Minimal copy; no pricing or performance claims

### Screenshot 1 — Product setup

Show Shopify Admin with a product selected and the green printable-area box positioned over the product image.

### Screenshot 2 — Customer customizer

Show the storefront customizer with an uploaded image inside the product preview and editing controls visible.

### Screenshot 3 — Text personalization

Show custom text on the live product preview with font/color/size controls.

### Screenshot 4 — Confirmed design

Show the design-confirmed state and the “Add personalized product to cart” action.

### Screenshot 5 — Bulk setup

Show the bulk product setup screen so merchants understand that multiple products can be configured efficiently.

---

## Reviewer setup instructions

1. Install LivePrint Preview on the review store.
2. Open **Home** in the embedded app.
3. Click **Add customizer to product template** in the onboarding panel.
4. In Shopify Theme Editor, add/save the **Product customizer** app block on a product template.
5. Return to the app and choose a product that has a product image.
6. Position/resize the green printable area.
7. Turn on **Enable personalization** and save. The button should change to **Saved ✓**.
8. Open that product on the storefront.
9. Click **Personalize this product**.
10. Upload a PNG/JPG/WebP image (15 MB or less), move/resize it, and optionally add text.
11. Click **Confirm design**.
12. Click **Add personalized product to cart**.
13. Verify the personalized line item is in the cart and the confirmed customization metadata is present for fulfillment.
14. Verify the uploaded artwork is available through Shopify Files / the order customization data.
15. Disable personalization for the product and confirm the storefront customizer no longer appears.

No third-party account is required for the core flow.

---

## Review screencast script

Record one continuous English-language screencast showing:

1. LivePrint Preview install/open in Shopify Admin.
2. The four-step onboarding panel.
3. Theme-editor deep link and Product customizer block placement.
4. Product selection and printable-area configuration.
5. Saving the enabled product.
6. Storefront upload + text + live preview.
7. Confirm design and add to cart.
8. The resulting personalized cart/order information.

Keep the video focused on setup and expected results and avoid showing private credentials or customer information.

---

## Technical pre-submission checklist

- [x] Embedded app architecture
- [x] Theme app extension used instead of modifying theme code
- [x] App proxy used for storefront server actions
- [x] Production URL points at Cloudflare Worker
- [x] Product settings stored through Shopify product metafields
- [x] Customer artwork uploaded directly to Shopify staged storage / Shopify Files
- [x] App uninstall webhook
- [x] App scopes-update webhook
- [x] Mandatory `customers/data_request` compliance webhook
- [x] Mandatory `customers/redact` compliance webhook
- [x] Mandatory `shop/redact` compliance webhook
- [x] Unused metaobject permissions removed
- [x] Public Privacy, Terms, and Support pages prepared
- [x] In-app theme-extension onboarding prepared
- [x] Final brand-first public app name selected: LivePrint Preview
- [x] `shopify.app.toml` public app name aligned with LivePrint Preview
- [x] Real monitored support email selected: fruttataco@gmail.com
- [x] Public Support, Privacy, and Terms pages include the support email
- [ ] Support email entered in the Shopify App Store listing
- [ ] Shopify App Pricing plan created in Partner Dashboard
- [x] Latest app version deployed with `shopify app deploy` (LivePrint Preview v33)
- [ ] Production environment variables/secrets verified
- [ ] Fresh-store end-to-end test completed
- [ ] Theme extension tested in at least one current Online Store 2.0 theme
- [ ] Public resource URLs checked while logged out
- [ ] App icon created
- [ ] Feature image created
- [ ] Unique listing screenshots created
- [ ] Reviewer screencast recorded
- [ ] Automated App Store preliminary checks all green
- [ ] $19 App Store registration fee completed if Shopify requests it for the Partner account
- [ ] App submitted for review
