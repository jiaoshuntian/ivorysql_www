import type { AssistantSource, AssistantStreamEvent } from "./types";

type TranslateOptions = {
  signal?: AbortSignal;
  onEvent?: (event: AssistantStreamEvent) => void;
};

const encoder = new TextEncoder();

export function encodeAssistantEvent(event: AssistantStreamEvent): Uint8Array {
  let data: object;
  switch (event.type) {
    case "token":
      data = { content: event.content };
      break;
    case "sources":
      data = { items: event.items };
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

function trustedDocumentationUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "docs.ivorysql.org") {
      return url.toString();
    }
  } catch {
    // Unparseable and non-HTTP citation values are intentionally discarded.
  }

  return undefined;
}

function parseExtraJson(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeSource(value: unknown): AssistantSource | undefined {
  if (!isRecord(value)) return undefined;

  const id = nonEmptyString(value.file_id) ?? nonEmptyString(value.id);
  const title = nonEmptyString(value.title) ?? nonEmptyString(value.file_name);
  if (!id || !title) return undefined;

  const source: AssistantSource = { id, title };
  const section = nonEmptyString(value.section_path);
  const url = trustedDocumentationUrl(value.url);
  if (section) source.section = section;
  if (url) source.url = url;
  return source;
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

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder();
      const sources = new Map<string, AssistantSource>();
      let buffer = "";
      let emittedAnswer = false;
      let parsingFailed = false;

      const emit = (event: AssistantStreamEvent) => {
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

          if (step !== "tool_return") continue;
          const additional = isRecord(message.additional_kwargs)
            ? message.additional_kwargs
            : undefined;
          const rawExtra = additional?.extra_json;
          const parsedExtra = parseExtraJson(rawExtra);
          if (!parsedExtra) {
            if (typeof rawExtra === "string") parsingFailed = true;
            continue;
          }

          if (!Array.isArray(parsedExtra.docs)) continue;
          for (const doc of parsedExtra.docs) {
            const source = normalizeSource(doc);
            if (source && !sources.has(source.id)) {
              sources.set(source.id, source);
            }
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
          if (sources.size > 0) {
            emit({ type: "sources", items: [...sources.values()] });
          }
          emit({ type: "done" });
        }
      } catch {
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
        controller.close();
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}
