import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { tauri, type Voice } from "../lib/tauri";
import { useSettings } from "../hooks/useSettings";
import { useAskStream } from "../hooks/useAskStream";
import { wrapCustomerMessage } from "../lib/wrap";
import { voiceColor, voiceDisplayName } from "../lib/voiceTheme";

const COMPOSER_WIDTH = 720;

export function Composer() {
  const { settings } = useSettings();
  const { state: stream, start, reset } = useAskStream();
  const [input, setInput] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // Pre-fill from clipboard on mount and on prefill events from Rust.
  // Trim surrounding whitespace — clipboard contents from Slack/Gmail
  // often carry trailing newlines that would otherwise stretch the
  // textarea (and the auto-sized window) for no reason.
  useEffect(() => {
    let cancelled = false;
    void readText()
      .then((t) => {
        if (!cancelled && t && !input) setInput(t.trim());
      })
      .catch(() => {});

    const unlisten = listen<string>("composer-prefill", (event) => {
      // Reopening via shortcut should always feel fresh.
      reset();
      setCopyState("idle");
      if (event.payload) setInput(event.payload.trim());
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => {
      cancelled = true;
      void unlisten.then((u) => u());
    };
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-size the window to fit content. Spotlight/Raycast feel: starts
  // compact (just input + footer), grows when results appear, shrinks
  // back when reset. We use ResizeObserver as the primary trigger and
  // also fire an explicit resync after every render that could affect
  // layout — belt + suspenders, since macOS swallows occasional setSize
  // calls during rapid stream updates.
  const resizeRafRef = useRef<number>(0);
  const applyHeight = useCallback((h: number) => {
    if (h <= 0) return;
    cancelAnimationFrame(resizeRafRef.current);
    resizeRafRef.current = requestAnimationFrame(() => {
      // Small buffer keeps the rounded bottom edge from being clipped.
      void getCurrentWebviewWindow().setSize(
        new LogicalSize(COMPOSER_WIDTH, Math.ceil(h) + 4),
      );
    });
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const blockSize = entry.borderBoxSize?.[0]?.blockSize;
      applyHeight(
        typeof blockSize === "number"
          ? blockSize
          : el.getBoundingClientRect().height,
      );
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(resizeRafRef.current);
    };
  }, [applyHeight]);

  // Focus + select on mount for one-keystroke editing.
  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  // Manual auto-grow. We don't rely on CSS `field-sizing: content`
  // because WKWebView support is recent and inconsistent. The textarea
  // grows to its scrollHeight up to a fixed cap; the outer
  // ResizeObserver picks the new height up and resizes the window.
  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 128;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, []);

  // Run autosize before paint so the textarea height is correct in the
  // same frame the parent measures itself. Then explicitly sync the
  // window size against the freshly-measured shell height.
  useLayoutEffect(() => {
    autosize();
    const el = shellRef.current;
    if (!el) return;
    applyHeight(el.getBoundingClientRect().height);
  });

  const activeVoice: Voice | undefined = useMemo(() => {
    if (!settings) return undefined;
    return (
      settings.voices.find((v) => v.key === settings.selected_voice_key) ??
      settings.voices[0]
    );
  }, [settings]);

  const accent = voiceColor(activeVoice?.key ?? "default");

  const canGenerate =
    !!settings?.api_key && !!input.trim() && stream.status !== "streaming";
  const canCopy = stream.status === "done" && !!stream.text;

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
    if (!canCopy) return;
    try {
      await writeText(stream.text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch (e) {
      console.error("copy failed", e);
    }
  }, [canCopy, stream.text]);

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
      if (e.key === "Escape") {
        e.preventDefault();
        void tauri.closeWindow("composer");
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        handleGenerate();
        return;
      }
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

  // Empty state until settings loaded.
  if (!settings) {
    return <Shell shellRef={shellRef}>{null}</Shell>;
  }

  // Unconfigured state.
  if (!settings.has_api_key) {
    return (
      <Shell shellRef={shellRef}>
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-10 text-center">
          <div className="text-[13px] text-[oklch(0.92_0_0)]">
            Cal.ai isn't configured yet.
          </div>
          <button
            onClick={() => void tauri.openSettings()}
            className="text-[12px] px-2.5 py-1 rounded-md bg-[oklch(0.30_0_0/0.6)] hover:bg-[oklch(0.36_0_0/0.7)] transition"
          >
            Open Settings
          </button>
        </div>
      </Shell>
    );
  }

  const showOutput =
    stream.status !== "idle" || !!stream.text || !!stream.errorMessage;

  return (
    <Shell shellRef={shellRef}>
      {/* Input row */}
      <div
        data-tauri-drag-region
        className="flex items-start gap-3 pl-5 pr-4 pt-4 pb-3"
      >
        <Indicator
          streaming={stream.status === "streaming"}
          color={accent}
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Reply to a customer message…"
          rows={1}
          spellCheck={false}
          style={{ caretColor: accent }}
          className="flex-1 bg-transparent outline-none text-[15px] leading-[1.5] resize-none placeholder:text-[oklch(0.45_0_0)] overflow-auto text-[oklch(0.96_0_0)]"
        />
      </div>

      {showOutput && (
        <>
          <Divider />
          <OutputArea
            text={stream.text}
            streaming={stream.status === "streaming"}
            errorMessage={
              stream.status === "error" ? stream.errorMessage : null
            }
            onRetry={handleGenerate}
            noContext={stream.noContext}
            accent={accent}
          />
          {stream.citations.length > 0 && (
            <Citations citations={stream.citations} />
          )}
        </>
      )}

      <Divider />

      {/* Footer */}
      <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-[oklch(0.62_0_0)] select-none">
        <button
          onClick={handleVoiceCycle}
          disabled={(settings.voices.length ?? 0) < 2}
          title={
            settings.voices.length > 1
              ? "Click to cycle voices"
              : "Voice (only one configured)"
          }
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[oklch(0.30_0_0/0.5)] disabled:hover:bg-transparent transition"
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: accent }}
          />
          <span className="text-[oklch(0.78_0_0)]">
            {activeVoice
              ? voiceDisplayName(activeVoice)
              : settings.selected_voice_key}
          </span>
        </button>

        <div className="flex items-center gap-1">
          {canCopy && (
            <ActionHint
              label={copyState === "copied" ? "Copied" : "Copy"}
              kbd={["⌘", "⇧", "C"]}
              onClick={handleCopy}
              tone={copyState === "copied" ? "accent" : "default"}
            />
          )}
          <ActionHint
            label={
              stream.status === "streaming"
                ? "Generating…"
                : stream.status === "done"
                  ? "Regenerate"
                  : "Generate"
            }
            kbd={["⌘", "↵"]}
            onClick={handleGenerate}
            disabled={!canGenerate}
            tone="primary"
          />
        </div>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  shellRef,
}: {
  children: ReactNode;
  shellRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={shellRef}
      className="flex flex-col rounded-xl overflow-hidden border border-[oklch(0.96_0_0/0.08)]"
      style={{
        background: "oklch(0.16 0 0 / 0.86)",
        backdropFilter: "blur(28px) saturate(150%)",
        WebkitBackdropFilter: "blur(28px) saturate(150%)",
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div className="h-px bg-[oklch(0.96_0_0/0.07)] mx-3 shrink-0" />
  );
}

function Indicator({
  streaming,
  color,
}: {
  streaming: boolean;
  color: string;
}) {
  // Match the textarea's first-line box height (15px font × 1.5 line-height
  // ≈ 22.5px) so flex centering aligns the dot with the text x-height.
  return (
    <div className="shrink-0 h-[22.5px] flex items-center">
      <span
        style={{ background: color }}
        className={`block w-2 h-2 rounded-full ${
          streaming ? "animate-pulse" : ""
        }`}
      />
    </div>
  );
}

function OutputArea({
  text,
  streaming,
  errorMessage,
  noContext,
  onRetry,
  accent,
}: {
  text: string;
  streaming: boolean;
  errorMessage: string | null;
  noContext: boolean;
  onRetry: () => void;
  accent: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll while streaming.
  useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text, streaming]);

  if (errorMessage) {
    return (
      <div className="px-5 py-3">
        <div className="flex items-start gap-3 text-[13px] leading-relaxed">
          <span className="text-[oklch(0.66_0.20_30)] flex-1">
            {errorMessage}
          </span>
          <button
            onClick={onRetry}
            className="shrink-0 px-2 py-0.5 rounded-md bg-[oklch(0.30_0_0/0.6)] hover:bg-[oklch(0.36_0_0/0.7)] text-[11px] text-[oklch(0.96_0_0)] transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="px-5 py-3 max-h-[300px] overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[oklch(0.92_0_0)]"
    >
      {text || (
        <span className="text-[oklch(0.45_0_0)]">
          {streaming ? "" : "Reply will appear here."}
        </span>
      )}
      {streaming && (
        <span
          style={{ background: accent }}
          className="inline-block w-[6px] h-[14px] -mb-[2px] ml-[1px] animate-pulse align-text-bottom"
        />
      )}
      {noContext && !streaming && (
        <div className="mt-2 text-[11px] text-[oklch(0.55_0_0)]">
          (no matching docs)
        </div>
      )}
    </div>
  );
}

function Citations({
  citations,
}: {
  citations: { slug: string; headingPath: string[] }[];
}) {
  return (
    <div className="px-4 pb-2 flex flex-wrap gap-1 text-[10.5px] shrink-0">
      {citations.map((c, i) => {
        const path =
          c.headingPath.length > 0 ? c.headingPath.join(" › ") : null;
        return (
          <span
            key={`${c.slug}-${i}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[oklch(0.96_0_0/0.05)] text-[oklch(0.72_0_0)]"
            title={path ?? c.slug}
          >
            <span className="text-[oklch(0.55_0_0)]">↗</span>
            <span className="truncate max-w-[180px] font-mono">{c.slug}</span>
            {path && (
              <span className="truncate max-w-[200px] text-[oklch(0.62_0_0)]">
                · {path}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function ActionHint({
  label,
  kbd,
  onClick,
  disabled,
  tone = "default",
}: {
  label: string;
  kbd: string[];
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "primary" | "accent";
}) {
  const labelTone =
    tone === "accent"
      ? "text-[oklch(0.74_0.16_270)]"
      : tone === "primary"
        ? "text-[oklch(0.92_0_0)]"
        : "text-[oklch(0.78_0_0)]";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-[oklch(0.30_0_0/0.5)] transition ${labelTone}`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-0.5">
        {kbd.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </span>
    </button>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-[3px] rounded-[4px] bg-[oklch(0.96_0_0/0.08)] text-[10px] text-[oklch(0.85_0_0)] font-medium leading-none">
      {children}
    </span>
  );
}
