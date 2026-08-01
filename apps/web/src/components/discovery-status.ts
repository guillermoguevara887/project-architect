import type { DiscoveryStatus } from "@project-architect/contracts";

export const discoveryStatusLabels: Record<DiscoveryStatus, string> = {
  not_started: "Sin iniciar",
  in_progress: "En progreso",
  ready_for_review: "Listo para revisión",
  completed: "Contexto confirmado",
};

export function getDiscoveryActionLabel(status: DiscoveryStatus) {
  if (status === "not_started") {
    return "Iniciar descubrimiento";
  }

  if (status === "completed") {
    return "Ver contexto";
  }

  return "Continuar descubrimiento";
}
