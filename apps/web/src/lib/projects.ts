export type ProjectStatus = "idea" | "in_progress" | "completed";

export type ProjectLink = {
  id: string;
  name: string;
  url: string;
  createdAt: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  objective: string;
  status: ProjectStatus;
  links: ProjectLink[];
  officialUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idea",
  in_progress: "En proceso",
  completed: "Terminado",
};

export const PROJECT_FILTERS: Array<{
  value: "all" | ProjectStatus;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "idea", label: "Ideas" },
  { value: "in_progress", label: "En proceso" },
  { value: "completed", label: "Terminados" },
];

export function inferToolName(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./u, "");
    const knownTools: Record<string, string> = {
      "figma.com": "Figma",
      "github.com": "GitHub",
      "linear.app": "Linear",
      "notion.so": "Notion",
      "slack.com": "Slack",
      "vercel.com": "Vercel",
    };

    return knownTools[hostname] ?? "";
  } catch {
    return "";
  }
}
