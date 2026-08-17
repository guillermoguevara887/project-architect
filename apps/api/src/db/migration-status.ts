import { createMigrationRuntime } from "./migration-cli.js";
import { getMigrationStatus } from "./migrations.js";

const { database, migrations } = await createMigrationRuntime();

try {
  const report = await getMigrationStatus(database, migrations);

  console.log(`Migration history: ${report.historyMode}`);

  for (const migration of report.migrations) {
    console.log(`${migration.id} ${migration.state}`);
  }

  if (report.historyMode === "legacy") {
    console.log("");
    console.log(
      "Review the recorded IDs, then run " +
        "`pnpm db:migrate:bootstrap -- --accept-existing` to attach checksums.",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
