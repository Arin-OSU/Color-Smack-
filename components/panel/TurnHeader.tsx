"use client";
import type { ChatMessage } from "@/lib/types";
import { stripEmDashes } from "@/lib/text";
import { cn } from "@/lib/utils";

export function TurnHeader({
  user,
  assistant,
}: {
  user: ChatMessage;
  assistant?: ChatMessage;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
          You
        </span>
        <span className="text-sm text-fg">{user.text}</span>
      </div>
      {assistant && (
        <div className="flex flex-col gap-1 mt-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
            Claude
          </span>
          <p
            className={cn(
              "text-sm text-fg leading-relaxed whitespace-pre-wrap",
              assistant.streaming && "caret-blink",
            )}
          >
            {stripEmDashes(assistant.text)}
          </p>
        </div>
      )}
    </div>
  );
}
