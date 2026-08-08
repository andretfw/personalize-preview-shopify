import { createHmac, timingSafeEqual } from "node:crypto";

import { unauthenticated } from "../shopify.server";

const PRODUCT_GID_PREFIX = "gid://shopify/Product/";
const MAX_PROXY_REQUEST_AGE_SECONDS = 10 * 60;
const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type MetafieldValue = { value?: string | null } | null;

type MediaNode = {
  id: string;
  image?: { url?: string | null; altText?: string | null } | null;
};

type ProductSidesData = {
  product?: {
    id: string;
    featuredMedia?: {
      preview?: { image?: { url?: string | null; altText?: string | null } | null } | null;
    } | null;
    media?: { nodes?: MediaNode[] } | null;
    frontPrintWidthCm?: MetafieldValue;
    frontPrintHeightCm?: MetafieldValue;
    backEnabled?: MetafieldValue;
    backMediaId?: MetafieldValue;
    backLeft?: MetafieldValue;
    backTop?: MetafieldValue;
    backWidth?: MetafieldValue;
    backHeight?: MetafieldValue;
    backPrintWidthCm?: MetafieldValue;
    backPrintHeightCm?: MetafieldValue;
  } | null;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function fail(error: string) {
  return json({ ok: false, error });
}

function positiveNumber(value: string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function numberOr(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function verifyAppProxyRequest(request: Request) {
  const secret = process.env.SHOPIFY_API_SECRET || "";

  if (!secret) {
    console.error("SHOPIFY_API_SECRET is missing.");
    return null;
  }

  const url = new URL(request.url);
  const signature = url.searchParams.get("signature") || "";
  const rawShop = url.searchParams.get("shop") || "";
  const timestamp = Number(url.searchParams.get("timestamp"));

  if (
    !signature ||
    !SHOP_DOMAIN_PATTERN.test(rawShop) ||
    !Number.isFinite(timestamp)
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_PROXY_REQUEST_AGE_SECONDS) return null;

  const parameterNames = Array.from(new Set(url.searchParams.keys())).filter(
    (name) => name !== "signature",
  );

  const message = parameterNames
    .map((name) => `${name}=${url.searchParams.getAll(name).join(",")}`)
    .sort()
    .join("");

  const expectedSignature = createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return { shop: rawShop.toLowerCase() };
}

async function graphql<TData>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message || "GraphQL error").join("; "),
    );
  }

  if (!payload.data) throw new Error("Shopify returned an empty GraphQL response.");
  return payload.data;
}

export async function loader() {
  return json({ ok: true, service: "personalize-preview-sides" });
}

export async function action({ request }: { request: Request }) {
  const verified = verifyAppProxyRequest(request);
  if (!verified) {
    console.error("Rejected sides app-proxy request: signature validation failed.");
    return fail("Invalid personalization request.");
  }

  let productId = "";
  try {
    const body = (await request.json()) as { productId?: unknown };
    productId = typeof body.productId === "string" ? body.productId.trim() : "";
  } catch {
    return fail("The request body is invalid.");
  }

  if (!productId.startsWith(PRODUCT_GID_PREFIX)) {
    return fail("The Shopify product ID is invalid.");
  }

  try {
    const context = await unauthenticated.admin(verified.shop);
    const admin = context.admin as AdminClient;

    const data = await graphql<ProductSidesData>(
      admin,
      `#graphql
        query PersonalizePreviewStorefrontSides($id: ID!) {
          product(id: $id) {
            id
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
      `,
      { id: productId },
    );

    const product = data.product;
    if (!product?.id) return fail("Shopify could not find this product.");

    const media = product.media?.nodes ?? [];
    const savedBackMediaId = product.backMediaId?.value || "";
    const backMedia =
      media.find((item) => item.id === savedBackMediaId) || media[1] || media[0] || null;
    const frontImage =
      product.featuredMedia?.preview?.image?.url || media[0]?.image?.url || "";

    return json({
      ok: true,
      front: {
        label: "Front",
        imageUrl: frontImage,
        printWidthCm: positiveNumber(product.frontPrintWidthCm?.value),
        printHeightCm: positiveNumber(product.frontPrintHeightCm?.value),
      },
      back: {
        enabled: product.backEnabled?.value === "true" && Boolean(backMedia?.image?.url),
        label: "Back",
        imageUrl: backMedia?.image?.url || "",
        left: numberOr(product.backLeft?.value, 35),
        top: numberOr(product.backTop?.value, 22),
        width: numberOr(product.backWidth?.value, 30),
        height: numberOr(product.backHeight?.value, 45),
        printWidthCm: positiveNumber(product.backPrintWidthCm?.value),
        printHeightCm: positiveNumber(product.backPrintHeightCm?.value),
      },
    });
  } catch (error) {
    console.error("Could not load storefront print sides:", error);
    return fail("The product print-side settings could not be loaded.");
  }
}
