import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { sessionStorage } from "../session-storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  const sessions = await sessionStorage.findSessionsByShop(shop);

  if (sessions.length > 0) {
    await sessionStorage.deleteSessions(sessions.map((session) => session.id));
  }

  return new Response(null, { status: 200 });
};
