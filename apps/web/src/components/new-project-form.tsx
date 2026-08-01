"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CreateProjectRequestSchema,
  CreateProjectResponseSchema,
  type ProjectType,
} from "@project-architect/contracts";
import { getApiErrorMessage } from "@/lib/api-client";
import { projectTypeLabels } from "./project-type-label";

type FormState = {
  name: string;
  projectType: ProjectType | "";
  globalObjective: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const initialFormState: FormState = {
  name: "",
  projectType: "",
  globalObjective: "",
};

export function NewProjectForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<Key extends keyof FormState>(
    key: Key,
    value: FormState[Key],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
    setErrors((current) => ({
      ...current,
      [key]: undefined,
    }));
    setServerError(null);
  }

  function validateForm() {
    const parsed = CreateProjectRequestSchema.safeParse({
      name: form.name,
      projectType: form.projectType,
      globalObjective: form.globalObjective,
    });

    if (parsed.success) {
      return parsed.data;
    }

    const nextErrors: FormErrors = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path[0];

      if (
        field === "name" ||
        field === "projectType" ||
        field === "globalObjective"
      ) {
        nextErrors[field] =
          field === "projectType"
            ? "Selecciona un tipo de proyecto."
            : issue.message;
      }
    }

    setErrors(nextErrors);
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);

    const input = validateForm();

    if (!input) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(
            response,
            "No se pudo guardar el proyecto.",
          ),
        );
      }

      const payload: unknown = await response.json();
      const data = CreateProjectResponseSchema.parse(payload);

      router.push(`/projects/${data.project.id}`);
      router.refresh();
    } catch (error) {
      setServerError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el proyecto.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"
      onSubmit={handleSubmit}
    >
      <div className="space-y-5">
        <div>
          <label
            className="text-sm font-medium text-neutral-800"
            htmlFor="project-name"
          >
            Nombre del proyecto
          </label>
          <input
            id="project-name"
            className="mt-2 h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            placeholder="Ej. Manuscrito Voynich"
          />
          {errors.name ? (
            <p className="mt-2 text-sm text-red-700">{errors.name}</p>
          ) : null}
        </div>

        <div>
          <label
            className="text-sm font-medium text-neutral-800"
            htmlFor="project-type"
          >
            Tipo de proyecto
          </label>
          <select
            id="project-type"
            className="mt-2 h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            value={form.projectType}
            onChange={(event) =>
              updateField("projectType", event.target.value as ProjectType)
            }
          >
            <option value="">Selecciona un tipo</option>
            <option value="research">{projectTypeLabels.research}</option>
            <option value="competition">{projectTypeLabels.competition}</option>
          </select>
          {errors.projectType ? (
            <p className="mt-2 text-sm text-red-700">{errors.projectType}</p>
          ) : null}
        </div>

        <div>
          <label
            className="text-sm font-medium text-neutral-800"
            htmlFor="global-objective"
          >
            Objetivo global
          </label>
          <textarea
            id="global-objective"
            className="mt-2 min-h-36 w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-3 text-sm leading-6 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            value={form.globalObjective}
            onChange={(event) =>
              updateField("globalObjective", event.target.value)
            }
            placeholder="Describe la idea, pregunta u objetivo inicial."
          />
          {errors.globalObjective ? (
            <p className="mt-2 text-sm text-red-700">
              {errors.globalObjective}
            </p>
          ) : null}
        </div>

        {serverError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-800">{serverError}</p>
          </div>
        ) : null}

        <button
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400 sm:w-auto"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Guardando..." : "Crear proyecto"}
        </button>
      </div>
    </form>
  );
}
