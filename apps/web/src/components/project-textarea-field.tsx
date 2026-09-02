"use client";

import { useState } from "react";

type ProjectTextareaFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
};

export function ProjectTextareaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 7,
  disabled = false,
}: ProjectTextareaFieldProps) {
  const [proposal, setProposal] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function improveText() {
    setLoading(true);
    setError(null);
    setProposal(null);

    try {
      const response = await fetch("/api/architect/projects/improve-text", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      const result = (await response.json()) as {
        improvedText?: string;
        message?: string;
      };

      if (!response.ok || !result.improvedText) {
        setError(result.message ?? "No se pudo mejorar el texto.");
        return;
      }

      setProposal(result.improvedText);
    } catch {
      setError("No se pudo mejorar el texto. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  function changeValue(nextValue: string) {
    setProposal(null);
    setError(null);
    onChange(nextValue);
  }

  return (
    <div className="project-text-field">
      <div className="project-field-heading">
        <label htmlFor={id}>{label}</label>
        <button
          className="project-ai-button"
          type="button"
          onClick={improveText}
          disabled={disabled || loading || value.trim().length === 0}
        >
          {loading ? "Mejorando…" : "✨ Mejorar texto"}
        </button>
      </div>

      <textarea
        id={id}
        name={id}
        rows={rows}
        value={value}
        onChange={(event) => changeValue(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />

      {error ? (
        <p className="form-error project-ai-error" role="alert">
          {error}
        </p>
      ) : null}

      {proposal ? (
        <section className="project-ai-proposal" aria-live="polite">
          <p className="section-kicker">Propuesta de IA</p>
          <p>{proposal}</p>
          <div className="project-ai-actions">
            <button
              type="button"
              onClick={() => {
                onChange(proposal);
                setProposal(null);
              }}
            >
              Usar esta versión
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setProposal(null)}
            >
              Cancelar
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
