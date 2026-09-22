import { translateBailianStream } from "./bailian-stream";
import type { AssistantStreamEvent } from "./types";
import { validateAssistantRequest } from "./validation";

export type AssistantEnvKey =
  "DASHSCOPE_API_KEY" | "BAILIAN_BASE_URL" | "BAILIAN_AGENT_ID";

export type AssistantServerDependencies = {
  fetch?: typeof globalThis.fetch;
  env?: Partial<Record<AssistantEnvKey, string>>;
  logger?: Pick<Console, "info" | "warn" | "error">;
  timeoutMs?: number;
};

type AssistantEnvironment = Record<AssistantEnvKey, string>;

const DEFAULT_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { code, message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

function readEnvironment(
  env: Partial<Record<AssistantEnvKey, string>>,
): AssistantEnvironment | undefined {
  const DASHSCOPE_API_KEY = env.DASHSCOPE_API_KEY?.trim();
  const BAILIAN_BASE_URL = env.BAILIAN_BASE_URL?.trim();
  const BAILIAN_AGENT_ID = env.BAILIAN_AGENT_ID?.trim();
  if (!DASHSCOPE_API_KEY || !BAILIAN_BASE_URL || !BAILIAN_AGENT_ID) {
    return undefined;
  }

  try {
    const baseUrl = new URL(BAILIAN_BASE_URL);
    if (baseUrl.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }

  return { DASHSCOPE_API_KEY, BAILIAN_BASE_URL, BAILIAN_AGENT_ID };
}

function timeoutError(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason;
  return (
    signal.aborted &&
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "TimeoutError"
  );
}

export function createAssistantHandler(
  dependencies: AssistantServerDependencies = {},
) {
  const fetchUpstream = dependencies.fetch ?? globalThis.fetch;
  const configuredEnv = dependencies.env ?? {
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    BAILIAN_BASE_URL: process.env.BAILIAN_BASE_URL,
    BAILIAN_AGENT_ID: process.env.BAILIAN_AGENT_ID,
  };
  const logger = dependencies.logger ?? console;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function handleAssistant(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();

    if (request.method !== "POST") {
      const response = jsonError(
        405,
        "METHOD_NOT_ALLOWED",
        "Only POST requests are supported.",
      );
      response.headers.set("Allow", "POST");
      return response;
    }

    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0];
    if (contentType?.trim().toLowerCase() !== "application/json") {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Content-Type must be application/json.",
      );
    }

    let bodyText: string;
    let rawBody: unknown;
    try {
      bodyText = await request.text();
      rawBody = JSON.parse(bodyText);
    } catch {
      return jsonError(
        400,
        "INVALID_REQUEST",
        "Request body must be valid JSON.",
      );
    }

    const validation = validateAssistantRequest(
      rawBody,
      encoder.encode(bodyText).byteLength,
    );
    if (!validation.ok) {
      return jsonError(400, validation.code, validation.message);
    }

    const environment = readEnvironment(configuredEnv);
    if (!environment) {
      logger.error("assistant_configuration_error", { requestId });
      return jsonError(
        503,
        "SERVICE_UNAVAILABLE",
        "The assistant is temporarily unavailable.",
      );
    }

    const abortController = new AbortController();
    const abortFromClient = () => abortController.abort(request.signal.reason);
    if (request.signal.aborted) {
      abortFromClient();
    } else {
      request.signal.addEventListener("abort", abortFromClient, { once: true });
    }

    const timeout = setTimeout(() => {
      abortController.abort(
        new DOMException("Assistant response timed out", "TimeoutError"),
      );
    }, timeoutMs);
    let finalized = false;
    let firstTokenMs: number | undefined;
    let citationCount = 0;

    const finalize = (outcome: string, upstreamStatus?: number) => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abortFromClient);
      logger.info("assistant_request", {
        requestId,
        outcome,
        upstreamStatus,
        durationMs: Date.now() - startedAt,
        firstTokenMs,
        citationCount,
      });
    };

    let upstream: Response;
    try {
      const endpoint = new URL(
        "/api/v2/apps/knowledge/chat",
        environment.BAILIAN_BASE_URL,
      );
      upstream = await fetchUpstream(endpoint.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${environment.DASHSCOPE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { messages: validation.value.messages },
          parameters: {
            agent_options: { agent_id: environment.BAILIAN_AGENT_ID },
          },
          stream: true,
        }),
        signal: abortController.signal,
      });
    } catch {
      if (timeoutError(abortController.signal)) {
        finalize("timeout");
        return jsonError(
          504,
          "TIMEOUT",
          "The assistant took too long to respond.",
        );
      }

      finalize(request.signal.aborted ? "client_aborted" : "upstream_error");
      return jsonError(
        502,
        "UPSTREAM_ERROR",
        "The assistant service could not be reached.",
      );
    }

    if (!upstream.ok) {
      finalize("upstream_error", upstream.status);
      logger.warn("assistant_upstream_error", {
        requestId,
        upstreamStatus: upstream.status,
      });
      return jsonError(
        502,
        "UPSTREAM_ERROR",
        "The assistant service returned an error.",
      );
    }

    if (!upstream.body) {
      finalize("empty_upstream_body", upstream.status);
      return jsonError(
        502,
        "UPSTREAM_ERROR",
        "The assistant service returned an empty response.",
      );
    }

    const observeEvent = (event: AssistantStreamEvent) => {
      if (event.type === "token" && firstTokenMs === undefined) {
        firstTokenMs = Date.now() - startedAt;
      } else if (event.type === "sources") {
        citationCount = event.items.length;
      } else if (event.type === "done") {
        finalize("completed", upstream.status);
      } else if (event.type === "error") {
        finalize(event.code.toLowerCase(), upstream.status);
      }
    };

    return new Response(
      translateBailianStream(upstream.body, {
        signal: abortController.signal,
        onEvent: observeEvent,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        },
      },
    );
  };
}
