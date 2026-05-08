import { useCallback, useRef, useState } from "react";
import { askStream, type Citation } from "../lib/api";
import { BackendErrorException, friendlyError } from "../lib/errors";

export type StreamStatus = "idle" | "streaming" | "done" | "error";

export type StreamState = {
  status: StreamStatus;
  text: string;
  citations: Citation[];
  errorMessage: string | null;
  noContext: boolean;
};

const initialState: StreamState = {
  status: "idle",
  text: "",
  citations: [],
  errorMessage: null,
  noContext: false,
};

export function useAskStream() {
  const [state, setState] = useState<StreamState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initialState);
  }, []);

  const start = useCallback(
    async (params: {
      baseUrl: string;
      apiKey: string;
      question: string;
      voice: string;
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        status: "streaming",
        text: "",
        citations: [],
        errorMessage: null,
        noContext: false,
      });

      try {
        const result = await askStream({
          baseUrl: params.baseUrl,
          apiKey: params.apiKey,
          question: params.question,
          voice: params.voice,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "delta") {
              setState((prev) => ({ ...prev, text: prev.text + event.text }));
            } else if (event.type === "citations") {
              setState((prev) => ({ ...prev, citations: event.citations }));
            } else if (event.type === "error") {
              setState((prev) => ({
                ...prev,
                status: "error",
                errorMessage: event.message,
              }));
            }
          },
        });
        setState((prev) => ({
          ...prev,
          status: "done",
          text: result.text,
          citations: result.citations,
          noContext: result.noContext,
        }));
      } catch (e) {
        if (controller.signal.aborted) return;
        const msg =
          e instanceof BackendErrorException
            ? e.asFriendly(params.baseUrl)
            : e instanceof Error
              ? e.message
              : "Unknown error";
        // Network errors come through fetch — translate as "backend offline".
        const finalMsg =
          e instanceof TypeError
            ? friendlyError(
                { code: "network", message: msg },
                params.baseUrl,
              )
            : msg;
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: finalMsg,
        }));
      }
    },
    [],
  );

  return { state, start, reset };
}
