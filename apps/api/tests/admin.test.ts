import assert from "node:assert/strict";
import test from "node:test";
import { AccountConflictError } from "../src/account/repository.js";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createSessionCookie } from "../src/auth/session.js";
import type { AdminUserStore } from "../src/admin/repository.js";
import { createServer } from "../src/create-server.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

function fixture(role: AuthUser["role"] = "superadmin") {
  let user: AuthUser | null = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "admin",
    passwordHash: "private-password-hash",
    role,
    sessionVersion: 2,
    createdAt: new Date(),
  };
  let listCalls = 0;
  let createCalls = 0;
  let resetCalls = 0;
  let listError: Error | null = null;
  let resetError: Error | null = null;
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "member",
    email: null as string | null,
    role: "user" as const,
    passwordHash: "never-return-this-hash",
    sessionVersion: 7,
    createdAt: new Date(),
  };
  const authStore: AuthStore = {
    async findById(id) {
      if (user?.id === id) return { ...user };
      return row.id === id ? { ...row } : null;
    },
    async findByUsername(username) {
      if (user?.username === username) return { ...user };
      return row.username === username ? { ...row } : null;
    },
  };
  const createdUsers: Array<typeof row> = [];
  const adminUserStore: AdminUserStore = {
    async listUsers() {
      listCalls++;
      if (listError) throw listError;
      return [row, ...createdUsers];
    },
    async createUser(input) {
      createCalls++;
      if ([row, ...createdUsers].some((existing) => existing.username === input.username)) {
        throw new AccountConflictError("username");
      }
      if (input.email && [row, ...createdUsers].some((existing) => existing.email === input.email)) {
        throw new AccountConflictError("email");
      }
      const created = {
        id: `33333333-3333-4333-8333-${String(createCalls).padStart(12, "0")}`,
        username: input.username,
        email: input.email,
        role: "user" as const,
        passwordHash: input.passwordHash,
        sessionVersion: 1,
        createdAt: new Date(),
      };
      createdUsers.push(created);
      return created;
    },
    async resetPassword(userId, passwordHash) {
      resetCalls++;
      if (resetError) throw resetError;
      if (row.id === userId) {
        row.passwordHash = passwordHash;
        row.sessionVersion += 1;
        return true;
      }
      if (user?.id === userId) {
        user.passwordHash = passwordHash;
        user.sessionVersion += 1;
        return true;
      }
      return false;
    },
  };
  const server = createServer({}, { authStore, adminUserStore });
  const cookie = createSessionCookie(user.id, 2).split(";", 1)[0]!;
  return {
    server,
    cookie,
    setUser(value: AuthUser | null) { user = value; },
    setExistingEmail(value: string) { row.email = value; },
    get user() { return user!; },
    get createdUsers() { return createdUsers; },
    get row() { return row; },
    get resetCalls() { return resetCalls; },
    failReset(error: Error) { resetError = error; },
    get createCalls() { return createCalls; },
    failList(error: Error) { listError = error; },
    get listCalls() { return listCalls; },
  };
}

test("GET /admin/users lists only safe fields for a current superadmin session", async () => {
  const f = fixture();
  try {
    const response = await f.server.inject({
      method: "GET",
      url: "/admin/users",
      headers: { cookie: f.cookie },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), {
      users: [{
        id: "22222222-2222-4222-8222-222222222222",
        username: "member",
        email: null,
        role: "user",
      }],
    });
    assert.equal(f.listCalls, 1);
    assert.doesNotMatch(response.body, /passwordHash|sessionVersion|createdAt|never-return-this-hash/);
  } finally {
    await f.server.close();
  }
});

test("POST /admin/users creates a normal account with a scrypt hash and safe response", async () => {
  const f = fixture();
  const password = "new-user-password-123";
  try {
    const response = await f.server.inject({
      method: "POST",
      url: "/admin/users",
      headers: { cookie: f.cookie },
      payload: {
        username: "  new-member  ",
        email: "  NEW@Example.COM  ",
        password,
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), {
      user: {
        id: "33333333-3333-4333-8333-000000000001",
        username: "new-member",
        email: "new@example.com",
        role: "user",
      },
    });
    assert.equal(f.createCalls, 1);
    assert.equal(f.createdUsers[0]?.role, "user");
    assert.notEqual(f.createdUsers[0]?.passwordHash, password);
    assert.equal(await verifyPassword(password, f.createdUsers[0]!.passwordHash), true);
    assert.doesNotMatch(response.body, /password|Hash|sessionVersion|token|createdAt/i);

    const listing = await f.server.inject({
      method: "GET",
      url: "/admin/users",
      headers: { cookie: f.cookie },
    });
    assert.equal(listing.statusCode, 200);
    assert.equal(listing.json().users.length, 2);
    assert.deepEqual(listing.json().users[1], response.json().user);
  } finally {
    await f.server.close();
  }
});

test("POST /admin/users accepts a missing email using the nullable users column", async () => {
  const f = fixture();
  try {
    const response = await f.server.inject({
      method: "POST",
      url: "/admin/users",
      headers: { cookie: f.cookie },
      payload: { username: "no-email", password: "new-user-password-123" },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().user.email, null);
    assert.equal(f.createdUsers[0]?.email, null);
  } finally {
    await f.server.close();
  }
});

test("POST /admin/users rejects privilege fields without creating a superadmin", async () => {
  const f = fixture();
  try {
    for (const field of [{ role: "superadmin" }, { sessionVersion: 1 }, { id: "client-id" }]) {
      const response = await f.server.inject({
        method: "POST",
        url: "/admin/users",
        headers: { cookie: f.cookie },
        payload: { username: "new-member", password: "new-user-password-123", ...field },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, "VALIDATION_ERROR");
    }
    assert.equal(f.createCalls, 0);
  } finally {
    await f.server.close();
  }
});

test("POST /admin/users requires a current superadmin session", async () => {
  const f = fixture("user");
  const payload = { username: "new-member", password: "new-user-password-123" };
  const request = (cookie?: string) => ({
    method: "POST" as const,
    url: "/admin/users?role=superadmin",
    headers: cookie ? { cookie, "x-role": "superadmin" } : { "x-role": "superadmin" },
    payload,
  });
  try {
    const forbidden = await f.server.inject(request(f.cookie));
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), { error: "FORBIDDEN" });

    f.setUser({ ...f.user, role: "superadmin" });
    const tampered = f.cookie.slice(0, -1) + (f.cookie.endsWith("A") ? "B" : "A");
    for (const cookie of [undefined, tampered, createSessionCookie(f.user.id, 1).split(";", 1)[0]]) {
      const denied = await f.server.inject(request(cookie));
      assert.equal(denied.statusCode, 401);
      assert.deepEqual(denied.json(), { error: "UNAUTHORIZED" });
    }
    f.setUser({ ...f.user, sessionVersion: 3 });
    assert.equal((await f.server.inject(request(f.cookie))).statusCode, 401);
    assert.equal(f.createCalls, 0);
  } finally {
    await f.server.close();
  }
});

test("POST /admin/users reports username and email conflicts without database details", async () => {
  const f = fixture();
  f.setExistingEmail("taken@example.com");
  try {
    for (const [payload, expected] of [
      [{ username: " member ", password: "new-user-password-123" }, "USERNAME_IN_USE"],
      [{ username: "new-member", email: " TAKEN@example.com ", password: "new-user-password-123" }, "EMAIL_IN_USE"],
    ] as const) {
      const response = await f.server.inject({
        method: "POST",
        url: "/admin/users",
        headers: { cookie: f.cookie },
        payload,
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, expected);
      assert.equal(typeof response.json().message, "string");
      assert.doesNotMatch(response.body, /23505|users_(username|email)_unique|new-user-password/);
    }
    assert.equal(f.createdUsers.length, 0);
  } finally {
    await f.server.close();
  }
});

test("POST /admin/users validates username, email and password", async () => {
  const f = fixture();
  try {
    for (const payload of [
      { username: "  ", password: "new-user-password-123" },
      { username: "new-member", email: "not-an-email", password: "new-user-password-123" },
      { username: "new-member", password: "short" },
    ]) {
      const response = await f.server.inject({
        method: "POST",
        url: "/admin/users",
        headers: { cookie: f.cookie },
        payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, "VALIDATION_ERROR");
      assert.equal(typeof response.json().message, "string");
      assert.doesNotMatch(response.body, /new-user-password-123|passwordHash|scrypt\$/);
    }
    assert.equal(f.createCalls, 0);
  } finally {
    await f.server.close();
  }
});

test("GET /admin/users rejects a normal user even when client fields claim superadmin", async () => {
  const f = fixture("user");
  try {
    const response = await f.server.inject({
      method: "GET",
      url: "/admin/users?role=superadmin",
      headers: { cookie: f.cookie, role: "superadmin", "x-role": "superadmin" },
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "FORBIDDEN" });
    assert.equal(f.listCalls, 0);
  } finally {
    await f.server.close();
  }
});

test("GET /admin/users rejects missing, tampered, stale and deleted-user sessions", async () => {
  const f = fixture();
  try {
    const tampered = f.cookie.slice(0, -1) + (f.cookie.endsWith("A") ? "B" : "A");
    for (const cookie of [undefined, tampered, createSessionCookie(f.user.id, 1).split(";", 1)[0]]) {
      const response = await f.server.inject({
        method: "GET",
        url: "/admin/users",
        headers: cookie ? { cookie } : {},
      });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: "UNAUTHORIZED" });
    }
    f.setUser({ ...f.user, sessionVersion: 3 });
    assert.equal((await f.server.inject({ method: "GET", url: "/admin/users", headers: { cookie: f.cookie } })).statusCode, 401);
    f.setUser(null);
    assert.equal((await f.server.inject({ method: "GET", url: "/admin/users", headers: { cookie: f.cookie } })).statusCode, 401);
    assert.equal(f.listCalls, 0);
  } finally {
    await f.server.close();
  }
});

test("GET /admin/users keeps storage failures private", async () => {
  const f = fixture();
  f.failList(new Error("private database connection details"));
  try {
    const response = await f.server.inject({
      method: "GET",
      url: "/admin/users",
      headers: { cookie: f.cookie },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "ADMIN_UNAVAILABLE" });
    assert.doesNotMatch(response.body, /private database connection details/);
  } finally {
    await f.server.close();
  }
});

const resetUrl = "/admin/users/22222222-2222-4222-8222-222222222222/reset-password";

test("POST admin reset changes only the target password and revokes its existing cookie", async () => {
  const f = fixture();
  const oldPassword = "previous-password-123";
  const newPassword = "replacement-password-123";
  f.row.passwordHash = await hashPassword(oldPassword);
  const before = { ...f.row };
  const targetCookie = createSessionCookie(f.row.id, f.row.sessionVersion).split(";", 1)[0]!;
  try {
    const priorSession = await f.server.inject({
      method: "GET", url: "/auth/session", headers: { cookie: targetCookie },
    });
    assert.equal(priorSession.statusCode, 200);

    const response = await f.server.inject({
      method: "POST", url: resetUrl, headers: { cookie: f.cookie },
      payload: { newPassword },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(response.json(), { success: true });
    assert.equal(response.headers["set-cookie"], undefined);
    assert.doesNotMatch(response.body, /password|hash|token|sessionVersion|secret|scrypt/i);
    assert.equal(f.resetCalls, 1);
    assert.notEqual(f.row.passwordHash, before.passwordHash);
    assert.notEqual(f.row.passwordHash, newPassword);
    assert.equal(await verifyPassword(newPassword, f.row.passwordHash), true);
    assert.equal(await verifyPassword(oldPassword, f.row.passwordHash), false);
    assert.equal(f.row.sessionVersion, before.sessionVersion + 1);
    assert.deepEqual({ ...f.row, passwordHash: before.passwordHash, sessionVersion: before.sessionVersion }, before);

    const staleSession = await f.server.inject({
      method: "GET", url: "/auth/session", headers: { cookie: targetCookie },
    });
    assert.equal(staleSession.statusCode, 401);
    assert.deepEqual(staleSession.json(), { authenticated: false });

    const oldLogin = await f.server.inject({
      method: "POST", url: "/auth/login",
      payload: { username: f.row.username, password: oldPassword },
    });
    assert.equal(oldLogin.statusCode, 401);
    const newLogin = await f.server.inject({
      method: "POST", url: "/auth/login",
      payload: { username: f.row.username, password: newPassword },
    });
    assert.equal(newLogin.statusCode, 200);
    const newCookie = String(newLogin.headers["set-cookie"]).split(";", 1)[0]!;
    assert.equal((await f.server.inject({
      method: "GET", url: "/auth/session", headers: { cookie: newCookie },
    })).statusCode, 200);
  } finally {
    await f.server.close();
  }
});

test("POST admin reset uses the persisted actor role and current signed session", async () => {
  const f = fixture("user");
  const request = (cookie?: string) => f.server.inject({
    method: "POST", url: `${resetUrl}?role=superadmin`,
    headers: cookie ? { cookie, "x-role": "superadmin" } : { "x-role": "superadmin" },
    payload: { newPassword: "replacement-password-123" },
  });
  try {
    assert.equal((await request(f.cookie)).statusCode, 403);
    f.setUser({ ...f.user, role: "superadmin" });
    const tampered = f.cookie.slice(0, -1) + (f.cookie.endsWith("A") ? "B" : "A");
    for (const cookie of [undefined, tampered, createSessionCookie(f.user.id, 1).split(";", 1)[0]]) {
      const response = await request(cookie);
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: "UNAUTHORIZED" });
    }
    f.setUser({ ...f.user, sessionVersion: 3 });
    assert.equal((await request(f.cookie)).statusCode, 401);
    assert.equal(f.resetCalls, 0);
  } finally {
    await f.server.close();
  }
});

test("POST admin reset rejects invalid input and extra account fields without mutation", async () => {
  const f = fixture();
  const before = { ...f.row };
  try {
    for (const payload of [
      { newPassword: "short" },
      { newPassword: "x".repeat(257) },
      { newPassword: "replacement-password-123", role: "superadmin" },
      { newPassword: "replacement-password-123", sessionVersion: 1 },
      { newPassword: "replacement-password-123", username: "changed" },
      { newPassword: "replacement-password-123", email: "changed@example.com" },
      { newPassword: "replacement-password-123", userId: f.user.id },
      {},
    ]) {
      const response = await f.server.inject({
        method: "POST", url: resetUrl, headers: { cookie: f.cookie }, payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, "VALIDATION_ERROR");
    }
    const invalidId = await f.server.inject({
      method: "POST", url: "/admin/users/not-a-uuid/reset-password",
      headers: { cookie: f.cookie }, payload: { newPassword: "replacement-password-123" },
    });
    assert.equal(invalidId.statusCode, 400);
    assert.equal(f.resetCalls, 0);
    assert.deepEqual(f.row, before);
  } finally {
    await f.server.close();
  }
});

test("POST admin reset returns a controlled 404 for a missing target and a private 503 on storage failure", async () => {
  const f = fixture();
  const password = "replacement-password-123";
  try {
    const missing = await f.server.inject({
      method: "POST", url: "/admin/users/33333333-3333-4333-8333-333333333333/reset-password",
      headers: { cookie: f.cookie }, payload: { newPassword: password },
    });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: "USER_NOT_FOUND", message: "El usuario no existe." });
    f.failReset(new Error("private database connection details"));
    const failed = await f.server.inject({
      method: "POST", url: resetUrl, headers: { cookie: f.cookie },
      payload: { newPassword: password },
    });
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.json().error, "ADMIN_UNAVAILABLE");
    assert.doesNotMatch(failed.body, /private database connection details|replacement-password-123|scrypt\$/);
  } finally {
    await f.server.close();
  }
});

test("POST admin reset permits a superadmin to reset themselves and invalidates their current cookie", async () => {
  const f = fixture();
  const newPassword = "new-admin-password-123";
  try {
    assert.equal((await f.server.inject({
      method: "GET", url: "/auth/session", headers: { cookie: f.cookie },
    })).statusCode, 200);
    const response = await f.server.inject({
      method: "POST", url: `/admin/users/${f.user.id}/reset-password`,
      headers: { cookie: f.cookie }, payload: { newPassword },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(f.user.sessionVersion, 3);
    assert.equal(await verifyPassword(newPassword, f.user.passwordHash), true);
    assert.equal((await f.server.inject({
      method: "GET", url: "/auth/session", headers: { cookie: f.cookie },
    })).statusCode, 401);
    assert.equal((await f.server.inject({
      method: "POST", url: resetUrl, headers: { cookie: f.cookie },
      payload: { newPassword },
    })).statusCode, 401);
  } finally {
    await f.server.close();
  }
});
