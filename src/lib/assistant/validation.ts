import {
  type AssistantLocale,
  type AssistantMessage,
  type AssistantRequest,
} from "./types";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 2_000;

type ValidationErrorCode =
  | "BODY_TOO_LARGE"
  | "INVALID_REQUEST"
  | "INVALID_LOCALE"
  | "INVALID_MESSAGES"
  | "TOO_MANY_MESSAGES"
  | "INVALID_ROLE"
  | "EMPTY_CONTENT"
  | "CONTENT_TOO_LONG"
  | "FINAL_MESSAGE_NOT_USER";

export type ValidationResult =
  | { ok: true; value: AssistantRequest }
  | { ok: false; code: ValidationErrorCode; message: string };

function failure(
  code: ValidationErrorCode,
  message: string,
): ValidationResult {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssistantLocale(value: unknown): value is AssistantLocale {
  return value === "en" || value === "zh";
}

export function validateAssistantRequest(
  raw: unknown,
  bodyBytes: number,
): ValidationResult {
  if (bodyBytes > MAX_BODY_BYTES) {
    return failure("BODY_TOO_LARGE", "Request body exceeds 32 KiB.");
  }

  if (!isRecord(raw)) {
    return failure("INVALID_REQUEST", "Request body must be an object.");
  }

  const { locale, messages } = raw;
  if (!isAssistantLocale(locale)) {
    return failure("INVALID_LOCALE", "Locale must be en or zh.");
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return failure("INVALID_MESSAGES", "Messages must be a non-empty array.");
  }

  if (messages.length > MAX_MESSAGES) {
    return failure("TOO_MANY_MESSAGES", "At most 20 messages are allowed.");
  }

  const sanitizedMessages: AssistantMessage[] = [];
  for (const message of messages) {
    if (!isRecord(message)) {
      return failure("INVALID_MESSAGES", "Every message must be an object.");
    }

    if (message.role !== "user" && message.role !== "assistant") {
      return failure("INVALID_ROLE", "Message role must be user or assistant.");
    }

    if (typeof message.content !== "string") {
      return failure("INVALID_MESSAGES", "Message content must be a string.");
    }

    if (message.content.trim().length === 0) {
      return failure("EMPTY_CONTENT", "Message content cannot be empty.");
    }

    if (Array.from(message.content).length > MAX_CONTENT_LENGTH) {
      return failure(
        "CONTENT_TOO_LONG",
        "Message content cannot exceed 2,000 characters.",
      );
    }

    sanitizedMessages.push({
      role: message.role,
      content: message.content,
    });
  }

  if (sanitizedMessages.at(-1)?.role !== "user") {
    return failure(
      "FINAL_MESSAGE_NOT_USER",
      "The final message must come from the user.",
    );
  }

  return {
    ok: true,
    value: {
      locale,
      messages: sanitizedMessages,
    },
  };
}
