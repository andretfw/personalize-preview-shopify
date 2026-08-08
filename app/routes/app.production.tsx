import { useEffect, useMemo, useRef, useState } from "react";
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
  printWidthCm: MetafieldValue;
  printHeightCm: MetafieldValue;
};

type ProductProduction = {
  id: string;
  title: string;
  status: string;
  printWidthCm: number;
  printHeightCm: number;
};

type ProductionValues = {
  printWidthCm: number;
  printHeightCm: number;
};

const numberFromMetafield = (field: MetafieldValue) => {
  const parsed = Number(field?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const parseMeasurement = (value: FormDataEntryValue | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(Math.min(parsed, 1000) * 10) / 10;
};

const valuesFromProduct = (product: ProductProduction | null): ProductionValues => ({
  printWidthCm: product?.printWidthCm ?? 0,
  printHeightCm: product?.printHeightCm ?? 0,
});

const valuesEqual = (left: ProductionValues, right: ProductionValues) =>
  left.printWidthCm === right.printWidthCm &&
  left.printHeightCm === right.printHeightCm;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
      query PersonalizePreviewProductionProducts {
        products(first: 100, sortKey: TITLE) {
          nodes {
            id
            title
            status
            printWidthCm: metafield(namespace: "custom", key: "personalize_print_width_cm") {
              value
            }
            printHeightCm: metafield(namespace: "custom", key: "personalize_print_height_cm") {
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

  const products: ProductProduction[] = (json.data?.products?.nodes ?? []).map(
    (product) => ({
      id: product.id,
      title: product.title,
      status: product.status,
      printWidthCm: numberFromMetafield(product.printWidthCm),
      printHeightCm: numberFromMetafield(product.printHeightCm),
    }),
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

  const printWidthCm = parseMeasurement(formData.get("printWidthCm"));
  const printHeightCm = parseMeasurement(formData.get("printHeightCm"));

  if ((printWidthCm === 0) !== (printHeightCm === 0)) {
    return {
      ok: false,
      errors: ["Enter both print width and print height, or set both to 0 to disable the quality check."],
    };
  }

  const response = await admin.graphql(
    `#graphql
      mutation SavePersonalizePreviewProduction($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId: productId,
            namespace: "custom",
            key: "personalize_print_width_cm",
            type: "number_decimal",
            value: String(printWidthCm),
          },
          {
            ownerId: productId,
            namespace: "custom",
            key: "personalize_print_height_cm",
            type: "number_decimal",
            value: String(printHeightCm),
          },
        ],
      },
    },
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
    values: { printWidthCm, printHeightCm },
  };
};

export default function ProductionSettings() {
  const { products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saveSequenceRef = useRef(0);
  const handledSaveSequenceRef = useRef(0);

  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId) ?? products[0] ?? null,
    [products, selectedId],
  );
  const [values, setValues] = useState<ProductionValues>(
    valuesFromProduct(selectedProduct),
  );

  const isSaving = fetcher.state !== "idle";
  const savedValues = valuesFromProduct(selectedProduct);
  const hasUnsavedChanges = !valuesEqual(values, savedValues);

  useEffect(() => {
    setValues(valuesFromProduct(selectedProduct));
  }, [selectedProduct]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result?.ok) return;
    if (handledSaveSequenceRef.current === saveSequenceRef.current) return;

    handledSaveSequenceRef.current = saveSequenceRef.current;
    const savedProduct = products.find((product) => product.id === result.productId);
    if (savedProduct) Object.assign(savedProduct, result.values);
    if (selectedId === result.productId) setValues(result.values);

    shopify.toast.show("Production settings saved");
  }, [fetcher.data, products, selectedId, shopify]);

  const save = () => {
    if (!selectedProduct || !hasUnsavedChanges || isSaving) return;
    saveSequenceRef.current += 1;

    const formData = new FormData();
    formData.set("productId", selectedProduct.id);
    formData.set("printWidthCm", String(values.printWidthCm));
    formData.set("printHeightCm", String(values.printHeightCm));
    fetcher.submit(formData, { method: "POST" });
  };

  if (!selectedProduct) {
    return (
      <s-page heading="Production">
        <s-section heading="No products found">
          <s-paragraph>Add a Shopify product first, then return here.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const saveLabel = isSaving
    ? "Saving…"
    : hasUnsavedChanges
      ? "Save production setup"
      : "Saved ✓";

  const updateMeasurement = (key: keyof ProductionValues, rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    setValues((current) => ({
      ...current,
      [key]: Math.max(0, Math.min(parsed, 1000)),
    }));
  };

  return (
    <s-page heading="Production">
      <s-button
        slot="primary-action"
        onClick={save}
        disabled={!hasUnsavedChanges || isSaving}
        {...(isSaving ? { loading: true } : {})}
      >
        {saveLabel}
      </s-button>

      <s-section heading="Print quality guard">
        <div style={{ display: "grid", gap: 18, maxWidth: 720 }}>
          <p style={{ margin: 0, color: "#616161", lineHeight: 1.55 }}>
            Tell the app the real printable size. Customers will then see a live image-quality
            check based on the uploaded file resolution and how large they make it in the print area.
          </p>

          <div style={{ display: "grid", gap: 8 }}>
            <label htmlFor="pp-production-product" style={{ fontWeight: 700 }}>
              Product
            </label>
            <select
              id="pp-production-product"
              value={selectedId}
              onChange={(event) => setSelectedId(event.currentTarget.value)}
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
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 14,
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="pp-print-width-cm" style={{ fontWeight: 650 }}>
                Print width (cm)
              </label>
              <input
                id="pp-print-width-cm"
                type="number"
                min={0}
                max={1000}
                step={0.1}
                value={values.printWidthCm}
                onChange={(event) =>
                  updateMeasurement("printWidthCm", event.currentTarget.value)
                }
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  border: "1px solid #8a8a8a",
                  borderRadius: 10,
                  fontSize: 15,
                }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="pp-print-height-cm" style={{ fontWeight: 650 }}>
                Print height (cm)
              </label>
              <input
                id="pp-print-height-cm"
                type="number"
                min={0}
                max={1000}
                step={0.1}
                value={values.printHeightCm}
                onChange={(event) =>
                  updateMeasurement("printHeightCm", event.currentTarget.value)
                }
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  border: "1px solid #8a8a8a",
                  borderRadius: 10,
                  fontSize: 15,
                }}
              />
            </div>
          </div>

          <p style={{ margin: 0, color: "#616161", fontSize: 13, lineHeight: 1.5 }}>
            Example: if the printable area is 20 cm wide by 25 cm high, enter 20 and 25.
            Set both values to 0 if you do not want a resolution warning on this product.
          </p>

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
              fontWeight: 750,
              cursor: isSaving ? "wait" : hasUnsavedChanges ? "pointer" : "default",
            }}
          >
            {saveLabel}
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
              {fetcher.data.errors?.join(" ") || "Could not save production settings."}
            </div>
          )}
        </div>
      </s-section>

      <s-section slot="aside" heading="How the quality check works">
        <s-paragraph>
          The storefront compares the artwork's pixel dimensions with its effective printed size.
          It labels the result Great, Okay, or Too low and updates as the customer resizes the image.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
