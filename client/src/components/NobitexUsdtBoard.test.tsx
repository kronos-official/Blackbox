// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NobitexUsdtBoard, type NobitexUsdtMarket } from "./NobitexUsdtBoard";

const market: NobitexUsdtMarket = {
  source: "nobitex", market: "USDT/IRT", latestToman: 202_340, markToman: 202_220, bestBuyToman: 202_120, bestSellToman: 202_340,
  dayLowToman: 199_000, dayHighToman: 204_000, dayOpenToman: 200_000, dayChangePercent: 1.17, volumeUsdt: 183.5, volumeToman: 37_133_700,
  updatedAt: "2026-08-25T12:00:00.000Z", isStale: false, chartIsStale: false,
  chart: [
    { time: 1_700_000_000_000, openToman: 202_000, highToman: 202_300, lowToman: 201_900, closeToman: 202_100, volumeUsdt: 20 },
    { time: 1_700_003_600_000, openToman: 202_100, highToman: 202_500, lowToman: 202_000, closeToman: 202_340, volumeUsdt: 32 },
  ],
};

describe("NobitexUsdtBoard", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("labels the selected Iranian source and shows actual USDT/Toman market fields", () => {
    render(<NobitexUsdtBoard market={market} isLoading={false} isFetching={false} hasError={false} range="1d" onRangeChange={vi.fn()} onRefresh={vi.fn()} locale="fa" />);

    expect(screen.getByText("بازار ایران · نوبیتکس")).toBeTruthy();
    expect(screen.getAllByText("202,340 تومان")).toHaveLength(2);
    expect(screen.getByText("202,120 تومان")).toBeTruthy();
    expect(screen.getByText("منبع: Nobitex · USDT/IRT")).toBeTruthy();
  });

  it("passes a selected chart range to the real range handler", () => {
    const onRangeChange = vi.fn();
    render(<NobitexUsdtBoard market={market} isLoading={false} isFetching={false} hasError={false} range="1d" onRangeChange={onRangeChange} onRefresh={vi.fn()} locale="fa" />);
    fireEvent.click(screen.getByRole("button", { name: "۷ روز" }));
    expect(onRangeChange).toHaveBeenCalledWith("7d");
  });
});
