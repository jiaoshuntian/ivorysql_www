"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Bot, MessageCircle, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { AssistantComposer } from "@/components/assistant/AssistantComposer";
import {
  AssistantMessage,
  type AssistantMessageLabels,
} from "@/components/assistant/AssistantMessage";
import { useAssistantChat } from "@/components/assistant/useAssistantChat";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AssistantLocale } from "@/lib/assistant/types";

export function AssistantWidget({ locale }: { locale: AssistantLocale }) {
  const t = useTranslations("Assistant");
  const [input, setInput] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const getErrorMessage = useCallback(
    (code: string) => {
      if (code === "RATE_LIMITED") return t("rateLimited");
      if (code === "TIMEOUT") return t("timeout");
      if (
        code === "INVALID_REQUEST" ||
        code === "BODY_TOO_LARGE" ||
        code === "CONTENT_TOO_LONG" ||
        code === "TOO_MANY_MESSAGES"
      ) {
        return t("invalidRequest");
      }
      return t("unavailable");
    },
    [t],
  );
  const { messages, isStreaming, send, stop, clear, retry } = useAssistantChat(
    locale,
    getErrorMessage,
  );

  useEffect(() => {
    const area = scrollAreaRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [messages]);

  const sendInput = () => {
    if (!input.trim() || isStreaming) return;
    send(input);
    setInput("");
  };
  const suggestions = [
    t("suggestions.install"),
    t("suggestions.oracle"),
    t("suggestions.upgrade"),
  ];
  const messageLabels: AssistantMessageLabels = {
    copyCode: t("copyCode"),
    copied: t("copied"),
    sources: t("sources"),
    unverified: t("unverified"),
    incomplete: t("incomplete"),
    retry: t("retry"),
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          aria-label={t("launcherLabel")}
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[90] h-12 rounded-full px-4 shadow-lg sm:right-6 sm:bottom-6"
          type="button"
        >
          <MessageCircle className="size-5" />
          <span className="hidden sm:inline">{t("launcherLabel")}</span>
        </Button>
      </DialogTrigger>

      <DialogContent aria-describedby="assistant-description">
        <div className="flex min-h-0 w-full flex-col">
          <header className="flex items-start gap-3 border-b p-4">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
              <Bot className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription id="assistant-description" className="mt-0.5">
                {t("description")}
              </DialogDescription>
            </div>
            <Button
              aria-label={t("clear")}
              disabled={messages.length === 0}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={clear}
            >
              <Trash2 />
            </Button>
            <DialogClose asChild>
              <Button
                aria-label={t("close")}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X />
              </Button>
            </DialogClose>
          </header>

          <div
            ref={scrollAreaRef}
            aria-live="polite"
            aria-relevant="additions text"
            className="min-h-0 flex-1 overflow-y-auto p-4"
            role="log"
          >
            {messages.length === 0 ? (
              <div className="flex min-h-full flex-col justify-center">
                <div className="mb-5">
                  <Bot className="text-primary mb-3 size-7" />
                  <p className="text-sm leading-relaxed">{t("description")}</p>
                  <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                    {t("disclaimer")}
                  </p>
                </div>
                <div className="space-y-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      className="hover:bg-accent focus-visible:ring-ring w-full rounded-md border px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-2"
                      type="button"
                      onClick={() => send(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <AssistantMessage
                    key={message.id}
                    labels={messageLabels}
                    message={message}
                    onRetry={
                      message.status === "incomplete" && !isStreaming
                        ? () => retry(message.id)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <p className="text-muted-foreground border-t px-3 pt-2 text-[11px] leading-relaxed">
            {t("disclaimer")}
          </p>
          <AssistantComposer
            disabled={false}
            isStreaming={isStreaming}
            placeholder={t("placeholder")}
            sendLabel={t("send")}
            stopLabel={t("stop")}
            value={input}
            onChange={setInput}
            onSend={sendInput}
            onStop={stop}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
