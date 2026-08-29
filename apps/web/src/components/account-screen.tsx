"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

type Account = {
  id: string;
  username: string;
  email: string | null;
  createdAt: string;
};

type DatabaseState = "checking" | "connected" | "disconnected";
type FormFeedback = {
  message: string;
  tone: "error" | "success";
};

const accountDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

async function responseMessage(response: Response, fallback: string) {
  const result = (await response.json()) as {
    account?: Account;
    message?: string;
  };

  return {
    account: result.account,
    message: result.message ?? fallback,
  };
}

export function AccountScreen() {
  const router = useRouter();
  const sessionUser = useSessionGuard();
  const [account, setAccount] = useState<Account | null>(null);
  const [database, setDatabase] = useState<DatabaseState>("checking");
  const [pageError, setPageError] = useState<string | null>(null);
  const [usernameFeedback, setUsernameFeedback] =
    useState<FormFeedback | null>(null);
  const [emailFeedback, setEmailFeedback] =
    useState<FormFeedback | null>(null);
  const [passwordFeedback, setPasswordFeedback] =
    useState<FormFeedback | null>(null);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!sessionUser) {
      return;
    }

    let active = true;

    async function loadAccount() {
      try {
        const [accountResponse, databaseResponse] = await Promise.all([
          fetch("/api/account", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/health/db", {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        if (accountResponse.status === 401) {
          router.replace("/");
          return;
        }

        if (!accountResponse.ok) {
          throw new Error("Account unavailable.");
        }

        const accountResult = (await accountResponse.json()) as {
          account?: Account;
        };
        const databaseResult = databaseResponse.ok
          ? ((await databaseResponse.json()) as { database?: string })
          : null;

        if (active && accountResult.account) {
          setAccount(accountResult.account);
          setDatabase(
            databaseResult?.database === "connected"
              ? "connected"
              : "disconnected",
          );
        }
      } catch {
        if (active) {
          setPageError("No se pudo cargar la cuenta.");
          setDatabase("disconnected");
        }
      }
    }

    void loadAccount();

    return () => {
      active = false;
    };
  }, [router, sessionUser]);

  async function updateUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUsernameSaving(true);
    setUsernameFeedback(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username") }),
      });
      const result = await responseMessage(
        response,
        "No se pudo actualizar el nombre de usuario.",
      );

      if (!response.ok || !result.account) {
        setUsernameFeedback({ message: result.message, tone: "error" });
        return;
      }

      setAccount(result.account);
      setUsernameFeedback({
        message: "Nombre de usuario actualizado",
        tone: "success",
      });
      router.refresh();
    } catch {
      setUsernameFeedback({
        message: "No se pudo actualizar el nombre de usuario.",
        tone: "error",
      });
    } finally {
      setUsernameSaving(false);
    }
  }

  async function updateEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailSaving(true);
    setEmailFeedback(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = await responseMessage(
        response,
        "No se pudo actualizar el correo electrónico.",
      );

      if (!response.ok || !result.account) {
        setEmailFeedback({ message: result.message, tone: "error" });
        return;
      }

      setAccount(result.account);
      setEmailFeedback({
        message: "Correo electrónico actualizado",
        tone: "success",
      });
    } catch {
      setEmailFeedback({
        message: "No se pudo actualizar el correo electrónico.",
        tone: "error",
      });
    } finally {
      setEmailSaving(false);
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordSaving(true);
    setPasswordFeedback(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      const response = await fetch("/api/account/password", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
          confirmPassword: form.get("confirmPassword"),
        }),
      });
      const result = await responseMessage(
        response,
        "No se pudo actualizar la contraseña.",
      );

      setPasswordFeedback({
        message: result.message,
        tone: response.ok ? "success" : "error",
      });

      if (response.ok) {
        formElement.reset();
      }
    } catch {
      setPasswordFeedback({
        message: "No se pudo actualizar la contraseña.",
        tone: "error",
      });
    } finally {
      setPasswordSaving(false);
    }
  }

  async function logout() {
    setLoggingOut(true);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  if (!sessionUser || (!account && !pageError)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  if (!account) {
    return (
      <main className="flow-shell">
        <section className="account-card">
          <p className="brand">MemoOS</p>
          <p className="form-error" role="alert">{pageError}</p>
          <Link className="primary-link" href="/dashboard">
            Volver al Dashboard
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flow-shell account-shell">
      <section className="account-card" aria-labelledby="account-title">
        <p className="brand">MemoOS</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>
        <h1 id="account-title">Cuenta</h1>

        <section className="account-section" aria-labelledby="profile-title">
          <h2 id="profile-title">Perfil</h2>
          <dl className="account-facts">
            <div>
              <dt>Usuario</dt>
              <dd>{account.username}</dd>
            </div>
            <div>
              <dt>Correo electrónico</dt>
              <dd>{account.email ?? "Sin configurar"}</dd>
            </div>
            <div>
              <dt>Miembro desde</dt>
              <dd>
                <time dateTime={account.createdAt}>
                  {accountDateFormatter.format(new Date(account.createdAt))}
                </time>
              </dd>
            </div>
          </dl>

          <details className="account-editor">
            <summary>Editar nombre de usuario</summary>
            <form className="account-form" onSubmit={updateUsername}>
              <label htmlFor="account-username">Nombre de usuario</label>
              <input
                id="account-username"
                name="username"
                type="text"
                autoComplete="username"
                defaultValue={account.username}
                maxLength={64}
                required
              />
              {usernameFeedback ? (
                <p
                  className={`form-${usernameFeedback.tone}`}
                  role={
                    usernameFeedback.tone === "error" ? "alert" : "status"
                  }
                >
                  {usernameFeedback.message}
                </p>
              ) : null}
              <button type="submit" disabled={usernameSaving}>
                {usernameSaving ? "Guardando…" : "Guardar usuario"}
              </button>
            </form>
          </details>

          <details className="account-editor">
            <summary>
              {account.email
                ? "Cambiar correo electrónico"
                : "Añadir correo electrónico"}
            </summary>
            <form className="account-form" onSubmit={updateEmail}>
              <label htmlFor="account-email">Correo electrónico</label>
              <input
                id="account-email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={account.email ?? ""}
                maxLength={320}
                required
              />
              {emailFeedback ? (
                <p
                  className={`form-${emailFeedback.tone}`}
                  role={emailFeedback.tone === "error" ? "alert" : "status"}
                >
                  {emailFeedback.message}
                </p>
              ) : null}
              <button type="submit" disabled={emailSaving}>
                {emailSaving ? "Guardando…" : "Guardar correo"}
              </button>
            </form>
          </details>
        </section>

        <section className="account-section" aria-labelledby="security-title">
          <h2 id="security-title">Seguridad</h2>
          <details className="account-editor">
            <summary>Cambiar contraseña</summary>
            <form className="account-form" onSubmit={updatePassword}>
              <label htmlFor="current-password">Contraseña actual</label>
              <input
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                maxLength={256}
                required
              />
              <label htmlFor="account-new-password">Nueva contraseña</label>
              <input
                id="account-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
              <label htmlFor="account-confirm-password">
                Confirmar nueva contraseña
              </label>
              <input
                id="account-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
              />
              {passwordFeedback ? (
                <p
                  className={`form-${passwordFeedback.tone}`}
                  role={passwordFeedback.tone === "error" ? "alert" : "status"}
                >
                  {passwordFeedback.message}
                </p>
              ) : null}
              <button type="submit" disabled={passwordSaving}>
                {passwordSaving ? "Actualizando…" : "Actualizar contraseña"}
              </button>
            </form>
          </details>
        </section>

        <section className="account-section" aria-labelledby="system-title">
          <h2 id="system-title">Estado del sistema</h2>
          <dl className="account-facts">
            <div>
              <dt>Database</dt>
              <dd className={`database-status database-${database}`}>
                {database === "connected"
                  ? "Connected"
                  : database === "disconnected"
                    ? "Disconnected"
                    : "Checking"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="account-section" aria-labelledby="session-title">
          <h2 id="session-title">Sesión</h2>
          <button
            className="secondary-button account-logout"
            type="button"
            disabled={loggingOut}
            onClick={logout}
          >
            {loggingOut ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </section>
      </section>
    </main>
  );
}
