"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

const accountDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function AccountScreen() {
  const router = useRouter();
  const user = useSessionGuard();
  const [loggingOut, setLoggingOut] = useState(false);

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

  if (!user) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell">
      <section className="auth-card" aria-labelledby="account-title">
        <p className="brand">MemoOS</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>
        <h1 id="account-title">Cuenta</h1>

        <dl className="status-list">
          <div>
            <dt>Usuario</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>Miembro desde</dt>
            <dd>
              <time dateTime={user.createdAt}>
                {accountDateFormatter.format(new Date(user.createdAt))}
              </time>
            </dd>
          </div>
        </dl>

        <button
          className="secondary-button"
          type="button"
          disabled={loggingOut}
          onClick={logout}
        >
          {loggingOut ? "Saliendo…" : "Cerrar sesión"}
        </button>
      </section>
    </main>
  );
}
