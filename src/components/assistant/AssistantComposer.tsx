"use client";

import type { KeyboardEvent } from "react";

import { Send, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type AssistantComposerProps = {
  value: string;
  disabled: boolean;
  isStreaming: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  onChange(value: string): void;
  onSend(): void;
  onStop(): void;
};

export function AssistantComposer({
  value,
  disabled,
  isStreaming,
  placeholder,
  sendLabel,
  stopLabel,
  onChange,
  onSend,
  onStop,
}: AssistantComposerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  return (
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <Textarea
          aria-label={placeholder}
          className="max-h-32 min-h-10 resize-none"
          disabled={disabled || isStreaming}
          maxLength={2000}
          placeholder={placeholder}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {isStreaming ? (
          <Button
            aria-label={stopLabel}
            size="icon"
            type="button"
            variant="outline"
            onClick={onStop}
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            aria-label={sendLabel}
            disabled={disabled || !value.trim()}
            size="icon"
            type="button"
            onClick={onSend}
          >
            <Send />
          </Button>
        )}
      </div>
    </div>
  );
}
