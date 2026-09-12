import { z } from "zod";
import { domainIdSchema, requiredTextSchema } from "../curriculum/primitives.js";

/** Knowledge state describes research, never evidence sufficiency. No defaults. */
export function profileKnowledgeSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("known"), value }).strict(),
    z.object({ state: z.literal("unknown"), reason: requiredTextSchema.optional() }).strict(),
    z.object({ state: z.literal("not_applicable"), reason: requiredTextSchema }).strict(),
  ]);
}

export const profileKnowledgeRelevanceSchema = z.enum([
  "initial_intelligibility",
  "age_expression",
  "age_realization",
]);
const applicabilitySchema = z.enum([
  "systematic", "common", "restricted", "optional", "context_dependent", "absent",
]);
const variationSchema = z.enum([
  "none_known", "regional", "register", "social", "lexical", "construction_specific",
]);

export const languageMechanismV2Schema = z.object({
  mechanismId: domainIdSchema,
  role: requiredTextSchema,
  applicability: applicabilitySchema,
  conditions: z.array(requiredTextSchema),
  variation: variationSchema,
  relevance: z.array(profileKnowledgeRelevanceSchema),
}).strict();

export const languageFeatureV2Schema = z.object({
  featureId: domainIdSchema,
  description: requiredTextSchema,
  applicability: applicabilitySchema,
  values: z.array(requiredTextSchema),
  mechanisms: z.array(languageMechanismV2Schema),
  conditions: z.array(requiredTextSchema),
  variation: variationSchema,
  relevance: z.array(profileKnowledgeRelevanceSchema),
}).strict().superRefine((feature, context) => {
  if (feature.applicability === "absent" && (
    feature.values.length > 0 ||
    feature.mechanisms.some((mechanism) => mechanism.applicability !== "absent")
  )) {
    context.addIssue({ code: "custom", message: "An absent phenomenon cannot have active values or mechanisms" });
  }
});
export type LanguageFeatureV2 = z.infer<typeof languageFeatureV2Schema>;

const feature = profileKnowledgeSchema(languageFeatureV2Schema);
const featureCollection = profileKnowledgeSchema(z.array(languageFeatureV2Schema));
const textList = z.array(requiredTextSchema).min(1);
const scriptSchema = z.object({
  scriptId: domainIdSchema,
  name: requiredTextSchema,
  family: z.enum(["latin", "cyrillic", "greek", "arabic", "hebrew", "han", "kana", "hangul", "devanagari", "thai", "other"]),
  role: z.enum(["primary", "secondary", "auxiliary"]),
  usage: requiredTextSchema,
  coexistsWith: z.array(domainIdSchema),
}).strict();

/** All fields are explicit slots; structural values retain their own types. */
export const profileKnowledgeSectionsV2Schema = z.object({
  identity: z.object({
    regionScope: profileKnowledgeSchema(textList),
    scriptScope: profileKnowledgeSchema(z.array(domainIdSchema).min(1)),
    referenceRegister: profileKnowledgeSchema(z.enum([
      "neutral_standard", "colloquial_standard", "formal_standard", "mixed_documented",
    ])),
  }).strict(),
  writingSystem: z.object({
    scripts: profileKnowledgeSchema(z.array(scriptSchema)),
    primaryScriptStrategy: profileKnowledgeSchema(z.object({
      strategy: z.enum(["single", "mixed", "contextual"]),
      scriptRefs: z.array(domainIdSchema).min(1),
    }).strict()),
    direction: profileKnowledgeSchema(z.enum(["ltr", "rtl", "vertical", "mixed"])),
    segmentation: profileKnowledgeSchema(z.enum([
      "space_delimited_words", "partial_spacing", "no_obligatory_word_spacing", "mixed", "other",
    ])),
    graphemeSoundRelationship: profileKnowledgeSchema(z.object({
      transparency: z.enum(["high", "moderate", "low", "mixed"]),
      description: requiredTextSchema,
    }).strict()),
    orthographicDepth: profileKnowledgeSchema(z.enum(["shallow", "moderate", "deep", "mixed"])),
    orthographicConventions: feature,
    diacritics: feature,
    transliterationSystems: profileKnowledgeSchema(z.array(z.object({
      systemId: domainIdSchema,
      name: requiredTextSchema,
      role: z.enum(["standard_romanization", "reference"]),
      targetScriptRefs: z.array(domainIdSchema).min(1),
      usage: requiredTextSchema,
    }).strict())),
  }).strict(),
  phonology: z.object({
    segmentalSystem: feature,
    syllableStructure: feature,
    stressSystem: feature,
    lexicalToneSystem: feature,
    lexicalPitchSystem: feature,
    lengthContrasts: feature,
    connectedSpeech: feature,
    phonotacticConstraints: feature,
    intelligibilityRelevantFeatures: featureCollection,
  }).strict(),
  nominalSystem: z.object({
    grammaticalGender: feature, nounClasses: feature, numberMarking: feature,
    caseMarking: feature, definiteness: feature, articlesAndDeterminers: feature,
    classifiers: feature, modification: feature, agreement: feature, possessionWithinNP: feature,
  }).strict(),
  participantReference: z.object({
    personDistinctions: feature, numberDistinctions: feature, genderDistinctions: feature,
    animacyDistinctions: feature, clusivity: feature, socialDistinctions: feature,
    pronounInventoryCharacteristics: feature, zeroReference: feature, nominalReference: feature,
    demonstrativeReference: feature, agreementBasedReference: feature, referencePersistence: feature,
  }).strict(),
  predicationSystem: z.object({
    identityPredication: feature, propertyPredication: feature, statePredication: feature,
    locationPredication: feature, existencePredication: feature, possessionPredication: feature,
  }).strict(),
  verbalSystem: z.object({
    personMarking: feature, numberMarking: feature, tense: feature, aspect: feature,
    mood: feature, polarity: feature, voice: feature, politenessMarking: feature,
    evidentiality: feature, auxiliaries: feature, particles: feature, serialization: feature,
    irregularity: feature,
  }).strict(),
  clauseStructure: z.object({
    canonicalOrders: profileKnowledgeSchema(textList),
    orderFlexibility: feature,
    argumentMarkingMechanisms: profileKnowledgeSchema(z.array(z.object({
      mechanismId: domainIdSchema,
      mechanism: z.enum(["word_order", "case", "adposition", "particle", "agreement", "clitic", "prosody", "context", "combination"]),
      applicability: applicabilitySchema,
      conditions: z.array(requiredTextSchema),
      relevance: z.array(profileKnowledgeRelevanceSchema),
    }).strict())),
    topicMechanisms: feature, questionFormation: feature, negation: feature,
    coordination: feature, basicSubordination: feature, informationStructure: feature,
  }).strict(),
  semanticSystems: z.object({
    numerals: feature, quantity: feature, age: feature, possession: feature, kinship: feature,
    time: feature, calendar: feature, space: feature, motion: feature, measurement: feature,
    comparison: feature, modality: feature,
  }).strict(),
  discourseSystem: z.object({
    topicContinuity: feature, referenceTracking: feature, ellipsis: feature,
    discourseParticles: feature, turnTaking: feature, backchannels: feature,
    repairPatterns: feature, informationPackaging: feature, cohesionStrategies: feature,
  }).strict(),
  sociolinguisticSystem: z.object({
    addressSystem: feature, politenessSystem: feature, honorificSystem: feature,
    registerVariation: feature, namingConventions: feature, sociallySensitiveQuestions: feature,
    interactionalNorms: feature,
  }).strict(),
}).strict();
export type ProfileKnowledgeSectionsV2 = z.infer<typeof profileKnowledgeSectionsV2Schema>;

export const profileKnowledgeSectionV2Schema = profileKnowledgeSectionsV2Schema.keyof();
type Section = keyof ProfileKnowledgeSectionsV2;
export type ProfileKnowledgeSlotId = {
  [S in Section]: `${S}.${Extract<keyof ProfileKnowledgeSectionsV2[S], string>}`;
}[Section];
type KnownValue<T> = T extends { state: "known"; value: infer V } ? V : never;
export type ProfileFeatureSlotId = {
  [S in Section]: {
    [F in keyof ProfileKnowledgeSectionsV2[S]]:
      KnownValue<ProfileKnowledgeSectionsV2[S][F]> extends LanguageFeatureV2 | LanguageFeatureV2[]
        ? `${S}.${Extract<F, string>}` : never;
  }[keyof ProfileKnowledgeSectionsV2[S]];
}[Section];

// The only slot authority is the schema above. These are enum values, not paths.
const slotEntries = Object.entries(profileKnowledgeSectionsV2Schema.shape).flatMap(
  ([section, schema]) => Object.entries(schema.shape).map(([field, fieldSchema]) => ({
    slot: `${section}.${field}` as ProfileKnowledgeSlotId,
    feature: fieldSchema === feature || fieldSchema === featureCollection,
  })),
);
export const profileKnowledgeSlotIdSchema = z.enum(
  slotEntries.map(({ slot }) => slot) as [ProfileKnowledgeSlotId, ...ProfileKnowledgeSlotId[]],
);
export const profileFeatureSlotIdSchema = z.enum(
  slotEntries.filter((entry) => entry.feature).map(({ slot }) => slot) as [ProfileFeatureSlotId, ...ProfileFeatureSlotId[]],
);

export const profileKnowledgeSlotRefSchema = z.object({
  kind: z.literal("slot"), slot: profileKnowledgeSlotIdSchema,
}).strict();
export const profileKnowledgeSubjectRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), section: profileKnowledgeSectionV2Schema }).strict(),
  profileKnowledgeSlotRefSchema,
  z.object({ kind: z.literal("feature"), slot: profileFeatureSlotIdSchema, featureId: domainIdSchema }).strict(),
  z.object({
    kind: z.literal("feature_mechanism"), slot: profileFeatureSlotIdSchema,
    featureId: domainIdSchema, mechanismId: domainIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("structural_item"),
    slot: z.enum(["writingSystem.scripts", "writingSystem.transliterationSystems", "clauseStructure.argumentMarkingMechanisms"]),
    itemId: domainIdSchema,
  }).strict(),
]);
export type ProfileKnowledgeSubjectRef = z.infer<typeof profileKnowledgeSubjectRefSchema>;

type KnowledgeIdKind = "feature" | "mechanism" | "script" | "system";
type KnowledgeOccurrence = {
  kind: KnowledgeIdKind; id: string; path: (string | number)[];
  subjectRef: ProfileKnowledgeSubjectRef | null;
};

/** Inspect only declared ID/reference positions, independently of wrapper state
 * and unrelated fields. Parsing an ID never implies its containing value is valid.
 */
function collectKnowledgeIntegrity(sections: unknown) {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const occurrences: KnowledgeOccurrence[] = [];
  const scriptReferences: { refs: { id: string; path: (string | number)[] }[]; subjectRef: ProfileKnowledgeSubjectRef | null }[] = [];
  const subjectRef = (raw: unknown) => {
    const subject = profileKnowledgeSubjectRefSchema.safeParse(raw);
    return subject.success ? subject.data : null;
  };
  const add = (kind: KnowledgeIdKind, rawId: unknown, path: (string | number)[], rawSubject: unknown) => {
    const id = domainIdSchema.safeParse(rawId);
    if (id.success) occurrences.push({ kind, id: id.data, path, subjectRef: subjectRef(rawSubject) });
  };
  const references = (raw: unknown, path: (string | number)[], subject: unknown) => {
    if (!Array.isArray(raw)) return;
    const refs = raw.flatMap((rawId, index) => {
      const id = domainIdSchema.safeParse(rawId);
      return id.success ? [{ id: id.data, path: [...path, index] }] : [];
    });
    scriptReferences.push({ refs, subjectRef: subjectRef(subject) });
  };
  for (const slot of profileKnowledgeSlotIdSchema.options) {
    const [section, field] = slot.split(".") as [string, string];
    const knowledge = record(record(record(sections)[section])[field]);
    const valuePath = ["knowledge", section, field, "value"];
    if (slot === "identity.scriptScope") references(knowledge.value, valuePath, { kind: "slot", slot });
    if (slot === "writingSystem.primaryScriptStrategy") {
      references(record(knowledge.value).scriptRefs, [...valuePath, "scriptRefs"], { kind: "slot", slot });
    }
    const collection = Array.isArray(knowledge.value);
    const entries = collection ? knowledge.value as unknown[] : [knowledge.value];
    entries.forEach((raw, index) => {
      const entry = record(raw);
      const path: (string | number)[] = ["knowledge", section, field, "value", ...(collection ? [index] : [])];
      if (profileFeatureSlotIdSchema.safeParse(slot).success) {
        add("feature", entry.featureId, [...path, "featureId"], { kind: "feature", slot, featureId: entry.featureId });
        if (Array.isArray(entry.mechanisms)) entry.mechanisms.forEach((rawMechanism, mechanismIndex) => {
          const mechanism = record(rawMechanism);
          add("mechanism", mechanism.mechanismId, [...path, "mechanisms", mechanismIndex, "mechanismId"],
            { kind: "feature_mechanism", slot, featureId: entry.featureId, mechanismId: mechanism.mechanismId });
        });
      } else if (slot === "clauseStructure.argumentMarkingMechanisms") {
        add("mechanism", entry.mechanismId, [...path, "mechanismId"], { kind: "structural_item", slot, itemId: entry.mechanismId });
      } else if (slot === "writingSystem.scripts") {
        const subject = { kind: "structural_item", slot, itemId: entry.scriptId };
        add("script", entry.scriptId, [...path, "scriptId"], subject);
        references(entry.coexistsWith, [...path, "coexistsWith"], subject);
      } else if (slot === "writingSystem.transliterationSystems") {
        const subject = { kind: "structural_item", slot, itemId: entry.systemId };
        add("system", entry.systemId, [...path, "systemId"], subject);
        references(entry.targetScriptRefs, [...path, "targetScriptRefs"], subject);
      }
    });
  }
  return { occurrences, scriptReferences };
}

function duplicateKnowledgeIds(occurrences: KnowledgeOccurrence[]): z.ZodIssue[] {
  const counts = new Map<string, number>();
  for (const entry of occurrences) {
    const id = `${entry.kind}:${entry.id}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return occurrences.filter((entry) => counts.get(`${entry.kind}:${entry.id}`)! > 1).map((entry) => ({
    code: "custom", path: entry.path, message: `Duplicate ${entry.kind} ID: ${entry.id}`,
    params: { subjectRef: entry.subjectRef },
  }));
}

/** All four owned ID namespaces. Mechanisms share a namespace across feature
 * and structural slots; scripts and systems each have their own inventory.
 */
export function profileKnowledgeIdentityIssues(sections: unknown): z.ZodIssue[] {
  return duplicateKnowledgeIds(collectKnowledgeIntegrity(sections).occurrences);
}

/** Shared S1/S2 integrity boundary before structural parsing. Each determinable
 * issue keeps its raw path and a legitimate subject, or null if unaddressable.
 * Reference uniqueness is scoped to each list, never across lists.
 */
export function profileKnowledgeIntegrityIssues(sections: unknown): z.ZodIssue[] {
  const { occurrences, scriptReferences } = collectKnowledgeIntegrity(sections);
  const issues = duplicateKnowledgeIds(occurrences);
  const scriptCounts = new Map<string, number>();
  for (const entry of occurrences.filter((entry) => entry.kind === "script")) {
    scriptCounts.set(entry.id, (scriptCounts.get(entry.id) ?? 0) + 1);
  }
  for (const { refs, subjectRef } of scriptReferences) {
    const counts = new Map<string, number>();
    for (const { id } of refs) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const { id, path } of refs) {
      const messages = [
        ...(counts.get(id)! > 1 ? ["Duplicate reference or ID"] : []),
        ...(!scriptCounts.has(id) ? ["Unknown script reference"] : scriptCounts.get(id)! > 1 ? ["Ambiguous script reference"] : []),
      ];
      for (const message of messages) issues.push({ code: "custom", path, message, params: { subjectRef } });
    }
  }
  return issues;
}

/** Whole-slot/feature references include their descendants; siblings do not. */
export function profileSubjectsOverlap(a: ProfileKnowledgeSubjectRef, b: ProfileKnowledgeSubjectRef): boolean {
  if (a.kind === "section") return b.kind === "section" ? a.section === b.section : b.slot.startsWith(`${a.section}.`);
  if (b.kind === "section") return a.slot.startsWith(`${b.section}.`);
  if (a.slot !== b.slot) return false;
  if (a.kind === "slot" || b.kind === "slot") return true;
  if (a.kind === "structural_item" || b.kind === "structural_item") return a.kind === "structural_item" && b.kind === "structural_item" && a.itemId === b.itemId;
  return a.featureId === b.featureId && (a.kind !== "feature_mechanism" || b.kind !== "feature_mechanism" || a.mechanismId === b.mechanismId);
}

/** Deterministic lookup of a validated, closed slot ID; never evaluates a path. */
export function profileKnowledgeSlotValue(sections: ProfileKnowledgeSectionsV2, slot: ProfileKnowledgeSlotId) {
  const [section, field] = slot.split(".") as [Section, string];
  return (sections[section] as Record<string, { state: string; value?: unknown }>)[field]!;
}

export function profileSubjectExists(sections: unknown, subject: ProfileKnowledgeSubjectRef): boolean {
  if (subject.kind === "section" || subject.kind === "slot") return true;
  // Validate only the referenced slot: unrelated malformed knowledge must not
  // suppress claim integrity checks or invalidate a healthy sibling claim.
  const [section, field] = subject.slot.split(".") as [Section, string];
  if (!sections || typeof sections !== "object" || !(section in sections)) return false;
  const fields = (sections as Record<string, unknown>)[section];
  if (!fields || typeof fields !== "object") return false;
  const schema = (profileKnowledgeSectionsV2Schema.shape[section].shape as Record<string, z.ZodTypeAny>)[field]!;
  const parsed = schema.safeParse((fields as Record<string, unknown>)[field]);
  if (!parsed.success) return false;
  const knowledge = parsed.data as { state: string; value?: unknown };
  if (knowledge.state !== "known") return false;
  const items = Array.isArray(knowledge.value) ? knowledge.value : [knowledge.value];
  if (subject.kind === "structural_item") {
    return items.some((item) => {
      const entry = item as { scriptId?: string; systemId?: string; mechanismId?: string };
      return (entry.scriptId ?? entry.systemId ?? entry.mechanismId) === subject.itemId;
    });
  }
  const found = (items as LanguageFeatureV2[]).find((item) => item.featureId === subject.featureId);
  return !!found && (subject.kind === "feature" || found.mechanisms.some((item) => item.mechanismId === subject.mechanismId));
}
