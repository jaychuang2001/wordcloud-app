import { useCallback, useEffect, useState } from "react";

import { DEFAULT_CONFIG, loadConfig, saveConfig, type RoomConfig } from "@/lib/wordcloud-core";

/** Reads the shared room config and keeps every open tab in sync. */
export function useWordCloudConfig() {
  const [config, setConfig] = useState<RoomConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "wc:config") setConfig(loadConfig());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((next: RoomConfig) => {
    setConfig(next);
    saveConfig(next);
  }, []);

  return { config, update, ready };
}
