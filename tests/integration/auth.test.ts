import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  createInvitation,
  revokeInvitation,
  setUserActive,
} from "@/server/invitations";
import {
  adminDb,
  anonDb,
  createUser,
  PASSWORD,
  resetDb,
  signInAs,
  tokenFromLink,
} from "./helpers";

const ORIGIN = "http://localhost:3000";
let adminId: string;

async function invite(email: string, now?: Date) {
  const res = await createInvitation(adminDb(), {
    email,
    createdBy: adminId,
    ttlHours: 72,
    origin: ORIGIN,
    now,
  });
  if (!res.ok) throw new Error(res.message);
  return { ...res.data, token: tokenFromLink(res.data.link) };
}

beforeEach(async () => {
  await resetDb();
  adminId = await createUser("admin@test.local", "admin");
});

describe("invitation-only registration", () => {
  it("rejects public sign-up through the publishable key", async () => {
    const { data, error } = await anonDb().auth.signUp({
      email: "intruder@test.local",
      password: PASSWORD,
    });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it("accepts an invitation exactly once and creates a student", async () => {
    const { token, link } = await invite("Student@Test.local");
    expect(link.startsWith(`${ORIGIN}/invite/`)).toBe(true);

    const first = await acceptInvitation(adminDb(), { token, fullName: "Nguyễn Văn A", password: PASSWORD });
    expect(first.ok).toBe(true);

    const second = await acceptInvitation(adminDb(), { token, fullName: "Kẻ gian", password: PASSWORD });
    expect(second).toMatchObject({ ok: false, code: "INVITE_INVALID" });

    const db = await signInAs("student@test.local");
    const { data: me } = await db.from("profiles").select("role, full_name").single();
    expect(me).toEqual({ role: "student", full_name: "Nguyễn Văn A" });
  });

  it("rejects an expired invitation", async () => {
    const { token } = await invite("late@test.local", new Date(Date.now() - 73 * 3_600_000));
    const res = await acceptInvitation(adminDb(), { token, fullName: "Trễ", password: PASSWORD });
    expect(res).toMatchObject({ ok: false, code: "INVITE_INVALID" });
  });

  it("rejects a revoked invitation", async () => {
    const { token } = await invite("revoked@test.local");
    const { data: row } = await adminDb().from("invitations").select("id").single();
    expect((await revokeInvitation(adminDb(), row!.id)).ok).toBe(true);
    const res = await acceptInvitation(adminDb(), { token, fullName: "Bị thu hồi", password: PASSWORD });
    expect(res).toMatchObject({ ok: false, code: "INVITE_INVALID" });
  });

  it("re-inviting revokes the previous open link", async () => {
    const old = await invite("again@test.local");
    const fresh = await invite("again@test.local");
    expect(
      await acceptInvitation(adminDb(), { token: old.token, fullName: "Cũ", password: PASSWORD }),
    ).toMatchObject({ ok: false, code: "INVITE_INVALID" });
    expect(
      (await acceptInvitation(adminDb(), { token: fresh.token, fullName: "Mới", password: PASSWORD })).ok,
    ).toBe(true);
  });

  it("refuses to invite an email that already has an account", async () => {
    const res = await createInvitation(adminDb(), {
      email: "admin@test.local",
      createdBy: adminId,
      ttlHours: 72,
      origin: ORIGIN,
    });
    expect(res).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("rejects malformed tokens and weak passwords without side effects", async () => {
    expect(
      await acceptInvitation(adminDb(), { token: "x".repeat(43), fullName: "A", password: PASSWORD }),
    ).toMatchObject({ ok: false, code: "INVITE_INVALID" });
    const { token } = await invite("weak@test.local");
    expect(
      await acceptInvitation(adminDb(), { token, fullName: "A", password: "short" }),
    ).toMatchObject({ ok: false, code: "VALIDATION" });
    const { data } = await adminDb().from("profiles").select("id").eq("email", "weak@test.local");
    expect(data).toEqual([]);
  });
});

describe("row-level security", () => {
  let studentId: string;
  beforeEach(async () => {
    studentId = await createUser("student@test.local", "student");
    await invite("pending@test.local");
  });

  it("a student cannot grant themselves admin or reactivate themselves", async () => {
    const db = await signInAs("student@test.local");
    const { data: updated } = await db
      .from("profiles")
      .update({ role: "admin", is_active: true })
      .eq("id", studentId)
      .select();
    expect(updated ?? []).toEqual([]);

    const { data: row } = await adminDb().from("profiles").select("role").eq("id", studentId).single();
    expect(row!.role).toBe("student");

    const { error: rpcAbuse } = await db.from("profiles").insert({
      id: crypto.randomUUID(),
      email: "fake@test.local",
      full_name: "Fake",
      role: "admin",
    });
    expect(rpcAbuse).not.toBeNull();
  });

  it("a student sees only their own profile and no invitations", async () => {
    const db = await signInAs("student@test.local");
    const { data: profiles } = await db.from("profiles").select("id");
    expect(profiles).toEqual([{ id: studentId }]);
    const { data: invitations } = await db.from("invitations").select("id, token_hash");
    expect(invitations ?? []).toEqual([]);
    const { error } = await db.from("invitations").insert({
      email: "x@test.local",
      token_hash: "f".repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_by: studentId,
    });
    expect(error).not.toBeNull();
  });

  it("anonymous clients read nothing", async () => {
    const db = anonDb();
    const { data: profiles } = await db.from("profiles").select("id");
    const { data: invitations } = await db.from("invitations").select("id");
    expect(profiles ?? []).toEqual([]);
    expect(invitations ?? []).toEqual([]);
  });

  it("an admin reads all profiles and invitations", async () => {
    const db = await signInAs("admin@test.local");
    const { data: profiles } = await db.from("profiles").select("id");
    const { data: invitations } = await db.from("invitations").select("id");
    expect(profiles).toHaveLength(2);
    expect(invitations).toHaveLength(1);
  });
});

describe("deactivation", () => {
  it("blocks sign-in for a deactivated user and allows reactivation", async () => {
    const studentId = await createUser("student@test.local", "student");
    expect((await setUserActive(adminDb(), { actorId: adminId, userId: studentId, active: false })).ok).toBe(true);

    await expect(signInAs("student@test.local")).rejects.toThrow();
    const { data } = await adminDb().from("profiles").select("is_active").eq("id", studentId).single();
    expect(data!.is_active).toBe(false);

    expect((await setUserActive(adminDb(), { actorId: adminId, userId: studentId, active: true })).ok).toBe(true);
    await expect(signInAs("student@test.local")).resolves.toBeDefined();
  });

  it("an admin cannot deactivate themselves", async () => {
    const res = await setUserActive(adminDb(), { actorId: adminId, userId: adminId, active: false });
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
