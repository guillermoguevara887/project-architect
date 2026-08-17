import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = join(repositoryRoot, "apps", "api");
const tsxCli = join(apiDirectory, "node_modules", "tsx", "dist", "cli.mjs");
const suffix = randomBytes(4).toString("hex");
const containerName = `memoos-migration-test-${process.pid}-${suffix}`;
const databaseUser = "memoos_test";
const databasePassword = "memoos_test_password";
const adminDatabase = "memoos_migration_admin";
let containerStarted = false;
let exitCode = 1;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

function commandFailure(command, result) {
  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return new Error(`${command} failed.\n${details}`.trim());
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
  const start = run(dockerCommand, [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--env",
    `POSTGRES_USER=${databaseUser}`,
    "--env",
    `POSTGRES_PASSWORD=${databasePassword}`,
    "--env",
    `POSTGRES_DB=${adminDatabase}`,
    "--publish",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);

  if (start.status !== 0) {
    throw commandFailure("docker run", start);
  }

  containerStarted = true;
  let ready = false;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = run(dockerCommand, [
      "exec",
      containerName,
      "pg_isready",
      "--username",
      databaseUser,
      "--dbname",
      adminDatabase,
    ]);

    if (probe.status === 0) {
      ready = true;
      break;
    }

    await wait(1_000);
  }

  if (!ready) {
    throw new Error("Temporary PostgreSQL did not become ready within 60 seconds.");
  }

  const portResult = run(dockerCommand, [
    "port",
    containerName,
    "5432/tcp",
  ]);

  if (portResult.status !== 0) {
    throw commandFailure("docker port", portResult);
  }

  const portMatch = portResult.stdout.trim().match(/:(\d+)$/);

  if (!portMatch?.[1]) {
    throw new Error(`Could not read the temporary PostgreSQL port.`);
  }

  const databaseUrl =
    `postgresql://${databaseUser}:${databasePassword}` +
    `@127.0.0.1:${portMatch[1]}/${adminDatabase}`;
  const testResult = run(
    process.execPath,
    [tsxCli, "--test", "tests/integration/migrations.postgres.test.ts"],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        DATABASE_URL: "",
        MIGRATION_TEST_ALLOW_LOCAL: "1",
        MIGRATION_TEST_DATABASE_URL: databaseUrl,
      },
      stdio: "inherit",
    },
  );

  if (testResult.error) {
    throw testResult.error;
  }

  exitCode = testResult.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  if (containerStarted) {
    const cleanup = run(dockerCommand, [
      "rm",
      "--force",
      "--volumes",
      containerName,
    ]);

    if (cleanup.status !== 0) {
      console.error(commandFailure("docker cleanup", cleanup).message);
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
