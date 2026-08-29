import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AccountProfileUpdate } from "../src/account/contracts.js";
import {
  PasswordResetEmailConfigurationError,
  type PasswordResetEmail,
  type PasswordResetMailer,
} from "../src/account/email.js";
import {
  AccountConflictError,
  type Account,
  type AccountStore,
} from "../src/account/repository.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import type { AuthStore } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

type StoredResetToken = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

class MemoryAccountStore implements AccountStore, AuthStore {
  readonly tokens: StoredResetToken[] = [];

  constructor(readonly users: Account[]) {}

  async findById(userId: string) {
    return this.users.find(({ id }) => id === userId) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((user) => user.username === username) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async updateProfile(userId: string, update: AccountProfileUpdate) {
    const user = await this.findById(userId);

    if (!user) {
      return null;
    }

    if (
      update.username &&
      this.users.some(
        (candidate) =>
          candidate.id !== userId && candidate.username === update.username,
      )
    ) {
      throw new AccountConflictError("username");
    }

    if (
      update.email &&
      this.users.some(
        (candidate) =>
          candidate.id !== userId && candidate.email === update.email,
      )
    ) {
      throw new AccountConflictError("email");
    }

    Object.assign(user, update);
    return user;
  }

  async updatePassword(userId: string, passwordHash: string) {
    const user = await this.findById(userId);

    if (!user) {
      return false;
    }

    user.passwordHash = passwordHash;
    return true;
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    this.tokens.push({ ...input, usedAt: null });
  }

  async hasUsablePasswordResetToken(tokenHash: string, now: Date) {
    return this.tokens.some(
      (token) =>
        token.tokenHash === tokenHash &&
        token.usedAt === null &&
        token.expiresAt > now,
    );
  }

  async invalidatePasswordResetToken(tokenHash: string, usedAt: Date) {
    const token = this.tokens.find(
      (candidate) =>
        candidate.tokenHash === tokenHash && candidate.usedAt === null,
    );

    if (token) {
      token.usedAt = usedAt;
    }
  }

  async resetPasswordWithToken(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }) {
    const token = this.tokens.find(
      (candidate) =>
        candidate.tokenHash === input.tokenHash &&
        candidate.usedAt === null &&
        candidate.expiresAt > input.now,
    );

    if (!token) {
      return false;
    }

    const user = await this.findById(token.userId);

    if (!user) {
      throw new Error("Reset token references a missing user.");
    }

    token.usedAt = input.now;
    user.passwordHash = input.passwordHash;
    return true;
  }
}

class MemoryMailer implements PasswordResetMailer {
  readonly messages: PasswordResetEmail[] = [];

  constructor(private readonly configured = true) {}

  assertConfigured() {
    if (!this.configured) {
      throw new PasswordResetEmailConfigurationError(["RESEND_API_KEY"]);
    }
  }

  async sendPasswordResetEmail(message: PasswordResetEmail) {
    this.messages.push(message);
  }
}

const userId = "91000000-0000-4000-8000-000000000001";
const secondUserId = "91000000-0000-4000-8000-000000000002";
const initialPassword = "initial-password-123";

async function createFixture() {
  const store = new MemoryAccountStore([
    {
      id: userId,
      username: "architect",
      email: "architect@example.com",
      passwordHash: await hashPassword(initialPassword),
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
    },
    {
      id: secondUserId,
      username: "existing",
      email: "existing@example.com",
      passwordHash: await hashPassword("another-password-123"),
      createdAt: new Date("2026-02-03T04:05:06.000Z"),
    },
  ]);
  const mailer = new MemoryMailer();
  const token = "fixed-reset-token-with-at-least-thirty-two-characters";
  const now = new Date("2026-08-29T12:00:00.000Z");
  const server = createServer(
    {},
    {
      authStore: store,
      accountStore: store,
      passwordResetMailer: mailer,
      accountNow: () => new Date(now),
      passwordResetTokenGenerator: () => token,
    },
  );
  const cookie = createSessionCookie(userId).split(";", 1)[0];

  return { cookie, mailer, now, server, store, token };
}

test("account profile requires a session and updates unique normalized fields", async () => {
  const fixture = await createFixture();

  try {
    const anonymous = await fixture.server.inject({
      method: "GET",
      url: "/account",
    });
    assert.equal(anonymous.statusCode, 401);

    const account = await fixture.server.inject({
      method: "GET",
      url: "/account",
      headers: { cookie: fixture.cookie },
    });
    assert.equal(account.statusCode, 200);
    assert.deepEqual(account.json().account, {
      id: userId,
      username: "architect",
      email: "architect@example.com",
      createdAt: "2026-01-02T03:04:05.000Z",
    });
    assert.equal("passwordHash" in account.json().account, false);

    const updateUsername = await fixture.server.inject({
      method: "PATCH",
      url: "/account/profile",
      headers: { cookie: fixture.cookie },
      payload: { username: "  memo-owner  " },
    });
    assert.equal(updateUsername.statusCode, 200);
    assert.equal(updateUsername.json().account.username, "memo-owner");

    const updateEmail = await fixture.server.inject({
      method: "PATCH",
      url: "/account/profile",
      headers: { cookie: fixture.cookie },
      payload: { email: "  OWNER@Example.COM  " },
    });
    assert.equal(updateEmail.statusCode, 200);
    assert.equal(updateEmail.json().account.email, "owner@example.com");

    const duplicateUsername = await fixture.server.inject({
      method: "PATCH",
      url: "/account/profile",
      headers: { cookie: fixture.cookie },
      payload: { username: "existing" },
    });
    assert.equal(duplicateUsername.statusCode, 409);
    assert.equal(duplicateUsername.json().error, "USERNAME_IN_USE");

    const duplicateEmail = await fixture.server.inject({
      method: "PATCH",
      url: "/account/profile",
      headers: { cookie: fixture.cookie },
      payload: { email: "EXISTING@example.com" },
    });
    assert.equal(duplicateEmail.statusCode, 409);
    assert.equal(duplicateEmail.json().error, "EMAIL_IN_USE");
  } finally {
    await fixture.server.close();
  }
});

test("authenticated password change verifies the current password", async () => {
  const fixture = await createFixture();
  const newPassword = "updated-password-456";

  try {
    const wrongCurrentPassword = await fixture.server.inject({
      method: "PATCH",
      url: "/account/password",
      headers: { cookie: fixture.cookie },
      payload: {
        currentPassword: "incorrect-password",
        newPassword,
        confirmPassword: newPassword,
      },
    });
    assert.equal(wrongCurrentPassword.statusCode, 400);
    assert.equal(
      wrongCurrentPassword.json().error,
      "CURRENT_PASSWORD_INCORRECT",
    );

    const mismatch = await fixture.server.inject({
      method: "PATCH",
      url: "/account/password",
      headers: { cookie: fixture.cookie },
      payload: {
        currentPassword: initialPassword,
        newPassword,
        confirmPassword: "different-password-789",
      },
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.json().message, "Las contraseñas no coinciden");

    const changed = await fixture.server.inject({
      method: "PATCH",
      url: "/account/password",
      headers: { cookie: fixture.cookie },
      payload: {
        currentPassword: initialPassword,
        newPassword,
        confirmPassword: newPassword,
      },
    });
    assert.equal(changed.statusCode, 200);

    const user = await fixture.store.findById(userId);
    assert.ok(user);
    assert.equal(await verifyPassword(initialPassword, user.passwordHash), false);
    assert.equal(await verifyPassword(newPassword, user.passwordHash), true);

    const oldLogin = await fixture.server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "architect", password: initialPassword },
    });
    const newLogin = await fixture.server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "architect", password: newPassword },
    });
    assert.equal(oldLogin.statusCode, 401);
    assert.equal(newLogin.statusCode, 200);
  } finally {
    await fixture.server.close();
  }
});

test("forgot password is non-enumerating and stores only a token hash", async () => {
  const fixture = await createFixture();

  try {
    const existing = await fixture.server.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "ARCHITECT@example.com" },
    });
    const missing = await fixture.server.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "missing@example.com" },
    });

    assert.equal(existing.statusCode, 202);
    assert.equal(missing.statusCode, 202);
    assert.equal(existing.json().message, missing.json().message);
    assert.deepEqual(fixture.mailer.messages, [
      { recipient: "architect@example.com", token: fixture.token },
    ]);
    assert.equal(fixture.store.tokens.length, 1);
    assert.equal(
      fixture.store.tokens[0]?.tokenHash,
      createHash("sha256").update(fixture.token).digest("hex"),
    );
    assert.notEqual(fixture.store.tokens[0]?.tokenHash, fixture.token);
    assert.equal(
      fixture.store.tokens[0]?.expiresAt.toISOString(),
      "2026-08-29T12:45:00.000Z",
    );
  } finally {
    await fixture.server.close();
  }
});

test("reset tokens expire, are one-use and replace the scrypt password hash", async () => {
  const fixture = await createFixture();
  const newPassword = "recovered-password-789";

  try {
    const invalid = await fixture.server.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: {
        token: "unknown-reset-token-with-at-least-thirty-two-characters",
        newPassword,
        confirmPassword: newPassword,
      },
    });
    assert.equal(invalid.statusCode, 400);

    const expiredRawToken =
      "expired-reset-token-with-at-least-thirty-two-characters";
    await fixture.store.createPasswordResetToken({
      userId,
      tokenHash: createHash("sha256").update(expiredRawToken).digest("hex"),
      expiresAt: new Date(fixture.now.getTime() - 1),
    });
    const expired = await fixture.server.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: {
        token: expiredRawToken,
        newPassword,
        confirmPassword: newPassword,
      },
    });
    assert.equal(expired.statusCode, 400);

    await fixture.server.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "architect@example.com" },
    });
    const reset = await fixture.server.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: {
        token: fixture.token,
        newPassword,
        confirmPassword: newPassword,
      },
    });
    assert.equal(reset.statusCode, 200);

    const reused = await fixture.server.inject({
      method: "POST",
      url: "/auth/reset-password",
      payload: {
        token: fixture.token,
        newPassword: "another-recovered-password-012",
        confirmPassword: "another-recovered-password-012",
      },
    });
    assert.equal(reused.statusCode, 400);

    const user = await fixture.store.findById(userId);
    assert.ok(user);
    assert.equal(await verifyPassword(initialPassword, user.passwordHash), false);
    assert.equal(await verifyPassword(newPassword, user.passwordHash), true);
    assert.ok(fixture.store.tokens.at(-1)?.usedAt);

    const login = await fixture.server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "architect", password: newPassword },
    });
    assert.equal(login.statusCode, 200);
  } finally {
    await fixture.server.close();
  }
});

test("forgot password reports an unavailable email provider without account lookup", async () => {
  const fixture = await createFixture();
  const server = createServer(
    {},
    {
      authStore: fixture.store,
      accountStore: fixture.store,
      passwordResetMailer: new MemoryMailer(false),
    },
  );

  try {
    const response = await server.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "architect@example.com" },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "PASSWORD_RESET_EMAIL_NOT_CONFIGURED");
    assert.equal(fixture.store.tokens.length, 0);
  } finally {
    await server.close();
    await fixture.server.close();
  }
});
