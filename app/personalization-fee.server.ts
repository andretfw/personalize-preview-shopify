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

type ProductRef = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variants?: { nodes?: Array<{ id: string }> } | null;
};

const INTERNAL_TAG = "personalize-preview-internal";
const HANDLE_PREFIX = "personalize-preview-back-addon-";

async function graphql<TData>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlEnvelope<TData>;

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((error) => error.message || "Shopify GraphQL error").join("; "),
    );
  }

  if (!payload.data) throw new Error("Shopify returned an empty GraphQL response.");
  return payload.data;
}

function firstError(errors: Array<{ message?: string }> | undefined, fallback: string) {
  return errors?.[0]?.message || fallback;
}

function productNumber(productId: string) {
  return productId.split("/").pop()?.replace(/[^0-9]/g, "") || "product";
}

async function findVariant(admin: AdminClient, variantId: string) {
  if (!variantId.startsWith("gid://shopify/ProductVariant/")) return null;

  const data = await graphql<{
    node?: {
      id?: string;
      product?: ProductRef | null;
    } | null;
  }>(
    admin,
    `#graphql
      query PersonalizePreviewFeeVariant($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            product {
              id
              title
              handle
              status
              variants(first: 1) { nodes { id } }
            }
          }
        }
      }
    `,
    { id: variantId },
  );

  if (!data.node?.id || !data.node.product?.id) return null;
  return { variantId: data.node.id, product: data.node.product };
}

async function findProductByHandle(admin: AdminClient, handle: string) {
  const data = await graphql<{
    products?: { nodes?: ProductRef[] } | null;
  }>(
    admin,
    `#graphql
      query PersonalizePreviewFeeProduct($query: String!) {
        products(first: 5, query: $query) {
          nodes {
            id
            title
            handle
            status
            variants(first: 1) { nodes { id } }
          }
        }
      }
    `,
    { query: `handle:${handle}` },
  );

  return (data.products?.nodes || []).find((product) => product.handle === handle) || null;
}

async function createFeeProduct(
  admin: AdminClient,
  handle: string,
  parentTitle: string,
) {
  const data = await graphql<{
    productCreate?: {
      product?: ProductRef | null;
      userErrors?: Array<{ message?: string }>;
    } | null;
  }>(
    admin,
    `#graphql
      mutation PersonalizePreviewCreateFeeProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 1) { nodes { id } }
          }
          userErrors { field message }
        }
      }
    `,
    {
      product: {
        title: `Back personalization add-on — ${parentTitle}`,
        handle,
        productType: "Personalization add-on",
        vendor: "Personalize Preview",
        status: "UNLISTED",
        tags: [INTERNAL_TAG],
      },
    },
  );

  const result = data.productCreate;
  if (result?.userErrors?.length) {
    throw new Error(firstError(result.userErrors, "Shopify could not create the add-on product."));
  }
  if (!result?.product?.id) throw new Error("Shopify did not return the add-on product.");
  return result.product;
}

async function keepFeeProductHidden(
  admin: AdminClient,
  productId: string,
  parentTitle: string,
) {
  const data = await graphql<{
    productUpdate?: { userErrors?: Array<{ message?: string }> } | null;
  }>(
    admin,
    `#graphql
      mutation PersonalizePreviewUpdateFeeProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          userErrors { field message }
        }
      }
    `,
    {
      product: {
        id: productId,
        title: `Back personalization add-on — ${parentTitle}`,
        productType: "Personalization add-on",
        vendor: "Personalize Preview",
        status: "UNLISTED",
        tags: [INTERNAL_TAG],
      },
    },
  );

  const errors = data.productUpdate?.userErrors;
  if (errors?.length) {
    throw new Error(firstError(errors, "Shopify could not update the add-on product."));
  }
}

async function updateFeeVariant(
  admin: AdminClient,
  productId: string,
  variantId: string,
  amount: number,
) {
  const data = await graphql<{
    productVariantsBulkUpdate?: {
      productVariants?: Array<{ id: string; price?: string | null }>;
      userErrors?: Array<{ message?: string }>;
    } | null;
  }>(
    admin,
    `#graphql
      mutation PersonalizePreviewUpdateFeeVariant(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id price }
          userErrors { field message }
        }
      }
    `,
    {
      productId,
      variants: [
        {
          id: variantId,
          price: amount.toFixed(2),
          taxable: true,
          inventoryItem: {
            tracked: false,
            requiresShipping: false,
          },
        },
      ],
    },
  );

  const result = data.productVariantsBulkUpdate;
  if (result?.userErrors?.length) {
    throw new Error(firstError(result.userErrors, "Shopify could not price the add-on product."));
  }
  if (!result?.productVariants?.[0]?.id) {
    throw new Error("Shopify did not return the priced add-on variant.");
  }
}

async function onlineStorePublicationId(admin: AdminClient) {
  const data = await graphql<{
    publications?: {
      nodes?: Array<{
        id: string;
        name?: string | null;
        catalog?: { title?: string | null } | null;
      }>;
    } | null;
  }>(
    admin,
    `#graphql
      query PersonalizePreviewOnlineStorePublication {
        publications(first: 50, catalogType: APP) {
          nodes {
            id
            name
            catalog { title }
          }
        }
      }
    `,
  );

  const publication = (data.publications?.nodes || []).find((item) => {
    const label = `${item.name || ""} ${item.catalog?.title || ""}`.toLowerCase();
    return label.includes("online store");
  });

  if (!publication?.id) {
    throw new Error("Shopify's Online Store publication could not be found.");
  }
  return publication.id;
}

async function publishFeeProduct(admin: AdminClient, productId: string) {
  const publicationId = await onlineStorePublicationId(admin);
  const data = await graphql<{
    publishablePublish?: { userErrors?: Array<{ message?: string }> } | null;
  }>(
    admin,
    `#graphql
      mutation PersonalizePreviewPublishFeeProduct(
        $id: ID!
        $input: [PublicationInput!]!
      ) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `,
    { id: productId, input: [{ publicationId }] },
  );

  const errors = data.publishablePublish?.userErrors;
  if (errors?.length) {
    throw new Error(firstError(errors, "Shopify could not publish the add-on product."));
  }
}

export async function ensureBackPersonalizationFee(
  admin: AdminClient,
  input: {
    parentProductId: string;
    parentTitle: string;
    existingVariantId?: string;
    amount: number;
  },
) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return input.existingVariantId || "";

  const handle = `${HANDLE_PREFIX}${productNumber(input.parentProductId)}`;
  let product: ProductRef | null = null;
  let variantId = "";

  const existing = await findVariant(admin, input.existingVariantId || "");
  if (existing) {
    product = existing.product;
    variantId = existing.variantId;
  }

  if (!product) {
    product = await findProductByHandle(admin, handle);
    variantId = product?.variants?.nodes?.[0]?.id || "";
  }

  if (!product) {
    product = await createFeeProduct(admin, handle, input.parentTitle);
    variantId = product.variants?.nodes?.[0]?.id || "";
  }

  if (!product.id || !variantId) {
    throw new Error("Shopify could not prepare the Back personalization add-on.");
  }

  await keepFeeProductHidden(admin, product.id, input.parentTitle);
  await updateFeeVariant(admin, product.id, variantId, input.amount);
  await publishFeeProduct(admin, product.id);

  return variantId;
}
