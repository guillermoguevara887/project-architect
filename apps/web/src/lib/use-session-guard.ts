"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function useSessionGuard() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

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

        if (active) {
          setAuthorized(true);
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

  return authorized;
}
