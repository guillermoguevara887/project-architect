"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginScreen() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "include",
        });

        if (active && response.ok) {
          router.replace("/dashboard");
          return;
        }
      } catch {
        // The login form remains available when the API cannot be reached.
      }

      if (active) {
        setCheckingSession(false);
      }
    }

    void checkSession();

    return () => {
      active = false;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        setError(
          response.status === 401
            ? "Usuario o contraseña incorrectos."
            : "No se pudo iniciar sesión.",
        );
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("No se pudo iniciar sesión.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="auth-shell">
        <p className="loading-message">Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="brand">Arquitect</p>
        <h1 id="login-title">Iniciar sesión</h1>

        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            maxLength={64}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            required
          />

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Iniciando…" : "Iniciar sesión"}
          </button>
        </form>
      </section>
    </main>
  );
}
