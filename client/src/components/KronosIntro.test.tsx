// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KronosIntro } from "./KronosIntro";

describe("KronosIntro", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the Persian Future motion system without a skip control", () => {
    render(<KronosIntro locale="fa" onComplete={vi.fn()} />);

    expect(document.querySelector(".kronos-intro__orbit--outer")).not.toBeNull();
    expect(document.querySelector(".kronos-intro__orbit--inner")).not.toBeNull();
    expect(document.querySelector(".kronos-intro__grid")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /ادامه بدون انیمیشن/i })).toBeNull();
  });

  it("shortens the intro schedule when reduced motion is requested", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const onComplete = vi.fn();
    render(<KronosIntro locale="fa" onComplete={onComplete} />);

    vi.advanceTimersByTime(239);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("completes once on the original schedule even when the parent re-renders", () => {
    vi.useFakeTimers();
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const { rerender } = render(
      <KronosIntro locale="en" onComplete={firstCallback} />,
    );

    rerender(<KronosIntro locale="en" onComplete={latestCallback} />);
    vi.advanceTimersByTime(4319);

    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).not.toHaveBeenCalled();
    expect(screen.getByText("Kronos").parentElement?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("Guard")).toBeTruthy();
    expect(document.querySelector(".kronos-intro__backdrop")).toBeNull();
    expect(document.querySelector(".kronos-intro__orbit--outer")).not.toBeNull();
    expect(document.querySelector(".kronos-intro__spark--one")).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(1);
  });
});
