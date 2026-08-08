import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type MetafieldValue = { value: string } | null;

type ProductImage = {
  url: string;
  altText: string | null;
} | null;

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredMedia: {
    preview: { image: ProductImage } | null;
  } | null;
  media: {
    nodes: Array<{
      image: ProductImage;
    }>;
  };
  personalizeEnabled: MetafieldValue;
  printLeft: MetafieldValue;
  printTop: MetafieldValue;
  printWidth: MetafieldValue;
  printHeight: MetafieldValue;
};

type ProductSetup = {
  id: string;
  title: string;
  handle: string;
  status: string;
  imageUrl: string | null;
  imageAlt: string;
  enabled: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
};

type SetupValues = Pick<
  ProductSetup,
  "enabled" | "left" | "top" | "width" | "height"
>;

type Interaction = {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  rect: DOMRect;
  initial: SetupValues;
};

const DEFAULTS: SetupValues = {
  enabled: false,
  left: 35,
  top: 22,
  width: 30,
  height: 45,
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const numberFromMetafield = (
  metafield: MetafieldValue,
  fallback: number,
) => {
  const parsed = Number(metafield?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseSubmittedNumber = (
  value: FormDataEntryValue | null,
  fallback: number,
) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const valuesFromProduct = (product: ProductSetup | null): SetupValues =>
  product
    ? {
        enabled: product.enabled,
        left: product.left,
        top: product.top,
        width: product.width,
        height: product.height,
      }
    : DEFAULTS;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query PersonalizePreviewProducts {
        products(first: 100, sortKey: TITLE) {
          nodes {
            id
            title
            handle
            status
            featuredMedia {
              preview {
                image {
                  url
                  altText
                }
              }
            }
            media(first: 1, query: "media_type:IMAGE", sortKey: POSITION) {
              nodes {
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
            personalizeEnabled: metafield(namespace: "custom", key: "personalize_enabled") {
              value
            }
            printLeft: metafield(namespace: "custom", key: "personalize_print_left") {
              value
            }
            printTop: metafield(namespace: "custom", key: "personalize_print_top") {
              value
            }
            printWidth: metafield(namespace: "custom", key: "personalize_print_width") {
              value
            }
            printHeight: metafield(namespace: "custom", key: "personalize_print_height") {
              value
            }
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

  const products: ProductSetup[] = (json.data?.products?.nodes ?? []).map(
    (product) => {
      const image =
        product.featuredMedia?.preview?.image ?? product.media.nodes[0]?.image ?? null;

      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        imageUrl: image?.url ?? null,
        imageAlt: image?.altText || product.title,
        enabled: product.personalizeEnabled?.value === "true",
        left: numberFromMetafield(product.printLeft, DEFAULTS.left),
        top: numberFromMetafield(product.printTop, DEFAULTS.top),
        width: numberFromMetafield(product.printWidth, DEFAULTS.width),
        height: numberFromMetafield(product.printHeight, DEFAULTS.height),
      };
    },
  );

  return { products };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const productId = String(formData.get("productId") || "");

  if (!productId.startsWith("gid://shopify/Product/")) {
    return { ok: false, errors: ["Choose a valid Shopify product."] };
  }

  const enabled = formData.get("enabled") === "true";
  const left = Math.round(
    clamp(parseSubmittedNumber(formData.get("left"), DEFAULTS.left), 0, 95),
  );
  const top = Math.round(
    clamp(parseSubmittedNumber(formData.get("top"), DEFAULTS.top), 0, 95),
  );
  const width = Math.round(
    clamp(
      parseSubmittedNumber(formData.get("width"), DEFAULTS.width),
      5,
      100 - left,
    ),
  );
  const height = Math.round(
    clamp(
      parseSubmittedNumber(formData.get("height"), DEFAULTS.height),
      5,
      100 - top,
    ),
  );

  const definitionResponse = await admin.graphql(
    `#graphql
      query PersonalizePreviewDefinitions {
        enabledDef: metafieldDefinition(identifier: {
          ownerType: PRODUCT,
          namespace: "custom",
          key: "personalize_enabled"
        }) { type { name } }
        leftDef: metafieldDefinition(identifier: {
          ownerType: PRODUCT,
          namespace: "custom",
          key: "personalize_print_left"
        }) { type { name } }
        topDef: metafieldDefinition(identifier: {
          ownerType: PRODUCT,
          namespace: "custom",
          key: "personalize_print_top"
        }) { type { name } }
        widthDef: metafieldDefinition(identifier: {
          ownerType: PRODUCT,
          namespace: "custom",
          key: "personalize_print_width"
        }) { type { name } }
        heightDef: metafieldDefinition(identifier: {
          ownerType: PRODUCT,
          namespace: "custom",
          key: "personalize_print_height"
        }) { type { name } }
      }
    `,
  );

  const definitionJson = (await definitionResponse.json()) as {
    data?: Record<string, { type?: { name?: string } } | null>;
  };
  const definitions = definitionJson.data ?? {};

  const metafields = [
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_enabled",
      type: definitions.enabledDef?.type?.name || "boolean",
      value: enabled ? "true" : "false",
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_print_left",
      type: definitions.leftDef?.type?.name || "number_integer",
      value: String(left),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_print_top",
      type: definitions.topDef?.type?.name || "number_integer",
      value: String(top),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_print_width",
      type: definitions.widthDef?.type?.name || "number_integer",
      value: String(width),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_print_height",
      type: definitions.heightDef?.type?.name || "number_integer",
      value: String(height),
    },
  ];

  const response = await admin.graphql(
    `#graphql
      mutation SavePersonalizePreviewSettings($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key value }
          userErrors { field message code }
        }
      }
    `,
    { variables: { metafields } },
  );

  const json = (await response.json()) as {
    data?: {
      metafieldsSet?: { userErrors?: Array<{ message: string }> };
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    return {
      ok: false,
      errors: json.errors.map((error) => error.message || "Shopify save failed"),
    };
  }

  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    return { ok: false, errors: errors.map((error) => error.message) };
  }

  return {
    ok: true,
    productId,
    values: { enabled, left, top, width, height },
  };
};

export default function PersonalizeDashboard() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const selectedProduct =
    products.find((product) => product.id === selectedId) ?? products[0] ?? null;
  const [values, setValues] = useState<SetupValues>(
    valuesFromProduct(selectedProduct),
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (!selectedProduct) return;
    setValues(valuesFromProduct(selectedProduct));
  }, [selectedProduct]);

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    shopify.toast.show("Personalization settings saved");
    revalidator.revalidate();
  }, [fetcher.data, revalidator, shopify]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;

      const deltaX =
        ((event.clientX - interaction.startX) / interaction.rect.width) * 100;
      const deltaY =
        ((event.clientY - interaction.startY) / interaction.rect.height) * 100;

      if (interaction.mode === "move") {
        setValues((current) => ({
          ...current,
          left: clamp(
            interaction.initial.left + deltaX,
            0,
            100 - interaction.initial.width,
          ),
          top: clamp(
            interaction.initial.top + deltaY,
            0,
            100 - interaction.initial.height,
          ),
        }));
        return;
      }

      setValues((current) => ({
        ...current,
        width: clamp(
          interaction.initial.width + deltaX,
          5,
          100 - interaction.initial.left,
        ),
        height: clamp(
          interaction.initial.height + deltaY,
          5,
          100 - interaction.initial.top,
        ),
      }));
    };

    const onPointerUp = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  const beginInteraction = (
    event: ReactPointerEvent,
    mode: Interaction["mode"],
  ) => {
    if (!stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    interactionRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect: stageRef.current.getBoundingClientRect(),
      initial: { ...values },
    };
  };

  const chooseProduct = (productId: string) => {
    const nextProduct = products.find((product) => product.id === productId) ?? null;
    setSelectedId(productId);
    setValues(valuesFromProduct(nextProduct));
    interactionRef.current = null;
  };

  const updateNumber = (
    key: "left" | "top" | "width" | "height",
    rawValue: string,
  ) => {
    const next = Number(rawValue);
    if (!Number.isFinite(next)) return;

    setValues((current) => {
      const updated = { ...current, [key]: next };
      updated.left = clamp(updated.left, 0, 95);
      updated.top = clamp(updated.top, 0, 95);
      updated.width = clamp(updated.width, 5, 100 - updated.left);
      updated.height = clamp(updated.height, 5, 100 - updated.top);
      return updated;
    });
  };

  const saveSettings = () => {
    if (!selectedProduct) return;

    const formData = new FormData();
    formData.set("productId", selectedProduct.id);
    formData.set("enabled", String(values.enabled));
    formData.set("left", String(values.left));
    formData.set("top", String(values.top));
    formData.set("width", String(values.width));
    formData.set("height", String(values.height));
    fetcher.submit(formData, { method: "POST" });
  };

  if (!selectedProduct) {
    return (
      <s-page heading="Personalize Preview">
        <s-section heading="No products found">
          <s-paragraph>
            Add a product to this Shopify store, then come back here to configure
            personalization.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const numberFields = [
    ["left", "Left %"],
    ["top", "Top %"],
    ["width", "Width %"],
    ["height", "Height %"],
  ] as const;

  return (
    <s-page heading="Personalize Preview">
      <s-button
        slot="primary-action"
        onClick={saveSettings}
        {...(isSaving ? { loading: true } : {})}
      >
        Save product setup
      </s-button>

      <s-section heading="Choose a product">
        <div style={{ display: "grid", gap: 10 }}>
          <label htmlFor="pp-product-select" style={{ fontWeight: 650 }}>
            Product
          </label>
          <select
            id="pp-product-select"
            value={selectedId}
            onChange={(event) => chooseProduct(event.currentTarget.value)}
            style={{
              width: "100%",
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
              </option>
            ))}
          </select>
        </div>
      </s-section>

      <s-section heading="Personalization setup">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(320px, 1.4fr) minmax(260px, 0.8fr)",
            gap: 28,
            alignItems: "start",
          }}
        >
          <div>
            <div
              style={{
                marginBottom: 10,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              Previewing: {selectedProduct.title}
            </div>

            <div
              ref={stageRef}
              style={{
                position: "relative",
                width: "100%",
                maxWidth: 680,
                minHeight: selectedProduct.imageUrl ? undefined : 420,
                margin: "0 auto",
                background: "#f4f4f4",
                borderRadius: 16,
                overflow: "hidden",
                lineHeight: 0,
                userSelect: "none",
              }}
            >
              {selectedProduct.imageUrl ? (
                <img
                  key={`${selectedProduct.id}:${selectedProduct.imageUrl}`}
                  src={selectedProduct.imageUrl}
                  alt={selectedProduct.imageAlt}
                  draggable={false}
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
              ) : (
                <div
                  style={{
                    minHeight: 420,
                    display: "grid",
                    placeItems: "center",
                    color: "#666",
                    lineHeight: 1.4,
                    padding: 32,
                    textAlign: "center",
                  }}
                >
                  This product does not have a featured product image yet.
                </div>
              )}

              {selectedProduct.imageUrl && (
                <div
                  onPointerDown={(event) => beginInteraction(event, "move")}
                  style={{
                    position: "absolute",
                    left: `${values.left}%`,
                    top: `${values.top}%`,
                    width: `${values.width}%`,
                    height: `${values.height}%`,
                    boxSizing: "border-box",
                    border: "3px solid #006e52",
                    background: "rgba(0, 110, 82, 0.16)",
                    cursor: "move",
                    lineHeight: 1.2,
                    display: "grid",
                    placeItems: "center",
                    color: "#004c3f",
                    fontWeight: 750,
                    fontSize: 13,
                    textAlign: "center",
                    touchAction: "none",
                  }}
                >
                  PRINT AREA
                  <button
                    type="button"
                    aria-label="Resize print area"
                    onPointerDown={(event) => beginInteraction(event, "resize")}
                    style={{
                      position: "absolute",
                      right: -8,
                      bottom: -8,
                      width: 18,
                      height: 18,
                      padding: 0,
                      border: "2px solid white",
                      borderRadius: 5,
                      background: "#006e52",
                      cursor: "nwse-resize",
                      touchAction: "none",
                    }}
                  />
                </div>
              )}
            </div>

            <p
              style={{
                margin: "12px 0 0",
                color: "#616161",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              Drag the green box to position it. Drag the square in the bottom-right
              corner to resize it. You can set the area before turning personalization
              on.
            </p>
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 18,
                padding: 16,
                border: "1px solid #dedede",
                borderRadius: 12,
              }}
            >
              <div>
                <label
                  htmlFor="pp-enable-personalization"
                  style={{ display: "block", fontWeight: 750, marginBottom: 4 }}
                >
                  Enable personalization
                </label>
                <span style={{ color: "#616161", fontSize: 13 }}>
                  Show the customizer for this product after you save.
                </span>
              </div>
              <input
                id="pp-enable-personalization"
                type="checkbox"
                checked={values.enabled}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    enabled: event.currentTarget.checked,
                  }))
                }
                style={{ width: 22, height: 22 }}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {numberFields.map(([key, labelText]) => {
                const inputId = `pp-${key}`;
                return (
                  <div key={key} style={{ display: "grid", gap: 6 }}>
                    <label
                      htmlFor={inputId}
                      style={{ fontWeight: 650, fontSize: 13 }}
                    >
                      {labelText}
                    </label>
                    <input
                      id={inputId}
                      type="number"
                      min={key === "width" || key === "height" ? 5 : 0}
                      max={100}
                      step={1}
                      value={Math.round(values[key])}
                      onChange={(event) =>
                        updateNumber(key, event.currentTarget.value)
                      }
                      style={{
                        minHeight: 42,
                        padding: "0 10px",
                        border: "1px solid #8a8a8a",
                        borderRadius: 8,
                        fontSize: 15,
                        background: "white",
                      }}
                    />
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={saveSettings}
              disabled={isSaving}
              style={{
                minHeight: 46,
                border: 0,
                borderRadius: 12,
                background: "#111",
                color: "white",
                fontSize: 15,
                fontWeight: 750,
                cursor: isSaving ? "wait" : "pointer",
              }}
            >
              {isSaving ? "Saving…" : "Save product setup"}
            </button>

            {fetcher.data && !fetcher.data.ok && (
              <div
                role="alert"
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "#fff1f0",
                  color: "#8a1f11",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {fetcher.data.errors?.join(" ") || "Could not save settings."}
              </div>
            )}
          </div>
        </div>
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Pick a product, place its printable area on the correct product image,
          switch personalization on when you want it live, and save. The app writes
          the Shopify product settings automatically.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
