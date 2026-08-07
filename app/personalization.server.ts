type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type DefinitionQueryResult = {
  data?: {
    metafieldDefinition?: {
      id: string;
      namespace: string;
      key: string;
      pinnedPosition: number | null;
      type: {
        name: string;
      };
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type DefinitionMutationResult = {
  data?: {
    metafieldDefinitionCreate?: {
      createdDefinition?: {
        id: string;
      } | null;
      userErrors?: Array<{
        code?: string | null;
        message: string;
      }>;
    };
    metafieldDefinitionPin?: {
      pinnedDefinition?: {
        id: string;
      } | null;
      userErrors?: Array<{
        message: string;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

const PERSONALIZATION_DEFINITION = {
  namespace: "custom",
  key: "personalize_enabled",
  ownerType: "PRODUCT",
  type: "boolean",
  name: "Personalization enabled",
  description:
    "Show the Fruttata product customizer for this product on the storefront.",
} as const;

const initializedShops = new Set<string>();

function firstGraphqlError(
  result: { errors?: Array<{ message?: string }> },
  fallback: string,
) {
  return result.errors?.find((error) => error.message)?.message || fallback;
}

async function getDefinition(admin: AdminGraphqlClient) {
  const response = await admin.graphql(
    `#graphql
      query PersonalizationMetafieldDefinition(
        $identifier: MetafieldDefinitionIdentifierInput!
      ) {
        metafieldDefinition(identifier: $identifier) {
          id
          namespace
          key
          pinnedPosition
          type {
            name
          }
        }
      }
    `,
    {
      variables: {
        identifier: {
          namespace: PERSONALIZATION_DEFINITION.namespace,
          key: PERSONALIZATION_DEFINITION.key,
          ownerType: PERSONALIZATION_DEFINITION.ownerType,
        },
      },
    },
  );

  const result = (await response.json()) as DefinitionQueryResult;

  if (result.errors?.length) {
    throw new Error(
      firstGraphqlError(result, "Unable to inspect personalization settings."),
    );
  }

  return result.data?.metafieldDefinition || null;
}

async function createDefinition(admin: AdminGraphqlClient) {
  const response = await admin.graphql(
    `#graphql
      mutation CreatePersonalizationMetafieldDefinition(
        $definition: MetafieldDefinitionInput!
      ) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
          }
          userErrors {
            code
            message
          }
        }
      }
    `,
    {
      variables: {
        definition: {
          namespace: PERSONALIZATION_DEFINITION.namespace,
          key: PERSONALIZATION_DEFINITION.key,
          ownerType: PERSONALIZATION_DEFINITION.ownerType,
          type: PERSONALIZATION_DEFINITION.type,
          name: PERSONALIZATION_DEFINITION.name,
          description: PERSONALIZATION_DEFINITION.description,
          pin: true,
        },
      },
    },
  );

  const result = (await response.json()) as DefinitionMutationResult;

  if (result.errors?.length) {
    throw new Error(
      firstGraphqlError(result, "Unable to create personalization settings."),
    );
  }

  const userErrors =
    result.data?.metafieldDefinitionCreate?.userErrors || [];

  if (userErrors.length) {
    throw new Error(userErrors[0]?.message || "Unable to create personalization settings.");
  }
}

async function pinDefinition(admin: AdminGraphqlClient) {
  const response = await admin.graphql(
    `#graphql
      mutation PinPersonalizationMetafieldDefinition(
        $identifier: MetafieldDefinitionIdentifierInput!
      ) {
        metafieldDefinitionPin(identifier: $identifier) {
          pinnedDefinition {
            id
          }
          userErrors {
            message
          }
        }
      }
    `,
    {
      variables: {
        identifier: {
          namespace: PERSONALIZATION_DEFINITION.namespace,
          key: PERSONALIZATION_DEFINITION.key,
          ownerType: PERSONALIZATION_DEFINITION.ownerType,
        },
      },
    },
  );

  const result = (await response.json()) as DefinitionMutationResult;

  if (result.errors?.length) {
    throw new Error(
      firstGraphqlError(result, "Unable to pin personalization settings."),
    );
  }

  const userErrors = result.data?.metafieldDefinitionPin?.userErrors || [];

  if (userErrors.length) {
    throw new Error(userErrors[0]?.message || "Unable to pin personalization settings.");
  }
}

export async function ensurePersonalizationDefinition(
  admin: AdminGraphqlClient,
  shop: string,
) {
  if (initializedShops.has(shop)) {
    return;
  }

  const existingDefinition = await getDefinition(admin);

  if (!existingDefinition) {
    await createDefinition(admin);
    initializedShops.add(shop);
    return;
  }

  if (existingDefinition.type.name !== PERSONALIZATION_DEFINITION.type) {
    throw new Error(
      `The ${PERSONALIZATION_DEFINITION.namespace}.${PERSONALIZATION_DEFINITION.key} metafield exists with type ${existingDefinition.type.name}; expected ${PERSONALIZATION_DEFINITION.type}.`,
    );
  }

  if (existingDefinition.pinnedPosition == null) {
    await pinDefinition(admin);
  }

  initializedShops.add(shop);
}
