import { afterEach, describe, expect, it, vi } from "vitest";

import { readAssistantStream } from "./client-stream";
import { streamAssistantAtEdge } from "./edge-stream";

const request = () => new Request("https://example.test/api/assistant");

describe("streamAssistantAtEdge", () => {
  afterEach(() => vi.useRealTimers());

  it("returns immediately and keeps streaming while upstream headers take over 40 seconds", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const response = streamAssistantAtEdge(request(), () => pending);
    const onDone = vi.fn();
    const onError = vi.fn();
    const onToken = vi.fn();
    const reading = readAssistantStream(response, {
      onToken,
      onError,
      onDone,
      onSources: vi.fn(),
    });

    expect(response.headers.get("X-Assistant-Runtime")).toBe("edge");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    resolve(
      new Response(
        'event: token\ndata: {"content":"答案"}\n\nevent: done\ndata: {}\n\n',
      ),
    );
    await reading;
    expect(onToken).toHaveBeenCalledWith("答案");
    expect(onDone).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { status: 400, code: "INVALID_REQUEST" },
    { status: 503, code: "SERVICE_UNAVAILABLE" },
    { status: 504, code: "TIMEOUT" },
  ])(
    "preserves a deferred $status error in SSE",
    async ({ status, code }) => {
      const error = { code, message: "The assistant request failed." };
      const response = streamAssistantAtEdge(request(), async () =>
        Response.json(error, { status }),
      );
      const onError = vi.fn();
      await readAssistantStream(response, {
        onToken: vi.fn(),
        onSources: vi.fn(),
        onDone: vi.fn(),
        onError,
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    },
  );

  it("aborts a pending upstream request when the visitor cancels", async () => {
    vi.useFakeTimers();
    let upstreamSignal: AbortSignal | undefined;
    const response = streamAssistantAtEdge(request(), (forwarded) => {
      upstreamSignal = forwarded.signal;
      return new Promise((_, reject) =>
        forwarded.signal.addEventListener(
          "abort",
          () => reject(new Error("cancelled")),
          { once: true },
        ),
      );
    });
    await response.body!.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
