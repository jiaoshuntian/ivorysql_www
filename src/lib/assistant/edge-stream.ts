type AssistantHandler = (request: Request) => Promise<Response>;

// Return headers before waiting for Bailian to satisfy the Edge header deadline.
export function streamAssistantAtEdge(
  request: Request,
  handler: AssistantHandler,
): Response {
  const abortController = new AbortController();
  const abort = () => abortController.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });

  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    clearInterval(heartbeat);
    request.signal.removeEventListener("abort", abort);
  };
  const encoder = new TextEncoder();
  const comment = encoder.encode(": keep-alive\n\n");
  const encodeError = (code: string, message: string) =>
    encoder.encode(
      `event: error\ndata: ${JSON.stringify({ code, message })}\n\n`,
    );
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(comment);
      heartbeat = setInterval(() => controller.enqueue(comment), 10_000);
      try {
        const response = await handler(
          new Request(request, { signal: abortController.signal }),
        );
        if (cancelled) {
          await response.body?.cancel();
          return;
        }
        if (!response.ok) {
          const error: unknown = await response.json();
          if (
            typeof error !== "object" ||
            error === null ||
            !("code" in error) ||
            typeof error.code !== "string" ||
            !("message" in error) ||
            typeof error.message !== "string"
          ) {
            throw new Error("Invalid assistant error response");
          }
          controller.enqueue(encodeError(error.code, error.message));
          return;
        }
        if (!response.body) throw new Error("Missing assistant stream");
        reader = response.body.getReader();
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!cancelled) controller.enqueue(value);
        }
      } catch {
        if (!cancelled) {
          controller.enqueue(
            encodeError(
              "UPSTREAM_ERROR",
              "The assistant stream could not be read.",
            ),
          );
        }
      } finally {
        cleanup();
        reader?.releaseLock();
        if (!cancelled) controller.close();
      }
    },
    async cancel(reason) {
      cancelled = true;
      cleanup();
      abortController.abort(reason);
      await reader?.cancel(reason);
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Assistant-Runtime": "edge",
    },
  });
}
