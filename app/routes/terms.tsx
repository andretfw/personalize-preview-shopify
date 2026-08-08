import styles from "./public-page.module.css";

export default function TermsOfService() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <p className={styles.eyebrow}>Personalize Preview</p>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.updated}>Last updated: August 8, 2026</p>

        <section className={styles.section}>
          <p>
            These Terms govern a Shopify merchant&apos;s use of Personalize Preview. By
            installing or using the app, the merchant agrees to use it in accordance
            with these Terms and Shopify&apos;s applicable terms and policies.
          </p>
        </section>

        <section className={styles.section}>
          <h2>What the app provides</h2>
          <p>
            Personalize Preview lets merchants enable personalization on selected
            products, configure printable areas, and let shoppers upload artwork, add
            text, preview a design, and attach confirmed customization details to a
            Shopify cart and order.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Merchant responsibilities</h2>
          <ul>
            <li>Configure products and print areas accurately before accepting orders.</li>
            <li>Test the storefront experience after theme or product changes.</li>
            <li>
              Ensure that products, artwork, text, and other customer-submitted content
              can lawfully be produced, sold, and fulfilled.
            </li>
            <li>
              Maintain any customer-facing policies, disclosures, consents, and order
              terms required for the merchant&apos;s business.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Customer content</h2>
          <p>
            The merchant remains responsible for deciding whether customer-submitted
            artwork and text can be accepted or fulfilled. Personalize Preview does not
            grant intellectual-property rights in customer content and does not certify
            that uploaded content is suitable for production.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Availability and changes</h2>
          <p>
            We may update, improve, or discontinue app features as the Shopify platform,
            security requirements, or the product evolves. We aim to provide a reliable
            service but do not guarantee uninterrupted availability.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Billing</h2>
          <p>
            If the app is offered on a paid plan, plan price, billing interval, trial,
            and included features are shown through Shopify before the merchant accepts
            a charge. Shopify handles app billing for supported public plans.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Termination</h2>
          <p>
            A merchant may stop using the service by uninstalling the app. We may limit
            or suspend access when necessary to protect the service, comply with law or
            Shopify requirements, or address misuse that threatens merchants, shoppers,
            or the platform.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Support</h2>
          <p>
            For product or account support, use the support contact provided on the
            Personalize Preview Shopify App Store listing or visit the public support
            page linked below.
          </p>
        </section>

        <nav className={styles.links} aria-label="Related pages">
          <a href="/">Home</a>
          <a href="/privacy">Privacy</a>
          <a href="/support">Support</a>
        </nav>
      </article>
    </main>
  );
}
