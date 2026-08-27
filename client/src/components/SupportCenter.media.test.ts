import { describe, expect, it } from "vitest";
import { getAttachmentPreviewKind } from "./SupportCenter";

describe("SupportCenter attachment media reader", () => {
  it("renders supported media types inside the Mini App", () => {
    expect(getAttachmentPreviewKind("image/jpeg")).toBe("image");
    expect(getAttachmentPreviewKind("video/mp4")).toBe("video");
    expect(getAttachmentPreviewKind("audio/mpeg")).toBe("audio");
    expect(getAttachmentPreviewKind("application/pdf")).toBe("pdf");
  });

  it("uses the safe internal fallback for unknown or missing types", () => {
    expect(getAttachmentPreviewKind("application/zip")).toBe("download");
    expect(getAttachmentPreviewKind(undefined)).toBe("download");
    expect(getAttachmentPreviewKind(null)).toBe("download");
  });
});
