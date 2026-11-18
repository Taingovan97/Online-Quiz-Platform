import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  invitationState,
  inviteExpiry,
} from "./token";

describe("invite tokens", () => {
  it("generates url-safe tokens with 32 bytes of entropy", () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateInviteToken()).not.toBe(t);
  });

  it("hashes deterministically to hex sha256, never returning the token", () => {
    const t = generateInviteToken();
    const h = hashInviteToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(t)).toBe(h);
    expect(h).not.toContain(t);
  });

  it("computes expiry from a TTL in hours", () => {
    const now = new Date("2026-11-18T00:00:00Z");
    expect(inviteExpiry(now, 72).toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  describe("invitationState", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const base = {
      expires_at: "2026-11-18T13:00:00Z",
      accepted_at: null,
      revoked_at: null,
    };

    it("is open before expiry", () => {
      expect(invitationState(base, now)).toBe("open");
    });
    it("is expired at or after expiry", () => {
      expect(invitationState({ ...base, expires_at: "2026-11-18T12:00:00Z" }, now)).toBe(
        "expired",
      );
    });
    it("reports accepted and revoked before expiry checks", () => {
      expect(invitationState({ ...base, accepted_at: "2026-11-18T11:00:00Z" }, now)).toBe(
        "accepted",
      );
      expect(
        invitationState(
          { ...base, expires_at: "2026-11-01T00:00:00Z", revoked_at: "2026-11-02T00:00:00Z" },
          now,
        ),
      ).toBe("revoked");
    });
  });
});
