"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

type ListedUser = {
  id: string;
  username: string;
  email: string | null;
  role: "user" | "superadmin";
};

type AdminState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; users: ListedUser[] };

type CreateFeedback = {
  message: string;
  tone: "error" | "success";
};

export function AdminScreen() {
  const router = useRouter();
  const [state, setState] = useState<AdminState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<CreateFeedback | null>(null);
  const submittingRef = useRef(false);
  const [resetTarget, setResetTarget] = useState<ListedUser | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<CreateFeedback | null>(null);
  const resetSubmittingRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      try {
        const response = await fetch("/api/admin/users", {
          credentials: "include",
          cache: "no-store",
        });

        if (!active) return;
        if (response.status === 401) {
          router.replace("/");
          return;
        }
        if (response.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (!response.ok) throw new Error("Failed to load users.");

        const result = (await response.json()) as { users?: ListedUser[] };
        if (!active) return;
        if (!Array.isArray(result.users)) throw new Error("Invalid user list.");

        setState({ status: "ready", users: result.users });
      } catch {
        if (active) setState({ status: "error" });
      }
    }

    void loadUsers();
    return () => {
      active = false;
    };
  }, [router]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setCreateFeedback(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password"),
          ...(email ? { email } : {}),
        }),
      });

      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (response.status === 403) {
        setState({ status: "forbidden" });
        return;
      }

      const result = (await response.json()) as {
        user?: ListedUser;
        message?: string;
      };
      if (!response.ok || !result.user) {
        setCreateFeedback({
          message: result.message ?? "No se pudo crear el usuario.",
          tone: "error",
        });
        return;
      }

      const createdUser = result.user;
      form.reset();
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              users: [...current.users, createdUser].sort(
                (a, b) =>
                  a.username.localeCompare(b.username) || a.id.localeCompare(b.id),
              ),
            }
          : current,
      );
      setCreateFeedback({ message: "Usuario creado.", tone: "success" });
    } catch {
      setCreateFeedback({
        message: "No se pudo crear el usuario.",
        tone: "error",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetSubmittingRef.current || !resetTarget) return;

    resetSubmittingRef.current = true;
    setResetSubmitting(true);
    setResetFeedback(null);
    const form = event.currentTarget;
    const target = resetTarget;
    const newPassword = String(new FormData(form).get("newPassword") ?? "");

    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(target.id)}/reset-password`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newPassword }),
        },
      );
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      if (response.status === 403) {
        setState({ status: "forbidden" });
        return;
      }

      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        setResetFeedback({
          message: result.message ?? "No se pudo restablecer la contraseña.",
          tone: "error",
        });
        return;
      }

      setResetTarget(null);
      setResetFeedback({
        message: `Contraseña de ${target.username} restablecida. Si es tu cuenta, vuelve a iniciar sesión.`,
        tone: "success",
      });
    } catch {
      setResetFeedback({
        message: "No se pudo restablecer la contraseña.",
        tone: "error",
      });
    } finally {
      form.reset();
      resetSubmittingRef.current = false;
      setResetSubmitting(false);
    }
  }

  function cancelReset() {
    if (resetSubmittingRef.current) return;
    setResetTarget(null);
    setResetFeedback(null);
  }

  if (state.status === "loading") {
    return (
      <main className="flow-shell">
        <p className="loading-message">Cargando usuarios…</p>
      </main>
    );
  }

  return (
    <main className="flow-shell">
      <section className="account-card admin-card" aria-labelledby="admin-title">
        <p className="brand">MemoOS</p>
        <Link className="back-link" href="/dashboard">
          Volver al Dashboard
        </Link>
        <h1 id="admin-title">Usuarios</h1>

        {state.status === "ready" ? (
          <p><Link href="/admin/material">Material curricular</Link></p>
        ) : null}

        {state.status === "forbidden" ? (
          <p className="form-error" role="alert">
            No tienes acceso a esta página.
          </p>
        ) : state.status === "error" ? (
          <p className="form-error" role="alert">
            No se pudo cargar el listado de usuarios.
          </p>
        ) : (
          <>
            <section className="account-section" aria-labelledby="admin-create-title">
              <h2 id="admin-create-title">Crear usuario</h2>
              <form className="auth-form admin-create-form" onSubmit={createUser}>
                <label htmlFor="admin-username">Usuario</label>
                <input
                  id="admin-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  maxLength={64}
                  required
                />
                <label htmlFor="admin-email">Correo electrónico (opcional)</label>
                <input
                  id="admin-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                />
                <label htmlFor="admin-password">Contraseña</label>
                <input
                  id="admin-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                />
                {createFeedback ? (
                  <p
                    className={`form-${createFeedback.tone}`}
                    role={createFeedback.tone === "error" ? "alert" : "status"}
                  >
                    {createFeedback.message}
                  </p>
                ) : null}
                <button type="submit" disabled={submitting}>
                  {submitting ? "Creando…" : "Crear usuario"}
                </button>
              </form>
            </section>

            {state.users.length === 0 ? (
              <p className="loading-message">No hay usuarios registrados.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th scope="col">Usuario</th>
                      <th scope="col">Correo electrónico</th>
                      <th scope="col">Rol</th>
                      <th scope="col">ID</th>
                      <th scope="col">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.users.map((user) => (
                      <tr key={user.id}>
                        <td>{user.username}</td>
                        <td>{user.email ?? "—"}</td>
                        <td>{user.role === "superadmin" ? "Superadmin" : "Usuario"}</td>
                        <td className="admin-user-id">{user.id}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-button admin-reset-action"
                            disabled={resetSubmitting}
                            onClick={() => {
                              setResetTarget(user);
                              setResetFeedback(null);
                            }}
                          >
                            Restablecer contraseña
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {resetTarget ? (
              <section className="account-section admin-reset-section" aria-labelledby="admin-reset-title">
                <h2 id="admin-reset-title">Restablecer contraseña</h2>
                <p>
                  Usuario: <strong>{resetTarget.username}</strong> ({resetTarget.id})
                </p>
                <form key={resetTarget.id} className="auth-form admin-reset-form" onSubmit={resetPassword}>
                  <label htmlFor="admin-reset-password">Nueva contraseña</label>
                  <input
                    id="admin-reset-password"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={256}
                    required
                  />
                  {resetFeedback?.tone === "error" ? (
                    <p className="form-error" role="alert">{resetFeedback.message}</p>
                  ) : null}
                  <div className="admin-reset-buttons">
                    <button type="submit" disabled={resetSubmitting}>
                      {resetSubmitting ? "Restableciendo…" : `Confirmar reset de ${resetTarget.username}`}
                    </button>
                    <button type="button" className="secondary-button" disabled={resetSubmitting} onClick={cancelReset}>
                      Cancelar
                    </button>
                  </div>
                </form>
              </section>
            ) : resetFeedback?.tone === "success" ? (
              <p className="form-success" role="status">{resetFeedback.message}</p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
