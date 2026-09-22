"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readAssistantStream } from "@/lib/assistant/client-stream";
import {
  getAssistantStorageKey,
  parseStoredConversation,
  serializeConversation,
  type StoredChatMessage,
} from "@/lib/assistant/storage";
import type { AssistantLocale } from "@/lib/assistant/types";

type ErrorMessageResolver = (code: string) => string;

export function useAssistantChat(
  locale: AssistantLocale,
  getErrorMessage: ErrorMessageResolver,
) {
  const [messages, setMessages] = useState<StoredChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const messagesRef = useRef<StoredChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const activeAnswerRef = useRef<string | null>(null);

  const replaceMessages = useCallback((next: StoredChatMessage[]) => {
    const bounded = next.slice(-20);
    messagesRef.current = bounded;
    setMessages(bounded);
  }, []);

  const updateAnswer = useCallback(
    (id: string, update: (message: StoredChatMessage) => StoredChatMessage) => {
      replaceMessages(
        messagesRef.current.map((message) =>
          message.id === id ? update(message) : message,
        ),
      );
    },
    [replaceMessages],
  );

  useEffect(() => {
    abortRef.current?.abort();
    let restored: StoredChatMessage[] = [];
    try {
      restored = parseStoredConversation(
        sessionStorage.getItem(getAssistantStorageKey(locale)),
      );
    } catch {
      // Storage may be blocked; the assistant still works for this page view.
    }
    replaceMessages(restored);
    setIsHydrated(true);
  }, [locale, replaceMessages]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      sessionStorage.setItem(
        getAssistantStorageKey(locale),
        serializeConversation(messages),
      );
    } catch {
      // Quota and privacy-mode failures should not interrupt chat.
    }
  }, [isHydrated, locale, messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startRequest = useCallback(
    async (conversation: StoredChatMessage[]) => {
      const answerId = crypto.randomUUID();
      const answer: StoredChatMessage = {
        id: answerId,
        role: "assistant",
        content: "",
      };
      const visibleConversation = [...conversation, answer].slice(-20);
      replaceMessages(visibleConversation);

      const abortController = new AbortController();
      abortRef.current = abortController;
      activeAnswerRef.current = answerId;
      setIsStreaming(true);

      const providerMessages = conversation
        .filter(
          (message) => message.role === "user" || message.status === "complete",
        )
        .map(({ role, content }) => ({ role, content }))
        .slice(-20);

      try {
        const response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, messages: providerMessages }),
          signal: abortController.signal,
        });
        await readAssistantStream(
          response,
          {
            onToken(content) {
              updateAnswer(answerId, (message) => ({
                ...message,
                content: message.content + content,
              }));
            },
            onSources(sources) {
              updateAnswer(answerId, (message) => ({ ...message, sources }));
            },
            onDone() {
              updateAnswer(answerId, (message) => ({
                ...message,
                status: "complete",
              }));
            },
            onError(error) {
              updateAnswer(answerId, (message) => ({
                ...message,
                content: message.content || getErrorMessage(error.code),
                status: "incomplete",
              }));
            },
          },
          abortController.signal,
        );
      } catch {
        if (!abortController.signal.aborted) {
          updateAnswer(answerId, (message) => ({
            ...message,
            content: message.content || getErrorMessage("UPSTREAM_ERROR"),
            status: "incomplete",
          }));
        }
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = null;
          if (activeAnswerRef.current === answerId)
            activeAnswerRef.current = null;
          setIsStreaming(false);
        }
      }
    },
    [getErrorMessage, locale, replaceMessages, updateAnswer],
  );

  const send = useCallback(
    (rawQuestion: string) => {
      const content = rawQuestion.trim();
      if (!content || abortRef.current) return;
      const userMessage: StoredChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      void startRequest([...messagesRef.current, userMessage]);
    },
    [startRequest],
  );

  const stop = useCallback(() => {
    const answerId = activeAnswerRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    activeAnswerRef.current = null;
    setIsStreaming(false);
    if (answerId) {
      updateAnswer(answerId, (message) => ({
        ...message,
        status: "incomplete",
      }));
    }
  }, [updateAnswer]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    activeAnswerRef.current = null;
    setIsStreaming(false);
    replaceMessages([]);
  }, [replaceMessages]);

  const retry = useCallback(
    (answerId: string) => {
      if (abortRef.current) return;
      const index = messagesRef.current.findIndex(
        (message) => message.id === answerId,
      );
      const question = messagesRef.current[index - 1];
      if (index < 1 || question?.role !== "user") return;
      const conversation = messagesRef.current.slice(0, index);
      replaceMessages(conversation);
      void startRequest(conversation);
    },
    [replaceMessages, startRequest],
  );

  return { messages, isStreaming, send, stop, clear, retry };
}
