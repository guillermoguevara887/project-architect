import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import {
  AccountConflictError,
  uniqueConstraint,
} from "../account/repository.js";

export type AdminListedUser = Pick<
  typeof users.$inferSelect,
  "id" | "username" | "email" | "role"
>;

export interface AdminUserStore {
  listUsers(): Promise<AdminListedUser[]>;
  createUser(input: {
    username: string;
    email: string | null;
    passwordHash: string;
  }): Promise<AdminListedUser>;
  resetPassword(userId: string, passwordHash: string): Promise<boolean>;
}

export const adminUserStore: AdminUserStore = {
  async listUsers() {
    return getDb()
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .orderBy(users.username, users.id);
  },
  async createUser({ username, email, passwordHash }) {
    try {
      const [created] = await getDb()
        .insert(users)
        .values({ username, email, passwordHash, role: "user" })
        .returning({
          id: users.id,
          username: users.username,
          email: users.email,
          role: users.role,
        });

      if (!created) {
        throw new Error("User creation returned no record.");
      }

      return created;
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
  async resetPassword(userId, passwordHash) {
    const [updated] = await getDb()
      .update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    return updated !== undefined;
  },
};
