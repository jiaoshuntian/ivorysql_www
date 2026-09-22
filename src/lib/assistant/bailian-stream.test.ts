import { describe, expect, it } from "vitest";

import { encodeAssistantEvent, translateBailianStream } from "./bailian-stream";
import type { AssistantStreamEvent } from "./types";

const encoder = new TextEncoder();

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function generationFrame(content: string, step = "generating"): string {
  return frame({
    output: {
      choices: [
        {
          message: {
            type: "ai",
            content,
            extra: { step, step_change: "" },
          },
        },
      ],
    },
  });
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function readEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<AssistantStreamEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((part) => {
      const [eventLine, dataLine] = part.split("\n");
      return {
        type: eventLine.replace("event: ", ""),
        ...JSON.parse(dataLine.replace("data: ", "")),
      };
    });
}

describe("translateBailianStream", () => {
  it("survives JSON and UTF-8 chunk boundaries without leaking plans", async () => {
    const answer = generationFrame("IvorySQL 支持");
    const planning = generationFrame("internal plan", "planning");
    const bytes = encoder.encode(planning + answer);
    const supportBytes = encoder.encode("支");
    const supportStart = bytes.findIndex(
      (byte, index) =>
        byte === supportBytes[0] && bytes[index + 1] === supportBytes[1],
    );

    const events = await readEvents(
      translateBailianStream(
        streamFromChunks([
          bytes.slice(0, 17),
          bytes.slice(17, supportStart + 1),
          bytes.slice(supportStart + 1),
        ]),
      ),
    );

    expect(events).toEqual([
      { type: "token", content: "IvorySQL 支持" },
      { type: "done" },
    ]);
    expect(JSON.stringify(events)).not.toContain("internal plan");
  });

  it("preserves tokens and reports a timeout when the source fails", async () => {
    const abortController = new AbortController();
    let sent = false;
    const input = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode(generationFrame("partial")));
          return;
        }

        abortController.abort(new DOMException("Timed out", "TimeoutError"));
        controller.error(new Error("upstream stopped"));
      },
    });

    await expect(
      readEvents(
        translateBailianStream(input, { signal: abortController.signal }),
      ),
    ).resolves.toEqual([
      { type: "token", content: "partial" },
      { type: "error", code: "TIMEOUT", message: "Response timed out." },
    ]);
  });

  it.each(["object", "string"])(
    "normalizes, deduplicates, and filters citation URLs from %s metadata",
    async (format) => {
      const docs = [
        {
          file_id: "file-1",
          title: "Oracle compatibility",
          section_path: "Compatibility > Data types",
          url: "https://docs.ivorysql.org/en/ivorysql-doc/v5.6/data-types",
        },
        {
          file_id: "file-1",
          title: "Oracle compatibility",
          section_path: "Compatibility > Data types",
          url: "https://docs.ivorysql.org/en/ivorysql-doc/v5.6/data-types",
        },
        {
          file_id: "file-2",
          title: "Untrusted",
          url: "javascript:alert(1)",
        },
        {
          file_id: "file-3",
          title: "Other host",
          url: "https://example.com/document",
        },
      ];
      const extraJson =
        format === "string" ? JSON.stringify({ docs }) : { docs };
      const toolFrame = frame({
        output: {
          choices: [
            {
              message: {
                type: "tool",
                content: "",
                additional_kwargs: { extra_json: extraJson },
                extra: { step: "tool_return" },
              },
            },
          ],
        },
      });

      const events = await readEvents(
        translateBailianStream(
          streamFromChunks([
            encoder.encode(toolFrame + generationFrame("Answer")),
          ]),
        ),
      );

      expect(events).toEqual([
        { type: "token", content: "Answer" },
        {
          type: "sources",
          items: [
            {
              id: "file-1",
              title: "Oracle compatibility",
              section: "Compatibility > Data types",
              url: "https://docs.ivorysql.org/en/ivorysql-doc/v5.6/data-types",
            },
            { id: "file-2", title: "Untrusted" },
            { id: "file-3", title: "Other host" },
          ],
        },
        { type: "done" },
      ]);
    },
  );

  it("ignores malformed citation metadata without stopping the answer", async () => {
    const toolFrame = frame({
      output: {
        choices: [
          {
            message: {
              additional_kwargs: { extra_json: "{not-json" },
              extra: { step: "tool_return" },
            },
          },
        ],
      },
    });

    await expect(
      readEvents(
        translateBailianStream(
          streamFromChunks([
            encoder.encode(toolFrame + generationFrame("Still works")),
          ]),
        ),
      ),
    ).resolves.toEqual([
      { type: "token", content: "Still works" },
      { type: "done" },
    ]);
  });
});

describe("encodeAssistantEvent", () => {
  it("encodes a website SSE event", () => {
    expect(
      new TextDecoder().decode(encodeAssistantEvent({ type: "done" })),
    ).toBe("event: done\ndata: {}\n\n");
  });
});
