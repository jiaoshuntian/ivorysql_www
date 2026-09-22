export const ASSISTANT_LOCALES = ["en", "zh"] as const;
export type AssistantLocale = (typeof ASSISTANT_LOCALES)[number];

export type AssistantRole = "user" | "assistant";

export type AssistantMessage = {
  role: AssistantRole;
  content: string;
};

export type AssistantRequest = {
  locale: AssistantLocale;
  messages: AssistantMessage[];
};

export type AssistantSource = {
  id: string;
  title: string;
  section?: string;
  url?: string;
};

export type AssistantStreamEvent =
  | { type: "token"; content: string }
  | { type: "sources"; items: AssistantSource[] }
  | { type: "done" }
  | {
      type: "error";
      code: "UPSTREAM_ERROR" | "TIMEOUT" | "INVALID_STREAM";
      message: string;
    };
