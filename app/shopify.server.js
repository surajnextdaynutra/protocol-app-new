import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { MONGODB_DB, MONGODB_URI } from "./db.server";

export const apiVersion = ApiVersion.July26;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(new URL(MONGODB_URI), MONGODB_DB),
  // Private app installed on the one store only - no App Store review.
  distribution: AppDistribution.SingleMerchant,
  hooks: {
    // On install / every new session: the store gets the custom.* product
    // metafield definitions the app and theme use, if it doesn't have them
    // yet - no manual setup. Background, so opening the app never waits on it.
    afterAuth: async () => {
      import("./services/catalog.server.js")
        .then((m) => m.ensureProductMetafieldDefinitions())
        .catch((err) => console.warn("[rx] metafield definitions:", err.message || err));
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

/* SHOPIFY_SHOP (.env) is the one store this app serves. Any other store it is
   installed on is turned away: its admin can't open the app and its
   storefront's /apps/rx calls are refused (its webhooks are ignored in
   routes/webhooks.shopify.jsx). Blank = every installed store is served. */
const ONLY_SHOP = String(process.env.SHOPIFY_SHOP || "").trim().toLowerCase();

export function isAllowedShop(shop) {
  return !ONLY_SHOP || String(shop || "").trim().toLowerCase() === ONLY_SHOP;
}

const otherStore = (shop) =>
  new Response(`This app only works on ${ONLY_SHOP} - not on ${shop || "this store"}.`, {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

export default shopify;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = {
  ...shopify.authenticate,
  admin: async (request) => {
    const ctx = await shopify.authenticate.admin(request);
    if (!isAllowedShop(ctx.session?.shop)) throw otherStore(ctx.session?.shop);
    return ctx;
  },
  public: {
    ...shopify.authenticate.public,
    appProxy: async (request) => {
      const ctx = await shopify.authenticate.public.appProxy(request);
      // `shop` is one of the signed params, so it can't be swapped
      const shop = new URL(request.url).searchParams.get("shop");
      if (!isAllowedShop(shop)) throw otherStore(shop);
      return ctx;
    },
  },
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
