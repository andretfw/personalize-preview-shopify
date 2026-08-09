import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { ensureBackPersonalizationFee } from "../personalization-fee.server";
import { authenticate } from "../shopify.server";

type MetafieldValue = { value?: string | null } | null;

type ProductNode = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  backEnabled: MetafieldValue;
  backSurcharge: MetafieldValue;
  backFeeVariantId: MetafieldValue;
};

type PricingProduct = {
  id: string;
  title: string;
  status: string;
  backEnabled: boolean;
  surcharge: number;
  feeVariantId: string;
};

const INTERNAL_TAG = "personalize-preview-internal";
const PRICING_SCOPES = ["read_publications", "write_publications"];

function moneyNumber(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Shopify could not complete the request.";
}

function hasPricingAccess(granted: string[]) {
  return PRICING_SCOPES.every((scope) => granted.includes(scope));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, scopes } = await authenticate.admin(request);

  let pricingAccessGranted = false;
  let pricingAccessError = "";
  try {
    const detail = await scopes.query();
    pricingAccessGranted = hasPricingAccess(detail.granted);
  } catch (error) {
    pricingAccessError = `Could not verify Shopify publication access: ${errorMessage(error)}`;
  }

  const response = await admin.graphql(
    `#graphql
      query PersonalizePreviewPricing {
        shop { currencyCode }
        products(first: 100, sortKey: TITLE) {
          nodes {
            id
            title
            status
            tags
            backEnabled: metafield(namespace: "custom", key: "personalize_back_enabled") { value }
            backSurcharge: metafield(namespace: "custom", key: "personalize_back_surcharge") { value }
            backFeeVariantId: metafield(namespace: "custom", key: "personalize_back_fee_variant_id") { value }
          }
        }
      }
    `,
  );

  const json = (await response.json()) as {
    data?: {
      shop?: { currencyCode?: string | null };
      products?: { nodes?: ProductNode[] };
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message || "Shopify query failed").join(" "));
  }

  const products: PricingProduct[] = (json.data?.products?.nodes || [])
    .filter((product) => !(product.tags || []).includes(INTERNAL_TAG))
    .map((product) => ({
      id: product.id,
      title: product.title,
      status: product.status,
      backEnabled: product.backEnabled?.value === "true",
      surcharge: moneyNumber(product.backSurcharge?.value),
      feeVariantId: product.backFeeVariantId?.value || "",
    }));

  return {
    products,
    currencyCode: json.data?.shop?.currencyCode || "",
    pricingAccessGranted,
    pricingAccessError,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, scopes } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save-pricing");

  if (intent === "request-pricing-access") {
    try {
      await scopes.request(PRICING_SCOPES);
      return { ok: true, intent };
    } catch (error) {
      if (error instanceof Response) throw error;
      return { ok: false, intent, errors: [errorMessage(error)] };
    }
  }

  const productId = String(formData.get("productId") || "");
  if (!productId.startsWith("gid://shopify/Product/")) {
    return { ok: false, intent, errors: ["Choose a valid Shopify product."] };
  }

  const rawSurcharge = Number(formData.get("surcharge") || 0);
  if (!Number.isFinite(rawSurcharge) || rawSurcharge < 0 || rawSurcharge > 100000) {
    return { ok: false, intent, errors: ["Enter a Back-side surcharge between 0 and 100000."] };
  }
  const surcharge = Math.round(rawSurcharge * 100) / 100;

  const productResponse = await admin.graphql(
    `#graphql
      query PersonalizePreviewPricingProduct($id: ID!) {
        product(id: $id) {
          id
          title
          backEnabled: metafield(namespace: "custom", key: "personalize_back_enabled") { value }
          backFeeVariantId: metafield(namespace: "custom", key: "personalize_back_fee_variant_id") { value }
        }
      }
    `,
    { variables: { id: productId } },
  );

  const productJson = (await productResponse.json()) as {
    data?: {
      product?: {
        id: string;
        title: string;
        backEnabled?: MetafieldValue;
        backFeeVariantId?: MetafieldValue;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (productJson.errors?.length) {
    return {
      ok: false,
      intent,
      errors: productJson.errors.map((error) => error.message || "Shopify product lookup failed"),
    };
  }

  const product = productJson.data?.product;
  if (!product?.id) return { ok: false, intent, errors: ["Shopify could not find this product."] };
  if (surcharge > 0 && product.backEnabled?.value !== "true") {
    return { ok: false, intent, errors: ["Enable the Back side in Print sides before adding a Back surcharge."] };
  }

  let feeVariantId = product.backFeeVariantId?.value || "";

  if (surcharge > 0) {
    let publicationAccess = false;
    try {
      const detail = await scopes.query();
      publicationAccess = hasPricingAccess(detail.granted);
    } catch (error) {
      return { ok: false, intent, errors: [errorMessage(error)] };
    }

    if (!publicationAccess) {
      return {
        ok: false,
        intent,
        errors: ["Allow paid add-ons first, then save the surcharge again."],
      };
    }

    try {
      feeVariantId = await ensureBackPersonalizationFee(admin, {
        parentProductId: product.id,
        parentTitle: product.title,
        existingVariantId: feeVariantId,
        amount: surcharge,
      });
    } catch (error) {
      return { ok: false, intent, errors: [errorMessage(error)] };
    }
  }

  const metafields = [
    {
      ownerId: product.id,
      namespace: "custom",
      key: "personalize_back_surcharge",
      type: "number_decimal",
      value: String(surcharge),
    },
    {
      ownerId: product.id,
      namespace: "custom",
      key: "personalize_back_fee_variant_id",
      type: "single_line_text_field",
      value: feeVariantId,
    },
  ];

  const saveResponse = await admin.graphql(
    `#graphql
      mutation PersonalizePreviewSavePricing($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }
    `,
    { variables: { metafields } },
  );

  const saveJson = (await saveResponse.json()) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ message?: string }> } };
    errors?: Array<{ message?: string }>;
  };

  const errors = [
    ...(saveJson.errors || []).map((error) => error.message || "Shopify save failed"),
    ...(saveJson.data?.metafieldsSet?.userErrors || []).map(
      (error) => error.message || "Shopify save failed",
    ),
  ];
  if (errors.length) return { ok: false, intent, errors };

  return {
    ok: true,
    intent,
    productId: product.id,
    surcharge,
    feeVariantId,
  };
};

export default function Pricing() {
  const {
    products,
    currencyCode,
    pricingAccessGranted,
    pricingAccessError,
  } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const accessFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const handledResult = useRef<unknown>(null);

  const [selectedId, setSelectedId] = useState(products[0]?.id || "");
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId) || products[0] || null,
    [products, selectedId],
  );
  const [surcharge, setSurcharge] = useState(selectedProduct?.surcharge || 0);

  useEffect(() => {
    setSurcharge(selectedProduct?.surcharge || 0);
  }, [selectedProduct]);

  useEffect(() => {
    const result = saveFetcher.data;
    if (!result || handledResult.current === result) return;
    handledResult.current = result;
    if (!result.ok || result.intent !== "save-pricing") return;

    const product = products.find((item) => item.id === result.productId);
    if (product) {
      product.surcharge = result.surcharge || 0;
      product.feeVariantId = result.feeVariantId || "";
    }
    setSurcharge(result.surcharge || 0);
    shopify.toast.show("Pricing saved");
  }, [products, saveFetcher.data, shopify]);

  if (!selectedProduct) {
    return (
      <s-page heading="Pricing">
        <s-section heading="No products found">
          <s-paragraph>Add a Shopify product first, then return here.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const savedSurcharge = selectedProduct.surcharge || 0;
  const changed = Math.round(surcharge * 100) !== Math.round(savedSurcharge * 100);
  const saving = saveFetcher.state !== "idle";

  const inputStyle = {
    minHeight: 44,
    padding: "0 12px",
    border: "1px solid #8a8a8a",
    borderRadius: 10,
    background: "white",
    fontSize: 15,
    width: "100%",
    boxSizing: "border-box" as const,
  };

  return (
    <s-page heading="Pricing">
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 20px 36px" }}>
        <div
          style={{
            padding: 18,
            border: "1px solid #d9e4df",
            borderRadius: 14,
            background: "#f6fbf8",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800 }}>Conditional personalization pricing</div>
          <div style={{ marginTop: 6, color: "#5d6964", fontSize: 13, lineHeight: 1.55 }}>
            Charge extra only when the customer actually personalizes the Back side.
            Front-only orders keep the normal product price.
          </div>
        </div>

        {!pricingAccessGranted ? (
          <div
            style={{
              padding: 18,
              border: "1px solid #eadbb8",
              borderRadius: 14,
              background: "#fffaf0",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 780 }}>Allow paid add-ons</div>
            <div style={{ marginTop: 6, color: "#6d6047", fontSize: 13, lineHeight: 1.5 }}>
              Shopify needs optional publication permissions so Personalize Preview can create and publish
              the hidden add-on product used to charge the Back-side fee. The add-on stays unlisted.
            </div>
            {pricingAccessError ? (
              <div style={{ marginTop: 10, color: "#8a2b1f", fontSize: 12 }}>{pricingAccessError}</div>
            ) : null}
            <accessFetcher.Form method="post" style={{ marginTop: 14 }}>
              <input type="hidden" name="intent" value="request-pricing-access" />
              <button
                type="submit"
                disabled={accessFetcher.state !== "idle"}
                style={{
                  border: 0,
                  borderRadius: 9,
                  padding: "11px 15px",
                  background: "#111",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 750,
                  cursor: "pointer",
                }}
              >
                {accessFetcher.state === "idle" ? "Allow paid add-ons" : "Opening Shopify permissions…"}
              </button>
            </accessFetcher.Form>
          </div>
        ) : null}

        <div
          style={{
            padding: 20,
            border: "1px solid #dce3df",
            borderRadius: 14,
            background: "#fff",
          }}
        >
          <div style={{ display: "grid", gap: 7 }}>
            <label htmlFor="pp-pricing-product" style={{ fontWeight: 700 }}>Product</label>
            <select
              id="pp-pricing-product"
              value={selectedId}
              disabled={saving}
              onChange={(event) => setSelectedId(event.currentTarget.value)}
              style={inputStyle}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} ({product.status.toLowerCase()})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 7 }}>
            <label htmlFor="pp-back-surcharge" style={{ fontWeight: 700 }}>
              Extra charge when Back is personalized ({currencyCode || "shop currency"})
            </label>
            <input
              id="pp-back-surcharge"
              type="number"
              min={0}
              max={100000}
              step={0.01}
              value={surcharge}
              disabled={saving || !selectedProduct.backEnabled || !pricingAccessGranted}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                setSurcharge(Number.isFinite(value) ? Math.max(0, value) : 0);
              }}
              style={inputStyle}
            />
            <div style={{ color: "#69736f", fontSize: 12, lineHeight: 1.45 }}>
              Set to 0 for no extra charge. The fee is added only when Back contains artwork or text.
            </div>
          </div>

          {!selectedProduct.backEnabled ? (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 10,
                background: "#fff4df",
                color: "#755000",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              Back is not enabled for this product. Enable it in Print sides first.
            </div>
          ) : null}

          {selectedProduct.surcharge > 0 && selectedProduct.feeVariantId ? (
            <div style={{ marginTop: 14, color: "#006e52", fontSize: 12, fontWeight: 700 }}>
              ✓ Back add-on is connected to Shopify
            </div>
          ) : null}

          <saveFetcher.Form method="post" style={{ marginTop: 18 }}>
            <input type="hidden" name="intent" value="save-pricing" />
            <input type="hidden" name="productId" value={selectedProduct.id} />
            <input type="hidden" name="surcharge" value={String(surcharge)} />
            <button
              type="submit"
              disabled={
                saving ||
                !changed ||
                !selectedProduct.backEnabled ||
                !pricingAccessGranted
              }
              style={{
                minHeight: 44,
                padding: "0 17px",
                border: 0,
                borderRadius: 10,
                background: changed ? "#111" : "#e8f5ee",
                color: changed ? "#fff" : "#005c45",
                fontSize: 13,
                fontWeight: 780,
                cursor: changed && !saving ? "pointer" : "default",
              }}
            >
              {saving ? "Saving…" : changed ? "Save pricing" : "Saved ✓"}
            </button>
          </saveFetcher.Form>

          {saveFetcher.data && !saveFetcher.data.ok ? (
            <div
              role="alert"
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 10,
                background: "#fff1f0",
                color: "#8a1f11",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {saveFetcher.data.errors?.join(" ") || "Could not save pricing."}
            </div>
          ) : null}
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
