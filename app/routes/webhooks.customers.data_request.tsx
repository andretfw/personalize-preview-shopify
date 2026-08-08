import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  // Personalize Preview does not keep customer profile data outside Shopify.
  // Customer artwork is stored in the merchant's own Shopify Files account,
  // and order customization details stay on the Shopify order/cart record.
  return new Response(null, { status: 200 });
};
