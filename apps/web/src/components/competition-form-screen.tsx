"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

export function CompetitionFormScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/architect/projects", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceText: form.get("sourceText"),
          officialUrl: form.get("officialUrl"),
        }),
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        project?: { id?: string };
        message?: string;
      };

      if (!response.ok || !result.project?.id) {
        setError(result.message ?? "No se pudo guardar el concurso.");
        return;
      }

      router.push(`/projects/${result.project.id}`);
    } catch {
      setError("No se pudo guardar el concurso.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!authorized) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell">
      <section className="flow-card" aria-labelledby="competition-form-title">
        <p className="brand">Proyectos</p>
        <Link className="back-link" href="/projects">
          Volver
        </Link>
        <h1 id="competition-form-title">Información del concurso</h1>

        <form className="competition-form" onSubmit={submit}>
          <label htmlFor="sourceText">Texto del concurso</label>
          <textarea
            id="sourceText"
            name="sourceText"
            rows={12}
            required
            placeholder="Pega aquí la descripción, reglas, requisitos o cualquier información disponible del concurso."
          />

          <label htmlFor="officialUrl">URL oficial</label>
          <input
            id="officialUrl"
            name="officialUrl"
            type="url"
            inputMode="url"
            placeholder="https://ejemplo.com/concurso"
          />

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar y continuar"}
          </button>
        </form>
      </section>
    </main>
  );
}
