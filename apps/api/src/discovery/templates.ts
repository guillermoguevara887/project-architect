import type {
  DiscoveryQuestionType,
  ProjectType,
} from "@project-architect/contracts";

export type DiscoveryQuestionTemplate = {
  key: string;
  text: string;
  category: string;
  type: DiscoveryQuestionType;
  required: boolean;
  options?: string[];
};

export type DiscoverySectionTemplate = {
  key: string;
  title: string;
  questions: DiscoveryQuestionTemplate[];
};

const researchTemplate: DiscoverySectionTemplate[] = [
  {
    key: "problem-and-purpose",
    title: "Problema y propósito",
    questions: [
      {
        key: "problem-definition",
        text: "¿Qué problema, fenómeno o incógnita quieres investigar?",
        category: "Definición del problema",
        type: "long_text",
        required: true,
      },
      {
        key: "context-and-motivation",
        text: "¿Qué contexto y motivación hacen relevante esta investigación?",
        category: "Contexto y motivación",
        type: "long_text",
        required: true,
      },
      {
        key: "research-question",
        text: "Formula la pregunta principal de investigación.",
        category: "Pregunta de investigación",
        type: "long_text",
        required: true,
      },
      {
        key: "success-criteria",
        text: "¿Qué evidencia indicaría que la investigación fue útil o exitosa?",
        category: "Criterios de éxito",
        type: "long_text",
        required: true,
      },
    ],
  },
  {
    key: "people-and-scope",
    title: "Usuarios, beneficiarios y alcance",
    questions: [
      {
        key: "beneficiaries",
        text: "¿Quiénes usarán o se beneficiarán de los resultados?",
        category: "Usuarios o beneficiarios",
        type: "long_text",
        required: true,
      },
      {
        key: "scope-in",
        text: "¿Qué está incluido dentro del alcance inicial?",
        category: "Alcance",
        type: "long_text",
        required: true,
      },
      {
        key: "scope-out",
        text: "¿Qué queda explícitamente fuera del alcance?",
        category: "Alcance",
        type: "long_text",
        required: false,
      },
    ],
  },
  {
    key: "evidence-and-method",
    title: "Datos, fuentes y metodología",
    questions: [
      {
        key: "available-data",
        text: "¿Qué datos, muestras o materiales tienes disponibles?",
        category: "Datos disponibles",
        type: "long_text",
        required: true,
      },
      {
        key: "information-sources",
        text: "¿Qué fuentes de información, literatura o expertos puedes consultar?",
        category: "Fuentes de información",
        type: "long_text",
        required: false,
      },
      {
        key: "planned-methodology",
        text: "¿Qué metodología o enfoque prevés utilizar inicialmente?",
        category: "Metodología prevista",
        type: "long_text",
        required: true,
      },
      {
        key: "data-access-confirmed",
        text: "¿Ya está confirmado el acceso a los datos o materiales esenciales?",
        category: "Datos disponibles",
        type: "yes_no",
        required: true,
      },
    ],
  },
  {
    key: "resources-and-risks",
    title: "Herramientas, restricciones y riesgos",
    questions: [
      {
        key: "tools-and-technologies",
        text: "¿Qué tecnologías, herramientas o infraestructura planeas usar?",
        category: "Tecnologías o herramientas",
        type: "long_text",
        required: false,
      },
      {
        key: "constraints",
        text: "¿Qué restricciones técnicas, éticas, legales o de recursos existen?",
        category: "Restricciones",
        type: "long_text",
        required: true,
      },
      {
        key: "risks",
        text: "¿Cuáles son los principales riesgos o supuestos inciertos?",
        category: "Riesgos",
        type: "long_text",
        required: true,
      },
      {
        key: "team-experience",
        text: "Resume la experiencia y los conocimientos relevantes del equipo.",
        category: "Experiencia y conocimientos del equipo",
        type: "long_text",
        required: false,
      },
    ],
  },
  {
    key: "timeline-and-outputs",
    title: "Plazo y entregables",
    questions: [
      {
        key: "target-date",
        text: "¿Cuál es la fecha objetivo para obtener resultados útiles?",
        category: "Plazo",
        type: "date",
        required: true,
      },
      {
        key: "deliverables",
        text: "¿Qué entregables concretos esperas producir?",
        category: "Entregables",
        type: "long_text",
        required: true,
      },
      {
        key: "expected-output",
        text: "Selecciona el resultado principal esperado.",
        category: "Entregables",
        type: "single_select",
        required: true,
        options: [
          "Informe o publicación",
          "Dataset o recurso",
          "Prototipo o prueba de concepto",
          "Análisis exploratorio",
          "Otro",
        ],
      },
    ],
  },
];

const competitionTemplate: DiscoverySectionTemplate[] = [
  {
    key: "challenge-and-value",
    title: "Reto, problema y propuesta de valor",
    questions: [
      {
        key: "official-challenge",
        text: "Resume el reto oficial o la convocatoria.",
        category: "Reto oficial",
        type: "long_text",
        required: true,
      },
      {
        key: "problem-to-solve",
        text: "¿Qué problema concreto debe resolver la propuesta?",
        category: "Problema que debe resolverse",
        type: "long_text",
        required: true,
      },
      {
        key: "beneficiaries",
        text: "¿Quiénes son los usuarios o beneficiarios principales?",
        category: "Usuarios beneficiarios",
        type: "long_text",
        required: true,
      },
      {
        key: "value-proposition",
        text: "¿Cuál es la propuesta de valor inicial?",
        category: "Propuesta de valor",
        type: "long_text",
        required: true,
      },
      {
        key: "differentiation",
        text: "¿Qué podría diferenciar la solución frente a otras propuestas?",
        category: "Diferenciación",
        type: "long_text",
        required: false,
      },
    ],
  },
  {
    key: "rules-and-evaluation",
    title: "Reglas y evaluación",
    questions: [
      {
        key: "rules",
        text: "¿Cuáles son las reglas y restricciones más importantes?",
        category: "Reglas",
        type: "long_text",
        required: true,
      },
      {
        key: "evaluation-criteria",
        text: "¿Qué criterios utilizará el jurado para evaluar?",
        category: "Criterios de evaluación",
        type: "long_text",
        required: true,
      },
      {
        key: "mandatory-deliverables",
        text: "¿Qué entregables son obligatorios?",
        category: "Entregables obligatorios",
        type: "long_text",
        required: true,
      },
      {
        key: "deadline",
        text: "¿Cuál es la fecha límite oficial?",
        category: "Fecha límite",
        type: "date",
        required: true,
      },
    ],
  },
  {
    key: "technical-resources",
    title: "Requisitos técnicos y recursos",
    questions: [
      {
        key: "technical-requirements",
        text: "¿Qué requerimientos técnicos debe cumplir la solución?",
        category: "Requerimientos técnicos",
        type: "long_text",
        required: true,
      },
      {
        key: "technology-rules",
        text: "¿Qué tecnologías están permitidas o prohibidas?",
        category: "Tecnologías permitidas o prohibidas",
        type: "long_text",
        required: false,
      },
      {
        key: "data-and-apis",
        text: "¿Qué datos, datasets o APIs están disponibles?",
        category: "Datos o APIs disponibles",
        type: "long_text",
        required: false,
      },
      {
        key: "external-api-required",
        text: "¿La solución depende de una API o servicio externo?",
        category: "Datos o APIs disponibles",
        type: "yes_no",
        required: true,
      },
    ],
  },
  {
    key: "team-and-feasibility",
    title: "Equipo, viabilidad y riesgos",
    questions: [
      {
        key: "team-composition",
        text: "¿Quiénes integran el equipo y qué rol puede asumir cada persona?",
        category: "Composición del equipo",
        type: "long_text",
        required: true,
      },
      {
        key: "team-skills",
        text: "¿Qué habilidades relevantes aporta el equipo y cuáles faltan?",
        category: "Habilidades de los integrantes",
        type: "long_text",
        required: true,
      },
      {
        key: "feasibility",
        text: "¿Por qué es viable construir una demostración dentro del plazo?",
        category: "Viabilidad",
        type: "long_text",
        required: true,
      },
      {
        key: "risks",
        text: "¿Qué riesgos técnicos, de alcance o presentación anticipas?",
        category: "Riesgos",
        type: "long_text",
        required: true,
      },
    ],
  },
  {
    key: "impact-and-pitch",
    title: "Impacto, presentación y éxito",
    questions: [
      {
        key: "impact",
        text: "¿Qué impacto medible podría producir la solución?",
        category: "Impacto",
        type: "long_text",
        required: true,
      },
      {
        key: "pitch-format",
        text: "¿Qué formato tendrá la presentación o pitch?",
        category: "Presentación o pitch",
        type: "single_select",
        required: true,
        options: [
          "Presentación en vivo",
          "Video grabado",
          "Documento escrito",
          "Demo técnica",
          "Combinación de formatos",
        ],
      },
      {
        key: "success-definition",
        text: "¿Cómo definirá el equipo que su participación fue exitosa?",
        category: "Definición de éxito",
        type: "long_text",
        required: true,
      },
    ],
  },
];

export function getDiscoveryTemplate(
  projectType: ProjectType,
): DiscoverySectionTemplate[] {
  return projectType === "research"
    ? researchTemplate
    : competitionTemplate;
}
