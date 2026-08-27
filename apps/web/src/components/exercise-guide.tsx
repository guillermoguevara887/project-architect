import type { StructuredExerciseGuide } from "@/lib/exercises";

function cleanLegacyGuide(content: string) {
  return content
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function ExerciseGuide({
  guide,
  legacyGuide,
}: {
  guide: StructuredExerciseGuide | null;
  legacyGuide: string | null;
}) {
  if (guide) {
    return (
      <div className="exercise-guide-sections">
        {guide.sections.map((section, sectionIndex) => (
          <section
            className={`exercise-guide-section exercise-guide-section-${section.type}`}
            key={`${section.type}-${sectionIndex}-${section.title}`}
          >
            <h3>{section.title}</h3>
            {section.intro ? (
              <p className="exercise-guide-intro">{section.intro}</p>
            ) : null}

            {section.type === "concepts" ? (
              <dl className="exercise-guide-concepts">
                {section.items.map((item, itemIndex) => (
                  <div key={`${itemIndex}-${item.label ?? item.text}`}>
                    <dt>{item.label}</dt>
                    <dd>{item.text}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {section.type === "bullets" ? (
              <ul className="exercise-guide-bullets">
                {section.items.map((item, itemIndex) => (
                  <li key={`${itemIndex}-${item.label ?? item.text}`}>
                    {item.label ? <strong>{item.label}</strong> : null}
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    );
  }

  if (legacyGuide) {
    return (
      <div className="exercise-guide-legacy">
        <p className="exercise-guide-legacy-label">Guía anterior</p>
        <div>{cleanLegacyGuide(legacyGuide)}</div>
      </div>
    );
  }

  return null;
}
