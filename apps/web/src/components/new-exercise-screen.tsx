"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

export function NewExerciseScreen() {
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
      const response = await fetch("/api/exercises", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          sourceName: form.get("sourceName"),
          chapter: form.get("chapter"),
          exerciseNumber: form.get("exerciseNumber"),
          prompt: form.get("prompt"),
        }),
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        exercise?: { id?: string };
        message?: string;
      };

      if (!response.ok || !result.exercise?.id) {
        setError(result.message ?? "No se pudo guardar el ejercicio.");
        return;
      }

      router.push(`/exercises/${result.exercise.id}`);
    } catch {
      setError("No se pudo guardar el ejercicio.");
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
    <main className="flow-shell exercises-shell">
      <section
        className="flow-card exercise-form-card"
        aria-labelledby="new-exercise-title"
      >
        <p className="brand">MemoOS · Ejercicios</p>
        <Link className="back-link" href="/exercises">
          Volver a Ejercicios
        </Link>
        <h1 id="new-exercise-title">Nuevo ejercicio</h1>
        <p className="exercises-intro">
          Guarda el contexto suficiente para continuar sin reconstruirlo luego.
        </p>

        <form className="exercise-form" onSubmit={submit}>
          <label htmlFor="title">Título</label>
          <input
            id="title"
            name="title"
            type="text"
            maxLength={200}
            required
            autoFocus
            placeholder="Operaciones con tensores"
          />

          <label htmlFor="sourceName">Libro o curso</label>
          <input
            id="sourceName"
            name="sourceName"
            type="text"
            maxLength={300}
            placeholder="Deep Learning with PyTorch"
          />

          <div className="exercise-form-row">
            <div>
              <label htmlFor="chapter">Capítulo</label>
              <input
                id="chapter"
                name="chapter"
                type="text"
                maxLength={300}
                placeholder="Capítulo 3"
              />
            </div>
            <div>
              <label htmlFor="exerciseNumber">Número o identificador</label>
              <input
                id="exerciseNumber"
                name="exerciseNumber"
                type="text"
                maxLength={300}
                placeholder="3.4"
              />
            </div>
          </div>

          <label htmlFor="prompt">Enunciado del ejercicio</label>
          <textarea
            id="prompt"
            name="prompt"
            rows={10}
            maxLength={100_000}
            required
            placeholder="Pega o escribe el enunciado completo…"
          />

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Guardar ejercicio"}
          </button>
        </form>
      </section>
    </main>
  );
}
