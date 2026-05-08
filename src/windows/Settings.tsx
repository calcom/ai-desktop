import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { tauri, type ValidateResult } from "../lib/tauri";

const DEFAULT_BASE_URL = "https://api.cal.ai";

type SaveState =
  | { status: "idle" }
  | { status: "validating" }
  | { status: "valid"; result: ValidateResult }
  | { status: "invalid"; message: string }
  | { status: "saved" };

export function Settings() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [hasExisting, setHasExisting] = useState(false);

  const reload = useCallback(async () => {
    const s = await tauri.getSettings();
    setApiKey(s.api_key ?? "");
    setBaseUrl(s.base_url || DEFAULT_BASE_URL);
    setHasExisting(s.has_api_key);
    setSaveState({ status: "idle" });
  }, []);

  useEffect(() => {
    void reload();
    // The window is hidden (not destroyed) on close, so the React tree
    // persists. Reset on reopen so we don't get a stale "Saved. Closing…".
    const unlisten = listen("settings-opened", () => {
      void reload();
    });
    return () => {
      void unlisten.then((u) => u());
    };
  }, [reload]);

  async function validateAndSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim() || !baseUrl.trim()) {
      setSaveState({
        status: "invalid",
        message: "Both fields are required.",
      });
      return;
    }
    setSaveState({ status: "validating" });
    const result = await tauri.validateApiKey(apiKey.trim(), baseUrl.trim());
    if (!result.ok) {
      const msg = (() => {
        if (result.error_message) return result.error_message;
        if (result.missing_scopes.length > 0) {
          return `API key is missing required scopes: ${result.missing_scopes.join(", ")}`;
        }
        return "Could not validate API key.";
      })();
      setSaveState({ status: "invalid", message: msg });
      return;
    }
    try {
      await tauri.saveSettings(apiKey.trim(), baseUrl.trim());
      // Trigger a fresh voices fetch so the tray picks them up.
      try {
        await tauri.refreshVoices();
      } catch (e) {
        console.warn("voices refresh failed", e);
      }
      setSaveState({ status: "saved" });
      setHasExisting(true);
      setTimeout(() => {
        void tauri.closeWindow("settings");
        setSaveState({ status: "idle" });
      }, 700);
    } catch (e) {
      setSaveState({
        status: "invalid",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="h-full bg-[oklch(0.18_0_0)] text-[oklch(0.96_0_0)] flex flex-col">
      <div className="px-6 py-5 border-b border-[oklch(0.30_0_0)]">
        <div className="text-[15px] font-medium">Cal.ai settings</div>
        <div className="text-[12px] text-[oklch(0.62_0_0)] mt-0.5">
          {hasExisting
            ? "Update your backend connection."
            : "Connect Cal.ai to your local RAG backend."}
        </div>
      </div>

      <form
        onSubmit={validateAndSave}
        className="flex-1 px-6 py-5 flex flex-col gap-4"
      >
        <Field label="Backend base URL">
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            className="w-full px-3 py-2 rounded-md bg-[oklch(0.22_0_0)] border border-[oklch(0.30_0_0)] outline-none focus:border-[oklch(0.74_0.16_270)] transition text-[13px]"
          />
        </Field>

        <Field label="API key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cal_…"
            className="w-full px-3 py-2 rounded-md bg-[oklch(0.22_0_0)] border border-[oklch(0.30_0_0)] outline-none focus:border-[oklch(0.74_0.16_270)] transition text-[13px] font-mono"
          />
        </Field>

        {saveState.status === "invalid" && (
          <div className="text-[12px] text-[oklch(0.66_0.20_30)]">
            {saveState.message}
          </div>
        )}
        {saveState.status === "saved" && (
          <div className="text-[12px] text-[oklch(0.74_0.16_270)]">
            Saved. Closing…
          </div>
        )}
        {saveState.status === "valid" && (
          <div className="text-[12px] text-[oklch(0.74_0.16_270)]">
            Verified — saving…
          </div>
        )}

        <div className="flex-1" />

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-[oklch(0.30_0_0)]">
          <button
            type="button"
            onClick={() => void tauri.closeWindow("settings")}
            disabled={!hasExisting}
            className="text-[12px] text-[oklch(0.62_0_0)] hover:text-[oklch(0.96_0_0)] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saveState.status === "validating"}
            className="px-3.5 py-1.5 rounded-md bg-[oklch(0.74_0.16_270)] text-black hover:brightness-110 disabled:opacity-50 transition text-[12px] font-medium"
          >
            {saveState.status === "validating"
              ? "Validating…"
              : "Validate & save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-[oklch(0.96_0_0)]">
        {label}
      </span>
      {children}
    </label>
  );
}
