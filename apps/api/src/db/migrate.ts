import { createMigrationRuntime } from "./migration-cli.js";
import { migratePending } from "./migrations.js";

const { database, migrations } = await createMigrationRuntime();

try {
  const applied = await migratePending(database, migrations);

  if (applied.length === 0) {
    console.log("No pending migrations.");
  } else {
    for (const id of applied) {
      console.log(`Applied migration ${id}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
