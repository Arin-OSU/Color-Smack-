"use client";
import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useBus } from "@/lib/directive-bus";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "What broke overnight?",
  "Show me the Med Center",
  "If IGS called a DR event now, what could we shed?",
];

export function BottomComposer({
  onSubmit,
}: {
  onSubmit: (text: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const turns = useBus((s) => s.turns);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  async function submit(override?: string) {
    const text = (override ?? value).trim();
    if (!text || streaming) return;
    setValue("");
    setStreaming(true);
    try {
      await onSubmit(text);
    } finally {
      setStreaming(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const showChips = turns.length === 0;

  return (
    <div className="bg-bg/80 backdrop-blur-sm border-t border-border pt-3 pb-4 px-6 shrink-0">
      <div className="max-w-3xl mx-auto flex flex-col gap-3">
        <div className="relative bg-bg-elev-1 border border-border rounded-lg focus-within:border-border-strong transition-colors">
          {streaming && (
            <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-t-lg">
              <div className="h-full bg-accent animate-pulse" />
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            placeholder='Ask anything. Try "what broke overnight"'
            rows={1}
            className="w-full bg-transparent p-3 pr-12 resize-none outline-none text-sm text-fg placeholder:text-fg-subtle"
            style={{ minHeight: 44, maxHeight: 160 }}
          />
          <button
            onClick={() => void submit()}
            disabled={!streaming && value.trim().length === 0}
            aria-label={streaming ? "Stop" : "Send"}
            className={cn(
              "absolute bottom-2 right-2 w-8 h-8 rounded-md flex items-center justify-center transition-colors",
              streaming
                ? "bg-bg-elev-2 text-fg hover:bg-bg-elev-2/70"
                : "bg-accent text-accent-fg hover:bg-accent/90 disabled:opacity-40 disabled:hover:bg-accent",
            )}
          >
            {streaming ? <Square size={14} /> : <ArrowUp size={16} />}
          </button>
        </div>
        {showChips && (
          <div className="flex gap-2 justify-center flex-wrap">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void submit(s)}
                className="text-xs text-fg-muted bg-bg-elev-1 border border-border rounded-full px-3 py-1.5 hover:border-border-strong hover:text-fg transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
