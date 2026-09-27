import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";

export type AdminListedUser = Pick<
  typeof users.$inferSelect,
  "id" | "username" | "email" | "role"
>;

export interface AdminUserStore {
  listUsers(): Promise<AdminListedUser[]>;
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
};
