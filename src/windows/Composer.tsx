import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { tauri, type Voice } from "../lib/tauri";
import { useSettings } from "../hooks/useSettings";
import { useAskStream } from "../hooks/useAskStream";
import { wrapCustomerMessage } from "../lib/wrap";

export function Composer() {
  const { settings } = useSettings();
  const { state: stream, start, reset } = useAskStream();
  const [input, setInput] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pre-fill from clipboard on mount, and respond to prefill events from Rust.
  useEffect(() => {
    let cancelled = false;
    void readText()
      .then((t) => {
        if (!cancelled && t && !input) {
          setInput(t);
        }
      })
      .catch(() => {
        // ignore — clipboard may be empty/non-text
      });

    const unlisten = listen<string>("composer-prefill", (event) => {
      if (event.payload && !stream.text) {
        setInput(event.payload);
        reset();
      }
    });

    return () => {
      cancelled = true;
      void unlisten.then((u) => u());
    };
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus textarea on mount.
  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const activeVoice: Voice | undefined = useMemo(() => {
    if (!settings) return undefined;
    return (
      settings.voices.find((v) => v.key === settings.selected_voice_key) ??
      settings.voices[0]
    );
  }, [settings]);

  const canGenerate =
    !!settings?.api_key && !!input.trim() && stream.status !== "streaming";

  const handleGenerate = useCallback(() => {
    if (!settings?.api_key || !input.trim()) return;
    void start({
      baseUrl: settings.base_url,
      apiKey: settings.api_key,
      question: wrapCustomerMessage(input),
      voice: settings.selected_voice_key,
    });
  }, [settings, input, start]);

  const handleCopy = useCallback(async () => {
    if (stream.status !== "done" || !stream.text) return;
    try {
      await writeText(stream.text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch (e) {
      console.error("copy failed", e);
    }
  }, [stream.status, stream.text]);

  const handleVoiceCycle = useCallback(() => {
    if (!settings || settings.voices.length < 2) return;
    const idx = settings.voices.findIndex(
      (v) => v.key === settings.selected_voice_key,
    );
    const next = settings.voices[(idx + 1) % settings.voices.length];
    void tauri.setSelectedVoice(next.key);
  }, [settings]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape → close window
      if (e.key === "Escape") {
        e.preventDefault();
        void tauri.closeWindow("composer");
        return;
      }
      // Cmd+Enter → generate
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
        return;
      }
      // Cmd+Shift+C → copy
      if (
        e.key.toLowerCase() === "c" &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey
      ) {
        e.preventDefault();
        void handleCopy();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleGenerate, handleCopy]);

  if (!settings) {
    return (
      <div className="h-full flex items-center justify-center text-[oklch(0.62_0_0)]">
        Loading…
      </div>
    );
  }

  if (!settings.has_api_key) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="text-[oklch(0.96_0_0)] font-medium">
          Cal.ai isn't configured yet
        </div>
        <div className="text-[oklch(0.62_0_0)] text-[12px]">
          Add your API key in Settings to start composing replies.
        </div>
        <button
          onClick={() => void tauri.openSettings()}
          className="mt-1 px-3 py-1.5 rounded-md bg-[oklch(0.30_0_0)] hover:bg-[oklch(0.36_0_0)] transition text-[12px]"
        >
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col rounded-xl overflow-hidden border border-[oklch(0.30_0_0/0.5)]"
      style={{
        background: "oklch(0.18 0 0 / 0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* drag handle / header */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2 border-b border-[oklch(0.30_0_0/0.5)] select-none"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[oklch(0.74_0.16_270)]" />
          <span className="text-[11px] tracking-wide uppercase text-[oklch(0.62_0_0)]">
            Cal.ai composer
          </span>
        </div>
        <button
          onClick={handleVoiceCycle}
          title="Click to cycle voices"
          className="px-2 py-0.5 text-[11px] rounded bg-[oklch(0.22_0_0)] hover:bg-[oklch(0.30_0_0)] text-[oklch(0.96_0_0)] transition"
        >
          Voice: {activeVoice?.name ?? settings.selected_voice_key}
        </button>
      </div>

      <div className="flex-1 grid grid-rows-2 gap-px bg-[oklch(0.30_0_0/0.5)] overflow-hidden">
        {/* input */}
        <div className="bg-[oklch(0.18_0_0)] flex flex-col min-h-0">
          <div className="px-4 pt-2 text-[10px] uppercase tracking-wide text-[oklch(0.62_0_0)]">
            Customer message
          </div>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste or type the customer message…"
            className="flex-1 px-4 py-2 bg-transparent outline-none text-[13px] leading-relaxed text-[oklch(0.96_0_0)] placeholder:text-[oklch(0.40_0_0)] min-h-0 overflow-auto"
          />
          <div className="px-4 py-2 border-t border-[oklch(0.30_0_0/0.5)] flex items-center justify-between text-[11px] text-[oklch(0.62_0_0)]">
            <span>{input.length} chars</span>
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="px-2.5 py-1 rounded-md bg-[oklch(0.74_0.16_270)] text-black disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition text-[12px] font-medium"
            >
              {stream.status === "streaming" ? "Streaming…" : "Generate ⌘↵"}
            </button>
          </div>
        </div>

        {/* output */}
        <div className="bg-[oklch(0.18_0_0)] flex flex-col min-h-0">
          <div className="px-4 pt-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-[oklch(0.62_0_0)]">
            <span>Reply</span>
            {stream.status === "streaming" && (
              <span className="flex items-center gap-1.5 text-[oklch(0.74_0.16_270)] normal-case tracking-normal">
                <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.74_0.16_270)] animate-pulse" />
                generating
              </span>
            )}
          </div>
          <ResponsePane
            status={stream.status}
            text={stream.text}
            errorMessage={stream.errorMessage}
            onRetry={handleGenerate}
          />

          {stream.citations.length > 0 && (
            <div className="px-4 py-2 border-t border-[oklch(0.30_0_0/0.5)] text-[11px] text-[oklch(0.62_0_0)]">
              <div className="text-[10px] uppercase tracking-wide mb-1">
                Citations
              </div>
              <ul className="space-y-0.5">
                {stream.citations.map((c, i) => (
                  <li key={`${c.slug}-${i}`} className="truncate">
                    <span className="text-[oklch(0.40_0_0)]">{c.slug}</span>
                    {c.headingPath.length > 0 && (
                      <span className="text-[oklch(0.78_0_0)]">
                        {" "}
                        › {c.headingPath.join(" › ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-4 py-2 border-t border-[oklch(0.30_0_0/0.5)] flex items-center justify-between text-[11px]">
            <span className="text-[oklch(0.62_0_0)]">
              {stream.status === "done" && stream.noContext
                ? "No matching docs."
                : stream.status === "done"
                  ? "Ready to copy."
                  : ""}
            </span>
            <button
              onClick={handleCopy}
              disabled={stream.status !== "done" || !stream.text}
              className="px-2.5 py-1 rounded-md bg-[oklch(0.30_0_0)] hover:bg-[oklch(0.36_0_0)] disabled:opacity-40 disabled:cursor-not-allowed transition text-[12px]"
            >
              {copyState === "copied" ? "Copied ✓" : "Copy ⌘⇧C"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResponsePane({
  status,
  text,
  errorMessage,
  onRetry,
}: {
  status: ReturnType<typeof useAskStream>["state"]["status"];
  text: string;
  errorMessage: string | null;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <div className="flex-1 flex flex-col items-start justify-center px-4 py-3 gap-2 min-h-0">
        <div className="text-[oklch(0.66_0.20_30)] text-[12px]">
          {errorMessage ?? "Something went wrong."}
        </div>
        <button
          onClick={onRetry}
          className="px-2.5 py-1 rounded-md bg-[oklch(0.30_0_0)] hover:bg-[oklch(0.36_0_0)] transition text-[12px]"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="flex-1 px-4 py-2 overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[oklch(0.96_0_0)] min-h-0">
      {text || (
        <span className="text-[oklch(0.40_0_0)]">
          {status === "streaming" ? "" : "Reply will appear here."}
        </span>
      )}
    </div>
  );
}
