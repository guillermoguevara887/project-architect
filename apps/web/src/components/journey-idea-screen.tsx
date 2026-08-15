"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  formatJourneyDate,
  JOURNEY_SOURCE_LABELS,
  type JourneyFeedEntry,
  type JourneyIdea,
} from "@/lib/journey";
import { useSessionGuard } from "@/lib/use-session-guard";

export function JourneyIdeaScreen({ ideaId }: { ideaId: string }) {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [idea, setIdea] = useState<JourneyIdea | null>(null);
  const [entries, setEntries] = useState<JourneyFeedEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let active = true;

    async function loadIdea() {
      try {
        const encodedIdeaId = encodeURIComponent(ideaId);
        const [ideaResponse, entriesResponse] = await Promise.all([
          fetch(`/api/journey/ideas/${encodedIdeaId}`, {
            cache: "no-store",
            credentials: "include",
          }),
          fetch(`/api/journey/ideas/${encodedIdeaId}/entries`, {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        if (ideaResponse.status === 401 || entriesResponse.status === 401) {
          router.replace("/");
          return;
        }

        const ideaResult = (await ideaResponse.json()) as {
          idea?: JourneyIdea;
        };
        const entriesResult = (await entriesResponse.json()) as {
          entries?: JourneyFeedEntry[];
        };

        if (
          !ideaResponse.ok ||
          !entriesResponse.ok ||
          !ideaResult.idea ||
          !entriesResult.entries
        ) {
          throw new Error("Idea unavailable");
        }

        if (active) {
          setIdea(ideaResult.idea);
          setEntries(entriesResult.entries);
        }
      } catch {
        if (active) {
          setLoadError("No se pudo cargar la idea.");
        }
      }
    }

    void loadIdea();

    return () => {
      active = false;
    };
  }, [authorized, ideaId, router]);

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/journey/ideas/${encodeURIComponent(ideaId)}/entries`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: newContent }),
        },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        entry?: JourneyFeedEntry;
        message?: string;
      };

      if (!response.ok || !result.entry) {
        setActionError(result.message ?? "No se pudo guardar la entrada.");
        return;
      }

      setEntries((current) => [
        result.entry as JourneyFeedEntry,
        ...(current ?? []),
      ]);
      setNewContent("");
    } catch {
      setActionError("No se pudo guardar la entrada.");
    } finally {
      setSubmitting(false);
    }
  }

  function beginEditing(entry: JourneyFeedEntry) {
    setActionError(null);
    setEditingId(entry.id);
    setEditingContent(entry.content);
  }

  async function updateEntry(entryId: string) {
    setBusyEntryId(entryId);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/journey/ideas/${encodeURIComponent(ideaId)}/entries/${encodeURIComponent(entryId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: editingContent }),
        },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      const result = (await response.json()) as {
        entry?: JourneyFeedEntry;
        message?: string;
      };

      if (!response.ok || !result.entry) {
        setActionError(result.message ?? "No se pudo actualizar la entrada.");
        return;
      }

      setEntries((current) =>
        current?.map((entry) =>
          entry.id === entryId ? (result.entry as JourneyFeedEntry) : entry,
        ) ?? null,
      );
      setEditingId(null);
      setEditingContent("");
    } catch {
      setActionError("No se pudo actualizar la entrada.");
    } finally {
      setBusyEntryId(null);
    }
  }

  async function deleteEntry(entryId: string) {
    if (!window.confirm("¿Borrar esta entrada del diario?")) {
      return;
    }

    setBusyEntryId(entryId);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/journey/ideas/${encodeURIComponent(ideaId)}/entries/${encodeURIComponent(entryId)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (response.status === 401) {
        router.replace("/");
        return;
      }

      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        setActionError(result.message ?? "No se pudo borrar la entrada.");
        return;
      }

      setEntries((current) =>
        current?.filter((entry) => entry.id !== entryId) ?? null,
      );

      if (editingId === entryId) {
        setEditingId(null);
        setEditingContent("");
      }
    } catch {
      setActionError("No se pudo borrar la entrada.");
    } finally {
      setBusyEntryId(null);
    }
  }

  if (!authorized || (!idea && !loadError)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando idea…</p>
      </main>
    );
  }

  if (loadError || !idea || !entries) {
    return (
      <main className="flow-shell">
        <section className="flow-card">
          <p className="brand">MemoOS · Journey</p>
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <Link className="primary-link" href="/journey">
            Volver a Journey
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flow-shell journey-shell">
      <article className="flow-card journey-detail-card" aria-labelledby="idea-title">
        <p className="brand">MemoOS · Journey</p>
        <Link className="back-link" href="/journey">
          Volver a Journey
        </Link>

        <header className="idea-detail-heading">
          <h1 id="idea-title">{idea.title}</h1>
          <time dateTime={idea.createdAt}>
            Creada {formatJourneyDate(idea.createdAt)}
          </time>
        </header>

        <dl className="idea-source">
          <div>
            <dt>Fuente</dt>
            <dd>{JOURNEY_SOURCE_LABELS[idea.sourceType]}</dd>
          </div>
          <div>
            <dt>Referencia</dt>
            <dd>{idea.sourceReference}</dd>
          </div>
        </dl>

        <section className="feed-section" aria-labelledby="feed-title">
          <div className="feed-heading">
            <div>
              <p className="section-kicker">Diario del proyecto</p>
              <h2 id="feed-title">Feed</h2>
            </div>
          </div>

          <form className="feed-composer" onSubmit={createEntry}>
            <label className="visually-hidden" htmlFor="new-entry">
              Nueva entrada del diario
            </label>
            <textarea
              id="new-entry"
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              maxLength={10_000}
              rows={4}
              required
              placeholder="¿Qué ocurrió, qué pensaste o qué quieres recordar?"
            />
            <div className="composer-actions">
              <span>{newContent.length.toLocaleString("es")} / 10.000</span>
              <button type="submit" disabled={submitting}>
                {submitting ? "Guardando…" : "Agregar al diario"}
              </button>
            </div>
          </form>

          {actionError ? (
            <p className="form-error feed-error" role="alert">
              {actionError}
            </p>
          ) : null}

          {entries.length === 0 ? (
            <div className="empty-state feed-empty">
              <h3>El diario está vacío</h3>
              <p>La primera entrada puede ser tan breve como una frase.</p>
            </div>
          ) : (
            <div className="feed-list" aria-label="Entradas del diario">
              {entries.map((entry) => (
                <article className="feed-entry" key={entry.id}>
                  <time dateTime={entry.createdAt}>
                    {formatJourneyDate(entry.createdAt)}
                  </time>

                  {editingId === entry.id ? (
                    <div className="entry-editor">
                      <label className="visually-hidden" htmlFor={`entry-${entry.id}`}>
                        Editar entrada
                      </label>
                      <textarea
                        id={`entry-${entry.id}`}
                        value={editingContent}
                        onChange={(event) =>
                          setEditingContent(event.target.value)
                        }
                        maxLength={10_000}
                        rows={4}
                      />
                      <div className="entry-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditingContent("");
                          }}
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={
                            busyEntryId === entry.id ||
                            editingContent.trim().length === 0
                          }
                          onClick={() => void updateEntry(entry.id)}
                        >
                          {busyEntryId === entry.id
                            ? "Guardando…"
                            : "Guardar cambios"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{entry.content}</p>
                      <div className="entry-actions entry-actions-compact">
                        <button
                          className="text-button"
                          type="button"
                          disabled={busyEntryId === entry.id}
                          onClick={() => beginEditing(entry)}
                        >
                          Editar
                        </button>
                        <button
                          className="text-button danger-button"
                          type="button"
                          disabled={busyEntryId === entry.id}
                          onClick={() => void deleteEntry(entry.id)}
                        >
                          {busyEntryId === entry.id ? "Borrando…" : "Borrar"}
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </article>
    </main>
  );
}
