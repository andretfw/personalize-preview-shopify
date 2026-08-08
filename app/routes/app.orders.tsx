import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type Attribute = { key: string; value: string | null };

type OrderLineNode = {
  id: string;
  name: string;
  title: string;
  quantity: number;
  sku: string | null;
  variantTitle: string | null;
  customAttributes: Attribute[];
};

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  lineItems: { nodes: OrderLineNode[] };
};

type ProductionJob = {
  id: string;
  orderName: string;
  orderUrl: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  sku: string;
  imageUrl: string;
  imageAlt: string;
  artworkUrl: string;
  artworkFile: string;
  proofUrl: string;
  quality: string;
  printSize: string;
  printSizeSource: "order" | "";
  customText: string;
  placement: string;
  confirmed: boolean;
  ready: boolean;
};

const attributeMap = (attributes: Attribute[]) => {
  const map: Record<string, string> = {};
  for (const attribute of attributes) {
    if (attribute?.key && attribute.value) map[attribute.key] = attribute.value;
  }
  return map;
};

const formatPlacement = (raw: string) => {
  if (!raw) return "Not recorded";

  try {
    const parsed = JSON.parse(raw) as {
      x?: number;
      y?: number;
      scale?: number;
      area?: {
        left?: string | number;
        top?: string | number;
        width?: string | number;
        height?: string | number;
      };
    };
    const parts: string[] = [];
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      parts.push(
        `Artwork ${Math.round(Number(parsed.x))}% × ${Math.round(Number(parsed.y))}%`,
      );
    }
    if (Number.isFinite(parsed.scale)) {
      parts.push(`scale ${Math.round(Number(parsed.scale) * 100)}%`);
    }
    if (parsed.area) {
      const clean = (value: string | number | undefined) =>
        String(value ?? "")
          .trim()
          .replace(/%$/, "");
      const left = clean(parsed.area.left);
      const top = clean(parsed.area.top);
      const width = clean(parsed.area.width);
      const height = clean(parsed.area.height);
      if (left && top && width && height) {
        parts.push(`print area L${left}% T${top}% W${width}% H${height}%`);
      }
    }
    return parts.join(" · ") || raw;
  } catch {
    return raw;
  }
};

const humanStatus = (value: string | null | undefined) =>
  String(value || "unknown")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown Shopify error";
  }
};

const emptyResult = (
  orderAccessGranted: boolean,
  orderAccessError = "",
) => ({
  jobs: [] as ProductionJob[],
  orderAccessGranted,
  orderAccessError,
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const { scopes } = await authenticate.admin(request);
  const formData = await request.formData();

  if (String(formData.get("intent") || "") !== "request-order-access") {
    return { ok: false };
  }

  try {
    await scopes.request(["read_orders"]);
    return { ok: true };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { ok: false, error: errorMessage(error) };
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, scopes } = await authenticate.admin(request);

  let orderAccessGranted = false;
  try {
    const scopeDetail = await scopes.query();
    orderAccessGranted = scopeDetail.granted.includes("read_orders");
  } catch (error) {
    if (error instanceof Response) throw error;
    return emptyResult(
      false,
      `Could not verify Shopify order access: ${errorMessage(error)}`,
    );
  }

  if (!orderAccessGranted) {
    return emptyResult(false);
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query PersonalizePreviewProductionOrders {
          orders(first: 50, reverse: true, sortKey: CREATED_AT) {
            nodes {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              lineItems(first: 100) {
                nodes {
                  id
                  name
                  title
                  quantity
                  sku
                  variantTitle
                  customAttributes { key value }
                }
              }
            }
          }
        }
      `,
    );

    const json = (await response.json()) as {
      data?: { orders?: { nodes?: OrderNode[] } };
      errors?: Array<{ message?: string }>;
    };

    if (json.errors?.length) {
      return emptyResult(
        true,
        json.errors
          .map((error) => error.message || "Shopify order query failed")
          .join(" "),
      );
    }

    const jobs: ProductionJob[] = [];

    for (const order of json.data?.orders?.nodes ?? []) {
      for (const line of order.lineItems?.nodes ?? []) {
        const properties = attributeMap(line.customAttributes ?? []);
        const personalized =
          properties["_Personalized"] === "Yes" ||
          properties["_Design confirmed"] === "Yes" ||
          Boolean(
            properties["_Artwork preview"] || properties["_Approved design proof"],
          );

        if (!personalized) continue;

        const artworkUrl = properties["_Artwork preview"] || "";
        const proofUrl = properties["_Approved design proof"] || "";
        const confirmed = properties["_Design confirmed"] === "Yes";
        const orderNumericId = order.id.split("/").pop() || "";

        jobs.push({
          id: `${order.id}-${line.id}`,
          orderName: order.name,
          orderUrl: orderNumericId
            ? `https://${session.shop}/admin/orders/${orderNumericId}`
            : `https://${session.shop}/admin/orders`,
          createdAt: order.createdAt,
          financialStatus: humanStatus(order.displayFinancialStatus),
          fulfillmentStatus: humanStatus(order.displayFulfillmentStatus),
          productTitle: line.title || line.name,
          variantTitle: line.variantTitle || "",
          quantity: line.quantity,
          sku: line.sku || "",
          imageUrl: "",
          imageAlt: line.title || "Product image",
          artworkUrl,
          artworkFile: properties["_Artwork file"] || "Customer artwork",
          proofUrl,
          quality: properties["_Print quality"] || "Not measured",
          printSize: properties["_Print size"] || "Not recorded on this order",
          printSizeSource: properties["_Print size"] ? "order" : "",
          customText: properties["Custom text"] || "",
          placement: formatPlacement(properties["_Artwork placement"] || ""),
          confirmed,
          ready: Boolean(confirmed && artworkUrl && proofUrl),
        });
      }
    }

    return {
      jobs,
      orderAccessGranted: true,
      orderAccessError: "",
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    return emptyResult(
      true,
      `Orders API request failed: ${errorMessage(error)}`,
    );
  }
};

const cardStyle = {
  border: "1px solid #d9e1dd",
  borderRadius: 14,
  background: "#fff",
  padding: 18,
} as const;

const labelStyle = {
  color: "#63706a",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: ".04em",
  marginBottom: 4,
};

const valueStyle = {
  color: "#202b27",
  fontSize: 13,
  lineHeight: 1.45,
  overflowWrap: "anywhere" as const,
};

export default function ProductionOrders() {
  const { jobs, orderAccessGranted, orderAccessError } =
    useLoaderData<typeof loader>();
  const accessFetcher = useFetcher<typeof action>();
  const readyCount = jobs.filter((job) => job.ready).length;

  if (!orderAccessGranted) {
    return (
      <s-page heading="Production orders">
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 32px" }}>
          <div style={{ ...cardStyle, background: "#f7faf8" }}>
            <div style={{ fontSize: 18, fontWeight: 780, color: "#17231e" }}>
              Allow order access
            </div>
            <div
              style={{
                marginTop: 7,
                color: "#596761",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Personalize Preview needs read-only access to recent Shopify orders
              to build your production desk. We use it only to find personalized
              line items and their artwork, proof, print quality, and placement.
              Customer names and addresses are not loaded on this page.
            </div>
            {orderAccessError ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 9,
                  background: "#fff4df",
                  color: "#7b5200",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {orderAccessError}
              </div>
            ) : null}
            <accessFetcher.Form method="post" style={{ marginTop: 16 }}>
              <input type="hidden" name="intent" value="request-order-access" />
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
                {accessFetcher.state === "idle"
                  ? "Allow order access"
                  : "Opening Shopify permissions…"}
              </button>
            </accessFetcher.Form>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading="Production orders">
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 20px 32px" }}>
        <div style={{ ...cardStyle, marginBottom: 16, background: "#f7faf8" }}>
          <div style={{ fontSize: 18, fontWeight: 780, color: "#17231e" }}>
            Production desk
          </div>
          <div
            style={{
              marginTop: 5,
              color: "#596761",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            Recent personalized line items from Shopify orders. Original artwork
            and the customer-approved proof stay in Shopify Files; this page brings
            the production details together in one place.
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "#e9f2ed",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {jobs.length} personalized job{jobs.length === 1 ? "" : "s"}
            </span>
            <span
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                background: "#edf8f2",
                color: "#006e52",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {readyCount} ready to produce
            </span>
          </div>
        </div>

        {orderAccessError ? (
          <div
            style={{
              ...cardStyle,
              marginBottom: 16,
              borderColor: "#efd0cb",
              background: "#fff7f5",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 760, color: "#8c2d23" }}>
              Shopify could not load orders
            </div>
            <div
              style={{
                marginTop: 6,
                color: "#704b45",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {orderAccessError}
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 750 }}>
              No personalized orders yet
            </div>
            <div
              style={{
                marginTop: 6,
                color: "#63706a",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Complete a test personalized order and it will appear here. Standard
              Shopify read-orders access covers recent orders; the app does not load
              customer names or addresses on this page.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {jobs.map((job) => (
              <div key={job.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", gap: 13, minWidth: 0 }}>
                    {job.imageUrl ? (
                      <img
                        src={job.imageUrl}
                        alt={job.imageAlt}
                        width={64}
                        height={64}
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 10,
                          objectFit: "cover",
                          border: "1px solid #e3e7e5",
                        }}
                      />
                    ) : null}
                    <div style={{ minWidth: 0 }}>
                      <a
                        href={job.orderUrl}
                        target="_top"
                        style={{
                          color: "#111",
                          fontSize: 15,
                          fontWeight: 800,
                          textDecoration: "none",
                        }}
                      >
                        {job.orderName}
                      </a>
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#29332f",
                        }}
                      >
                        {job.productTitle}
                      </div>
                      <div
                        style={{ marginTop: 3, fontSize: 12, color: "#68756f" }}
                      >
                        {job.variantTitle ? `${job.variantTitle} · ` : ""}Qty{" "}
                        {job.quantity}
                        {job.sku ? ` · SKU ${job.sku}` : ""}
                      </div>
                      <div
                        style={{ marginTop: 3, fontSize: 12, color: "#89928e" }}
                      >
                        {new Date(job.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <span
                    style={{
                      padding: "7px 10px",
                      borderRadius: 999,
                      background: job.ready ? "#eaf8f1" : "#fff4df",
                      color: job.ready ? "#006e52" : "#7b5200",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {job.ready ? "Ready to produce" : "Needs review"}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 14,
                    marginTop: 18,
                    paddingTop: 16,
                    borderTop: "1px solid #edf0ee",
                  }}
                >
                  <div>
                    <div style={labelStyle}>Print size</div>
                    <div style={valueStyle}>{job.printSize}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Print quality</div>
                    <div style={valueStyle}>{job.quality}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Design</div>
                    <div style={valueStyle}>
                      {job.confirmed ? "Customer confirmed" : "Confirmation missing"}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Shopify status</div>
                    <div style={valueStyle}>
                      {job.financialStatus} · {job.fulfillmentStatus}
                    </div>
                  </div>
                  {job.customText ? (
                    <div>
                      <div style={labelStyle}>Custom text</div>
                      <div style={valueStyle}>{job.customText}</div>
                    </div>
                  ) : null}
                  <div style={{ gridColumn: "span 2" }}>
                    <div style={labelStyle}>Artwork placement</div>
                    <div style={valueStyle}>{job.placement}</div>
                  </div>
                </div>

                <div
                  style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}
                >
                  {job.artworkUrl ? (
                    <a
                      href={job.artworkUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: "9px 12px",
                        borderRadius: 9,
                        background: "#111",
                        color: "#fff",
                        textDecoration: "none",
                        fontSize: 12,
                        fontWeight: 750,
                      }}
                    >
                      Download original artwork
                    </a>
                  ) : (
                    <span
                      style={{
                        padding: "9px 12px",
                        borderRadius: 9,
                        background: "#f3f4f3",
                        color: "#7b8580",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Original artwork missing
                    </span>
                  )}
                  {job.proofUrl ? (
                    <a
                      href={job.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: "9px 12px",
                        borderRadius: 9,
                        border: "1px solid #cdd5d1",
                        color: "#26312c",
                        textDecoration: "none",
                        fontSize: 12,
                        fontWeight: 750,
                      }}
                    >
                      Download approved proof
                    </a>
                  ) : (
                    <span
                      style={{
                        padding: "9px 12px",
                        borderRadius: 9,
                        background: "#fff4df",
                        color: "#7b5200",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Approved proof missing
                    </span>
                  )}
                  <a
                    href={job.orderUrl}
                    target="_top"
                    style={{
                      padding: "9px 12px",
                      borderRadius: 9,
                      border: "1px solid #d8deda",
                      color: "#52605a",
                      textDecoration: "none",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Open Shopify order
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
