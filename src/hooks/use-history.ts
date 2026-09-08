"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Undo and redo over snapshots of whatever you are editing.
 *
 * The editor already keeps its whole document in one piece of state and hands
 * that to autosave, so a snapshot is just that value: no patches, no inverse
 * operations, nothing to keep in sync with the twenty ways the document can
 * change. Records cost a reference, not a copy, because every mutation path in
 * the editor already builds a new object rather than mutating the old one.
 *
 * Changes closer together than `GAP_MS` fold into one step, so a sentence typed
 * into a bullet undoes as a sentence rather than forty times. The gap matches
 * the autosave debounce on purpose: one undo step is about one saved revision,
 * which is the mental model a person already has from watching the indicator.
 */

/** A pause this long ends the current step. Matches the autosave debounce. */
const GAP_MS = 700;

/** How far back you can go. Snapshots are cheap, but not free. */
const LIMIT = 80;

export function useHistory<T>(current: T, apply: (value: T) => void) {
  const latest = useRef(current);
  latest.current = current;
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const lastAt = useRef(0);
  // Depth is state so the toolbar buttons can disable themselves; the stacks
  // stay in refs so recording never costs a render.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const sync = () => setDepth({ past: past.current.length, future: future.current.length });

  /**
   * Take a snapshot of where things stand, BEFORE applying a change.
   *
   * Pass `step: true` for something discrete — a delete, a drag, a toggle — to
   * force a boundary even if it lands mid-sentence. Two deletes in quick
   * succession are two things a person did, not one.
   */
  const record = useCallback((options?: { step?: boolean }) => {
    const at = Date.now();
    const continuing = !options?.step && at - lastAt.current < GAP_MS;
    lastAt.current = options?.step ? 0 : at;
    if (continuing) return;
    past.current = [...past.current.slice(-(LIMIT - 1)), latest.current];
    future.current = [];
    sync();
  }, []);

  /** Go back to an exact snapshot — what a toast's Undo button restores. */
  const restore = useCallback(
    (snapshot: T) => {
      past.current = [...past.current.slice(-(LIMIT - 1)), latest.current];
      future.current = [];
      lastAt.current = 0;
      sync();
      apply(snapshot);
    },
    [apply],
  );

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous === undefined) return false;
    future.current = [...future.current, latest.current];
    lastAt.current = 0;
    sync();
    apply(previous);
    return true;
  }, [apply]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return false;
    past.current = [...past.current, latest.current];
    lastAt.current = 0;
    sync();
    apply(next);
    return true;
  }, [apply]);

  return {
    record,
    restore,
    undo,
    redo,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
  };
}
