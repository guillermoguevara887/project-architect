import { createMigrationRuntime } from "./migration-cli.js";
import { bootstrapLegacyMigrationHistory } from "./migrations.js";

const confirmationArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");

if (
  confirmationArguments.length !== 1 ||
  confirmationArguments[0] !== "--accept-existing"
) {
  console.error(
    "Bootstrap requires explicit confirmation: " +
      "`pnpm db:migrate:bootstrap -- --accept-existing`.",
  );
  process.exitCode = 1;
} else {
  const { database, migrations } = await createMigrationRuntime();

  try {
    const accepted = await bootstrapLegacyMigrationHistory(
      database,
      migrations,
    );

    console.log(
      `Attached checksums to ${accepted.length} recorded migration(s).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
