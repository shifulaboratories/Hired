"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

/**
 * What a save may answer instead of throwing: the record changed under the
 * editor since it was loaded — usually because an assistant wrote it — and the
 * save was refused rather than written over that.
 */
export type SaveConflict = { conflict: true };

function isConflict(result: unknown): result is SaveConflict {
  return Boolean(result && typeof result === "object" && (result as SaveConflict).conflict === true);
}

/**
 * Debounced autosave. Returns the current state plus a `push` you call with the
 * latest value on every keystroke. Guarantees a final save on unmount so nothing
 * is lost when you navigate away mid-sentence.
 *
 * Saves run one at a time, in order. Two in flight at once could land out of
 * order, and an editor that sends the version it last saw needs each save's
 * answer before it sends the next.
 *
 * A save that answers `{ conflict: true }` stops autosaving for good: state
 * goes to "conflict" and nothing more is sent, because every later keystroke
 * would be written over the same newer version. The editor says so and offers
 * a reload.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 700) {
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<T | null>(null);
  const running = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    const next = running.current.then(async () => {
      if (stopped.current || pendingValue.current === null) return;
      const value = pendingValue.current;
      pendingValue.current = null;
      setState("saving");
      try {
        const result = await saveRef.current(value);
        if (isConflict(result)) {
          stopped.current = true;
          setState("conflict");
          return;
        }
        setState(pendingValue.current === null ? "saved" : "dirty");
      } catch {
        setState("error");
      }
    });
    running.current = next;
    return next;
  }, []);

  const push = useCallback(
    (value: T) => {
      if (stopped.current) return;
      pendingValue.current = value;
      setState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pendingValue.current !== null) void flush();
    };
  }, [flush]);

  useEffect(() => {
    if (state !== "saved") return;
    const timeout = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timeout);
  }, [state]);

  return { state, push, flush };
}
