import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { ensurePersonalizationDefinition } from "../personalization.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  await ensurePersonalizationDefinition(admin, session.shop);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
  };
};

export default function App() {
  const { apiKey, shop } = useLoaderData<typeof loader>();
  const location = useLocation();
  const showOnboarding = location.pathname === "/app" || location.pathname === "/app/";
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/product-customizer&target=newAppsSection`;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/orders">Orders</s-link>
        <s-link href="/app/production">Production</s-link>
        <s-link href="/app/bulk">Bulk setup</s-link>
      </s-app-nav>

      {showOnboarding && (
        <div style={{ padding: "16px 24px 0" }}>
          <div
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              padding: 18,
              border: "1px solid #d9e4df",
              borderRadius: 14,
              background: "#f6fbf8",
              color: "#1f2d28",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 750, marginBottom: 8 }}>
              Get started in four steps
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: 12,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <div><strong>1. Add the theme block</strong><br />Place Product customizer on your product template.</div>
              <div><strong>2. Choose products</strong><br />Select the products customers can personalize.</div>
              <div><strong>3. Set the print area</strong><br />Position the printable area, enable personalization, and save.</div>
              <div><strong>4. Test the storefront</strong><br />Upload an image, add text, confirm the design, and add it to cart.</div>
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <a
                href={themeEditorUrl}
                target="_top"
                style={{
                  display: "inline-block",
                  padding: "10px 14px",
                  borderRadius: 9,
                  background: "#111",
                  color: "white",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                Add customizer to product template
              </a>
              <span style={{ color: "#5d6a65", fontSize: 12 }}>
                Already added it? Continue with product setup below. Production settings are optional.
              </span>
            </div>
          </div>
        </div>
      )}

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
