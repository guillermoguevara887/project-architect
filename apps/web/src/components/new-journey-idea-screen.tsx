"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  JOURNEY_SOURCE_LABELS,
  JOURNEY_SOURCE_TYPES,
} from "@/lib/journey";
import { useSessionGuard } from "@/lib/use-session-guard";

export function NewJourneyIdeaScreen() {
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
      const response = await fetch("/api/journey/ideas", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          sourceType: form.get("sourceType"),
          sourceReference: form.get("sourceReference"),
        }),
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        idea?: { id?: string };
        message?: string;
      };

      if (!response.ok || !result.idea?.id) {
        setError(result.message ?? "No se pudo guardar la idea.");
        return;
      }

      router.push(`/journey/${result.idea.id}`);
    } catch {
      setError("No se pudo guardar la idea.");
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
    <main className="flow-shell journey-shell">
      <section className="flow-card journey-form-card" aria-labelledby="idea-title">
        <p className="brand">MemoOS · Journey</p>
        <Link className="back-link" href="/journey">
          Volver a Journey
        </Link>
        <h1 id="idea-title">Nueva idea</h1>
        <p className="journey-intro">
          Guarda lo esencial ahora. Podrás seguir pensando después.
        </p>

        <form className="journey-form" onSubmit={submit}>
          <label htmlFor="title">Título</label>
          <input
            id="title"
            name="title"
            type="text"
            maxLength={200}
            required
            autoFocus
            placeholder="Arcoíris de sonido"
          />

          <label htmlFor="sourceType">Tipo de fuente</label>
          <select id="sourceType" name="sourceType" defaultValue="url" required>
            {JOURNEY_SOURCE_TYPES.map((sourceType) => (
              <option key={sourceType} value={sourceType}>
                {JOURNEY_SOURCE_LABELS[sourceType]}
              </option>
            ))}
          </select>

          <label htmlFor="sourceReference">Referencia de la fuente</label>
          <textarea
            id="sourceReference"
            name="sourceReference"
            rows={4}
            maxLength={4000}
            required
            placeholder="Nombre del libro — capítulo 3"
          />

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar idea"}
          </button>
        </form>
      </section>
    </main>
  );
}
