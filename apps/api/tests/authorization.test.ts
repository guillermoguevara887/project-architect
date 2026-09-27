import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { requireSuperadmin } from "../src/auth/authorization.js";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

function signedCookie(payload: object) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_COOKIE_SECRET!)
    .update(encoded).digest("base64url");
  return `architect_session=${encoded}.${signature}`;
}

function fixture(role: AuthUser["role"] = "superadmin") {
  let persisted: AuthUser | null = {
    id: "11111111-1111-4111-8111-111111111111",
    username: "authorization-test",
    passwordHash: "must-not-be-exposed",
    sessionVersion: 3,
    role,
    createdAt: new Date(),
  };
  const id = persisted.id;
  let lookups = 0;
  let allowed = 0;
  let storeError: Error | null = null;
  const store: AuthStore = {
    async findById(userId) {
      lookups++;
      if (storeError) throw storeError;
      return persisted?.id === userId ? { ...persisted } : null;
    },
    async findByUsername() { throw new Error("Authorization must resolve by session identity."); },
  };
  const server = Fastify();
  // This route exists only in this isolated test server, never in createServer.
  server.post("/guard-test", { preHandler: requireSuperadmin(store) }, async () => {
    allowed++;
    return { success: true };
  });
  return {
    server, id,
    cookie: createSessionCookie(id, 3).split(";", 1)[0]!,
    setUser(user: AuthUser | null) { persisted = user; },
    failStore(error: Error) { storeError = error; },
    get user() { return persisted!; },
    get lookups() { return lookups; },
    get allowed() { return allowed; },
  };
}

test("requireSuperadmin rejects absent, tampered, expired, legacy, stale and missing-user sessions with 401", async () => {
  const f = fixture();
  const valid = { version: 2, userId: f.id, sessionVersion: 3, expiresAt: Math.floor(Date.now() / 1000) + 60 };
  const invalidCookies = [
    undefined,
    f.cookie.slice(0, -1) + (f.cookie.endsWith("A") ? "B" : "A"),
    signedCookie({ ...valid, expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    signedCookie({ ...valid, version: 1, sessionVersion: undefined }),
    signedCookie({ ...valid, sessionVersion: undefined }),
    createSessionCookie(f.id, 2).split(";", 1)[0],
    createSessionCookie("nonexistent-user", 3).split(";", 1)[0],
  ];
  try {
    for (const cookie of invalidCookies) {
      const response = await f.server.inject({ method: "POST", url: "/guard-test", headers: cookie ? { cookie } : {} });
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.json(), { error: "UNAUTHORIZED" });
      assert.equal(f.allowed, 0);
    }
    assert.equal(f.lookups, 2);
    f.setUser(null);
    assert.equal((await f.server.inject({ method: "POST", url: "/guard-test", headers: { cookie: f.cookie } })).statusCode, 401);
    assert.equal(f.allowed, 0);
  } finally {
    await f.server.close();
  }
});

test("requireSuperadmin ignores client roles and reads role changes on every authorization", async () => {
  const f = fixture("user");
  const cookie = signedCookie({
    version: 2, userId: f.id, sessionVersion: 3,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    role: "superadmin",
  });
  const request = {
    method: "POST" as const,
    url: "/guard-test?role=superadmin",
    headers: { cookie, role: "superadmin", "x-role": "superadmin" },
    payload: { role: "superadmin" },
  };
  try {
    const forbidden = await f.server.inject(request);
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), { error: "FORBIDDEN" });
    assert.equal(f.allowed, 0);

    f.setUser({ ...f.user, role: "superadmin" });
    const permitted = await f.server.inject(request);
    assert.equal(permitted.statusCode, 200);
    assert.deepEqual(permitted.json(), { success: true });

    f.setUser({ ...f.user, role: "user" });
    assert.equal((await f.server.inject(request)).statusCode, 403);
    assert.equal(f.lookups, 3);
    assert.equal(f.allowed, 1);
  } finally {
    await f.server.close();
  }
});

test("requireSuperadmin allows a current superadmin cookie and still rejects it after revocation", async () => {
  const f = fixture();
  const request = { method: "POST" as const, url: "/guard-test", headers: { cookie: f.cookie } };
  try {
    assert.equal((await f.server.inject(request)).statusCode, 200);
    f.setUser({ ...f.user, sessionVersion: 4 });
    assert.equal((await f.server.inject(request)).statusCode, 401);
    assert.equal(f.allowed, 1);
  } finally {
    await f.server.close();
  }
});

test("requireSuperadmin stops the protected handler on store failure and returns a generic 503", async () => {
  const f = fixture();
  const internalMessage = "PostgreSQL connection failed at private-db.internal:5432; sensitive query details";
  f.failStore(new Error(internalMessage));
  try {
    const response = await f.server.inject({
      method: "POST", url: "/guard-test", headers: { cookie: f.cookie },
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { authenticated: false, error: "AUTH_UNAVAILABLE" });
    assert.equal(response.body.includes(internalMessage), false);
    assert.equal(f.lookups, 1);
    assert.equal(f.allowed, 0);
  } finally {
    await f.server.close();
  }
});
