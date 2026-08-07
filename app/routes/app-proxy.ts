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

async function graphql<TData>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlEnvelope<TData>;

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message || "GraphQL error").join("; "),
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
 * It intentionally exposes no store or authentication data.
 */
export async function loader() {
  return json({
    ok: true,
    service: "personalize-preview",
  });
}

/**
 * Storefront app-proxy endpoint.
 * The image bytes never pass through this route. The browser uploads directly
 * to Shopify's staged-upload destination and this endpoint only exchanges JSON.
 */
export async function action({ request }: { request: Request }) {
  let admin: AdminClient | undefined;

  try {
    const context = await authenticate.public.appProxy(request);
    admin = context.admin as AdminClient | undefined;
  } catch (error) {
    console.error("Rejected app-proxy request:", error);
    return json({ ok: false, error: "Invalid personalization request." }, 401);
  }

  if (!admin) {
    return json(
      {
        ok: false,
        error: "The personalization service is not connected to this store.",
      },
      401,
    );
  }

  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Expected a JSON request." }, 415);
  }

  let body: ProxyRequest;

  try {
    body = (await request.json()) as ProxyRequest;
  } catch {
    return json({ ok: false, error: "The request body is invalid." }, 400);
  }

  try {
    switch (body.action) {
      case "prepare-upload": {
        const filename = stringValue(body.filename);
        const mimeType = stringValue(body.mimeType);
        const fileSize =
          typeof body.fileSize === "number" && Number.isFinite(body.fileSize)
            ? body.fileSize
            : 0;

        if (!filename) {
          return json({ ok: false, error: "The image filename is missing." }, 400);
        }

        if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
          return json(
            {
              ok: false,
              error: "Please upload a PNG, JPG, JPEG, or WebP image.",
            },
            400,
          );
        }

        if (fileSize <= 0) {
          return json({ ok: false, error: "The uploaded image is empty." }, 400);
        }

        if (fileSize > MAX_FILE_SIZE_BYTES) {
          return json(
            {
              ok: false,
              error: "The image is too large. Please use a file under 15 MB.",
            },
            400,
          );
        }

        const safeFilename = `personalization-${Date.now()}-${sanitizeFilename(filename)}`;

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
                httpMethod: "POST",
                resource: "IMAGE",
              },
            ],
          },
        );

        const result = data.stagedUploadsCreate;

        if (result?.userErrors?.length) {
          return json(
            {
              ok: false,
              error: firstUserError(
                result.userErrors,
                "Shopify could not prepare the artwork upload.",
              ),
            },
            400,
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
        const resourceUrl = stringValue(body.resourceUrl);
        const filename = sanitizeFilename(stringValue(body.filename));

        if (!resourceUrl.startsWith("https://")) {
          return json({ ok: false, error: "The staged artwork URL is invalid." }, 400);
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
          return json(
            {
              ok: false,
              error: firstUserError(
                result.userErrors,
                "Shopify could not save the artwork.",
              ),
            },
            400,
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
        const fileId = stringValue(body.fileId);

        if (!fileId.startsWith(MEDIA_IMAGE_GID_PREFIX)) {
          return json({ ok: false, error: "The Shopify file ID is invalid." }, 400);
        }

        return json({
          ok: true,
          file: await getFileStatus(admin, fileId),
        });
      }

      default:
        return json({ ok: false, error: "Unknown personalization action." }, 400);
    }
  } catch (error) {
    console.error("Personalization proxy failed:", error);

    return json(
      {
        ok: false,
        error: "The personalization service is temporarily unavailable.",
      },
      502,
    );
  }
}
