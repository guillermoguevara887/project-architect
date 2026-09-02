"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  inferToolName,
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectLink,
  type ProjectStatus,
} from "@/lib/projects";
import { useSessionGuard } from "@/lib/use-session-guard";
import { ProjectTextareaField } from "./project-textarea-field";

export function ProjectDetailScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("idea");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) return;
    let active = true;

    async function loadProject() {
      try {
        const response = await fetch(
          `/api/architect/projects/${encodeURIComponent(projectId)}`,
          { cache: "no-store", credentials: "include" },
        );
        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as { project?: Project };
        if (!response.ok || !result.project) {
          if (active) setError("No se encontró el proyecto.");
          return;
        }

        if (active) setProject(result.project);
      } catch {
        if (active) setError("No se pudo cargar el proyecto.");
      }
    }

    void loadProject();
    return () => {
      active = false;
    };
  }, [authorized, projectId, router]);

  function beginEditing() {
    if (!project) return;
    setName(project.name);
    setDescription(project.description);
    setObjective(project.objective);
    setStatus(project.status);
    setActionError(null);
    setEditing(true);
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/architect/projects/${encodeURIComponent(projectId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            sourceText: description,
            objective,
            status,
          }),
        },
      );
      const result = (await response.json()) as {
        project?: Project;
        message?: string;
      };
      if (!response.ok || !result.project) {
        setActionError(result.message ?? "No se pudo actualizar el proyecto.");
        return;
      }

      setProject(result.project);
      setEditing(false);
    } catch {
      setActionError("No se pudo actualizar el proyecto.");
    } finally {
      setSaving(false);
    }
  }

  async function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingLink(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/architect/projects/${encodeURIComponent(projectId)}/links`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: linkName, url: linkUrl }),
        },
      );
      const result = (await response.json()) as {
        link?: ProjectLink;
        message?: string;
      };
      if (!response.ok || !result.link) {
        setActionError(result.message ?? "No se pudo guardar la herramienta.");
        return;
      }

      setProject((current) =>
        current ? { ...current, links: [...current.links, result.link!] } : current,
      );
      setLinkName("");
      setLinkUrl("");
      setShowLinkForm(false);
    } catch {
      setActionError("No se pudo guardar la herramienta.");
    } finally {
      setSavingLink(false);
    }
  }

  async function deleteLink(linkId: string) {
    setDeletingLinkId(linkId);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/architect/projects/${encodeURIComponent(projectId)}/links/${encodeURIComponent(linkId)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        setActionError(result.message ?? "No se pudo eliminar la herramienta.");
        return;
      }

      setProject((current) =>
        current
          ? { ...current, links: current.links.filter((link) => link.id !== linkId) }
          : current,
      );
    } catch {
      setActionError("No se pudo eliminar la herramienta.");
    } finally {
      setDeletingLinkId(null);
    }
  }

  if (!authorized || (!project && !error)) {
    return (
      <main className="flow-shell projects-shell">
        <p className="loading-message">Cargando proyecto…</p>
      </main>
    );
  }

  if (error || !project) {
    return (
      <main className="flow-shell projects-shell">
        <section className="flow-card project-detail-card">
          <p className="brand">Proyectos</p>
          <p className="form-error" role="alert">{error}</p>
          <Link className="primary-link" href="/projects">Volver a Proyectos</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flow-shell projects-shell">
      <article className="flow-card project-detail-card" aria-labelledby="project-title">
        <p className="brand">Proyectos</p>
        <Link className="back-link" href="/projects">Volver a Proyectos</Link>

        {!editing ? (
          <>
            <header className="project-detail-heading">
              <div>
                <h1 id="project-title">{project.name}</h1>
                <span className={`project-status project-status-${project.status}`}>
                  {PROJECT_STATUS_LABELS[project.status]}
                </span>
              </div>
              <button className="secondary-button" type="button" onClick={beginEditing}>
                Editar proyecto
              </button>
            </header>

            <section className="project-detail-section" aria-labelledby="objective-title">
              <h2 id="objective-title">Objetivo</h2>
              <p>{project.objective || "Sin objetivo definido todavía."}</p>
            </section>
            <section className="project-detail-section" aria-labelledby="description-title">
              <h2 id="description-title">Qué quiero construir</h2>
              <p>{project.description || "Sin descripción todavía."}</p>
            </section>
          </>
        ) : (
          <form className="project-form project-edit-form" onSubmit={saveProject}>
            <h1 id="project-title">Editar proyecto</h1>
            <label htmlFor="project-name">Nombre</label>
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              required
              disabled={saving}
            />
            <ProjectTextareaField
              id="sourceText"
              label="¿Qué quiero construir?"
              value={description}
              onChange={setDescription}
              disabled={saving}
            />
            <ProjectTextareaField
              id="objective"
              label="Objetivo"
              value={objective}
              onChange={setObjective}
              disabled={saving}
              rows={5}
            />
            <label htmlFor="project-status">Estado</label>
            <select
              id="project-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as ProjectStatus)}
              disabled={saving}
            >
              <option value="idea">Idea</option>
              <option value="in_progress">En proceso</option>
              <option value="completed">Terminado</option>
            </select>
            <div className="project-form-actions">
              <button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        <section className="project-detail-section project-tools" aria-labelledby="tools-title">
          <div className="project-section-heading">
            <h2 id="tools-title">Herramientas</h2>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowLinkForm((visible) => !visible)}
            >
              + Agregar herramienta
            </button>
          </div>

          {showLinkForm ? (
            <form className="project-link-form" onSubmit={addLink}>
              <label htmlFor="link-name">Nombre</label>
              <input
                id="link-name"
                value={linkName}
                onChange={(event) => setLinkName(event.target.value)}
                maxLength={80}
                required
                placeholder="Linear"
                disabled={savingLink}
              />
              <label htmlFor="link-url">URL</label>
              <input
                id="link-url"
                type="url"
                inputMode="url"
                value={linkUrl}
                onChange={(event) => {
                  const nextUrl = event.target.value;
                  setLinkUrl(nextUrl);
                  if (!linkName.trim()) setLinkName(inferToolName(nextUrl));
                }}
                required
                placeholder="https://linear.app/..."
                disabled={savingLink}
              />
              <div className="project-form-actions">
                <button type="submit" disabled={savingLink}>
                  {savingLink ? "Guardando…" : "Guardar"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowLinkForm(false)}
                  disabled={savingLink}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {project.links.length === 0 && !project.officialUrl ? (
            <p className="project-tools-empty">Todavía no hay herramientas asociadas.</p>
          ) : null}

          <div className="project-tool-list">
            {project.officialUrl ? (
              <div className="project-tool-row">
                <a href={project.officialUrl} target="_blank" rel="noreferrer">
                  <strong>Sitio oficial</strong>
                  <span>{project.officialUrl}</span>
                </a>
                <span className="legacy-link-label">Enlace heredado</span>
              </div>
            ) : null}
            {project.links.map((link) => (
              <div className="project-tool-row" key={link.id}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  <strong>{link.name}</strong>
                  <span>{link.url}</span>
                </a>
                <button
                  className="project-link-delete"
                  type="button"
                  onClick={() => void deleteLink(link.id)}
                  disabled={deletingLinkId === link.id}
                  aria-label={`Eliminar ${link.name}`}
                >
                  {deletingLinkId === link.id ? "Eliminando…" : "Eliminar"}
                </button>
              </div>
            ))}
          </div>
        </section>

        {actionError ? (
          <p className="form-error project-action-error" role="alert">
            {actionError}
          </p>
        ) : null}
      </article>
    </main>
  );
}
