import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type MetafieldValue = { value: string } | null;

type ProductNode = {
  id: string;
  title: string;
  status: string;
  enabled: MetafieldValue;
  left: MetafieldValue;
  top: MetafieldValue;
  width: MetafieldValue;
  height: MetafieldValue;
};

type ProductRow = {
  id: string;
  title: string;
  status: string;
  configured: boolean;
  enabled: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
};

const DEFAULTS = {
  enabled: false,
  left: 35,
  top: 22,
  width: 30,
  height: 45,
};

const numberValue = (field: MetafieldValue, fallback: number) => {
  const parsed = Number(field?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const productFields = `
  id
  title
  status
  enabled: metafield(namespace: "custom", key: "personalize_enabled") { value }
  left: metafield(namespace: "custom", key: "personalize_print_left") { value }
  top: metafield(namespace: "custom", key: "personalize_print_top") { value }
  width: metafield(namespace: "custom", key: "personalize_print_width") { value }
  height: metafield(namespace: "custom", key: "personalize_print_height") { value }
`;

function normalizeProduct(product: ProductNode): ProductRow {
  return {
    id: product.id,
    title: product.title,
    status: product.status,
    configured: Boolean(
      product.enabled || product.left || product.top || product.width || product.height,
    ),
    enabled: product.enabled?.value === "true",
    left: numberValue(product.left, DEFAULTS.left),
    top: numberValue(product.top, DEFAULTS.top),
    width: numberValue(product.width, DEFAULTS.width),
    height: numberValue(product.height, DEFAULTS.height),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query BulkPersonalizeProducts {
        products(first: 100, sortKey: TITLE) {
          nodes {
            ${productFields}
          }
        }
      }
    `,
  );

  const json = (await response.json()) as {
    data?: { products?: { nodes?: ProductNode[] } };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error) => error.message || "Shopify query failed").join(" "),
    );
  }

  return {
    products: (json.data?.products?.nodes ?? []).map(normalizeProduct),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const sourceId = String(formData.get("sourceId") || "");

  let targetIds: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("targetIds") || "[]"));
    if (Array.isArray(parsed)) {
      targetIds = parsed.filter(
        (value): value is string =>
          typeof value === "string" && value.startsWith("gid://shopify/Product/"),
      );
    }
  } catch {
    return { ok: false, errors: ["Could not read the selected products."] };
  }

  targetIds = [...new Set(targetIds)].filter((id) => id !== sourceId);

  if (!sourceId.startsWith("gid://shopify/Product/")) {
    return { ok: false, errors: ["Choose a valid source product."] };
  }

  if (!targetIds.length) {
    return { ok: false, errors: ["Select at least one target product."] };
  }

  const sourceResponse = await admin.graphql(
    `#graphql
      query BulkPersonalizeSource($id: ID!) {
        product(id: $id) {
          ${productFields}
        }
      }
    `,
    { variables: { id: sourceId } },
  );

  const sourceJson = (await sourceResponse.json()) as {
    data?: { product?: ProductNode | null };
    errors?: Array<{ message?: string }>;
  };

  if (sourceJson.errors?.length) {
    return {
      ok: false,
      errors: sourceJson.errors.map(
        (error) => error.message || "Could not load the source product.",
      ),
    };
  }

  const sourceNode = sourceJson.data?.product;
  if (!sourceNode) {
    return { ok: false, errors: ["The source product no longer exists."] };
  }

  const source = normalizeProduct(sourceNode);
  if (!source.configured) {
    return {
      ok: false,
      errors: ["Configure and save the source product on Home before copying it."],
    };
  }

  const metafields = targetIds.flatMap((ownerId) => [
    {
      ownerId,
      namespace: "custom",
      key: "personalize_enabled",
      type: "boolean",
      value: source.enabled ? "true" : "false",
    },
    {
      ownerId,
      namespace: "custom",
      key: "personalize_print_left",
      type: "number_integer",
      value: String(Math.round(source.left)),
    },
    {
      ownerId,
      namespace: "custom",
      key: "personalize_print_top",
      type: "number_integer",
      value: String(Math.round(source.top)),
    },
    {
      ownerId,
      namespace: "custom",
      key: "personalize_print_width",
      type: "number_integer",
      value: String(Math.round(source.width)),
    },
    {
      ownerId,
      namespace: "custom",
      key: "personalize_print_height",
      type: "number_integer",
      value: String(Math.round(source.height)),
    },
  ]);

  const errors: string[] = [];

  // Shopify metafieldsSet accepts at most 25 metafields per mutation.
  for (let index = 0; index < metafields.length; index += 25) {
    const batch = metafields.slice(index, index + 25);
    const response = await admin.graphql(
      `#graphql
        mutation BulkCopyPersonalizeSettings($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message code }
          }
        }
      `,
      { variables: { metafields: batch } },
    );

    const json = (await response.json()) as {
      data?: { metafieldsSet?: { userErrors?: Array<{ message: string }> } };
      errors?: Array<{ message?: string }>;
    };

    if (json.errors?.length) {
      errors.push(
        ...json.errors.map((error) => error.message || "Shopify bulk save failed"),
      );
      break;
    }

    const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length) {
      errors.push(...userErrors.map((error) => error.message));
      break;
    }
  }

  if (errors.length) {
    return {
      ok: false,
      errors: [
        ...errors,
        "Some earlier batches may already have been copied. Refresh before retrying.",
      ],
    };
  }

  return {
    ok: true,
    copiedCount: targetIds.length,
    sourceTitle: source.title,
  };
};

export default function BulkProductSetup() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const firstConfigured = products.find((product) => product.configured) ?? products[0];
  const [sourceId, setSourceId] = useState(firstConfigured?.id ?? "");
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const isSaving = fetcher.state !== "idle";

  const source = products.find((product) => product.id === sourceId) ?? null;
  const targets = useMemo(
    () => products.filter((product) => product.id !== sourceId),
    [products, sourceId],
  );

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    shopify.toast.show(
      `Copied setup to ${fetcher.data.copiedCount} product${
        fetcher.data.copiedCount === 1 ? "" : "s"
      }`,
    );
    setSelectedTargets(new Set());
  }, [fetcher.data, shopify]);

  const changeSource = (nextSourceId: string) => {
    setSourceId(nextSourceId);
    setSelectedTargets((current) => {
      const next = new Set(current);
      next.delete(nextSourceId);
      return next;
    });
  };

  const toggleTarget = (productId: string, checked: boolean) => {
    setSelectedTargets((current) => {
      const next = new Set(current);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  };

  const selectAllActive = () => {
    setSelectedTargets(
      new Set(
        targets
          .filter((product) => product.status === "ACTIVE")
          .map((product) => product.id),
      ),
    );
  };

  const copySetup = () => {
    if (!source || !selectedTargets.size) return;
    const formData = new FormData();
    formData.set("sourceId", source.id);
    formData.set("targetIds", JSON.stringify([...selectedTargets]));
    fetcher.submit(formData, { method: "POST" });
  };

  if (!products.length) {
    return (
      <s-page heading="Bulk setup">
        <s-section heading="No products found">
          <s-paragraph>Add products first, then return here.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Bulk product setup">
      <s-section heading="Copy one setup to many products">
        <div style={{ display: "grid", gap: 20 }}>
          <p style={{ margin: 0, color: "#616161", lineHeight: 1.5 }}>
            Configure one product perfectly on Home, then copy its personalization
            switch and print-area position to other products in one go.
          </p>

          <div style={{ display: "grid", gap: 8 }}>
            <label htmlFor="pp-bulk-source" style={{ fontWeight: 700 }}>
              Copy setup from
            </label>
            <select
              id="pp-bulk-source"
              value={sourceId}
              onChange={(event) => changeSource(event.currentTarget.value)}
              style={{
                minHeight: 44,
                padding: "0 12px",
                border: "1px solid #8a8a8a",
                borderRadius: 10,
                background: "white",
                fontSize: 15,
              }}
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} ({product.status.toLowerCase()})
                  {product.configured ? " — configured" : " — not configured"}
                </option>
              ))}
            </select>
          </div>

          {source && (
            <div
              style={{
                padding: 14,
                border: "1px solid #dedede",
                borderRadius: 12,
                background: source.configured ? "#f6fdf9" : "#fff8e8",
                lineHeight: 1.5,
              }}
            >
              <strong>{source.title}</strong>
              {source.configured ? (
                <div style={{ marginTop: 4, color: "#4a4a4a" }}>
                  Personalization: {source.enabled ? "On" : "Off"} · Print area: left{" "}
                  {Math.round(source.left)}%, top {Math.round(source.top)}%, width{" "}
                  {Math.round(source.width)}%, height {Math.round(source.height)}%
                </div>
              ) : (
                <div style={{ marginTop: 4, color: "#7a4b00" }}>
                  Save this product on Home first. We will not copy unsaved defaults.
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={selectAllActive}
              style={{
                minHeight: 38,
                padding: "0 14px",
                border: "1px solid #8a8a8a",
                borderRadius: 9,
                background: "white",
                cursor: "pointer",
                fontWeight: 650,
              }}
            >
              Select all active products
            </button>
            <button
              type="button"
              onClick={() => setSelectedTargets(new Set())}
              style={{
                minHeight: 38,
                padding: "0 14px",
                border: "1px solid #8a8a8a",
                borderRadius: 9,
                background: "white",
                cursor: "pointer",
                fontWeight: 650,
              }}
            >
              Clear selection
            </button>
          </div>

          <div
            style={{
              border: "1px solid #dedede",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {targets.map((product, index) => (
              <label
                key={product.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderTop: index ? "1px solid #ededed" : undefined,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTargets.has(product.id)}
                  onChange={(event) => toggleTarget(product.id, event.currentTarget.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span style={{ flex: 1 }}>
                  <strong>{product.title}</strong>
                  <span style={{ marginLeft: 8, color: "#777", fontSize: 13 }}>
                    {product.status.toLowerCase()}
                    {product.configured ? " · already configured" : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <button
            type="button"
            onClick={copySetup}
            disabled={isSaving || !source?.configured || selectedTargets.size === 0}
            style={{
              minHeight: 48,
              border: 0,
              borderRadius: 12,
              background:
                isSaving || !source?.configured || selectedTargets.size === 0
                  ? "#b5b5b5"
                  : "#111",
              color: "white",
              fontSize: 15,
              fontWeight: 750,
              cursor:
                isSaving || !source?.configured || selectedTargets.size === 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isSaving
              ? "Copying…"
              : `Copy setup to ${selectedTargets.size} selected product${
                  selectedTargets.size === 1 ? "" : "s"
                }`}
          </button>

          {fetcher.data && !fetcher.data.ok && (
            <div
              role="alert"
              style={{
                padding: 12,
                borderRadius: 10,
                background: "#fff1f0",
                color: "#8a1f11",
                lineHeight: 1.45,
              }}
            >
              {fetcher.data.errors?.join(" ") || "Could not copy the setup."}
            </div>
          )}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
