import { authenticate, isAllowedShop } from "../shopify.server";
import { acceptWebhook } from "../services/webhooks.server";

// Every orders/*, customers/* and products/* subscription in shopify.app.toml
// points here; the topic decides the handler (services/webhooks.server.js).
export const action = async ({ request }) => {
  const { topic, payload, webhookId, shop } = await authenticate.webhook(request);
  // another store's orders / customers / products must never reach this
  // store's data - answer 200 so Shopify doesn't keep retrying
  if (!isAllowedShop(shop)) return new Response();
  await acceptWebhook({ topic, payload, webhookId });
  return new Response();
};
