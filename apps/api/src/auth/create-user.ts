import "dotenv/config";
import { getDb, closeDbConnection } from "../db/client.js";
import { users } from "../db/schema.js";
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  isValidNewPassword,
} from "./password.js";

const username = process.env.ARCHITECT_USERNAME?.trim();
const password = process.env.ARCHITECT_PASSWORD;

if (!username || !password || !isValidNewPassword(password)) {
  throw new Error(
    `Set ARCHITECT_USERNAME and ARCHITECT_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters).`,
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
