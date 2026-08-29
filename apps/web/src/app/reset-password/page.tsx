import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordScreen } from "@/components/reset-password-screen";

export const metadata: Metadata = {
  referrer: "no-referrer",
  title: "Restablecer contraseña | MemoOS",
};

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-shell">
          <p className="loading-message">Preparando recuperación…</p>
        </main>
      }
    >
      <ResetPasswordScreen />
    </Suspense>
  );
}
