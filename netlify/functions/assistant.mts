import type { Config } from "@netlify/functions";

import { createAssistantHandler } from "../../src/lib/assistant/server";

export default createAssistantHandler();

export const config: Config = {
  path: "/api/assistant",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["domain", "ip"],
  },
};
