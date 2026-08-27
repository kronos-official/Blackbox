// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileMenuLayer } from "./MobileMenuLayer";

afterEach(cleanup);

describe("MobileMenuLayer", () => {
  it("renders the open sidebar above the backdrop and closes through the backdrop", () => {
    const onClose = vi.fn();
    render(
      <MobileMenuLayer open closeLabel="بستن منو" onClose={onClose}>
        <nav aria-label="منوی تست"><button>داشبورد</button></nav>
      </MobileMenuLayer>,
    );

    const openSidebar = screen.getByRole("complementary");
    expect(openSidebar.getAttribute("data-menu-open")).toBe("true");
    expect(openSidebar.classList.contains("kronos-sidebar--open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "بستن منو" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes through Escape in the actual rendered menu layer", () => {
    const onClose = vi.fn();
    render(<MobileMenuLayer open closeLabel="بستن منو" onClose={onClose}><span>محتوا</span></MobileMenuLayer>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the closed sidebar hidden and does not render a backdrop", () => {
    render(<MobileMenuLayer open={false} closeLabel="بستن منو" onClose={vi.fn()}><span>محتوا</span></MobileMenuLayer>);
    const closedSidebar = screen.getByRole("complementary", { hidden: true });
    expect(closedSidebar.getAttribute("data-menu-open")).toBe("false");
    expect(closedSidebar.classList.contains("kronos-sidebar--closed")).toBe(true);
    expect(screen.queryByRole("button", { name: "بستن منو" })).toBeNull();
  });
});
