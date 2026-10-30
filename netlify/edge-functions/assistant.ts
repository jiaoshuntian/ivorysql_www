import type { Config } from "@netlify/edge-functions";

import { streamAssistantAtEdge } from "../../src/lib/assistant/edge-stream.ts";
import { createAssistantHandler } from "../../src/lib/assistant/server.ts";

export default function handler(request: Request): Response {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const handleAssistant = createAssistantHandler({
    env: {
      DASHSCOPE_API_KEY: Netlify.env.get("DASHSCOPE_API_KEY"),
      BAILIAN_BASE_URL: Netlify.env.get("BAILIAN_BASE_URL"),
      BAILIAN_AGENT_ID: Netlify.env.get("BAILIAN_AGENT_ID"),
    },
    // Leave time to send a timeout event before this site's observed 60s cutoff.
    timeoutMs: 58_000,
  });
  return streamAssistantAtEdge(request, handleAssistant);
}

export const config: Config = {
  path: "/api/assistant",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["domain", "ip"],
  },
};
