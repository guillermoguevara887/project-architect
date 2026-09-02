"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";
import type { ProjectStatus } from "@/lib/projects";
import { ProjectTextareaField } from "./project-textarea-field";

export function ProjectFormScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("idea");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/architect/projects", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          sourceText: description,
          objective,
          status,
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
        setError(result.message ?? "No se pudo guardar el proyecto.");
        return;
      }

      router.push(`/projects/${result.project.id}`);
    } catch {
      setError("No se pudo guardar el proyecto.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!authorized) {
    return (
      <main className="flow-shell projects-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell projects-shell">
      <section className="flow-card project-form-card" aria-labelledby="project-form-title">
        <p className="brand">Proyectos</p>
        <Link className="back-link" href="/projects">
          Volver a Proyectos
        </Link>
        <h1 id="project-form-title">Nuevo proyecto</h1>
        <p className="projects-intro">
          Guarda la idea central y reúne después los accesos a tus herramientas.
        </p>

        <form className="project-form" onSubmit={submit}>
          <label htmlFor="project-name">Nombre</label>
          <input
            id="project-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={160}
            required
            disabled={submitting}
            placeholder="Automatización de recibos de gasolina"
          />

          <ProjectTextareaField
            id="sourceText"
            label="¿Qué quiero construir?"
            value={description}
            onChange={setDescription}
            disabled={submitting}
            placeholder="Describe con tus propias palabras qué quieres construir."
          />

          <ProjectTextareaField
            id="objective"
            label="Objetivo"
            value={objective}
            onChange={setObjective}
            disabled={submitting}
            placeholder="¿Qué resultado concreto quieres conseguir?"
            rows={5}
          />

          <label htmlFor="project-status">Estado</label>
          <select
            id="project-status"
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
            disabled={submitting}
          >
            <option value="idea">Idea</option>
            <option value="in_progress">En proceso</option>
            <option value="completed">Terminado</option>
          </select>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : "Crear proyecto"}
          </button>
        </form>
      </section>
    </main>
  );
}
