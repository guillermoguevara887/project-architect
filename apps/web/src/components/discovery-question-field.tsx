"use client";

import type {
  DiscoveryAnswerValue,
  DiscoveryQuestion,
} from "@project-architect/contracts";

type DiscoveryQuestionFieldProps = {
  question: DiscoveryQuestion;
  value: DiscoveryAnswerValue | null;
  disabled: boolean;
  onChange: (value: DiscoveryAnswerValue | null) => void;
};

const baseInputClass =
  "mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-neutral-100";

export function DiscoveryQuestionField({
  question,
  value,
  disabled,
  onChange,
}: DiscoveryQuestionFieldProps) {
  const inputId = `discovery-question-${question.id}`;
  const descriptionId = `${inputId}-description`;
  const label = (
    <>
      {question.questionText}
      {question.isRequired ? (
        <span className="ml-1 text-red-700" aria-hidden="true">
          *
        </span>
      ) : null}
    </>
  );

  if (question.questionType === "yes_no") {
    return (
      <fieldset
        className="rounded-lg border border-neutral-200 p-4"
        aria-describedby={descriptionId}
      >
        <legend className="px-1 text-sm font-semibold text-neutral-900">
          {label}
        </legend>
        <p id={descriptionId} className="mt-1 text-xs text-neutral-500">
          {question.category}
          {question.isRequired ? " · Obligatoria" : " · Opcional"}
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          {[
            { label: "Sí", optionValue: true },
            { label: "No", optionValue: false },
          ].map((option) => (
            <label
              key={option.label}
              className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800"
            >
              <input
                type="radio"
                name={inputId}
                checked={value === option.optionValue}
                disabled={disabled}
                onChange={() => onChange(option.optionValue)}
                className="size-4 accent-emerald-700"
              />
              {option.label}
            </label>
          ))}
          <button
            type="button"
            disabled={disabled || value === null}
            onClick={() => onChange(null)}
            className="text-xs font-medium text-neutral-500 underline disabled:cursor-not-allowed disabled:text-neutral-300"
          >
            Limpiar
          </button>
        </div>
      </fieldset>
    );
  }

  if (question.questionType === "multi_select") {
    const selectedValues = Array.isArray(value) ? value : [];

    return (
      <fieldset
        className="rounded-lg border border-neutral-200 p-4"
        aria-describedby={descriptionId}
      >
        <legend className="px-1 text-sm font-semibold text-neutral-900">
          {label}
        </legend>
        <p id={descriptionId} className="mt-1 text-xs text-neutral-500">
          {question.category}
          {question.isRequired ? " · Obligatoria" : " · Opcional"}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(question.options ?? []).map((option) => {
            const isChecked = selectedValues.includes(option);

            return (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 p-3 text-sm text-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      isChecked
                        ? selectedValues.filter((value) => value !== option)
                        : [...selectedValues, option],
                    )
                  }
                  className="size-4 accent-emerald-700"
                />
                {option}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className="text-sm font-semibold text-neutral-900"
      >
        {label}
      </label>
      <p id={descriptionId} className="mt-1 text-xs text-neutral-500">
        {question.category}
        {question.isRequired ? " · Obligatoria" : " · Opcional"}
      </p>

      {question.questionType === "long_text" ? (
        <textarea
          id={inputId}
          aria-describedby={descriptionId}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Escribe tu respuesta..."
          className={`${baseInputClass} min-h-32 resize-y py-3 leading-6`}
        />
      ) : null}

      {question.questionType === "short_text" ? (
        <input
          id={inputId}
          aria-describedby={descriptionId}
          disabled={disabled}
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Escribe tu respuesta..."
          className={`${baseInputClass} h-11`}
        />
      ) : null}

      {question.questionType === "date" ? (
        <input
          id={inputId}
          aria-describedby={descriptionId}
          disabled={disabled}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) =>
            onChange(event.target.value.length > 0 ? event.target.value : null)
          }
          className={`${baseInputClass} h-11`}
        />
      ) : null}

      {question.questionType === "number" ? (
        <input
          id={inputId}
          aria-describedby={descriptionId}
          disabled={disabled}
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(event) =>
            onChange(
              event.target.value.length > 0
                ? Number(event.target.value)
                : null,
            )
          }
          className={`${baseInputClass} h-11`}
        />
      ) : null}

      {question.questionType === "single_select" ? (
        <select
          id={inputId}
          aria-describedby={descriptionId}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) =>
            onChange(event.target.value.length > 0 ? event.target.value : null)
          }
          className={`${baseInputClass} h-11`}
        >
          <option value="">Selecciona una opción</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
