import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

type JsonProperty = [string, string | number | boolean];

type KvNamespace = {
  put(key: string, value: string): Promise<void>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  get<T>(key: string, options: { type: "json" }): Promise<T | null>;
  delete(key: string): Promise<void>;
};

const CLOUDFLARE_KV_MODE = "cloudflare-kv";
const SHOP_INDEX_PREFIX = "shop:";

let prismaStoragePromise: Promise<SessionStorage> | undefined;

function usesCloudflareKv() {
  return process.env.SESSION_STORAGE?.toLowerCase() === CLOUDFLARE_KV_MODE;
}

async function getPrismaStorage(): Promise<SessionStorage> {
  if (!prismaStoragePromise) {
    prismaStoragePromise = Promise.all([
      import("@shopify/shopify-app-session-storage-prisma"),
      import("./db.server"),
    ]).then(([{ PrismaSessionStorage }, { default: prisma }]) =>
      new PrismaSessionStorage(prisma),
    );
  }

  return prismaStoragePromise;
}

async function getCloudflareKv(): Promise<KvNamespace> {
  // This module is provided by the Cloudflare Workers runtime at deploy time.
  // eslint-disable-next-line import/no-unresolved
  const cloudflare = (await import("cloudflare:workers")) as {
    env?: Record<string, unknown>;
  };
  const namespace = cloudflare.env?.SHOPIFY_SESSIONS as KvNamespace | undefined;

  if (!namespace) {
    throw new Error(
      "Missing Cloudflare KV binding SHOPIFY_SESSIONS. Configure it before using SESSION_STORAGE=cloudflare-kv.",
    );
  }

  return namespace;
}

function shopIndexKey(shop: string) {
  return `${SHOP_INDEX_PREFIX}${shop}`;
}

async function addShopSessionId(
  namespace: KvNamespace,
  shop: string,
  sessionId: string,
) {
  const key = shopIndexKey(shop);
  const current = (await namespace.get<string[]>(key, "json")) ?? [];
  const next = current.includes(sessionId) ? current : [...current, sessionId];
  await namespace.put(key, JSON.stringify(next));
}

async function removeShopSessionId(
  namespace: KvNamespace,
  shop: string,
  sessionId: string,
) {
  const key = shopIndexKey(shop);
  const current = (await namespace.get<string[]>(key, "json")) ?? [];
  await namespace.put(
    key,
    JSON.stringify(current.filter((id) => id !== sessionId)),
  );
}

class HybridSessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    if (!usesCloudflareKv()) {
      return (await getPrismaStorage()).storeSession(session);
    }

    const namespace = await getCloudflareKv();
    await namespace.put(
      session.id,
      JSON.stringify(session.toPropertyArray(true)),
    );
    await addShopSessionId(namespace, session.shop, session.id);
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    if (!usesCloudflareKv()) {
      return (await getPrismaStorage()).loadSession(id);
    }

    const namespace = await getCloudflareKv();
    const properties = await namespace.get<JsonProperty[]>(id, "json");

    if (!properties) {
      return undefined;
    }

    const { Session } = await import("@shopify/shopify-api");
    return Session.fromPropertyArray(properties, true);
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!usesCloudflareKv()) {
      return (await getPrismaStorage()).deleteSession(id);
    }

    const namespace = await getCloudflareKv();
    const session = await this.loadSession(id);

    if (!session) {
      return true;
    }

    await namespace.delete(id);
    await removeShopSessionId(namespace, session.shop, id);
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (!usesCloudflareKv()) {
      return (await getPrismaStorage()).deleteSessions(ids);
    }

    for (const id of ids) {
      await this.deleteSession(id);
    }

    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    if (!usesCloudflareKv()) {
      return (await getPrismaStorage()).findSessionsByShop(shop);
    }

    const namespace = await getCloudflareKv();
    const ids =
      (await namespace.get<string[]>(shopIndexKey(shop), { type: "json" })) ?? [];
    const sessions = await Promise.all(ids.map((id) => this.loadSession(id)));

    return sessions.filter((session): session is Session => Boolean(session));
  }
}

export const sessionStorage = new HybridSessionStorage();
