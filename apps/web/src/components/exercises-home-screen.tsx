"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  EXERCISE_STATUS_LABELS,
  exerciseSourceLabel,
  type ExerciseSummary,
} from "@/lib/exercises";
import { useSessionGuard } from "@/lib/use-session-guard";

export function ExercisesHomeScreen() {
  const router = useRouter();
  const authorized = useSessionGuard();
  const [exercises, setExercises] = useState<ExerciseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorized) {
      return;
    }

    let active = true;

    async function loadExercises() {
      try {
        const response = await fetch("/api/exercises", {
          cache: "no-store",
          credentials: "include",
        });

        if (response.status === 401) {
          router.replace("/");
          return;
        }

        const result = (await response.json()) as {
          exercises?: ExerciseSummary[];
        };

        if (!response.ok || !result.exercises) {
          throw new Error("Exercises unavailable");
        }

        if (active) {
          setExercises(result.exercises);
        }
      } catch {
        if (active) {
          setError("No se pudieron cargar los ejercicios.");
        }
      }
    }

    void loadExercises();

    return () => {
      active = false;
    };
  }, [authorized, router]);

  if (!authorized || (!exercises && !error)) {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando ejercicios…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell exercises-shell">
      <section
        className="flow-card exercises-card"
        aria-labelledby="exercises-title"
      >
        <p className="brand">MemoOS · Ejercicios</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>

        <header className="exercises-heading">
          <div>
            <h1 id="exercises-title">Ejercicios</h1>
            <p className="exercises-intro">
              Guarda el enunciado, tu mesa de trabajo y la ayuda que necesitas.
            </p>
          </div>
          <Link className="primary-link" href="/exercises/new">
            Nuevo ejercicio
          </Link>
        </header>

        {error ? (
          <p className="form-error exercises-error" role="alert">
            {error}
          </p>
        ) : null}

        {exercises?.length === 0 ? (
          <div className="empty-state">
            <h2>Aún no hay ejercicios</h2>
            <p>Guarda el primero para retomarlo cuando quieras.</p>
          </div>
        ) : (
          <div className="exercise-list" aria-label="Ejercicios guardados">
            {exercises?.map((exercise) => (
              <Link
                className="exercise-list-card"
                href={`/exercises/${exercise.id}`}
                key={exercise.id}
              >
                <div className="exercise-list-copy">
                  <strong>{exercise.title}</strong>
                  <p>{exerciseSourceLabel(exercise)}</p>
                  {exercise.chapter ? <span>{exercise.chapter}</span> : null}
                </div>
                <span
                  className={`exercise-status exercise-status-${exercise.status}`}
                >
                  {EXERCISE_STATUS_LABELS[exercise.status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
