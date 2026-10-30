import type { AssistantLocale, AssistantRole } from "./types";

export type StoredChatMessage = {
  id: string;
  role: AssistantRole;
  content: string;
  status?: "complete" | "incomplete";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(value: unknown): StoredChatMessage | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    (value.status !== undefined &&
      value.status !== "complete" &&
      value.status !== "incomplete")
  ) {
    return undefined;
  }

  const message: StoredChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
  };
  if (value.status) {
    message.status = value.status;
  } else if (value.role === "assistant") {
    message.status = "incomplete";
  }
  return message;
}

export function getAssistantStorageKey(locale: AssistantLocale): string {
  return `ivorysql-assistant:${locale}`;
}

export function parseStoredConversation(
  raw: string | null,
): StoredChatMessage[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const messages = parsed.map(parseMessage);
  if (messages.some((message) => message === undefined)) return [];
  return messages.filter((message) => message !== undefined).slice(-20);
}

export function serializeConversation(messages: StoredChatMessage[]): string {
  return JSON.stringify(messages.slice(-20));
}
