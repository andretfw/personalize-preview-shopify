import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <main className={styles.index}>
      <section className={styles.content}>
        <div className={styles.badge}>Shopify product personalization</div>
        <h1 className={styles.heading}>LivePrint Preview</h1>
        <p className={styles.text}>
          Let shoppers upload artwork, add text, and preview a personalized product
          before adding it to cart.
        </p>

        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
              />
            </label>
            <button className={styles.button} type="submit">
              Open app
            </button>
          </Form>
        )}

        <div className={styles.features}>
          <article>
            <strong>Live product preview</strong>
            <span>Customers position artwork and text directly on the product.</span>
          </article>
          <article>
            <strong>Product-specific print areas</strong>
            <span>Configure the printable area for each product from Shopify Admin.</span>
          </article>
          <article>
            <strong>Artwork saved with the order</strong>
            <span>Confirmed artwork is stored in Shopify Files and attached to order data.</span>
          </article>
        </div>

        <nav className={styles.footerLinks} aria-label="Legal and support">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </nav>
      </section>
    </main>
  );
}
