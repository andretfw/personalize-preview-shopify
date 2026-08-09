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

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
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

function verifyAppProxyRequest(request: Request) {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  if (!secret) return null;

  const url = new URL(request.url);
  const signature = url.searchParams.get("signature") || "";
  const shop = url.searchParams.get("shop") || "";
  const timestamp = Number(url.searchParams.get("timestamp"));

  if (!signature || !SHOP_DOMAIN_PATTERN.test(shop) || !Number.isFinite(timestamp)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_PROXY_REQUEST_AGE_SECONDS) return null;

  const names = Array.from(new Set(url.searchParams.keys())).filter(
    (name) => name !== "signature",
  );
  const message = names
    .map((name) => `${name}=${url.searchParams.getAll(name).join(",")}`)
    .sort()
    .join("");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  return { shop: shop.toLowerCase() };
}

export async function loader() {
  return json({ ok: true, service: "personalize-preview-pricing" });
}

export async function action({ request }: { request: Request }) {
  const verified = verifyAppProxyRequest(request);
  if (!verified) return fail("Invalid personalization pricing request.");

  let productId = "";
  try {
    const body = (await request.json()) as { productId?: unknown };
    productId = typeof body.productId === "string" ? body.productId.trim() : "";
  } catch {
    return fail("The pricing request body is invalid.");
  }

  if (!productId.startsWith(PRODUCT_GID_PREFIX)) {
    return fail("The Shopify product ID is invalid.");
  }

  try {
    const context = await unauthenticated.admin(verified.shop);
    const admin = context.admin as AdminClient;
    const response = await admin.graphql(
      `#graphql
        query PersonalizePreviewStorefrontPricing($id: ID!) {
          shop { currencyCode }
          product(id: $id) {
            id
            backEnabled: metafield(namespace: "custom", key: "personalize_back_enabled") { value }
            backSurcharge: metafield(namespace: "custom", key: "personalize_back_surcharge") { value }
            backFeeVariantId: metafield(namespace: "custom", key: "personalize_back_fee_variant_id") { value }
          }
        }
      `,
      { variables: { id: productId } },
    );

    const payload = (await response.json()) as {
      data?: {
        shop?: { currencyCode?: string | null };
        product?: {
          id: string;
          backEnabled?: MetafieldValue;
          backSurcharge?: MetafieldValue;
          backFeeVariantId?: MetafieldValue;
        } | null;
      };
      errors?: Array<{ message?: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message || "GraphQL error").join("; "));
    }

    const product = payload.data?.product;
    if (!product?.id) return fail("Shopify could not find this product.");

    const surcharge = Number(product.backSurcharge?.value || 0);
    const feeVariantGid = product.backFeeVariantId?.value || "";
    const feeVariantId = feeVariantGid.split("/").pop() || "";

    return json({
      ok: true,
      surcharge: Number.isFinite(surcharge) && surcharge > 0 ? surcharge : 0,
      currencyCode: payload.data?.shop?.currencyCode || "",
      feeVariantId: /^\d+$/.test(feeVariantId) ? feeVariantId : "",
      backEnabled: product.backEnabled?.value === "true",
    });
  } catch (error) {
    console.error("Could not load storefront personalization pricing:", error);
    return fail("The personalization pricing could not be loaded.");
  }
}
