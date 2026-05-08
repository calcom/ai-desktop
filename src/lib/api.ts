import { listen } from "@tauri-apps/api/event";
import { backendErrorExceptionFromUnknown } from "./errors";
import { tauri, type AskStreamCommandResult } from "./tauri";

export type Citation = {
  slug: string;
  headingPath: string[];
};

export type AskEvent =
  | { type: "delta"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "error"; message: string }
  | { type: "done" };

export type AskOptions = {
  baseUrl: string;
  apiKey: string;
  question: string;
  voice: string;
  topK?: number;
  signal?: AbortSignal;
  onEvent: (event: AskEvent) => void;
};

type AskStreamPayload = {
  request_id: string;
  type: "delta" | "citations" | "error";
  text?: string | null;
  citations?: Citation[] | null;
  message?: string | null;
};

/**
 * POST /ask with SSE streaming.
 *
 * The composer uses a Rust command for transport so it follows the same
 * network path as the clipboard shortcut. Rust emits each parsed SSE event
 * back to this webview, keeping the React UI incremental without depending on
 * plugin-http streaming behavior in WKWebView.
 */
export async function askStream(
  opts: AskOptions,
): Promise<{ text: string; citations: Citation[]; noContext: boolean }> {
  const requestId = makeRequestId();
  let unlisten = () => {};

  try {
    unlisten = await listen<AskStreamPayload>("ask-stream", (event) => {
      const payload = event.payload;
      if (payload.request_id !== requestId) return;

      if (payload.type === "delta") {
        opts.onEvent({ type: "delta", text: payload.text ?? "" });
      } else if (payload.type === "citations") {
        opts.onEvent({
          type: "citations",
          citations: payload.citations ?? [],
        });
      } else if (payload.type === "error") {
        opts.onEvent({
          type: "error",
          message: payload.message ?? "Something went wrong.",
        });
      }
    });

    const command = tauri.askStream({
      request_id: requestId,
      base_url: opts.baseUrl,
      api_key: opts.apiKey,
      question: opts.question,
      voice: opts.voice,
      top_k: opts.topK ?? 8,
    });
    command.catch(() => {});

    const result = await withAbort(command, opts.signal);
    opts.onEvent({ type: "done" });
    return toAskResult(result);
  } catch (error) {
    throw backendErrorExceptionFromUnknown(error);
  } finally {
    unlisten();
  }
}

function toAskResult(
  result: AskStreamCommandResult,
): { text: string; citations: Citation[]; noContext: boolean } {
  return {
    text: result.text,
    citations: result.citations,
    noContext: result.no_context,
  };
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Request cancelled"));

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Request cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function makeRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
