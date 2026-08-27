import { describe, expect, it } from "vitest";
import { expectedStars, MAX_ACTIVE_FORCED_JOIN_CHANNELS, parseMarketplaceRequest, STARS_PER_DAY } from "./marketplace";

describe("channel marketplace parsing and pricing", () => {
  it("uses the fixed 10 Stars per day marketplace rate", () => {
    expect(STARS_PER_DAY).toBe(10);
    expect(MAX_ACTIVE_FORCED_JOIN_CHANNELS).toBe(3);
    expect(expectedStars(1)).toBe(10);
    expect(expectedStars(7)).toBe(70);
    expect(expectedStars(31)).toBe(310);
    expect(expectedStars(7, 17)).toBe(119);
  });

  it("parses only valid public channel, duration, and method requests", () => {
    expect(parseMarketplaceRequest("/channel @KronosChannel 7 stars")).toEqual({ channel: "@KronosChannel", days: 7, method: "telegram_stars" });
    expect(parseMarketplaceRequest("@KronosChannel ۳ card")).toEqual({ channel: "@KronosChannel", days: 3, method: "card_to_card" });
    expect(parseMarketplaceRequest("/channel not-a-channel 1 stars")).toBeUndefined();
    expect(parseMarketplaceRequest("/channel @KronosChannel 0 stars")).toBeUndefined();
  });
});
