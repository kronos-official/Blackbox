// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KronosTypingText } from "./KronosTypingText";

describe("KronosTypingText", () => {
  afterEach(() => vi.useRealTimers());

  it("reveals the supplied operational text over time while exposing its complete accessible label", () => {
    vi.useFakeTimers();
    render(<KronosTypingText text="پنل Kronos آماده است" characterDelay={20} />);

    expect(screen.getByLabelText("پنل Kronos آماده است").textContent).toBe("");
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByLabelText("پنل Kronos آماده است").textContent).toContain("پنل Kronos آماده است");
  });
});
