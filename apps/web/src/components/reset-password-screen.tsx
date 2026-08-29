"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ResetPasswordScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "El enlace de recuperación no es válido.",
  );
  const [completed, setCompleted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: form.get("newPassword"),
          confirmPassword: form.get("confirmPassword"),
        }),
      });
      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        setError(result.message ?? "No se pudo restablecer la contraseña.");
        return;
      }

      setCompleted(true);
    } catch {
      setError("No se pudo restablecer la contraseña.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="reset-title">
        <p className="brand">MemoOS</p>
        <h1 id="reset-title">Nueva contraseña</h1>

        {completed ? (
          <div className="reset-complete">
            <p className="form-success" role="status">
              Contraseña actualizada. Ya puedes iniciar sesión.
            </p>
            <Link className="primary-link" href="/">
              Ir al Login
            </Link>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="new-password">Nueva contraseña</label>
            <input
              id="new-password"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
              disabled={!token}
            />

            <label htmlFor="confirm-password">Confirmar contraseña</label>
            <input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
              disabled={!token}
            />

            {error ? <p className="form-error" role="alert">{error}</p> : null}

            <button type="submit" disabled={submitting || !token}>
              {submitting ? "Actualizando…" : "Actualizar contraseña"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
