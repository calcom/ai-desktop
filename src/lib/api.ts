import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { BackendErrorException } from "./errors";

// All backend traffic goes through tauri-plugin-http, which routes the
// request through Rust (reqwest under the hood) instead of the webview.
// That bypasses CORS — the backend has no Access-Control-Allow-Origin set,
// and the webview origin (tauri://localhost or http://localhost:1420 in
// dev) is not the same as the backend at http://localhost:3000.
const httpFetch: typeof fetch = tauriFetch as unknown as typeof fetch;

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

const NO_CONTEXT_REPLY =
  "I don't have information about that in the Cal.com docs.";

/**
 * POST /ask with SSE streaming.
 *
 * Calls onEvent for every parsed delta / citations / error event. Resolves
 * (with an aggregate of plain text + citations) when the stream ends, or
 * throws a BackendErrorException for non-200 responses or stream errors.
 */
export async function askStream(
  opts: AskOptions,
): Promise<{ text: string; citations: Citation[]; noContext: boolean }> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/ask`;
  const res = await httpFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      question: opts.question,
      voice: opts.voice,
      top_k: opts.topK ?? 8,
    }),
    signal: opts.signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream")) {
    const body = await res.text();
    let parsed: { error?: { code?: string; message?: string; required_scope?: string; retry_after_seconds?: number } } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // ignore
    }
    throw new BackendErrorException({
      code: parsed.error?.code ?? `http_${res.status}`,
      message: parsed.error?.message ?? `Request failed: HTTP ${res.status}`,
      required_scope: parsed.error?.required_scope,
      retry_after_seconds: parsed.error?.retry_after_seconds,
    });
  }

  if (!res.body) {
    throw new BackendErrorException({
      code: "network",
      message: "Empty response body",
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let citations: Citation[] = [];
  let noContext = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = nextEventBoundary(buffer)) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^[\r\n]+/, "");

      const { event, data } = parseSseEvent(raw);
      if (event === "" || event === "message") {
        text += data;
        opts.onEvent({ type: "delta", text: data });
      } else if (event === "citations") {
        try {
          citations = JSON.parse(data) as Citation[];
        } catch {
          citations = [];
        }
        opts.onEvent({ type: "citations", citations });
      } else if (event === "error") {
        let msg = data;
        try {
          msg = (JSON.parse(data) as { message?: string }).message ?? data;
        } catch {
          // raw data
        }
        opts.onEvent({ type: "error", message: msg });
        throw new BackendErrorException({
          code: "stream_error",
          message: msg,
        });
      }
    }
  }

  if (text.trim() === NO_CONTEXT_REPLY) {
    noContext = true;
  }

  opts.onEvent({ type: "done" });
  return { text, citations, noContext };
}

function nextEventBoundary(s: string): number {
  // Returns the index *after* the boundary (so callers can slice to it).
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === "\n" && s[i + 1] === "\n") return i + 2;
    if (
      i + 3 < s.length &&
      s[i] === "\r" &&
      s[i + 1] === "\n" &&
      s[i + 2] === "\r" &&
      s[i + 3] === "\n"
    ) {
      return i + 4;
    }
  }
  return -1;
}

function parseSseEvent(raw: string): { event: string; data: string } {
  let event = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice("event:".length).trimStart();
    } else if (trimmed.startsWith("data:")) {
      const rest = trimmed.slice("data:".length);
      dataLines.push(rest.startsWith(" ") ? rest.slice(1) : rest);
    }
  }
  return { event, data: dataLines.join("\n") };
}
