"use client";

import { useEffect, useState } from "react";
import {
  HealthResponseSchema,
  type HealthResponse,
} from "@project-architect/contracts";

type HealthState =
  | { status: "checking" }
  | { status: "available"; data: HealthResponse }
  | { status: "unavailable"; message: string };

export function HealthStatus() {
  const [health, setHealth] = useState<HealthState>({ status: "checking" });

  useEffect(() => {
    let isMounted = true;

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }

        const payload: unknown = await response.json();
        const data = HealthResponseSchema.parse(payload);

        if (isMounted) {
          setHealth({ status: "available", data });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown health check error";

        if (isMounted) {
          setHealth({ status: "unavailable", message });
        }
      }
    }

    void checkHealth();

    return () => {
      isMounted = false;
    };
  }, []);

  if (health.status === "checking") {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-neutral-500">API status</p>
        <p className="mt-2 text-lg font-semibold text-neutral-950">Checking...</p>
      </section>
    );
  }

  if (health.status === "available") {
    return (
      <section className="rounded-lg border border-emerald-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-emerald-700">API status</p>
        <p className="mt-2 text-lg font-semibold text-neutral-950">Available</p>
        <p className="mt-1 text-sm text-neutral-600">
          {health.data.service} returned {health.data.status}.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-red-700">API status</p>
      <p className="mt-2 text-lg font-semibold text-neutral-950">Unavailable</p>
      <p className="mt-1 text-sm text-neutral-600">{health.message}</p>
    </section>
  );
}