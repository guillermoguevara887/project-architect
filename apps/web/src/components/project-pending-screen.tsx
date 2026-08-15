"use client";

import Link from "next/link";
import { useSessionGuard } from "@/lib/use-session-guard";

export function ProjectPendingScreen() {
  const authorized = useSessionGuard();

  if (!authorized) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell">
      <section className="flow-card" aria-labelledby="pending-project-title">
        <p className="brand">Project Architect</p>
        <h1 id="pending-project-title">Proyecto</h1>
        <p className="flow-message">Flujo de proyecto pendiente.</p>
        <Link className="primary-link" href="/projects/new">
          Volver
        </Link>
      </section>
    </main>
  );
}
