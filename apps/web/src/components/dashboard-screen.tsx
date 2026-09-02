"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SessionUser = {
  id: string;
  username: string;
};

export function DashboardScreen() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

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
      } catch {
        if (active) {
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

          <Link className="primary-link account-link" href="/account">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <span>Cuenta</span>
          </Link>
        </header>

        <dl className="status-list">
          <div>
            <dt>Username</dt>
            <dd>{user.username}</dd>
          </div>
        </dl>

        <section className="modules-section" aria-labelledby="modules-title">
          <h2 id="modules-title">Módulos</h2>
          <div className="module-grid">
            <Link className="module-card" href="/projects">
              <span className="module-label">Proyectos técnicos</span>
              <strong>Proyectos</strong>
              <p>Organiza cada proyecto y reúne sus herramientas.</p>
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
