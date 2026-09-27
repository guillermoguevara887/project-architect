import assert from "node:assert/strict";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
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
    email: null,
    role: "user" as const,
    passwordHash: "never-return-this-hash",
    sessionVersion: 7,
    createdAt: new Date(),
  };
  const adminUserStore: AdminUserStore = {
    async listUsers() {
      listCalls++;
      if (listError) throw listError;
      return [row];
    },
  };
  const server = createServer({}, { authStore, adminUserStore });
  const cookie = createSessionCookie(user.id, 2).split(";", 1)[0]!;
  return {
    server,
    cookie,
    setUser(value: AuthUser | null) { user = value; },
    get user() { return user!; },
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
