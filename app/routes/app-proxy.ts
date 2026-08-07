import { authenticate } from "../shopify.server";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

const ALLOWED_FILE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function safeFilename(filename: string) {
  const cleaned = filename
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);

  const finalName =
    cleaned || "customer-artwork.png";

  return `personalization-${Date.now()}-${finalName}`;
}

async function getFileStatus(
  admin: any,
  fileId: string,
) {
  const response = await admin.graphql(
    `#graphql
      query PersonalizationFileStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus

            image {
              url
            }
          }
        }
      }
    `,
    {
      variables: {
        id: fileId,
      },
    },
  );

  const result = (await response.json()) as {
    data?: {
      node?: {
        id?: string;
        fileStatus?: string;
        image?: {
          url?: string | null;
        } | null;
      } | null;
    };

    errors?: Array<{
      message?: string;
    }>;
  };

  if (result.errors?.length) {
    throw new Error(
      result.errors[0]?.message ||
        "Unable to check the uploaded file.",
    );
  }

  return {
    id: result.data?.node?.id || fileId,
    status:
      result.data?.node?.fileStatus ||
      "PROCESSING",
    url:
      result.data?.node?.image?.url ||
      null,
  };
}


/*
 * GET /apps/personalize-preview
 *
 * Simple health check.
 */
export async function loader({
  request,
}: {
  request: Request;
}) {
  await authenticate.public.appProxy(request);

  return json({
    ok: true,
    message:
      "Personalize Preview proxy is working",
  });
}


/*
 * POST /apps/personalize-preview
 *
 * IMPORTANT:
 * This route now accepts JSON only.
 *
 * The actual customer image will NOT be posted
 * through the Shopify app proxy.
 */
export async function action({
  request,
}: {
  request: Request;
}) {
  try {
    const context =
      await authenticate.public.appProxy(request);

    const admin = context.admin;

    if (!admin) {
      return json(
        {
          ok: false,
          error:
            "The Shopify Admin session is unavailable.",
        },
        401,
      );
    }

    const contentType =
      request.headers.get("content-type") || "";

    if (
      !contentType.includes(
        "application/json",
      )
    ) {
      return json(
        {
          ok: false,
          error:
            "This endpoint accepts JSON requests only.",
        },
        415,
      );
    }

    const body = (await request.json()) as {
      action?: string;

      filename?: string;
      mimeType?: string;
      fileSize?: number;

      resourceUrl?: string;

      fileId?: string;
    };


    /*
     * ==========================================
     * STEP 1
     * ASK SHOPIFY FOR A STAGED UPLOAD DESTINATION
     * ==========================================
     */

    if (body.action === "prepare-upload") {
      const filename =
        typeof body.filename === "string"
          ? body.filename.trim()
          : "";

      const mimeType =
        typeof body.mimeType === "string"
          ? body.mimeType.trim()
          : "";

      const fileSize =
        typeof body.fileSize === "number"
          ? body.fileSize
          : 0;


      if (!filename) {
        return json(
          {
            ok: false,
            error:
              "The image filename is missing.",
          },
          400,
        );
      }


      if (
        !ALLOWED_FILE_TYPES.has(mimeType)
      ) {
        return json(
          {
            ok: false,
            error:
              "Please upload a PNG, JPG, JPEG, or WebP image.",
          },
          400,
        );
      }


      if (
        !Number.isFinite(fileSize) ||
        fileSize <= 0
      ) {
        return json(
          {
            ok: false,
            error:
              "The uploaded image is empty.",
          },
          400,
        );
      }


      if (fileSize > MAX_FILE_SIZE) {
        return json(
          {
            ok: false,
            error:
              "The image is too large. Please use a file under 15 MB.",
          },
          400,
        );
      }


      const finalFilename =
        safeFilename(filename);


      const stagedResponse =
        await admin.graphql(
          `#graphql
            mutation PersonalizationStagedUpload(
              $input: [StagedUploadInput!]!
            ) {
              stagedUploadsCreate(
                input: $input
              ) {
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
            variables: {
              input: [
                {
                  filename:
                    finalFilename,

                  mimeType,

                  fileSize:
                    String(fileSize),

                  resource: "IMAGE",

                  httpMethod: "POST",
                },
              ],
            },
          },
        );


      const stagedResult =
        (await stagedResponse.json()) as {
          data?: {
            stagedUploadsCreate?: {
              stagedTargets?: Array<{
                url: string;
                resourceUrl: string;

                parameters: Array<{
                  name: string;
                  value: string;
                }>;
              }>;

              userErrors?: Array<{
                field?: string[];
                message: string;
              }>;
            };
          };

          errors?: Array<{
            message?: string;
          }>;
        };


      const graphqlErrors =
        stagedResult.errors || [];

      const userErrors =
        stagedResult.data
          ?.stagedUploadsCreate
          ?.userErrors || [];


      if (
        graphqlErrors.length ||
        userErrors.length
      ) {
        const message =
          userErrors[0]?.message ||
          graphqlErrors[0]?.message ||
          "Shopify could not prepare the image upload.";

        console.error(
          "stagedUploadsCreate failed:",
          stagedResult,
        );

        return json(
          {
            ok: false,
            error: message,
          },
          400,
        );
      }


      const target =
        stagedResult.data
          ?.stagedUploadsCreate
          ?.stagedTargets?.[0];


      if (
        !target?.url ||
        !target.resourceUrl
      ) {
        console.error(
          "No staged upload target:",
          stagedResult,
        );

        return json(
          {
            ok: false,
            error:
              "Shopify did not return an upload destination.",
          },
          500,
        );
      }


      return json({
        ok: true,

        upload: {
          url: target.url,

          resourceUrl:
            target.resourceUrl,

          parameters:
            target.parameters || [],

          filename:
            finalFilename,

          mimeType,
        },
      });
    }


    /*
     * ==========================================
     * STEP 2
     * CUSTOMER'S BROWSER UPLOADS DIRECTLY
     * TO THE STAGED SHOPIFY URL.
     *
     * Nothing happens on our server here.
     * ==========================================
     */


    /*
     * ==========================================
     * STEP 3
     * CREATE A PERMANENT SHOPIFY FILE
     * ==========================================
     */

    if (body.action === "complete-upload") {
      const resourceUrl =
        typeof body.resourceUrl === "string"
          ? body.resourceUrl.trim()
          : "";

      const suppliedFilename =
        typeof body.filename === "string"
          ? body.filename.trim()
          : "";


      if (
        !resourceUrl ||
        !resourceUrl.startsWith(
          "https://",
        )
      ) {
        return json(
          {
            ok: false,
            error:
              "The staged image URL is invalid.",
          },
          400,
        );
      }


      const createResponse =
        await admin.graphql(
          `#graphql
            mutation PersonalizationFileCreate(
              $files: [FileCreateInput!]!
            ) {
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
            variables: {
              files: [
                {
                  originalSource:
                    resourceUrl,

                  contentType:
                    "IMAGE",

                  alt:
                    "Customer personalization artwork",

                  ...(suppliedFilename
                    ? {
                        filename:
                          suppliedFilename,
                      }
                    : {}),
                },
              ],
            },
          },
        );


      const createResult =
        (await createResponse.json()) as {
          data?: {
            fileCreate?: {
              files?: Array<{
                id?: string;
                fileStatus?: string;

                image?: {
                  url?: string | null;
                } | null;
              }>;

              userErrors?: Array<{
                field?: string[];
                message: string;
              }>;
            };
          };

          errors?: Array<{
            message?: string;
          }>;
        };


      const graphqlErrors =
        createResult.errors || [];

      const userErrors =
        createResult.data
          ?.fileCreate
          ?.userErrors || [];


      if (
        graphqlErrors.length ||
        userErrors.length
      ) {
        const message =
          userErrors[0]?.message ||
          graphqlErrors[0]?.message ||
          "Shopify could not create the permanent image.";

        console.error(
          "fileCreate failed:",
          createResult,
        );

        return json(
          {
            ok: false,
            error: message,
          },
          400,
        );
      }


      const createdFile =
        createResult.data
          ?.fileCreate
          ?.files?.[0];


      if (!createdFile?.id) {
        console.error(
          "fileCreate returned no file:",
          createResult,
        );

        return json(
          {
            ok: false,
            error:
              "Shopify created no file record.",
          },
          500,
        );
      }


      return json({
        ok: true,

        file: {
          id:
            createdFile.id,

          status:
            createdFile.fileStatus ||
            "PROCESSING",

          url:
            createdFile.image?.url ||
            null,
        },
      });
    }


    /*
     * ==========================================
     * STEP 4
     * CHECK WHETHER SHOPIFY FINISHED PROCESSING
     * ==========================================
     */

    if (body.action === "status") {
      const fileId =
        typeof body.fileId === "string"
          ? body.fileId.trim()
          : "";


      if (
        !fileId.startsWith(
          "gid://shopify/",
        )
      ) {
        return json(
          {
            ok: false,
            error:
              "The Shopify file ID is invalid.",
          },
          400,
        );
      }


      const file =
        await getFileStatus(
          admin,
          fileId,
        );


      return json({
        ok: true,
        file,
      });
    }


    /*
     * UNKNOWN ACTION
     */

    return json(
      {
        ok: false,
        error:
          "Unknown personalization action.",
      },
      400,
    );
  } catch (error) {
    console.error(
      "Personalization proxy failed:",
      error,
    );

    return json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "The personalization request failed.",
      },
      500,
    );
  }
}