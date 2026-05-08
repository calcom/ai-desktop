import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauri, type Settings } from "../lib/tauri";

export function useSettings(): {
  settings: Settings | null;
  reload: () => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await tauri.getSettings();
      setSettings(s);
    } catch (e) {
      console.error("get_settings failed", e);
    }
  }, []);

  useEffect(() => {
    void reload();
    const unlisten = listen<string>("voice-changed", () => {
      void reload();
    });
    return () => {
      void unlisten.then((u) => u());
    };
  }, [reload]);

  return { settings, reload };
}
