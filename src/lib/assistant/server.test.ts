import { describe, expect, it, vi } from "vitest";

import { createAssistantHandler } from "./server";

const env = {
  DASHSCOPE_API_KEY: "test-key",
  BAILIAN_BASE_URL: "https://workspace.example.com",
  BAILIAN_AGENT_ID: "aid-test",
};

const validRequest = {
  locale: "zh",
  messages: [{ role: "user", content: "如何安装？", ignored: "drop me" }],
  ignored: "drop me too",
};

function request(
  body: unknown = validRequest,
  contentType = "application/json",
) {
  return new Request("https://www.ivorysql.org/api/assistant", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function bailianFrame(content: string): Uint8Array {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({
      output: {
        choices: [
          {
            message: {
              content,
              extra: { step: "generating" },
            },
          },
        ],
      },
    })}\n\n`,
  );
}

function successfulUpstream(content = "可以这样安装") {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bailianFrame(content));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("createAssistantHandler", () => {
  it("calls Bailian with secrets and only sanitized conversation fields", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(successfulUpstream());
    const handler = createAssistantHandler({
      env,
      fetch: fetchMock,
      logger: silentLogger(),
    });

    const response = await handler(request());
    await response.text();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://workspace.example.com/api/v2/apps/knowledge/chat",
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-key",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      input: {
        messages: [{ role: "user", content: "如何安装？" }],
      },
      parameters: {
        agent_options: { agent_id: "aid-test" },
      },
      stream: true,
    });
  });

  it("rejects methods other than POST", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const handler = createAssistantHandler({ env, fetch: fetchMock });

    const response = await handler(
      new Request("https://www.ivorysql.org/api/assistant"),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["non-JSON content", validRequest, "text/plain"],
    ["invalid JSON", "{broken", "application/json"],
    ["invalid history", { locale: "zh", messages: [] }, "application/json"],
    [
      "oversized history",
      {
        locale: "zh",
        messages: [{ role: "user", content: "x".repeat(33_000) }],
      },
      "application/json",
    ],
  ])("returns 400 for %s without calling upstream", async (_, body, type) => {
    const fetchMock = vi.fn<typeof fetch>();
    const handler = createAssistantHandler({ env, fetch: fetchMock });

    const response = await handler(request(body, type));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...env, DASHSCOPE_API_KEY: undefined },
    { ...env, BAILIAN_BASE_URL: undefined },
    { ...env, BAILIAN_AGENT_ID: undefined },
    { ...env, BAILIAN_BASE_URL: "http://insecure.example.com" },
  ])(
    "returns a generic 503 for incomplete or unsafe configuration",
    async (badEnv) => {
      const fetchMock = vi.fn<typeof fetch>();
      const handler = createAssistantHandler({ env: badEnv, fetch: fetchMock });

      const response = await handler(request());
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).not.toMatch(/DASHSCOPE|BAILIAN|test-key|aid-test/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([401, 500])("maps Bailian %i to a generic 502", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret upstream details", { status }));
    const handler = createAssistantHandler({
      env,
      fetch: fetchMock,
      logger: silentLogger(),
    });

    const response = await handler(request());
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain("secret upstream details");
  });

  it("sets safe streaming response headers", async () => {
    const handler = createAssistantHandler({
      env,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(successfulUpstream()),
      logger: silentLogger(),
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    await response.text();
  });

  it("returns 502 when Bailian supplies no response body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const handler = createAssistantHandler({
      env,
      fetch: fetchMock,
      logger: silentLogger(),
    });

    expect((await handler(request())).status).toBe(502);
  });

  it("returns a 504 when Bailian does not produce response headers in time", async () => {
    const fetchMock = vi.fn<typeof fetch>((_, init) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          {
            once: true,
          },
        );
      });
    });
    const handler = createAssistantHandler({
      env,
      fetch: fetchMock,
      logger: silentLogger(),
      timeoutMs: 5,
    });

    const response = await handler(request());

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({
      code: "TIMEOUT",
      message: "The assistant took too long to respond.",
    });
  });

  it("keeps partial output and emits a stream timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>((_, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bailianFrame("partial"));
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new Error("stalled")),
            { once: true },
          );
        },
      });
      return Promise.resolve(new Response(body));
    });
    const handler = createAssistantHandler({
      env,
      fetch: fetchMock,
      logger: silentLogger(),
      timeoutMs: 5,
    });

    const output = await (await handler(request())).text();

    expect(output).toContain('event: token\ndata: {"content":"partial"}');
    expect(output).toContain(
      'event: error\ndata: {"code":"TIMEOUT","message":"Response timed out."}',
    );
    expect(output).not.toContain("event: done");
  });
});
