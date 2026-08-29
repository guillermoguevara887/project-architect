import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("Dashboard links to Account with an icon and no database status", async () => {
  const dashboard = await source(
    "../../web/src/components/dashboard-screen.tsx",
  );

  assert.match(dashboard, /href="\/account"/);
  assert.match(dashboard, /<svg/);
  assert.doesNotMatch(dashboard, /health\/db/);
  assert.doesNotMatch(dashboard, /Database:\s*Connected/);
});

test("Account contains profile, security and the real database health request", async () => {
  const account = await source("../../web/src/components/account-screen.tsx");

  assert.match(account, /fetch\("\/api\/account"/);
  assert.match(account, /fetch\("\/api\/health\/db"/);
  assert.match(account, /Correo electrónico/);
  assert.match(account, /Miembro desde/);
  assert.match(account, /Editar nombre de usuario/);
  assert.match(account, /Cambiar contraseña/);
  assert.match(account, /Estado del sistema/);
});

test("Login and reset pages expose the complete recovery flow", async () => {
  const login = await source("../../web/src/components/login-screen.tsx");
  const forgot = await source(
    "../../web/src/components/forgot-password-screen.tsx",
  );
  const reset = await source(
    "../../web/src/components/reset-password-screen.tsx",
  );

  assert.match(login, /href="\/forgot-password"/);
  assert.match(login, /¿Olvidaste tu contraseña\?/);
  assert.match(forgot, /\/api\/auth\/forgot-password/);
  assert.match(reset, /searchParams\.get\("token"\)/);
  assert.match(reset, /\/api\/auth\/reset-password/);
});

test("account and recovery controls remain usable at a 390px viewport", async () => {
  const css = await source("../../web/src/app/globals.css");

  assert.match(css, /@media \(max-width: 36rem\)/);
  assert.match(css, /\.account-card/);
  assert.match(css, /\.account-facts > div/);
  assert.match(css, /grid-template-columns: 1fr/);
  assert.match(css, /\.account-form > button/);
});
