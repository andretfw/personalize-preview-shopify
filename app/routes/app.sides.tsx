import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type MetafieldValue = { value: string } | null;

type MediaNode = {
  id: string;
  image: { url: string; altText: string | null } | null;
};

type ProductNode = {
  id: string;
  title: string;
  status: string;
  featuredMedia: {
    preview: { image: { url: string; altText: string | null } | null } | null;
  } | null;
  media: { nodes: MediaNode[] };
  frontLeft: MetafieldValue;
  frontTop: MetafieldValue;
  frontWidth: MetafieldValue;
  frontHeight: MetafieldValue;
  frontPrintWidthCm: MetafieldValue;
  frontPrintHeightCm: MetafieldValue;
  backEnabled: MetafieldValue;
  backMediaId: MetafieldValue;
  backLeft: MetafieldValue;
  backTop: MetafieldValue;
  backWidth: MetafieldValue;
  backHeight: MetafieldValue;
  backPrintWidthCm: MetafieldValue;
  backPrintHeightCm: MetafieldValue;
};

type ProductSideSetup = {
  id: string;
  title: string;
  status: string;
  front: {
    imageUrl: string;
    left: number;
    top: number;
    width: number;
    height: number;
    printWidthCm: number;
    printHeightCm: number;
  };
  media: MediaNode[];
  back: {
    enabled: boolean;
    mediaId: string;
    left: number;
    top: number;
    width: number;
    height: number;
    printWidthCm: number;
    printHeightCm: number;
  };
};

type BackValues = ProductSideSetup["back"];

type Interaction = {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  rect: DOMRect;
  initial: BackValues;
};

const DEFAULT_AREA = { left: 35, top: 22, width: 30, height: 45 };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const numberValue = (field: MetafieldValue, fallback = 0) => {
  const parsed = Number(field?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveNumber = (field: MetafieldValue) => {
  const value = numberValue(field, 0);
  return value > 0 ? value : 0;
};

const parseNumber = (value: FormDataEntryValue | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const valuesEqual = (left: BackValues, right: BackValues) =>
  left.enabled === right.enabled &&
  left.mediaId === right.mediaId &&
  left.left === right.left &&
  left.top === right.top &&
  left.width === right.width &&
  left.height === right.height &&
  left.printWidthCm === right.printWidthCm &&
  left.printHeightCm === right.printHeightCm;

const normalizeProduct = (product: ProductNode): ProductSideSetup => {
  const media = (product.media?.nodes ?? []).filter((item) => Boolean(item.image?.url));
  const frontImage = product.featuredMedia?.preview?.image?.url || media[0]?.image?.url || "";
  const savedBackMediaId = product.backMediaId?.value || "";
  const defaultBackMedia =
    media.find((item) => item.id === savedBackMediaId) || media[1] || media[0] || null;

  const frontLeft = numberValue(product.frontLeft, DEFAULT_AREA.left);
  const frontTop = numberValue(product.frontTop, DEFAULT_AREA.top);
  const frontWidth = numberValue(product.frontWidth, DEFAULT_AREA.width);
  const frontHeight = numberValue(product.frontHeight, DEFAULT_AREA.height);

  return {
    id: product.id,
    title: product.title,
    status: product.status,
    front: {
      imageUrl: frontImage,
      left: frontLeft,
      top: frontTop,
      width: frontWidth,
      height: frontHeight,
      printWidthCm: positiveNumber(product.frontPrintWidthCm),
      printHeightCm: positiveNumber(product.frontPrintHeightCm),
    },
    media,
    back: {
      enabled: product.backEnabled?.value === "true",
      mediaId: savedBackMediaId || defaultBackMedia?.id || "",
      left: numberValue(product.backLeft, frontLeft),
      top: numberValue(product.backTop, frontTop),
      width: numberValue(product.backWidth, frontWidth),
      height: numberValue(product.backHeight, frontHeight),
      printWidthCm: positiveNumber(product.backPrintWidthCm),
      printHeightCm: positiveNumber(product.backPrintHeightCm),
    },
  };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query PersonalizePreviewPrintSides {
        products(first: 100, sortKey: TITLE) {
          nodes {
            id
            title
            status
            featuredMedia {
              preview { image { url altText } }
            }
            media(first: 10, query: "media_type:IMAGE", sortKey: POSITION) {
              nodes {
                ... on MediaImage {
                  id
                  image { url altText }
                }
              }
            }
            frontLeft: metafield(namespace: "custom", key: "personalize_print_left") { value }
            frontTop: metafield(namespace: "custom", key: "personalize_print_top") { value }
            frontWidth: metafield(namespace: "custom", key: "personalize_print_width") { value }
            frontHeight: metafield(namespace: "custom", key: "personalize_print_height") { value }
            frontPrintWidthCm: metafield(namespace: "custom", key: "personalize_print_width_cm") { value }
            frontPrintHeightCm: metafield(namespace: "custom", key: "personalize_print_height_cm") { value }
            backEnabled: metafield(namespace: "custom", key: "personalize_back_enabled") { value }
            backMediaId: metafield(namespace: "custom", key: "personalize_back_media_id") { value }
            backLeft: metafield(namespace: "custom", key: "personalize_back_left") { value }
            backTop: metafield(namespace: "custom", key: "personalize_back_top") { value }
            backWidth: metafield(namespace: "custom", key: "personalize_back_width") { value }
            backHeight: metafield(namespace: "custom", key: "personalize_back_height") { value }
            backPrintWidthCm: metafield(namespace: "custom", key: "personalize_back_print_width_cm") { value }
            backPrintHeightCm: metafield(namespace: "custom", key: "personalize_back_print_height_cm") { value }
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
  const productId = String(formData.get("productId") || "");

  if (!productId.startsWith("gid://shopify/Product/")) {
    return { ok: false, errors: ["Choose a valid Shopify product."] };
  }

  const enabled = formData.get("enabled") === "true";
  const mediaId = String(formData.get("mediaId") || "").trim();
  const left = Math.round(clamp(parseNumber(formData.get("left"), DEFAULT_AREA.left), 0, 95));
  const top = Math.round(clamp(parseNumber(formData.get("top"), DEFAULT_AREA.top), 0, 95));
  const width = Math.round(
    clamp(parseNumber(formData.get("width"), DEFAULT_AREA.width), 5, 100 - left),
  );
  const height = Math.round(
    clamp(parseNumber(formData.get("height"), DEFAULT_AREA.height), 5, 100 - top),
  );
  const printWidthCm = Math.round(
    clamp(parseNumber(formData.get("printWidthCm"), 0), 0, 1000) * 10,
  ) / 10;
  const printHeightCm = Math.round(
    clamp(parseNumber(formData.get("printHeightCm"), 0), 0, 1000) * 10,
  ) / 10;

  if (enabled && !mediaId.startsWith("gid://shopify/MediaImage/")) {
    return { ok: false, errors: ["Choose the Shopify product image used for the Back side."] };
  }

  if ((printWidthCm === 0) !== (printHeightCm === 0)) {
    return {
      ok: false,
      errors: ["Enter both Back print width and height, or set both to 0."],
    };
  }

  const metafields = [
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_enabled",
      type: "boolean",
      value: enabled ? "true" : "false",
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_media_id",
      type: "single_line_text_field",
      value: mediaId,
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_left",
      type: "number_integer",
      value: String(left),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_top",
      type: "number_integer",
      value: String(top),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_width",
      type: "number_integer",
      value: String(width),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_height",
      type: "number_integer",
      value: String(height),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_print_width_cm",
      type: "number_decimal",
      value: String(printWidthCm),
    },
    {
      ownerId: productId,
      namespace: "custom",
      key: "personalize_back_print_height_cm",
      type: "number_decimal",
      value: String(printHeightCm),
    },
  ];

  const response = await admin.graphql(
    `#graphql
      mutation SavePersonalizePreviewBackSide($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }
    `,
    { variables: { metafields } },
  );

  const json = (await response.json()) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ message: string }> } };
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
    values: { enabled, mediaId, left, top, width, height, printWidthCm, printHeightCm },
  };
};

export default function PrintSides() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const selectedProduct =
    products.find((product) => product.id === selectedId) ?? products[0] ?? null;
  const [values, setValues] = useState<BackValues>(selectedProduct?.back ?? {
    enabled: false,
    mediaId: "",
    left: DEFAULT_AREA.left,
    top: DEFAULT_AREA.top,
    width: DEFAULT_AREA.width,
    height: DEFAULT_AREA.height,
    printWidthCm: 0,
    printHeightCm: 0,
  });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const handledResultRef = useRef<unknown>(null);
  const isSaving = fetcher.state !== "idle";
  const savedValues = selectedProduct?.back ?? values;
  const hasUnsavedChanges = !valuesEqual(values, savedValues);

  const selectedMedia =
    selectedProduct?.media.find((item) => item.id === values.mediaId) ||
    selectedProduct?.media[0] ||
    null;

  useEffect(() => {
    if (!selectedProduct) return;
    setValues(selectedProduct.back);
    interactionRef.current = null;
  }, [selectedProduct]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result || handledResultRef.current === result) return;
    handledResultRef.current = result;
    if (!result.ok) return;

    const product = products.find((item) => item.id === result.productId);
    if (product) Object.assign(product.back, result.values);
    if (selectedId === result.productId) setValues(result.values);
    shopify.toast.show("Back-side setup saved");
  }, [fetcher.data, products, selectedId, shopify]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;

      const deltaX = ((event.clientX - interaction.startX) / interaction.rect.width) * 100;
      const deltaY = ((event.clientY - interaction.startY) / interaction.rect.height) * 100;

      if (interaction.mode === "move") {
        setValues((current) => ({
          ...current,
          left: clamp(interaction.initial.left + deltaX, 0, 100 - interaction.initial.width),
          top: clamp(interaction.initial.top + deltaY, 0, 100 - interaction.initial.height),
        }));
        return;
      }

      setValues((current) => ({
        ...current,
        width: clamp(interaction.initial.width + deltaX, 5, 100 - interaction.initial.left),
        height: clamp(interaction.initial.height + deltaY, 5, 100 - interaction.initial.top),
      }));
    };

    const up = () => {
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const beginInteraction = (event: ReactPointerEvent, mode: Interaction["mode"]) => {
    if (!stageRef.current || !values.enabled) return;
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

  const updateNumber = (
    key: "left" | "top" | "width" | "height" | "printWidthCm" | "printHeightCm",
    raw: string,
  ) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setValues((current) => {
      const next = { ...current, [key]: value };
      next.left = clamp(next.left, 0, 95);
      next.top = clamp(next.top, 0, 95);
      next.width = clamp(next.width, 5, 100 - next.left);
      next.height = clamp(next.height, 5, 100 - next.top);
      next.printWidthCm = clamp(next.printWidthCm, 0, 1000);
      next.printHeightCm = clamp(next.printHeightCm, 0, 1000);
      return next;
    });
  };

  const save = () => {
    if (!selectedProduct || !hasUnsavedChanges || isSaving) return;
    const data = new FormData();
    data.set("productId", selectedProduct.id);
    data.set("enabled", String(values.enabled));
    data.set("mediaId", values.mediaId);
    data.set("left", String(values.left));
    data.set("top", String(values.top));
    data.set("width", String(values.width));
    data.set("height", String(values.height));
    data.set("printWidthCm", String(values.printWidthCm));
    data.set("printHeightCm", String(values.printHeightCm));
    fetcher.submit(data, { method: "POST" });
  };

  if (!selectedProduct) {
    return (
      <s-page heading="Print sides">
        <s-section heading="No products found">
          <s-paragraph>Add a Shopify product first, then return here.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const saveLabel = isSaving
    ? "Saving…"
    : hasUnsavedChanges
      ? "Save Back side"
      : "Saved ✓";

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
    <s-page heading="Print sides">
      <s-button
        slot="primary-action"
        onClick={save}
        disabled={!hasUnsavedChanges || isSaving}
        {...(isSaving ? { loading: true } : {})}
      >
        {saveLabel}
      </s-button>

      <s-section heading="Choose a product">
        <div style={{ display: "grid", gap: 7 }}>
          <label htmlFor="pp-side-product" style={{ fontWeight: 700 }}>Product</label>
          <select
            id="pp-side-product"
            value={selectedId}
            disabled={isSaving}
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
      </s-section>

      <s-section heading="Front + Back">
        <div style={{ display: "grid", gap: 22 }}>
          <div
            style={{
              padding: 16,
              border: "1px solid #dce3df",
              borderRadius: 14,
              background: "#f7faf8",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16 }}>Front</div>
            <div style={{ marginTop: 5, color: "#65716c", fontSize: 13, lineHeight: 1.5 }}>
              Uses the print area already configured on Home. Physical size:{" "}
              {selectedProduct.front.printWidthCm > 0 && selectedProduct.front.printHeightCm > 0
                ? `${selectedProduct.front.printWidthCm} × ${selectedProduct.front.printHeightCm} cm`
                : "quality check off"}.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(320px, 1.35fr) minmax(280px, .8fr)",
              gap: 24,
              alignItems: "start",
            }}
          >
            <div>
              <div style={{ marginBottom: 10, fontWeight: 800, fontSize: 16 }}>Back preview</div>
              <div
                ref={stageRef}
                style={{
                  position: "relative",
                  width: "100%",
                  maxWidth: 680,
                  minHeight: selectedMedia?.image?.url ? undefined : 420,
                  margin: "0 auto",
                  background: "#f4f4f4",
                  borderRadius: 16,
                  overflow: "hidden",
                  lineHeight: 0,
                  userSelect: "none",
                  opacity: values.enabled ? 1 : 0.5,
                }}
              >
                {selectedMedia?.image?.url ? (
                  <img
                    key={selectedMedia.id}
                    src={selectedMedia.image.url}
                    alt={selectedMedia.image.altText || `${selectedProduct.title} Back`}
                    draggable={false}
                    style={{ display: "block", width: "100%", height: "auto" }}
                  />
                ) : (
                  <div
                    style={{
                      minHeight: 420,
                      display: "grid",
                      placeItems: "center",
                      padding: 30,
                      color: "#666",
                      lineHeight: 1.4,
                      textAlign: "center",
                    }}
                  >
                    Add a second product image in Shopify to use a Back side.
                  </div>
                )}

                {selectedMedia?.image?.url ? (
                  <div
                    onPointerDown={(event) => beginInteraction(event, "move")}
                    style={{
                      position: "absolute",
                      left: `${values.left}%`,
                      top: `${values.top}%`,
                      width: `${values.width}%`,
                      height: `${values.height}%`,
                      border: "3px solid #008060",
                      background: "rgba(0,128,96,.13)",
                      boxSizing: "border-box",
                      cursor: values.enabled ? "move" : "default",
                      touchAction: "none",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        color: "#005c45",
                        fontWeight: 800,
                        fontSize: 12,
                        lineHeight: 1.2,
                        textAlign: "center",
                        pointerEvents: "none",
                      }}
                    >
                      BACK PRINT AREA
                    </div>
                    <div
                      onPointerDown={(event) => beginInteraction(event, "resize")}
                      style={{
                        position: "absolute",
                        right: -9,
                        bottom: -9,
                        width: 18,
                        height: 18,
                        border: "3px solid white",
                        borderRadius: 6,
                        background: "#008060",
                        cursor: values.enabled ? "nwse-resize" : "default",
                        touchAction: "none",
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <p style={{ margin: "10px 0 0", color: "#68736e", fontSize: 12, lineHeight: 1.5 }}>
                Drag the green box to position it. Drag the bottom-right corner to resize it.
              </p>
            </div>

            <div style={{ display: "grid", gap: 16 }}>
              <label
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  padding: 16,
                  border: "1px solid #d8dfdc",
                  borderRadius: 14,
                }}
              >
                <span>
                  <strong style={{ display: "block" }}>Enable Back side</strong>
                  <span style={{ display: "block", marginTop: 4, color: "#68736e", fontSize: 12 }}>
                    Customers can choose Front or Back in the customizer.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={values.enabled}
                  disabled={isSaving}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setValues((current) => ({ ...current, enabled: checked }));
                  }}
                  style={{ width: 22, height: 22 }}
                />
              </label>

              <div style={{ display: "grid", gap: 7 }}>
                <label htmlFor="pp-back-image" style={{ fontWeight: 700 }}>Back product image</label>
                <select
                  id="pp-back-image"
                  value={values.mediaId}
                  disabled={isSaving || selectedProduct.media.length === 0}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, mediaId: event.currentTarget.value }))
                  }
                  style={inputStyle}
                >
                  {selectedProduct.media.length === 0 ? (
                    <option value="">No product images</option>
                  ) : (
                    selectedProduct.media.map((media, index) => (
                      <option key={media.id} value={media.id}>
                        Image {index + 1}{media.image?.altText ? ` · ${media.image.altText}` : ""}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                {(["left", "top", "width", "height"] as const).map((key) => (
                  <label key={key} style={{ display: "grid", gap: 6, fontWeight: 650 }}>
                    {key.charAt(0).toUpperCase() + key.slice(1)} %
                    <input
                      type="number"
                      min={key === "width" || key === "height" ? 5 : 0}
                      max={100}
                      step={1}
                      value={Math.round(values[key] * 10) / 10}
                      disabled={isSaving}
                      onChange={(event) => updateNumber(key, event.currentTarget.value)}
                      style={inputStyle}
                    />
                  </label>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                <label style={{ display: "grid", gap: 6, fontWeight: 650 }}>
                  Print width (cm)
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={0.1}
                    value={values.printWidthCm}
                    disabled={isSaving}
                    onChange={(event) => updateNumber("printWidthCm", event.currentTarget.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, fontWeight: 650 }}>
                  Print height (cm)
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={0.1}
                    value={values.printHeightCm}
                    disabled={isSaving}
                    onChange={(event) => updateNumber("printHeightCm", event.currentTarget.value)}
                    style={inputStyle}
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={save}
                disabled={!hasUnsavedChanges || isSaving}
                style={{
                  minHeight: 46,
                  border: 0,
                  borderRadius: 12,
                  background: hasUnsavedChanges ? "#111" : "#e8f5ee",
                  color: hasUnsavedChanges ? "white" : "#005c45",
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: hasUnsavedChanges && !isSaving ? "pointer" : "default",
                }}
              >
                {saveLabel}
              </button>

              {fetcher.data && !fetcher.data.ok ? (
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
                  {fetcher.data.errors?.join(" ") || "Could not save the Back side."}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
