import { describe, expect, it } from "vitest";

import {
  getAssistantStorageKey,
  parseStoredConversation,
  serializeConversation,
} from "./storage";

describe("assistant conversation storage", () => {
  it("namespaces session data by locale", () => {
    expect(getAssistantStorageKey("en")).toBe("ivorysql-assistant:en");
    expect(getAssistantStorageKey("zh")).toBe("ivorysql-assistant:zh");
  });

  it.each([
    null,
    "{broken",
    JSON.stringify({ role: "user" }),
    JSON.stringify([{ id: "1", role: "system", content: "bad" }]),
    JSON.stringify([{ id: "1", role: "user", content: 7 }]),
    JSON.stringify([{ id: "1", role: "user", content: "ok", status: "busy" }]),
  ])("returns an empty conversation for corrupt data %#", (raw) => {
    expect(parseStoredConversation(raw)).toEqual([]);
  });

  it("keeps only the latest 20 valid messages", () => {
    const messages = Array.from({ length: 22 }, (_, index) => ({
      id: String(index),
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}`,
    }));

    const parsed = parseStoredConversation(JSON.stringify(messages));

    expect(parsed).toHaveLength(20);
    expect(parsed[0].id).toBe("2");
    expect(parsed.at(-1)?.id).toBe("21");
  });

  it("retains only verified IvorySQL documentation URLs", () => {
    const raw = JSON.stringify([
      {
        id: "answer-1",
        role: "assistant",
        content: "answer",
        status: "complete",
        sources: [
          {
            id: "doc-1",
            title: "Install",
            url: "https://docs.ivorysql.org/en/install",
          },
          { id: "doc-2", title: "Bad", url: "javascript:alert(1)" },
          {
            id: "doc-3",
            title: "Other",
            url: "https://example.com/doc",
          },
        ],
      },
    ]);

    expect(parseStoredConversation(raw)).toEqual([
      {
        id: "answer-1",
        role: "assistant",
        content: "answer",
        status: "complete",
        sources: [
          {
            id: "doc-1",
            title: "Install",
            url: "https://docs.ivorysql.org/en/install",
          },
          { id: "doc-2", title: "Bad" },
          { id: "doc-3", title: "Other" },
        ],
      },
    ]);
  });

  it("serializes a bounded conversation", () => {
    const messages = Array.from({ length: 21 }, (_, index) => ({
      id: String(index),
      role: "user" as const,
      content: String(index),
    }));

    expect(
      parseStoredConversation(serializeConversation(messages)),
    ).toHaveLength(20);
  });
});
