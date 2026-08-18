"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type SessionUser = {
  id: string;
  username: string;
  createdAt: string;
};

export function useSessionGuard() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let active = true;

    async function verifySession() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "include",
        });

        if (!response.ok) {
          router.replace("/");
          return;
        }

        const session = (await response.json()) as {
          user?: SessionUser;
        };

        if (!session.user) {
          router.replace("/");
          return;
        }

        if (active) {
          setUser(session.user);
        }
      } catch {
        router.replace("/");
      }
    }

    void verifySession();

    return () => {
      active = false;
    };
  }, [router]);

  return user;
}
