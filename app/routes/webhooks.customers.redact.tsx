import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  // Personalize Preview does not keep customer profile data outside Shopify.
  // There is therefore no separate customer record to erase in app storage.
  return new Response(null, { status: 200 });
};
