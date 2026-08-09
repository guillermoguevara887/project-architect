import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";

export type AuthUser = {
  id: string;
  username: string;
  passwordHash: string;
};

export interface AuthStore {
  findById(userId: string): Promise<AuthUser | null>;
  findByUsername(username: string): Promise<AuthUser | null>;
}

type UserRow = typeof users.$inferSelect;

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
  };
}

export const authStore: AuthStore = {
  async findById(userId) {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ? toAuthUser(user) : null;
  },

  async findByUsername(username) {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    return user ? toAuthUser(user) : null;
  },
};
