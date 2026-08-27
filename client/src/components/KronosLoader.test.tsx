// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { KronosLoader } from "./KronosLoader";

describe("KronosLoader", () => {
  it("exposes a labelled loading status and renders the lightweight circular mark", () => {
    render(<KronosLoader size="sm" label="در حال همگام‌سازی تنظیمات" />);

    expect(screen.getByRole("status", { name: "در حال همگام‌سازی تنظیمات" })).not.toBeNull();
    expect(screen.getByRole("status").querySelector(".kronos-loader__ring")).not.toBeNull();
    expect(screen.getByRole("status").className).toContain("kronos-loader--sm");
  });
});
