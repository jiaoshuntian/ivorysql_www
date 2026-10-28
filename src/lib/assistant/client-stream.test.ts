import { describe, expect, it, vi } from "vitest";

import { readAssistantStream } from "./client-stream";

const encoder = new TextEncoder();

function responseFromChunks(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}

function handlers() {
  return {
    onToken: vi.fn(),
    onSources: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
  };
}

describe("readAssistantStream", () => {
  it("reads ordered website events across arbitrary UTF-8 chunks", async () => {
    const streamText = [
      'event: token\ndata: {"content":"Hello "}\n\n',
      'event: token\ndata: {"content":"世界"}\n\n',
      'event: sources\ndata: {"items":[{"id":"1","title":"Install"}]}\n\n',
      "event: done\ndata: {}\n\n",
    ].join("");
    const bytes = encoder.encode(streamText);
    const world = encoder.encode("世");
    const worldStart = bytes.findIndex(
      (byte, index) => byte === world[0] && bytes[index + 1] === world[1],
    );
    const callbacks = handlers();
    const order: string[] = [];
    callbacks.onToken.mockImplementation((content) => order.push(content));
    callbacks.onSources.mockImplementation(() => order.push("sources"));
    callbacks.onDone.mockImplementation(() => order.push("done"));

    await readAssistantStream(
      responseFromChunks([
        bytes.slice(0, 13),
        bytes.slice(13, worldStart + 1),
        bytes.slice(worldStart + 1),
      ]),
      callbacks,
    );

    expect(callbacks.onToken.mock.calls).toEqual([["Hello "], ["世界"]]);
    expect(callbacks.onSources).toHaveBeenCalledWith([
      { id: "1", title: "Install" },
    ]);
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(order).toEqual(["Hello ", "世界", "sources", "done"]);
  });

  it("forwards website error events", async () => {
    const callbacks = handlers();
    const response = responseFromChunks([
      encoder.encode(
        'event: error\ndata: {"code":"TIMEOUT","message":"Too slow"}\n\n',
      ),
    ]);

    await readAssistantStream(response, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith({
      code: "TIMEOUT",
      message: "Too slow",
    });
  });

  it("reports malformed website event JSON", async () => {
    const callbacks = handlers();

    await readAssistantStream(
      responseFromChunks([encoder.encode("event: token\ndata: {broken\n\n")]),
      callbacks,
    );

    expect(callbacks.onError).toHaveBeenCalledWith({
      code: "INVALID_STREAM",
      message: "The assistant response could not be read.",
    });
  });

  it("maps non-OK JSON errors", async () => {
    const callbacks = handlers();

    await readAssistantStream(
      Response.json(
        { code: "RATE_LIMITED", message: "Try later" },
        { status: 429 },
      ),
      callbacks,
    );

    expect(callbacks.onError).toHaveBeenCalledWith({
      code: "RATE_LIMITED",
      message: "Try later",
    });
  });

  it("maps a platform-level 429 without relying on a JSON body", async () => {
    const callbacks = handlers();

    await readAssistantStream(
      new Response("rate limit exceeded", { status: 429 }),
      callbacks,
    );

    expect(callbacks.onError).toHaveBeenCalledWith({
      code: "RATE_LIMITED",
      message: "Too many assistant requests.",
    });
  });

  it("stops quietly when the caller aborts", async () => {
    const abortController = new AbortController();
    const callbacks = handlers();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          abortController.signal.addEventListener(
            "abort",
            () => controller.error(new DOMException("Stopped", "AbortError")),
            { once: true },
          );
        },
      }),
    );

    const reading = readAssistantStream(
      response,
      callbacks,
      abortController.signal,
    );
    abortController.abort();
    await reading;

    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
