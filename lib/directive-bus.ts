"use client";
import { create } from "zustand";
import type {
  CenterDirective,
  PanelCard,
  ChatMessage,
  Directive,
} from "@/lib/types";

// Lightweight global event stream for chat + directives.
// Avoids prop drilling between composer, panel, and stage.

type TurnGroup = {
  turn_id: string;
  user: ChatMessage;
  assistant?: ChatMessage;
  cards: PanelCard[];
  status: "streaming" | "done" | "error";
};

interface BusState {
  latestCenter: CenterDirective | null;
  turns: TurnGroup[];
  setCenter: (d: CenterDirective | null) => void;
  startTurn: (turn_id: string, userText: string) => void;
  appendAssistantText: (turn_id: string, chunk: string) => void;
  finishTurn: (turn_id: string) => void;
  errorTurn: (turn_id: string, msg: string) => void;
  addCard: (card: PanelCard) => void;
  dispatch: (d: Directive) => void;
}

export const useBus = create<BusState>((set, get) => ({
  latestCenter: null,
  turns: [],
  setCenter: (d) => set({ latestCenter: d }),
  startTurn: (turn_id, userText) =>
    set((s) => ({
      turns: [
        ...s.turns,
        {
          turn_id,
          user: {
            id: turn_id + ":u",
            turn_id,
            role: "user",
            text: userText,
            created_at: new Date().toISOString(),
          },
          cards: [],
          status: "streaming",
        },
      ],
    })),
  appendAssistantText: (turn_id, chunk) =>
    set((s) => ({
      turns: s.turns.map((t) => {
        if (t.turn_id !== turn_id) return t;
        const prior = t.assistant?.text ?? "";
        return {
          ...t,
          assistant: {
            id: turn_id + ":a",
            turn_id,
            role: "assistant",
            text: prior + chunk,
            streaming: true,
            created_at: t.assistant?.created_at ?? new Date().toISOString(),
          },
        };
      }),
    })),
  finishTurn: (turn_id) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.turn_id === turn_id
          ? {
              ...t,
              status: "done",
              assistant: t.assistant
                ? { ...t.assistant, streaming: false }
                : t.assistant,
            }
          : t,
      ),
    })),
  errorTurn: (turn_id) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.turn_id === turn_id ? { ...t, status: "error" } : t,
      ),
    })),
  addCard: (card) =>
    set((s) => ({
      turns: s.turns.map((t) =>
        t.turn_id === card.turn_id ? { ...t, cards: [...t.cards, card] } : t,
      ),
    })),
  dispatch: (d) => {
    if (d.target === "center") {
      get().setCenter(d);
    } else {
      get().addCard(d);
    }
  },
}));
