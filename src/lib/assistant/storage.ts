import type { AssistantLocale, AssistantRole, AssistantSource } from "./types";

export type StoredChatMessage = {
  id: string;
  role: AssistantRole;
  content: string;
  sources?: AssistantSource[];
  status?: "complete" | "incomplete";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function verifiedUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "docs.ivorysql.org") {
      return url.toString();
    }
  } catch {
    // Invalid and untrusted URLs are stored as plain source labels only.
  }
  return undefined;
}

function parseSource(value: unknown): AssistantSource | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    (value.section !== undefined && typeof value.section !== "string")
  ) {
    return undefined;
  }

  const source: AssistantSource = { id: value.id, title: value.title };
  if (value.section) source.section = value.section;
  const url = verifiedUrl(value.url);
  if (url) source.url = url;
  return source;
}

function parseMessage(value: unknown): StoredChatMessage | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    (value.status !== undefined &&
      value.status !== "complete" &&
      value.status !== "incomplete") ||
    (value.sources !== undefined && !Array.isArray(value.sources))
  ) {
    return undefined;
  }

  const message: StoredChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
  };
  if (value.status) message.status = value.status;
  if (Array.isArray(value.sources)) {
    const sources = value.sources.map(parseSource);
    if (sources.some((source) => source === undefined)) return undefined;
    message.sources = sources.filter((source) => source !== undefined);
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
