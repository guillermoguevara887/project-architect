import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const shimDir = join(root, "node_modules", ".cache", "project-architect-pnpm-shim");
mkdirSync(shimDir, { recursive: true });

if (process.platform === "win32") {
  writeFileSync(
    join(shimDir, "pnpm.cmd"),
    "@echo off\r\ncorepack pnpm %*\r\n",
  );
} else {
  writeFileSync(join(shimDir, "pnpm"), "#!/usr/bin/env sh\nexec corepack pnpm \"$@\"\n", {
    mode: 0o755,
  });
}

const turboArgs = process.argv.slice(2);
const turboCommand = process.platform === "win32" ? "turbo.cmd" : "turbo";
const command =
  process.platform === "win32" ? `${turboCommand} ${turboArgs.join(" ")}` : turboCommand;

const child = spawn(command, process.platform === "win32" ? [] : turboArgs, {
  env: {
    ...process.env,
    PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
    TURBO_TELEMETRY_DISABLED: process.env.TURBO_TELEMETRY_DISABLED ?? "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});