import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type MetafieldValue = { value: string } | null;

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ProductNode = {
  id: string;
  title: string;
  status: string;
  left: MetafieldValue;
  top: MetafieldValue;
  width: MetafieldValue;
  height: MetafieldValue;
  printWidthCm: MetafieldValue;
  printHeightCm: MetafieldValue;
};

type ProductProduction = {
  id: string;
  title: string;
  status: string;
  left: number;
  top: number;
  width: number;
  height: number;
  printWidthCm: number;
  printHeightCm: number;
};

type ProductionValues = {
  printWidthCm: number;
  printHeightCm: number;
};

type ProductionPreset = {
  id: string;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  printWidthCm: number;
  printHeightCm: number;
};

type InstallationConfig = {
  id: string;
  presets: ProductionPreset[];
};

const PRESET_NAMESPACE = "personalize_preview";
const PRESET_KEY = "production_presets";
const MAX_PRESETS = 20;
const PRINT_AREA_DEFAULTS = {
  left: 35,
  top: 22,
  width: 30,
  height: 45,
};

const numberFromMetafield = (field: MetafieldValue, fallback = 0) => {
  const parsed = Number(field?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const positiveNumberFromMetafield = (field: MetafieldValue) => {
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

const normalizeProduct = (product: ProductNode): ProductProduction => ({
  id: product.id,
  title: product.title,
  status: product.status,
  left: numberFromMetafield(product.left, PRINT_AREA_DEFAULTS.left),
  top: numberFromMetafield(product.top, PRINT_AREA_DEFAULTS.top),
  width: numberFromMetafield(product.width, PRINT_AREA_DEFAULTS.width),
  height: numberFromMetafield(product.height, PRINT_AREA_DEFAULTS.height),
  printWidthCm: positiveNumberFromMetafield(product.printWidthCm),
  printHeightCm: positiveNumberFromMetafield(product.printHeightCm),
});

function normalizePreset(value: unknown): ProductionPreset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 50) : "";
  const id = typeof candidate.id === "string" ? candidate.id.slice(0, 100) : "";

  if (!id || !name) return null;

  const number = (key: string, fallback: number) => {
    const parsed = Number(candidate[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    id,
    name,
    left: number("left", PRINT_AREA_DEFAULTS.left),
    top: number("top", PRINT_AREA_DEFAULTS.top),
    width: number("width", PRINT_AREA_DEFAULTS.width),
    height: number("height", PRINT_AREA_DEFAULTS.height),
    printWidthCm: Math.max(0, number("printWidthCm", 0)),
    printHeightCm: Math.max(0, number("printHeightCm", 0)),
  };
}

function parsePresets(rawValue: string | null | undefined): ProductionPreset[] {
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePreset)
      .filter((preset): preset is ProductionPreset => Boolean(preset))
      .slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

async function loadInstallationConfig(admin: AdminGraphqlClient): Promise<InstallationConfig> {
  const response = await admin.graphql(
    `#graphql
      query PersonalizePreviewInstallationConfig {
        currentAppInstallation {
          id
          presets: metafield(namespace: "personalize_preview", key: "production_presets") {
            value
          }
        }
      }
    `,
  );

  const json = (await response.json()) as {
    data?: {
      currentAppInstallation?: {
        id?: string;
        presets?: { value?: string | null } | null;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length || !json.data?.currentAppInstallation?.id) {
    throw new Error(
      json.errors?.map((error) => error.message || "Shopify query failed").join(" ") ||
        "Could not load app preset storage.",
    );
  }

  return {
    id: json.data.currentAppInstallation.id,
    presets: parsePresets(json.data.currentAppInstallation.presets?.value),
  };
}

async function saveInstallationPresets(
  admin: AdminGraphqlClient,
  installationId: string,
  presets: ProductionPreset[],
) {
  const response = await admin.graphql(
    `#graphql
      mutation SavePersonalizePreviewPresets($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId: installationId,
            namespace: PRESET_NAMESPACE,
            key: PRESET_KEY,
            type: "json",
            value: JSON.stringify(presets),
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
    throw new Error(json.errors.map((error) => error.message || "Shopify save failed").join(" "));
  }

  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
}

async function loadProduct(admin: AdminGraphqlClient, productId: string) {
  const response = await admin.graphql(
    `#graphql
      query PersonalizePreviewProductionProduct($id: ID!) {
        product(id: $id) {
          id
          title
          status
          left: metafield(namespace: "custom", key: "personalize_print_left") { value }
          top: metafield(namespace: "custom", key: "personalize_print_top") { value }
          width: metafield(namespace: "custom", key: "personalize_print_width") { value }
          height: metafield(namespace: "custom", key: "personalize_print_height") { value }
          printWidthCm: metafield(namespace: "custom", key: "personalize_print_width_cm") { value }
          printHeightCm: metafield(namespace: "custom", key: "personalize_print_height_cm") { value }
        }
      }
    `,
    { variables: { id: productId } },
  );

  const json = (await response.json()) as {
    data?: { product?: ProductNode | null };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length || !json.data?.product) {
    throw new Error(
      json.errors?.map((error) => error.message || "Shopify query failed").join(" ") ||
        "The selected product could not be loaded.",
    );
  }

  return normalizeProduct(json.data.product);
}

async function saveProductMetafields(
  admin: AdminGraphqlClient,
  metafields: Array<Record<string, string>>,
) {
  const response = await admin.graphql(
    `#graphql
      mutation SavePersonalizePreviewProduction($metafields: [MetafieldsSetInput!]!) {
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
    throw new Error(json.errors.map((error) => error.message || "Shopify save failed").join(" "));
  }

  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join(" "));
}

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
            left: metafield(namespace: "custom", key: "personalize_print_left") { value }
            top: metafield(namespace: "custom", key: "personalize_print_top") { value }
            width: metafield(namespace: "custom", key: "personalize_print_width") { value }
            height: metafield(namespace: "custom", key: "personalize_print_height") { value }
            printWidthCm: metafield(namespace: "custom", key: "personalize_print_width_cm") { value }
            printHeightCm: metafield(namespace: "custom", key: "personalize_print_height_cm") { value }
          }
        }
        currentAppInstallation {
          id
          presets: metafield(namespace: "personalize_preview", key: "production_presets") {
            value
          }
        }
      }
    `,
  );

  const json = (await response.json()) as {
    data?: {
      products?: { nodes?: ProductNode[] };
      currentAppInstallation?: {
        id?: string;
        presets?: { value?: string | null } | null;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      json.errors.map((error) => error.message || "Shopify query failed").join(" "),
    );
  }

  return {
    products: (json.data?.products?.nodes ?? []).map(normalizeProduct),
    presets: parsePresets(json.data?.currentAppInstallation?.presets?.value),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "save-production");
  const productId = String(formData.get("productId") || "");

  try {
    if (intent === "delete-preset") {
      const presetId = String(formData.get("presetId") || "");
      const installation = await loadInstallationConfig(admin);
      const presets = installation.presets.filter((preset) => preset.id !== presetId);
      await saveInstallationPresets(admin, installation.id, presets);
      return { ok: true, intent, presets };
    }

    if (!productId.startsWith("gid://shopify/Product/")) {
      return { ok: false, intent, errors: ["Choose a valid Shopify product."] };
    }

    if (intent === "save-preset") {
      const name = String(formData.get("presetName") || "").trim().slice(0, 50);
      if (!name) {
        return { ok: false, intent, errors: ["Give the preset a name first."] };
      }

      const product = await loadProduct(admin, productId);
      const printWidthCm = parseMeasurement(formData.get("printWidthCm"));
      const printHeightCm = parseMeasurement(formData.get("printHeightCm"));

      if ((printWidthCm === 0) !== (printHeightCm === 0)) {
        return {
          ok: false,
          intent,
          errors: ["Enter both print width and print height before saving the preset."],
        };
      }

      const installation = await loadInstallationConfig(admin);
      const matchingIndex = installation.presets.findIndex(
        (preset) => preset.name.toLowerCase() === name.toLowerCase(),
      );

      if (matchingIndex < 0 && installation.presets.length >= MAX_PRESETS) {
        return {
          ok: false,
          intent,
          errors: [`You can save up to ${MAX_PRESETS} presets. Delete one before adding another.`],
        };
      }

      const preset: ProductionPreset = {
        id:
          matchingIndex >= 0
            ? installation.presets[matchingIndex].id
            : `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        left: Math.round(product.left),
        top: Math.round(product.top),
        width: Math.round(product.width),
        height: Math.round(product.height),
        printWidthCm,
        printHeightCm,
      };

      const presets = [...installation.presets];
      if (matchingIndex >= 0) presets[matchingIndex] = preset;
      else presets.push(preset);

      await saveInstallationPresets(admin, installation.id, presets);
      return { ok: true, intent, presets, savedPresetName: name };
    }

    if (intent === "apply-preset") {
      const presetId = String(formData.get("presetId") || "");
      const installation = await loadInstallationConfig(admin);
      const preset = installation.presets.find((item) => item.id === presetId);

      if (!preset) {
        return { ok: false, intent, errors: ["That preset no longer exists."] };
      }

      await saveProductMetafields(admin, [
        {
          ownerId: productId,
          namespace: "custom",
          key: "personalize_print_left",
          type: "number_integer",
          value: String(Math.round(preset.left)),
        },
        {
          ownerId: productId,
          namespace: "custom",
          key: "personalize_print_top",
          type: "number_integer",
          value: String(Math.round(preset.top)),
        },
        {
          ownerId: productId,
          namespace: "custom",
          key: "personalize_print_width",
          type: "number_integer",
          value: String(Math.round(preset.width)),
        },
        {
          ownerId: productId,
          namespace: "custom",
          key: "personalize_print_height",
          type: "number_integer",
          value: String(Math.round(preset.height)),
        },
        {
          ownerId: productId,
          namespace: "custom",
          key: "personalize_print_width_cm",
          type: "number_decimal",
          value: String(preset.printWidthCm),
        },
        {
          ownerId: productId,
          namespace: "custom",
          key: "personalize_print_height_cm",
          type: "number_decimal",
          value: String(preset.printHeightCm),
        },
      ]);

      return {
        ok: true,
        intent,
        productId,
        appliedPresetName: preset.name,
        productValues: {
          left: preset.left,
          top: preset.top,
          width: preset.width,
          height: preset.height,
          printWidthCm: preset.printWidthCm,
          printHeightCm: preset.printHeightCm,
        },
      };
    }

    const printWidthCm = parseMeasurement(formData.get("printWidthCm"));
    const printHeightCm = parseMeasurement(formData.get("printHeightCm"));

    if ((printWidthCm === 0) !== (printHeightCm === 0)) {
      return {
        ok: false,
        intent,
        errors: ["Enter both print width and print height, or set both to 0 to disable the quality check."],
      };
    }

    await saveProductMetafields(admin, [
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
    ]);

    return {
      ok: true,
      intent: "save-production",
      productId,
      productValues: { printWidthCm, printHeightCm },
    };
  } catch (error) {
    console.error(`Production action failed during ${intent}:`, error);
    return {
      ok: false,
      intent,
      errors: [error instanceof Error ? error.message : "The production settings could not be saved."],
    };
  }
};

export default function ProductionSettings() {
  const { products, presets: initialPresets } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const handledResultRef = useRef<unknown>(null);

  const [presets, setPresets] = useState<ProductionPreset[]>(initialPresets);
  const [presetName, setPresetName] = useState("");
  const [selectedId, setSelectedId] = useState(products[0]?.id ?? "");
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId) ?? products[0] ?? null,
    [products, selectedId],
  );
  const [values, setValues] = useState<ProductionValues>(
    valuesFromProduct(selectedProduct),
  );

  const isBusy = fetcher.state !== "idle";
  const savedValues = valuesFromProduct(selectedProduct);
  const hasUnsavedChanges = !valuesEqual(values, savedValues);

  useEffect(() => {
    setValues(valuesFromProduct(selectedProduct));
  }, [selectedProduct]);

  useEffect(() => {
    const result = fetcher.data;
    if (!result || handledResultRef.current === result) return;
    handledResultRef.current = result;

    if (!result.ok) return;

    if ("presets" in result && Array.isArray(result.presets)) {
      setPresets(result.presets as ProductionPreset[]);
    }

    if ("productId" in result && result.productId && "productValues" in result) {
      const product = products.find((item) => item.id === result.productId);
      if (product && result.productValues) Object.assign(product, result.productValues);

      if (selectedId === result.productId && result.productValues) {
        setValues({
          printWidthCm: Number(result.productValues.printWidthCm) || 0,
          printHeightCm: Number(result.productValues.printHeightCm) || 0,
        });
      }
    }

    if (result.intent === "save-production") {
      shopify.toast.show("Production settings saved");
    } else if (result.intent === "save-preset") {
      setPresetName("");
      shopify.toast.show(`Preset ${result.savedPresetName || "saved"}`);
    } else if (result.intent === "apply-preset") {
      shopify.toast.show(`Applied ${result.appliedPresetName || "preset"}`);
    } else if (result.intent === "delete-preset") {
      shopify.toast.show("Preset deleted");
    }
  }, [fetcher.data, products, selectedId, shopify]);

  const submit = (fields: Record<string, string>) => {
    const formData = new FormData();
    Object.entries(fields).forEach(([key, value]) => formData.set(key, value));
    fetcher.submit(formData, { method: "POST" });
  };

  const saveProduction = () => {
    if (!selectedProduct || !hasUnsavedChanges || isBusy) return;
    submit({
      intent: "save-production",
      productId: selectedProduct.id,
      printWidthCm: String(values.printWidthCm),
      printHeightCm: String(values.printHeightCm),
    });
  };

  const savePreset = () => {
    if (!selectedProduct || !presetName.trim() || hasUnsavedChanges || isBusy) return;
    submit({
      intent: "save-preset",
      productId: selectedProduct.id,
      presetName: presetName.trim(),
      printWidthCm: String(values.printWidthCm),
      printHeightCm: String(values.printHeightCm),
    });
  };

  const applyPreset = (presetId: string) => {
    if (!selectedProduct || isBusy) return;
    submit({
      intent: "apply-preset",
      productId: selectedProduct.id,
      presetId,
    });
  };

  const deletePreset = (preset: ProductionPreset) => {
    if (isBusy) return;
    if (!window.confirm(`Delete preset “${preset.name}”?`)) return;
    submit({ intent: "delete-preset", presetId: preset.id });
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

  const saveLabel = isBusy && fetcher.formData?.get("intent") === "save-production"
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
        onClick={saveProduction}
        disabled={!hasUnsavedChanges || isBusy}
        {...(isBusy && fetcher.formData?.get("intent") === "save-production" ? { loading: true } : {})}
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
              disabled={isBusy}
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
                disabled={isBusy}
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
                disabled={isBusy}
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
            onClick={saveProduction}
            disabled={!hasUnsavedChanges || isBusy}
            style={{
              minHeight: 46,
              border: 0,
              borderRadius: 12,
              background: hasUnsavedChanges ? "#111" : "#e8f5ee",
              color: hasUnsavedChanges ? "white" : "#005c45",
              fontSize: 15,
              fontWeight: 750,
              cursor: isBusy ? "wait" : hasUnsavedChanges ? "pointer" : "default",
            }}
          >
            {saveLabel}
          </button>
        </div>
      </s-section>

      <s-section heading="Reusable print presets">
        <div style={{ display: "grid", gap: 18, maxWidth: 820 }}>
          <p style={{ margin: 0, color: "#616161", lineHeight: 1.55 }}>
            Save the selected product print box and physical print size once, then apply that setup
            to another product without rebuilding it from scratch. Save any production changes first.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="pp-preset-name" style={{ fontWeight: 650 }}>
                Preset name
              </label>
              <input
                id="pp-preset-name"
                type="text"
                maxLength={50}
                value={presetName}
                disabled={isBusy}
                onChange={(event) => setPresetName(event.currentTarget.value)}
                placeholder="Example: 11oz mug"
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  border: "1px solid #8a8a8a",
                  borderRadius: 10,
                  fontSize: 15,
                }}
              />
            </div>
            <button
              type="button"
              onClick={savePreset}
              disabled={!presetName.trim() || hasUnsavedChanges || isBusy}
              style={{
                minHeight: 44,
                padding: "0 16px",
                border: 0,
                borderRadius: 10,
                background: "#111",
                color: "white",
                fontWeight: 750,
                cursor: !presetName.trim() || hasUnsavedChanges || isBusy ? "default" : "pointer",
                opacity: !presetName.trim() || hasUnsavedChanges || isBusy ? 0.5 : 1,
              }}
            >
              Save current setup as preset
            </button>
          </div>

          {presets.length === 0 ? (
            <div
              style={{
                padding: 16,
                border: "1px dashed #c8c8c8",
                borderRadius: 12,
                color: "#616161",
                fontSize: 13,
              }}
            >
              No presets yet. Configure one product, name the setup, and save it here.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {presets.map((preset) => (
                <div
                  key={preset.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 14,
                    alignItems: "center",
                    padding: 14,
                    border: "1px solid #dedede",
                    borderRadius: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 750, marginBottom: 4 }}>{preset.name}</div>
                    <div style={{ color: "#616161", fontSize: 12, lineHeight: 1.5 }}>
                      Area: {Math.round(preset.left)}% left · {Math.round(preset.top)}% top · {Math.round(preset.width)}% × {Math.round(preset.height)}%
                      <br />
                      Physical: {preset.printWidthCm > 0 && preset.printHeightCm > 0
                        ? `${preset.printWidthCm} × ${preset.printHeightCm} cm`
                        : "quality check off"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={() => applyPreset(preset.id)}
                      disabled={isBusy}
                      style={{
                        minHeight: 38,
                        padding: "0 12px",
                        border: 0,
                        borderRadius: 9,
                        background: "#111",
                        color: "white",
                        fontWeight: 700,
                        cursor: isBusy ? "wait" : "pointer",
                      }}
                    >
                      Apply to {selectedProduct.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePreset(preset)}
                      disabled={isBusy}
                      style={{
                        minHeight: 38,
                        padding: "0 12px",
                        border: "1px solid #c8c8c8",
                        borderRadius: 9,
                        background: "white",
                        color: "#333",
                        fontWeight: 700,
                        cursor: isBusy ? "wait" : "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </s-section>

      {fetcher.data && !fetcher.data.ok && (
        <s-section>
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
            {fetcher.data.errors?.join(" ") || "Could not update production settings."}
          </div>
        </s-section>
      )}

      <s-section slot="aside" heading="How the quality check works">
        <s-paragraph>
          The storefront compares the uploaded artwork pixel dimensions with its effective printed size.
          It labels the result Great, Okay, or Too low and updates as the customer resizes the image.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
