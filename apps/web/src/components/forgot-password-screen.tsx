"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export function ForgotPasswordScreen() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = (await response.json()) as {
        message?: string;
      };

      if (!response.ok) {
        setError(result.message ?? "No se pudo solicitar la recuperación.");
        return;
      }

      setMessage(
        result.message ??
          "Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.",
      );
    } catch {
      setError("No se pudo solicitar la recuperación.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="forgot-title">
        <p className="brand">MemoOS</p>
        <Link className="back-link" href="/">
          Volver al Login
        </Link>
        <h1 id="forgot-title">Recuperar contraseña</h1>
        <p className="auth-intro">
          Introduce el correo asociado a tu cuenta y te enviaremos un enlace
          temporal.
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="recovery-email">Correo electrónico</label>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={320}
            required
          />

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          {message ? <p className="form-success" role="status">{message}</p> : null}

          <button type="submit" disabled={submitting}>
            {submitting ? "Solicitando…" : "Solicitar recuperación"}
          </button>
        </form>
      </section>
    </main>
  );
}
