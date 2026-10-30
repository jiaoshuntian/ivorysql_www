import type { AssistantStreamEvent } from "./types.ts";

type TranslateOptions = {
  signal?: AbortSignal;
  onEvent?: (event: AssistantStreamEvent) => void;
  onCancel?: () => void;
};

const encoder = new TextEncoder();

export function encodeAssistantEvent(event: AssistantStreamEvent): Uint8Array {
  let data: object;
  switch (event.type) {
    case "token":
      data = { content: event.content };
      break;
    case "error":
      data = { code: event.code, message: event.message };
      break;
    case "done":
      data = {};
  }

  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isTimeout(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted || !isRecord(signal.reason)) return false;
  return signal.reason.name === "TimeoutError";
}

export function translateBailianStream(
  input: ReadableStream<Uint8Array>,
  options: TranslateOptions = {},
): ReadableStream<Uint8Array> {
  const reader = input.getReader();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder();
      let buffer = "";
      let emittedAnswer = false;
      let parsingFailed = false;

      const emit = (event: AssistantStreamEvent) => {
        if (cancelled) return;
        controller.enqueue(encodeAssistantEvent(event));
        try {
          options.onEvent?.(event);
        } catch {
          // Observability must never interrupt a visitor's answer stream.
        }
      };

      const processPayload = (payload: unknown) => {
        if (!isRecord(payload) || !isRecord(payload.output)) return;
        const { choices } = payload.output;
        if (!Array.isArray(choices)) return;

        for (const choice of choices) {
          if (!isRecord(choice) || !isRecord(choice.message)) continue;
          const { message } = choice;
          const extra = isRecord(message.extra) ? message.extra : undefined;
          const step = extra?.step;

          if (step === "generating") {
            const content = nonEmptyString(message.content);
            if (content) {
              emittedAnswer = true;
              emit({ type: "token", content });
            }
            continue;
          }
        }
      };

      const processFrame = (frame: string) => {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data || data === "[DONE]") return;

        try {
          processPayload(JSON.parse(data));
        } catch {
          parsingFailed = true;
        }
      };

      const processBufferedFrames = () => {
        while (true) {
          const delimiter = buffer.match(/\r?\n\r?\n/);
          if (!delimiter || delimiter.index === undefined) return;
          const frame = buffer.slice(0, delimiter.index);
          buffer = buffer.slice(delimiter.index + delimiter[0].length);
          processFrame(frame);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processBufferedFrames();
        }

        if (cancelled) return;

        buffer += decoder.decode();
        processBufferedFrames();
        if (buffer.trim()) processFrame(buffer);

        if (!emittedAnswer && parsingFailed) {
          emit({
            type: "error",
            code: "INVALID_STREAM",
            message: "The answer stream could not be read.",
          });
        } else {
          emit({ type: "done" });
        }
      } catch {
        if (cancelled) return;
        emit(
          isTimeout(options.signal)
            ? {
                type: "error",
                code: "TIMEOUT",
                message: "Response timed out.",
              }
            : {
                type: "error",
                code: "UPSTREAM_ERROR",
                message: "The answer stream ended unexpectedly.",
              },
        );
      } finally {
        if (!cancelled) controller.close();
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      cancelled = true;
      try {
        options.onCancel?.();
      } catch {
        // Observability must never interrupt upstream cancellation.
      }
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}
