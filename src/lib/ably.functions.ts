import { createServerFn } from "@tanstack/react-start";

export type AblyTokenDetails = {
  token: string;
  expires: number;
  issued: number;
  capability: string;
  clientId: string;
  keyName: string;
};

export type AblyTokenResult = {
  ok: boolean;
  reason: string;
  token: AblyTokenDetails | null;
};

/**
 * Issues a short-lived Ably token so browsers never hold the API key.
 * ok=false means no server-side key is configured, which lets the host screen
 * fall back to a locally entered key.
 */
export const getAblyToken = createServerFn({ method: "POST" })
  .inputValidator((input: { clientId?: string }) => ({
    clientId: typeof input?.clientId === "string" ? input.clientId.slice(0, 64) : "",
  }))
  .handler(async ({ data }): Promise<AblyTokenResult> => {
    const key = process.env["ABLY_API_KEY"];
    if (!key || !key.includes(":")) {
      return { ok: false, reason: "missing_key", token: null };
    }
    const keyName = key.split(":")[0]!;
    const res = await fetch(
      `https://rest.ably.io/keys/${encodeURIComponent(keyName)}/requestToken`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${btoa(key)}`,
        },
        body: JSON.stringify({
          keyName,
          clientId: data.clientId || `guest-${Math.random().toString(36).slice(2, 10)}`,
          capability: JSON.stringify({ "wc:*": ["publish", "subscribe", "presence"] }),
          ttl: 60 * 60 * 1000,
          timestamp: Date.now(),
          nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
        }),
      },
    );

    if (!res.ok) {
      console.error("Ably token request failed", res.status, await res.text());
      return { ok: false, reason: "request_failed", token: null };
    }
    const token = (await res.json()) as AblyTokenDetails;
    return { ok: true, reason: "", token };
  });
