import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type KronosTypingTextProps = {
  text: string;
  className?: string;
  characterDelay?: number;
};

/** A quiet typing treatment for short operational messages on the Kronos entry gate. */
export function KronosTypingText({ text, className, characterDelay = 22 }: KronosTypingTextProps) {
  const [visibleLength, setVisibleLength] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReduceMotion(Boolean(query?.matches));
    syncPreference();
    query?.addEventListener?.("change", syncPreference);
    return () => query?.removeEventListener?.("change", syncPreference);
  }, []);

  useEffect(() => {
    setVisibleLength(reduceMotion ? text.length : 0);
    if (reduceMotion || !text) return;

    const timer = window.setInterval(() => {
      setVisibleLength(previous => {
        const next = Math.min(previous + 1, text.length);
        if (next === text.length) window.clearInterval(timer);
        return next;
      });
    }, characterDelay);
    return () => window.clearInterval(timer);
  }, [characterDelay, reduceMotion, text]);

  return (
    <span className={cn("kronos-typing", className)} aria-label={text}>
      <span aria-hidden="true">{text.slice(0, visibleLength)}</span>
      <span className="kronos-typing__cursor" aria-hidden="true" />
    </span>
  );
}
