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

const FUNCTION_HANDLE = "personalize-back-surcharge";

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

export async function ensureBackSurchargeCartTransform(admin: AdminClient) {
  const existing = await graphql<{
    cartTransforms?: { nodes?: Array<{ id: string; blockOnFailure: boolean }> } | null;
  }>(
    admin,
    `#graphql
      query PersonalizePreviewCartTransforms {
        cartTransforms(first: 10) {
          nodes {
            id
            blockOnFailure
          }
        }
      }
    `,
  );

  const current = existing.cartTransforms?.nodes?.[0];
  if (current?.id) return current.id;

  const created = await graphql<{
    cartTransformCreate?: {
      cartTransform?: { id: string; blockOnFailure: boolean } | null;
      userErrors?: Array<{ message?: string }>;
    } | null;
  }>(
    admin,
    `#graphql
      mutation PersonalizePreviewCreateCartTransform($functionHandle: String!) {
        cartTransformCreate(
          functionHandle: $functionHandle
          blockOnFailure: true
        ) {
          cartTransform {
            id
            blockOnFailure
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { functionHandle: FUNCTION_HANDLE },
  );

  const result = created.cartTransformCreate;
  if (result?.userErrors?.length) {
    throw new Error(
      result.userErrors[0]?.message || "Shopify could not activate enforced pricing.",
    );
  }

  if (!result?.cartTransform?.id) {
    throw new Error("Shopify did not activate the Back personalization price transform.");
  }

  return result.cartTransform.id;
}
