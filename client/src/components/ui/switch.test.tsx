// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch";

function ControlledSwitch() {
  const [checked, setChecked] = useState(false);
  return <Switch aria-label="قفل لینک" checked={checked} onCheckedChange={setChecked} />;
}

describe("Switch", () => {
  it("uses RTL direction and keeps its thumb within the track when the content control is enabled", () => {
    render(<ControlledSwitch />);
    const control = screen.getByRole("switch", { name: "قفل لینک" });
    const thumb = control.querySelector("[data-slot=switch-thumb]");

    expect(control.className).toContain("w-10");
    expect(control.getAttribute("dir")).toBe("rtl");
    expect(thumb?.className).toContain("data-[state=checked]:-translate-x-[18px]");
    fireEvent.click(control);
    expect(control.getAttribute("data-state")).toBe("checked");
  });
});
