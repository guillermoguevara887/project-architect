export const EXERCISE_STATUSES = ["pending", "working", "solved"] as const;

export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];

export const EXERCISE_STATUS_LABELS: Record<ExerciseStatus, string> = {
  pending: "Pendiente",
  working: "Trabajando",
  solved: "Resuelto",
};

export const EXERCISE_WORKSPACE_TYPES = ["colab", "local", "url"] as const;

export type ExerciseWorkspaceType =
  (typeof EXERCISE_WORKSPACE_TYPES)[number];

export const EXERCISE_WORKSPACE_LABELS: Record<
  ExerciseWorkspaceType,
  string
> = {
  colab: "Google Colab",
  local: "Local",
  url: "Otro enlace",
};

export type ExerciseSummary = {
  id: string;
  title: string;
  sourceName: string | null;
  chapter: string | null;
  exerciseNumber: string | null;
  status: ExerciseStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExerciseGuideItem = {
  label: string | null;
  text: string;
};

export type ExerciseGuideSection = {
  type: "explanation" | "concepts" | "bullets";
  title: string;
  intro: string | null;
  items: ExerciseGuideItem[];
};

export type StructuredExerciseGuide = {
  sections: ExerciseGuideSection[];
};

export type Exercise = ExerciseSummary & {
  prompt: string;
  guideContent: string | null;
  guideStructuredContent: StructuredExerciseGuide | null;
  guideGenerationCount: number;
  suggestedSteps: string[] | null;
  workspaceType: ExerciseWorkspaceType | null;
  workspaceValue: string | null;
};

export function exerciseSourceLabel(exercise: ExerciseSummary) {
  return exercise.sourceName ?? "Sin libro o curso";
}
