import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { passwordResetTokens, users } from "../db/schema.js";
import type { AccountProfileUpdate } from "./contracts.js";

export type Account = {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
};

export type AccountConflictField = "username" | "email";

export class AccountConflictError extends Error {
  constructor(readonly field: AccountConflictField) {
    super(`The ${field} is already in use.`);
    this.name = "AccountConflictError";
  }
}

export interface AccountStore {
  findById(userId: string): Promise<Account | null>;
  findByEmail(email: string): Promise<Account | null>;
  updateProfile(
    userId: string,
    update: AccountProfileUpdate,
  ): Promise<Account | null>;
  updatePassword(
    userId: string,
    passwordHash: string,
    expectedSessionVersion: number,
  ): Promise<number | null>;
  createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  hasUsablePasswordResetToken(tokenHash: string, now: Date): Promise<boolean>;
  invalidatePasswordResetToken(tokenHash: string, usedAt: Date): Promise<void>;
  resetPasswordWithToken(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<boolean>;
}

type UserRow = typeof users.$inferSelect;

function toAccount(user: UserRow): Account {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    passwordHash: user.passwordHash,
    sessionVersion: user.sessionVersion,
    createdAt: user.createdAt,
  };
}

function uniqueConstraint(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as {
    code?: unknown;
    constraint_name?: unknown;
  };

  return candidate.code === "23505" &&
    typeof candidate.constraint_name === "string"
    ? candidate.constraint_name
    : null;
}

export const accountStore: AccountStore = {
  async findById(userId) {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ? toAccount(user) : null;
  },

  async findByEmail(email) {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return user ? toAccount(user) : null;
  },

  async updateProfile(userId, update) {
    try {
      const [user] = await getDb()
        .update(users)
        .set(update)
        .where(eq(users.id, userId))
        .returning();

      return user ? toAccount(user) : null;
    } catch (error) {
      const constraint = uniqueConstraint(error);

      if (constraint === "users_username_unique") {
        throw new AccountConflictError("username");
      }

      if (constraint === "users_email_unique") {
        throw new AccountConflictError("email");
      }

      throw error;
    }
  },

  async updatePassword(userId, passwordHash, expectedSessionVersion) {
    const [updated] = await getDb()
      .update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.id, userId), eq(users.sessionVersion, expectedSessionVersion)))
      .returning({ sessionVersion: users.sessionVersion });

    return updated?.sessionVersion ?? null;
  },

  async createPasswordResetToken(input) {
    await getDb().insert(passwordResetTokens).values(input);
  },

  async hasUsablePasswordResetToken(tokenHash, now) {
    const token = await getDb()
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);

    return token.length === 1;
  },

  async invalidatePasswordResetToken(tokenHash, usedAt) {
    await getDb()
      .update(passwordResetTokens)
      .set({ usedAt })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
        ),
      );
  },

  async resetPasswordWithToken(input) {
    return getDb().transaction(async (transaction) => {
      const [token] = await transaction
        .update(passwordResetTokens)
        .set({ usedAt: input.now })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, input.tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, input.now),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });

      if (!token) {
        return false;
      }

      const updated = await transaction
        .update(users)
        .set({
          passwordHash: input.passwordHash,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, token.userId))
        .returning({ id: users.id });

      if (updated.length !== 1) {
        throw new Error("The password reset user no longer exists.");
      }

      return true;
    });
  },
};
