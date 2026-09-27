import assert from "node:assert/strict";
import test from "node:test";
import { AccountConflictError } from "../src/account/repository.js";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { verifyPassword } from "../src/auth/password.js";
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
  let listError: Error | null = null;
  const authStore: AuthStore = {
    async findById(id) {
      return user?.id === id ? { ...user } : null;
    },
    async findByUsername() {
      throw new Error("Listing must authenticate by cookie identity.");
    },
  };
  const row = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "member",
    email: null as string | null,
    role: "user" as const,
    passwordHash: "never-return-this-hash",
    sessionVersion: 7,
    createdAt: new Date(),
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
