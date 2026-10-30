"use client";

import { isValidElement, type ReactNode, useState } from "react";

import { Check, Copy, RotateCcw, TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import type { StoredChatMessage } from "@/lib/assistant/storage";

type AssistantMessageLabels = {
  copyCode: string;
  copied: string;
  incomplete: string;
  retry: string;
};

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return "";
}

function CodeBlock({
  children,
  labels,
}: {
  children: ReactNode;
  labels: AssistantMessageLabels;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        textFromNode(children).replace(/\n$/, ""),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by browser permissions.
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-md border bg-zinc-950 text-zinc-100">
      <Button
        aria-label={copied ? labels.copied : labels.copyCode}
        className="absolute top-2 right-2 opacity-80"
        size="icon-sm"
        type="button"
        variant="secondary"
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
      <pre className="overflow-x-auto p-4 pr-12 text-xs">{children}</pre>
    </div>
  );
}

export function AssistantMessage({
  message,
  labels,
  onRetry,
}: {
  message: StoredChatMessage;
  labels: AssistantMessageLabels;
  onRetry?(): void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <article className="space-y-3 text-sm">
      {message.content ? (
        <div className="prose prose-sm dark:prose-invert prose-a:text-primary prose-p:leading-relaxed max-w-none break-words">
          <ReactMarkdown
            components={{
              a: ({ children, ...props }) => (
                <a {...props} rel="noreferrer noopener" target="_blank">
                  {children}
                </a>
              ),
              pre: ({ children }) => (
                <CodeBlock labels={labels}>{children}</CodeBlock>
              ),
            }}
            remarkPlugins={[remarkGfm]}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      ) : (
        message.status === undefined && (
          <span className="text-muted-foreground animate-pulse">…</span>
        )
      )}

      {message.status === "incomplete" && (
        <div className="text-muted-foreground flex items-start justify-between gap-2 text-xs">
          <span className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {labels.incomplete}
          </span>
          {onRetry && (
            <Button size="sm" type="button" variant="ghost" onClick={onRetry}>
              <RotateCcw />
              {labels.retry}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export type { AssistantMessageLabels };
