"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";

export function NewLanguageScreen() {
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
      const response = await fetch("/api/languages/projects", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language: form.get("language"),
          level: form.get("level"),
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
        setError(result.message ?? "No se pudo crear el idioma.");
        return;
      }
      router.push(`/languages/${result.project.id}`);
    } catch {
      setError("No se pudo crear el idioma.");
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
    <main className="flow-shell language-shell">
      <section
        className="flow-card language-form-card"
        aria-labelledby="new-language-title"
      >
        <p className="brand">MemoOS · Idiomas</p>
        <Link className="back-link" href="/languages">
          Volver a Idiomas
        </Link>
        <h1 id="new-language-title">Nuevo idioma</h1>
        <form className="language-form" onSubmit={submit}>
          <label htmlFor="language">Idioma</label>
          <input
            id="language"
            name="language"
            type="text"
            maxLength={100}
            required
            autoFocus
            placeholder="Alemán"
          />
          <label htmlFor="level">Nivel</label>
          <input
            id="level"
            name="level"
            type="text"
            maxLength={100}
            required
            placeholder="Nivel 2"
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={submitting}>
            {submitting ? "Creando…" : "Crear"}
          </button>
        </form>
      </section>
    </main>
  );
}
