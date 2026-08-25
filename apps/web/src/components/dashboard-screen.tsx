"use client";

import Link from "next/link";
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
            <p className="brand">MemoOS</p>
            <h1 id="dashboard-title">Dashboard</h1>
          </div>

          <Link className="primary-link" href="/account">
            Cuenta
          </Link>
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

        <section className="modules-section" aria-labelledby="modules-title">
          <h2 id="modules-title">Módulos</h2>
          <div className="module-grid">
            <Link className="module-card" href="/projects/new">
              <span className="module-label">Proyectos generales</span>
              <strong>Project Architect</strong>
              <p>Define y organiza proyectos y concursos.</p>
            </Link>

            <Link className="module-card" href="/journey">
              <span className="module-label">Videos de YouTube</span>
              <strong>Journey</strong>
              <p>Captura ideas y acompaña su recorrido creativo.</p>
            </Link>
            <Link className="module-card" href="/languages">
              <span className="module-label">Aprendizaje continuo</span>
              <strong>Idiomas</strong>
              <p>Organiza idiomas, niveles y lecciones secuenciales.</p>
            </Link>
            <Link className="module-card" href="/exercises">
              <span className="module-label">Práctica enfocada</span>
              <strong>Ejercicios</strong>
              <p>Trabaja ejercicios de libros, cursos y materiales de estudio.</p>
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
