"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SessionUser = {
  id: string;
  username: string;
};

type DatabaseState = "checking" | "connected" | "disconnected";

export function DashboardScreen() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [database, setDatabase] = useState<DatabaseState>("checking");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "include",
        });

        if (!sessionResponse.ok) {
          router.replace("/");
          return;
        }

        const session = (await sessionResponse.json()) as {
          user?: SessionUser;
        };

        if (!session.user) {
          router.replace("/");
          return;
        }

        if (active) {
          setUser(session.user);
        }

        const databaseResponse = await fetch("/api/health/db", {
          cache: "no-store",
          credentials: "include",
        });
        const databaseResult = databaseResponse.ok
          ? ((await databaseResponse.json()) as { database?: string })
          : null;

        if (active) {
          setDatabase(
            databaseResult?.database === "connected"
              ? "connected"
              : "disconnected",
          );
        }
      } catch {
        if (active) {
          setDatabase("disconnected");
          router.replace("/");
        }
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [router]);

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
      <main className="dashboard-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <section className="dashboard-card" aria-labelledby="dashboard-title">
        <header className="dashboard-header">
          <div>
            <p className="brand">Arquitect</p>
            <h1 id="dashboard-title">Dashboard</h1>
          </div>

          <button
            className="secondary-button"
            type="button"
            disabled={loggingOut}
            onClick={logout}
          >
            {loggingOut ? "Saliendo…" : "Logout"}
          </button>
        </header>

        <dl className="status-list">
          <div>
            <dt>Username</dt>
            <dd>{user.username}</dd>
          </div>
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
    </main>
  );
}
