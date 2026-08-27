import React from "react";
import { cn } from "@/lib/utils";

type KronosLoaderProps = {
  className?: string;
  label?: string;
  size?: "sm" | "md" | "lg";
};

/** A lightweight circular progress mark shared across the Kronos interface. */
export function KronosLoader({ className, label = "Loading", size = "md" }: KronosLoaderProps) {
  return (
    <span className={cn("kronos-loader", `kronos-loader--${size}`, className)} role="status" aria-label={label}>
      <span className="kronos-loader__ring" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
