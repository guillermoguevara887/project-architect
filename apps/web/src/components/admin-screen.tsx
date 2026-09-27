"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

export function AdminScreen() {
  const router = useRouter();
  const [state, setState] = useState<AdminState>({ status: "loading" });

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

        {state.status === "forbidden" ? (
          <p className="form-error" role="alert">
            No tienes acceso a esta página.
          </p>
        ) : state.status === "error" ? (
          <p className="form-error" role="alert">
            No se pudo cargar el listado de usuarios.
          </p>
        ) : state.users.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {state.users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{user.email ?? "—"}</td>
                    <td>{user.role === "superadmin" ? "Superadmin" : "Usuario"}</td>
                    <td className="admin-user-id">{user.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
