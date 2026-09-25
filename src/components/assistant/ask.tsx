"use client";

import { createContext, useContext } from "react";
import { toast } from "sonner";

/**
 * "Ask the assistant about this", from any screen.
 *
 * A button on a role — "mine this role", "log this week" — should put the
 * request in front of the built-in assistant with the drawer open, so it reads
 * as one move. The Shell owns the drawer, so it provides the function; a
 * component anywhere below asks for it.
 *
 * When no assistant is configured (the default, and the right state for anyone
 * who connects their own client), the same button copies the request instead,
 * ready to paste into Claude. The words are the same either way: this is a
 * shortcut to a conversation, never a feature of its own.
 */
export const AskContext = createContext<((message: string) => void) | null>(null);

export function useAsk() {
  const open = useContext(AskContext);
  return (message: string) => {
    if (open) {
      open(message);
      return;
    }
    void navigator.clipboard
      ?.writeText(message)
      .then(() => toast.success("Copied. Paste it into your assistant."))
      .catch(() => toast.message(message));
  };
}
