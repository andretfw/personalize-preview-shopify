import styles from "../public-page.module.css";

export default function PrivacyPolicy() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <p className={styles.eyebrow}>LivePrint Preview</p>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: August 8, 2026</p>

        <section className={styles.section}>
          <p>
            This Privacy Policy explains how LivePrint Preview processes information
            when Shopify merchants install and use the app and when shoppers use the
            product personalization experience on a merchant&apos;s storefront.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Information we process</h2>
          <ul>
            <li>
              <strong>Shop and authentication data:</strong> the merchant&apos;s Shopify shop
              domain and Shopify session credentials needed to authenticate the app and
              call Shopify APIs.
            </li>
            <li>
              <strong>Product configuration:</strong> personalization-enabled status and
              product-specific print-area settings stored as Shopify product metafields.
            </li>
            <li>
              <strong>Customer artwork:</strong> images a shopper chooses to upload for a
              personalized product. The image bytes are uploaded directly from the
              shopper&apos;s browser to Shopify&apos;s staged upload service and then saved in
              the merchant&apos;s Shopify Files account.
            </li>
            <li>
              <strong>Customization details:</strong> confirmed artwork references, text,
              and placement details that are attached to the Shopify cart/order as line
              item properties so the merchant can fulfill the personalized product.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>How we use information</h2>
          <p>
            We use this information only to provide and secure the personalization
            service, save merchant configuration, process customer artwork through
            Shopify, attach confirmed customization details to orders, troubleshoot the
            app, and comply with legal or Shopify platform obligations.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Where information is stored</h2>
          <p>
            Customer artwork and order customization data are stored in the merchant&apos;s
            Shopify environment. Production app sessions are stored in Cloudflare KV so
            the app can authenticate Shopify API requests. The app does not operate a
            separate customer-profile database or sell customer information.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Service providers</h2>
          <p>
            The app relies on Shopify for commerce APIs, Shopify Files, cart and order
            records, and on Cloudflare for production application hosting and session
            storage. These providers process information under their own applicable
            terms and privacy commitments.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Retention and deletion</h2>
          <p>
            Shopify session records are removed when the app is uninstalled and when we
            receive Shopify&apos;s shop-redaction compliance request. Customer artwork and
            order records stored inside Shopify are controlled by the merchant and
            Shopify and follow the merchant&apos;s and Shopify&apos;s applicable retention rules.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Privacy requests</h2>
          <p>
            Shoppers should normally direct privacy requests to the Shopify merchant
            they purchased from. LivePrint Preview receives and responds to Shopify&apos;s
            mandatory customer data-request, customer-redaction, and shop-redaction
            compliance webhooks. For app-specific questions, email{" "}
            <a href="mailto:fruttataco@gmail.com">fruttataco@gmail.com</a>.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes</h2>
          <p>
            We may update this policy when the app, its service providers, or legal
            requirements change. The latest version will remain available at this URL.
          </p>
        </section>

        <nav className={styles.links} aria-label="Related pages">
          <a href="/">Home</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </nav>
      </article>
    </main>
  );
}
