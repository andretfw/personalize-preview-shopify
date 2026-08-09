import styles from "../public-page.module.css";

export default function Support() {
  return (
    <main className={styles.page}>
      <article className={styles.shell}>
        <p className={styles.eyebrow}>LivePrint Preview</p>
        <h1 className={styles.title}>Support</h1>
        <p className={styles.updated}>Setup and troubleshooting</p>

        <section className={styles.section}>
          <div className={styles.notice}>
            For direct support, email{" "}
            <a href="mailto:fruttataco@gmail.com">fruttataco@gmail.com</a>. Include your
            store domain, the product you are testing, and a short description of what
            happened.
          </div>
        </section>

        <section className={styles.section}>
          <h2>Quick setup</h2>
          <ol>
            <li>Install LivePrint Preview in Shopify Admin.</li>
            <li>Add the Product customizer app block to your product template.</li>
            <li>Open the app and choose a product.</li>
            <li>Position and size the printable area.</li>
            <li>Turn on Enable personalization and save the product setup.</li>
            <li>
              Open the storefront product page and test artwork upload, text, preview,
              confirmation, and add to cart.
            </li>
          </ol>
        </section>

        <section className={styles.section}>
          <h2>The customizer does not appear</h2>
          <ul>
            <li>Confirm that personalization is enabled and saved for that product.</li>
            <li>Confirm that the Product customizer block is on the product template.</li>
            <li>Confirm that you are viewing the same product/template you configured.</li>
            <li>Save the theme editor after adding or moving the app block.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Artwork upload does not finish</h2>
          <ul>
            <li>Use PNG, JPG/JPEG, or WebP artwork.</li>
            <li>Keep the file at or below 15 MB.</li>
            <li>Try the upload again after Shopify finishes processing the file.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>What to send support</h2>
          <p>
            Please include the Shopify store domain, product title, theme name, browser,
            a screenshot or short screen recording, and the exact error message if one
            appeared. Do not send passwords, private API keys, or access tokens.
          </p>
        </section>

        <nav className={styles.links} aria-label="Related pages">
          <a href="/">Home</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </article>
    </main>
  );
}
