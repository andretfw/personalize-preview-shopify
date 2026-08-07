import { authenticate } from "../shopify.server";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MEDIA_IMAGE_GID_PREFIX = "gid://shopify/MediaImage/";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlEnvelope<TData> = {
  data?: TData;
  errors?: Array<{ message?: string }>;
};

type ProxyRequest = {
  action?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
  resourceUrl?: unknown;
  fileId?: unknown;
};

type StagedUploadData = {
  stagedUploadsCreate?: {
    stagedTargets?: Array<{
      url: string;
      resourceUrl: string;
      parameters: Array<{ name: string; value: string }>;
    }>;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

type FileCreateData = {
  fileCreate?: {
    files?: Array<{
      id?: string;
      fileStatus?: string;
      image?: { url?: string | null } | null;
    }>;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
};

type FileStatusData = {
  node?: {
    id?: string;
    fileStatus?: string;
    fileErrors?: Array<{ message?: string | null }>;
    image?: { url?: string | null } | null;
  } | null;
};

type FailureCode =
  | "INVALID_PROXY_REQUEST"
  | "STORE_SESSION_UNAVAILABLE"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_BODY"
  | "INVALID_FILENAME"
  | "INVALID_FILE_TYPE"
  | "INVALID_FILE_SIZE"
  | "FILE_TOO_LARGE"
  | "PREPARE_UPLOAD_FAILED"
  | "INVALID_STAGED_URL"
  | "SAVE_FILE_FAILED"
  | "INVALID_FILE_ID"
  | "FILE_STATUS_FAILED"
  | "UNKNOWN_ACTION";

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

/**
 * Shopify app proxies can replace 5xx response bodies with storefront HTML.
 * The storefront client therefore uses a JSON-level `ok` flag and keeps
 * expected operational failures on HTTP 200 so the real message survives.
 */
function fail(error: string, code: FailureCode) {
  return json({ ok: false, error, code });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeFilename(filename: string) {
  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);

  return sanitized || "customer-artwork.png";
}

function firstUserError(
  errors: Array<{ message: string }> | undefined,
  fallback: string,
) {
  return errors?.[0]?.message || fallback;
}

function publicFailureMessage(stage: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/access denied|permission|scope/i.test(message)) {
    return "The personalization app needs its Shopify permissions refreshed.";
  }

  if (/session|offline token|not connected/i.test(message)) {
    return "The personalization app needs to be reopened in Shopify Admin.";
  }

  if (stage === "prepare-upload") {
    return "Shopify could not prepare the artwork upload.";
  }

  if (stage === "complete-upload") {
    return "Shopify could not save the artwork.";
  }

  if (stage === "status") {
    return "Shopify could not finish processing the artwork.";
  }

  return "The personalization service is temporarily unavailable.";
}

async function graphql<TData>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlEnvelope<TData>;

  if (payload.errors?.length) {
    throw new Error(
      payload.errors
        .map((error) => error.message || "GraphQL error")
        .join("; "),
    );
  }

  if (!payload.data) {
    throw new Error("Shopify returned an empty GraphQL response.");
  }

  return payload.data;
}

async function getFileStatus(admin: AdminClient, fileId: string) {
  const data = await graphql<FileStatusData>(
    admin,
    `#graphql
      query PersonalizationFileStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus
            fileErrors {
              message
            }
            image {
              url
            }
          }
        }
      }
    `,
    { id: fileId },
  );

  const node = data.node;

  if (!node?.id) {
    throw new Error("Shopify could not find the uploaded image.");
  }

  return {
    id: node.id,
    status: node.fileStatus || "PROCESSING",
    url: node.image?.url || null,
    error: node.fileErrors?.[0]?.message || null,
  };
}

/**
 * Health endpoint for the configured app-proxy destination.
 */
export async function loader() {
  return json({ ok: true, service: "personalize-preview" });
}

/**
 * Storefront app-proxy endpoint.
 * Image bytes never pass through this route. The browser uploads directly to
 * Shopify's staged target; this route only exchanges signed JSON metadata.
 */
export async function action({ request }: { request: Request }) {
  let admin: AdminClient | undefined;

  try {
    const context = await authenticate.public.appProxy(request);
    admin = context.admin as AdminClient | undefined;
  } catch (error) {
    console.error("Rejected app-proxy request:", error);
    return fail("Invalid personalization request.", "INVALID_PROXY_REQUEST");
  }

  if (!admin) {
    return fail(
      "The personalization app needs to be reopened in Shopify Admin.",
      "STORE_SESSION_UNAVAILABLE",
    );
  }

  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return fail("Expected a JSON request.", "INVALID_CONTENT_TYPE");
  }

  let body: ProxyRequest;

  try {
    body = (await request.json()) as ProxyRequest;
  } catch {
    return fail("The request body is invalid.", "INVALID_BODY");
  }

  let stage = "unknown";

  try {
    switch (body.action) {
      case "prepare-upload": {
        stage = "prepare-upload";

        const filename = stringValue(body.filename);
        const mimeType = stringValue(body.mimeType);
        const fileSize =
          typeof body.fileSize === "number" && Number.isFinite(body.fileSize)
            ? body.fileSize
            : 0;

        if (!filename) {
          return fail("The image filename is missing.", "INVALID_FILENAME");
        }

        if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
          return fail(
            "Please upload a PNG, JPG, JPEG, or WebP image.",
            "INVALID_FILE_TYPE",
          );
        }

        if (fileSize <= 0) {
          return fail("The uploaded image is empty.", "INVALID_FILE_SIZE");
        }

        if (fileSize > MAX_FILE_SIZE_BYTES) {
          return fail(
            "The image is too large. Please use a file under 15 MB.",
            "FILE_TOO_LARGE",
          );
        }

        const safeFilename = `personalization-${Date.now()}-${sanitizeFilename(
          filename,
        )}`;

        const data = await graphql<StagedUploadData>(
          admin,
          `#graphql
            mutation PersonalizationStagedUpload($input: [StagedUploadInput!]!) {
              stagedUploadsCreate(input: $input) {
                stagedTargets {
                  url
                  resourceUrl
                  parameters {
                    name
                    value
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          {
            input: [
              {
                filename: safeFilename,
                mimeType,
                fileSize: String(fileSize),
                httpMethod: "POST",
                resource: "IMAGE",
              },
            ],
          },
        );

        const result = data.stagedUploadsCreate;

        if (result?.userErrors?.length) {
          return fail(
            firstUserError(
              result.userErrors,
              "Shopify could not prepare the artwork upload.",
            ),
            "PREPARE_UPLOAD_FAILED",
          );
        }

        const target = result?.stagedTargets?.[0];

        if (!target?.url || !target.resourceUrl) {
          throw new Error("Shopify returned no staged-upload target.");
        }

        return json({
          ok: true,
          upload: {
            url: target.url,
            resourceUrl: target.resourceUrl,
            parameters: target.parameters || [],
            filename: safeFilename,
          },
        });
      }

      case "complete-upload": {
        stage = "complete-upload";

        const resourceUrl = stringValue(body.resourceUrl);
        const filename = sanitizeFilename(stringValue(body.filename));

        if (!resourceUrl.startsWith("https://")) {
          return fail("The staged artwork URL is invalid.", "INVALID_STAGED_URL");
        }

        const data = await graphql<FileCreateData>(
          admin,
          `#graphql
            mutation PersonalizationFileCreate($files: [FileCreateInput!]!) {
              fileCreate(files: $files) {
                files {
                  id
                  fileStatus
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          {
            files: [
              {
                alt: "Customer personalization artwork",
                contentType: "IMAGE",
                duplicateResolutionMode: "APPEND_UUID",
                filename,
                originalSource: resourceUrl,
              },
            ],
          },
        );

        const result = data.fileCreate;

        if (result?.userErrors?.length) {
          return fail(
            firstUserError(result.userErrors, "Shopify could not save the artwork."),
            "SAVE_FILE_FAILED",
          );
        }

        const file = result?.files?.[0];

        if (!file?.id) {
          throw new Error("Shopify returned no file after fileCreate.");
        }

        return json({
          ok: true,
          file: {
            id: file.id,
            status: file.fileStatus || "PROCESSING",
            url: file.image?.url || null,
          },
        });
      }

      case "status": {
        stage = "status";

        const fileId = stringValue(body.fileId);

        if (!fileId.startsWith(MEDIA_IMAGE_GID_PREFIX)) {
          return fail("The Shopify file ID is invalid.", "INVALID_FILE_ID");
        }

        return json({
          ok: true,
          file: await getFileStatus(admin, fileId),
        });
      }

      default:
        return fail("Unknown personalization action.", "UNKNOWN_ACTION");
    }
  } catch (error) {
    console.error(`Personalization proxy failed during ${stage}:`, error);

    const code: FailureCode =
      stage === "prepare-upload"
        ? "PREPARE_UPLOAD_FAILED"
        : stage === "complete-upload"
          ? "SAVE_FILE_FAILED"
          : stage === "status"
            ? "FILE_STATUS_FAILED"
            : "UNKNOWN_ACTION";

    return fail(publicFailureMessage(stage, error), code);
  }
}
