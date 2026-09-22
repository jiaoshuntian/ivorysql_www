import type { AssistantSource } from "./types";

export type AssistantStreamHandlers = {
  onToken(content: string): void;
  onSources(items: AssistantSource[]): void;
  onDone(): void;
  onError(error: { code: string; message: string }): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSource(value: unknown): AssistantSource | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string"
  ) {
    return undefined;
  }

  const source: AssistantSource = { id: value.id, title: value.title };
  if (typeof value.section === "string") source.section = value.section;
  if (typeof value.url === "string") source.url = value.url;
  return source;
}

function invalidStream(handlers: AssistantStreamHandlers) {
  handlers.onError({
    code: "INVALID_STREAM",
    message: "The assistant response could not be read.",
  });
}

export async function readAssistantStream(
  response: Response,
  handlers: AssistantStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok) {
    let error: unknown;
    try {
      error = await response.json();
    } catch {
      error = undefined;
    }

    handlers.onError(
      isRecord(error) &&
        typeof error.code === "string" &&
        typeof error.message === "string"
        ? { code: error.code, message: error.message }
        : { code: "HTTP_ERROR", message: "The assistant request failed." },
    );
    return;
  }

  if (signal?.aborted) return;
  if (!response.body) {
    invalidStream(handlers);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalEvent = false;
  let invalid = false;

  const abortReading = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abortReading, { once: true });

  const processFrame = (frame: string) => {
    const lines = frame.split(/\r?\n/);
    const event = lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    if (!event || !["token", "sources", "done", "error"].includes(event)) {
      return;
    }

    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      invalid = true;
      return;
    }
    if (!isRecord(payload)) {
      invalid = true;
      return;
    }

    if (event === "token") {
      if (typeof payload.content !== "string") {
        invalid = true;
        return;
      }
      handlers.onToken(payload.content);
      return;
    }

    if (event === "sources") {
      if (!Array.isArray(payload.items)) {
        invalid = true;
        return;
      }
      const sources = payload.items.map(parseSource);
      if (sources.some((source) => source === undefined)) {
        invalid = true;
        return;
      }
      handlers.onSources(sources.filter((source) => source !== undefined));
      return;
    }

    terminalEvent = true;
    if (event === "done") {
      handlers.onDone();
    } else if (
      typeof payload.code === "string" &&
      typeof payload.message === "string"
    ) {
      handlers.onError({ code: payload.code, message: payload.message });
    } else {
      invalid = true;
    }
  };

  const processBufferedFrames = () => {
    while (!invalid && !terminalEvent) {
      const delimiter = buffer.match(/\r?\n\r?\n/);
      if (!delimiter || delimiter.index === undefined) return;
      const frame = buffer.slice(0, delimiter.index);
      buffer = buffer.slice(delimiter.index + delimiter[0].length);
      processFrame(frame);
    }
  };

  try {
    while (!invalid && !terminalEvent) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      processBufferedFrames();
    }

    if (!invalid && !terminalEvent) {
      buffer += decoder.decode();
      processBufferedFrames();
      if (buffer.trim()) processFrame(buffer);
    }
  } catch {
    if (signal?.aborted) return;
    invalid = true;
  } finally {
    signal?.removeEventListener("abort", abortReading);
    reader.releaseLock();
  }

  if (signal?.aborted) return;
  if (invalid || !terminalEvent) invalidStream(handlers);
}
