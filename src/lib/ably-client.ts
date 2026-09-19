import { useEffect, useState } from "react";
import type { Realtime } from "ably";

import { getAblyToken } from "./ably.functions";

export const LOCAL_KEY_STORAGE = "wc:ablyKey";

let clientPromise: Promise<Realtime> | null = null;

export function getAblyClient(): Promise<Realtime> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const Ably = await import("ably");
    const localKey = window.localStorage.getItem(LOCAL_KEY_STORAGE) ?? "";
    if (localKey.includes(":")) {
      return new Ably.Realtime({ key: localKey, echoMessages: true });
    }
    return new Ably.Realtime({
      echoMessages: true,
      authCallback: (_params, callback) => {
        getAblyToken({ data: { clientId: "" } })
          .then((result) => {
            if (result.ok && result.token) callback(null, result.token);
            else callback(result.reason || "no_ably_key", null);
          })
          .catch((err: Error) => callback(err.message, null));
      },
    });
  })();
  return clientPromise;
}

export function resetAblyClient() {
  const pending = clientPromise;
  clientPromise = null;
  void pending?.then((c) => c.close()).catch(() => undefined);
}

export type ConnectionStatus = "connecting" | "connected" | "error" | "disconnected";

/** Connects on mount (browser only) and tracks the connection state. */
export function useAbly() {
  const [client, setClient] = useState<Realtime | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let instance: Realtime | null = null;

    const onState = (change: { current: string; reason?: { message?: string } }) => {
      if (cancelled) return;
      switch (change.current) {
        case "connected":
          setStatus("connected");
          setError("");
          break;
        case "failed":
        case "suspended":
          setStatus("error");
          setError(change.reason?.message ?? "連線失敗");
          break;
        case "disconnected":
          setStatus("disconnected");
          break;
        case "connecting":
        case "initialized":
          setStatus("connecting");
          break;
        default:
          break;
      }
    };

    getAblyClient()
      .then((c) => {
        if (cancelled) return;
        instance = c;
        setClient(c);
        c.connection.on(onState);
        onState({ current: c.connection.state });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setStatus("error");
        setError(err.message);
      });

    return () => {
      cancelled = true;
      instance?.connection.off(onState);
    };
  }, []);

  return { client, status, error };
}
