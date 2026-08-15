"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSessionGuard } from "@/lib/use-session-guard";
import {
  formatJourneyDate,
  JOURNEY_SOURCE_LABELS,
  type JourneyIdea,
} from "@/lib/journey";

export function JourneyHomeScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [ideas, setIdeas] = useState<JourneyIdea[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let active = true;

    async function loadIdeas() {
      try {
        const response = await fetch("/api/journey/ideas", {
          cache: "no-store",
          credentials: "include",
        });

        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as { ideas?: JourneyIdea[] };

        if (!response.ok || !result.ideas) {
          throw new Error("Ideas unavailable");
        }

        if (active) {
          setIdeas(result.ideas);
        }
      } catch {
        if (active) {
          setError("No se pudieron cargar las ideas.");
        }
      }
    }

    void loadIdeas();

    return () => {
      active = false;
    };
  }, [authorized, router]);

  if (!authorized || (!ideas && !error)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando Journey…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell journey-shell">
      <section className="flow-card journey-card" aria-labelledby="journey-title">
        <p className="brand">MemoOS · Journey</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>

        <header className="journey-heading">
          <div>
            <h1 id="journey-title">Journey</h1>
            <p className="journey-intro">
              Tu espacio de trabajo para llevar una idea hasta un video de
              YouTube.
            </p>
          </div>
          <Link className="primary-link" href="/journey/new">
            Nueva idea
          </Link>
        </header>

        {error ? (
          <p className="form-error journey-error" role="alert">
            {error}
          </p>
        ) : null}

        {ideas?.length === 0 ? (
          <div className="empty-state">
            <h2>Aún no hay ideas</h2>
            <p>Captura la primera cuando aparezca.</p>
          </div>
        ) : (
          <div className="idea-list" aria-label="Ideas de video">
            {ideas?.map((idea) => (
              <Link
                className="idea-list-card"
                href={`/journey/${idea.id}`}
                key={idea.id}
              >
                <div>
                  <strong>{idea.title}</strong>
                  <p>{idea.sourceReference}</p>
                </div>
                <div className="idea-card-meta">
                  <span>{JOURNEY_SOURCE_LABELS[idea.sourceType]}</span>
                  <time dateTime={idea.createdAt}>
                    {formatJourneyDate(idea.createdAt)}
                  </time>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
