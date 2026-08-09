import "dotenv/config";
import { getDb, closeDbConnection } from "../db/client.js";
import { users } from "../db/schema.js";
import { hashPassword } from "./password.js";

const username = process.env.ARCHITECT_USERNAME?.trim();
const password = process.env.ARCHITECT_PASSWORD;

if (!username || !password || password.length < 12) {
  throw new Error(
    "Set ARCHITECT_USERNAME and ARCHITECT_PASSWORD (at least 12 characters).",
  );
}

try {
  const passwordHash = await hashPassword(password);

  await getDb().insert(users).values({
    username,
    passwordHash,
  });

  console.log(`Usuario ${username} creado.`);
} finally {
  await closeDbConnection();
}
