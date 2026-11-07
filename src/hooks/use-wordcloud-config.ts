import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchRemoteConfig,
  getHostPassword,
  getScriptUrl,
  pushRemoteConfig,
  setHostPassword,
  unlockHost,
  type UnlockResult,
} from "@/lib/cloud";
import { DEFAULT_CONFIG, loadConfig, saveConfig, type RoomConfig } from "@/lib/wordcloud-core";

/** "off" = no sheet connected (single-machine mode). */
export type CloudState = "checking" | "on" | "off";
export type SyncState = "idle" | "saving" | "saved" | "locked" | "error";
/**
 * local       – no Google Sheet connected: everything lives in this browser
 * checking    – a sheet is connected, first check still running
 * synced      – connected and answering
 * unreachable – connected, but the sheet isn't answering right now (retrying)
 */
export type LinkState = "local" | "checking" | "synced" | "unreachable";

/** Set when the host chose to keep this computer's settings instead of the sheet's. */
export const PREFER_LOCAL_FLAG = "wc:preferLocalConfig";

function preferLocal(): boolean {
  try {
    return window.localStorage.getItem(PREFER_LOCAL_FLAG) === "1";
  } catch {
    return false;
  }
}

function setPreferLocal(on: boolean) {
  try {
    if (on) window.localStorage.setItem(PREFER_LOCAL_FLAG, "1");
    else window.localStorage.removeItem(PREFER_LOCAL_FLAG);
  } catch {
    /* ignore */
  }
}

/**
 * Reads the room config. With a Google Sheet connected, the shared copy wins
 * (and is kept in this browser as a cache); without one, the browser's own copy
 * is used. `ready` turns true once the first check has finished, so pages
 * don't flash "not enabled" from stale local defaults.
 */
export function useWordCloudConfig(options?: { pollMs?: number; onSaved?: () => void }) {
  const pollMs = options?.pollMs ?? 0;
  const onSavedRef = useRef<(() => void) | undefined>(options?.onSaved);
  onSavedRef.current = options?.onSaved;
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  const [cloud, setCloud] = useState<CloudState>("checking");
  const [link, setLink] = useState<LinkState>("checking");
  const [sync, setSync] = useState<SyncState>("idle");
  const [unlocked, setUnlocked] = useState(false);
  const remoteKnown = useRef(false); // the sheet has answered at least once
  const configRef = useRef<RoomConfig>(DEFAULT_CONFIG);
  const pushTimer = useRef<number | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);
  const linkRef = useRef<LinkState>("checking");
  const lastRun = useRef(0);

  const setLinkState = useCallback((next: LinkState) => {
    linkRef.current = next;
    setLink(next);
  }, []);

  const adopt = useCallback((next: RoomConfig) => {
    configRef.current = next;
    setConfig(next);
    saveConfig(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const local = loadConfig();
    configRef.current = local;
    setConfig(local);
    setUnlocked(Boolean(getHostPassword()));

    const hasSheet = Boolean(getScriptUrl());
    if (!hasSheet) {
      setCloud("off");
      setLinkState("local");
      setReady(true);
    } else {
      setLinkState("checking");
    }

    const refresh = async (first: boolean) => {
      if (!getScriptUrl()) return;
      lastRun.current = Date.now();
      const res = await fetchRemoteConfig();
      if (cancelled) return;
      if (res.state === "on") {
        setCloud("on");
        setLinkState("synced");
        remoteKnown.current = true;
        // Don't overwrite what the host is typing (or chose to keep) with the sheet's copy.
        if (
          res.config &&
          pushTimer.current === null &&
          !preferLocal() &&
          JSON.stringify(res.config) !== JSON.stringify(configRef.current)
        ) {
          adopt(res.config);
        }
      } else {
        // A temporary failure after a good connection keeps showing the shared copy.
        setLinkState("unreachable");
        if (!remoteKnown.current) setCloud("checking");
      }
      if (first) setReady(true);
    };
    refreshRef.current = () => void refresh(false);

    let safety: number | undefined;
    if (hasSheet) {
      void refresh(true);
      safety = window.setTimeout(() => setReady(true), 10000);
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === "wc:config") {
        const next = loadConfig();
        configRef.current = next;
        setConfig(next);
      }
    };
    window.addEventListener("storage", onStorage);
    // Every 10 s: retry if the sheet is unreachable; otherwise only run the slow safety-net poll (screens).
    const timer = hasSheet
      ? window.setInterval(() => {
          const due = pollMs > 0 && Date.now() - lastRun.current >= pollMs;
          if (linkRef.current === "unreachable" || due) void refresh(false);
        }, 10000)
      : null;
    return () => {
      cancelled = true;
      if (safety !== undefined) window.clearTimeout(safety);
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [adopt, pollMs, setLinkState]);

  const push = useCallback(async (next: RoomConfig) => {
    setSync("saving");
    const result = await pushRemoteConfig(next);
    if (result === "ok") {
      setSync("saved");
      setPreferLocal(false); // the sheet now holds this computer's settings
      onSavedRef.current?.();
    } else if (result === "locked") {
      setSync("locked");
      setUnlocked(false);
    } else setSync("error");
  }, []);

  const update = useCallback(
    (next: RoomConfig) => {
      configRef.current = next;
      setConfig(next);
      saveConfig(next);
      if (!remoteKnown.current) return; // no sheet (or not reachable yet): local only
      if (!getHostPassword()) {
        setSync("locked");
        return;
      }
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => {
        pushTimer.current = null;
        void push(configRef.current);
      }, 500);
    },
    [push],
  );

  /** Verifies the host password; on success pushes the current config so it is saved to the sheet. */
  const unlock = useCallback(
    async (password: string): Promise<UnlockResult> => {
      const result = await unlockHost(password);
      setUnlocked(result === "ok");
      if (result === "ok" && remoteKnown.current) await push(configRef.current);
      return result;
    },
    [push],
  );

  /** Re-reads the shared config now (called when the host announces a change). */
  const refresh = useCallback(() => refreshRef.current(), []);

  const lock = useCallback(() => {
    setHostPassword("");
    setUnlocked(false);
  }, []);

  return { config, update, ready, cloud, link, sync, unlocked, unlock, lock, refresh };
}
