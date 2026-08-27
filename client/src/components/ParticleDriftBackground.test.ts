import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

describe("Mini App background", () => {
  it("keeps the Mini App backdrop free of particles while allowing the isolated Intro scene its own geometry", () => {
    expect(stylesheet).toContain(".kronos-shell {\n    position: relative;\n    isolation: isolate;\n    background: #050913;");
    expect(stylesheet).not.toContain("@keyframes kronos-particle-drift");
    expect(stylesheet).not.toContain("radial-gradient(circle at 8% 18%");
    expect(stylesheet).not.toContain(".kronos-intro__backdrop");
    expect(stylesheet).toContain(".kronos-intro__orbit");
    expect(stylesheet).toContain(".kronos-intro__grid");
  });
});
