import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie, readSession } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

class MemoryAuthStore implements AuthStore {
  constructor(private readonly user: AuthUser) {}

  async findById(userId: string) {
    return userId === this.user.id ? this.user : null;
  }

  async findByUsername(username: string) {
    return username === this.user.username ? this.user : null;
  }
}

function cookieValue(setCookie: string | string[] | undefined) {
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(cookie);
  return cookie.split(";", 1)[0];
}

test("scrypt hashes and verifies passwords", async () => {
  const password = "a-secure-test-password";
  const passwordHash = await hashPassword(password);

  assert.match(passwordHash, /^scrypt\$/);
  assert.notEqual(passwordHash, password);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword("incorrect-password", passwordHash), false);
});

test("login, session verification and logout use an HTTP-only cookie", async () => {
  const user: AuthUser = {
    id: "af31bb93-55f4-4cf4-a8ad-23c6733c3b36",
    username: "architect",
    passwordHash: await hashPassword("correct-password"),
    role: "user",
    sessionVersion: 7,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
  };
  const server = createServer({}, { authStore: new MemoryAuthStore(user) });

  try {
    const invalidLogin = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: user.username,
        password: "incorrect-password",
      },
    });

    assert.equal(invalidLogin.statusCode, 401);
    assert.equal(invalidLogin.json().error, "INVALID_CREDENTIALS");

    const login = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: user.username,
        password: "correct-password",
      },
    });

    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.json(), {
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt.toISOString(),
      },
    });
    assert.equal("passwordHash" in login.json().user, false);

    const setCookie = login.headers["set-cookie"];
    const cookie = cookieValue(setCookie);
    assert.deepEqual(readSession(cookie), { userId: user.id, sessionVersion: 7 });
    const serializedCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.match(serializedCookie ?? "", /HttpOnly/);
    assert.match(serializedCookie ?? "", /SameSite=Lax/);

    const session = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });

    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt.toISOString(),
      },
    });
    assert.equal("passwordHash" in session.json().user, false);

    const logout = await server.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });

    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);

    const sessionAfterLogout = await server.inject({
      method: "GET",
      url: "/auth/session",
    });

    assert.equal(sessionAfterLogout.statusCode, 401);
    assert.equal(sessionAfterLogout.json().authenticated, false);
  } finally {
    await server.close();
  }
});

test("session rejects missing and tampered cookies", async () => {
  const user: AuthUser = {
    id: "8ac9bb20-229c-47f8-a038-ccab0a5f8d1f",
    username: "architect",
    passwordHash: await hashPassword("correct-password"),
    role: "user",
    sessionVersion: 1,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
  };
  const server = createServer({}, { authStore: new MemoryAuthStore(user) });

  try {
    const missing = await server.inject({
      method: "GET",
      url: "/auth/session",
    });
    const tampered = await server.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: "architect_session=tampered.value" },
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(tampered.statusCode, 401);
  } finally {
    await server.close();
  }
});

test("sessions reject stale, legacy, missing-version, invalid-version and expired signed cookies", async () => {
  const user: AuthUser = {
    id: "8ac9bb20-229c-47f8-a038-ccab0a5f8d1f",
    username: "architect",
    passwordHash: "unused",
    role: "user",
    sessionVersion: 3,
    createdAt: new Date(),
  };
  const server = createServer({}, { authStore: new MemoryAuthStore(user) });
  const valid = { version: 2, userId: user.id, sessionVersion: 3, expiresAt: Math.floor(Date.now() / 1000) + 60 };
  function signedCookie(payload: object) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", process.env.AUTH_COOKIE_SECRET!).update(encoded).digest("base64url");
    return `architect_session=${encoded}.${signature}`;
  }

  try {
    const currentCookie = cookieValue(createSessionCookie(user.id, user.sessionVersion));
    assert.equal((await server.inject({ method: "GET", url: "/auth/session", headers: { cookie: currentCookie } })).statusCode, 200);
    user.sessionVersion = 4;
    assert.equal((await server.inject({ method: "GET", url: "/auth/session", headers: { cookie: currentCookie } })).statusCode, 401);
    user.sessionVersion = 3;

    const invalid = [
      { ...valid, version: 1, sessionVersion: undefined },
      { ...valid, sessionVersion: undefined },
      { ...valid, sessionVersion: 0 },
      { ...valid, sessionVersion: -1 },
      { ...valid, sessionVersion: 1.5 },
      { ...valid, sessionVersion: "3" },
      { ...valid, sessionVersion: null },
      { ...valid, expiresAt: Math.floor(Date.now() / 1000) - 1 },
    ];
    for (const payload of invalid) {
      const response = await server.inject({ method: "GET", url: "/auth/session", headers: { cookie: signedCookie(payload) } });
      assert.equal(response.statusCode, 401, JSON.stringify(payload));
    }
    const tampered = signedCookie(valid).replace(
      Buffer.from(JSON.stringify(valid)).toString("base64url"),
      Buffer.from(JSON.stringify({ ...valid, sessionVersion: 4 })).toString("base64url"),
    );
    assert.equal((await server.inject({ method: "GET", url: "/auth/session", headers: { cookie: tampered } })).statusCode, 401);
    assert.throws(() => createSessionCookie(user.id, 0));
  } finally {
    await server.close();
  }
});

test("users migration is isolated and non-destructive", async () => {
  const migration = await readFile(
    new URL("../drizzle/0002_create_users.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "users"/);
  assert.match(migration, /CREATE UNIQUE INDEX "users_username_unique"/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|ALTER)\b/i);
  assert.doesNotMatch(migration, /\b(?:projects|discovery_)\b/i);
});
