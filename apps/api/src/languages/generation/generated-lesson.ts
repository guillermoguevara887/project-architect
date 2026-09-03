import { z } from "zod";
import {
  domainIdSchema,
  requiredTextSchema,
  semanticVersionSchema,
  supportLevelSchema,
  versionedRefSchema,
} from "../curriculum/primitives.js";
import {
  validationIssue,
  validationResult,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";
import {
  lessonSpecSchema,
  validateLessonSpec,
  type LessonSpec,
} from "../lessons/lesson-spec.js";

const idListSchema = z.array(domainIdSchema);
const textListSchema = z.array(requiredTextSchema);

const generatedBlockTypeSchema = z.enum([
  "context",
  "input",
  "notice",
  "micro_explanation",
  "guided_practice",
  "retrieval",
  "communicative_practice",
  "pronunciation",
  "literacy",
  "integration",
  "assessment",
]);

const responseModeSchema = z.enum([
  "none",
  "selection",
  "short_text",
  "spoken",
  "written",
  "interaction",
  "reconstruction",
]);

const generatedContentItemSchema = z
  .object({
    itemId: domainIdSchema,
    itemType: z.enum([
      "target_text",
      "explanation",
      "instruction",
      "prompt",
      "dialogue_turn",
      "choice",
      "hint",
      "model",
      "feedback",
      "note",
    ]),
    languageRole: z.enum(["target", "explanation", "mixed", "none"]),
    text: requiredTextSchema,
    speaker: requiredTextSchema.optional(),
    targetRefs: idListSchema,
    inventoryRefs: idListSchema,
    responseRequired: z.boolean(),
  })
  .strict();

const generatedBlockSchema = z
  .object({
    blockId: domainIdSchema,
    sourceBlockRef: domainIdSchema,
    blockType: generatedBlockTypeSchema,
    title: requiredTextSchema,
    targetRefs: idListSchema,
    items: z.array(generatedContentItemSchema).min(1),
  })
  .strict();

const generatedPracticeSchema = z
  .object({
    activityId: domainIdSchema,
    sourcePracticeRef: domainIdSchema,
    prompt: requiredTextSchema,
    responseMode: responseModeSchema.exclude(["none"]),
    supportLevel: supportLevelSchema,
    targetRefs: idListSchema.min(1),
    inventoryRefs: idListSchema,
    hint: z.string().optional(),
  })
  .strict();

const generatedPronunciationSchema = z
  .object({
    activityId: domainIdSchema,
    sourceTargetRef: domainIdSchema,
    instructions: requiredTextSchema,
    targetRefs: idListSchema.min(1),
    inventoryRefs: idListSchema,
  })
  .strict();

const generatedLiteracySchema = z
  .object({
    activityId: domainIdSchema,
    sourceTargetRef: domainIdSchema,
    instructions: requiredTextSchema,
    targetRefs: idListSchema.min(1),
    inventoryRefs: idListSchema,
  })
  .strict();

const generatedAssessmentSchema = z
  .object({
    assessmentItemId: domainIdSchema,
    sourceEvidenceItemRef: domainIdSchema,
    prompt: requiredTextSchema,
    responseMode: responseModeSchema.exclude(["none"]),
    targetRefs: idListSchema.min(1),
    inventoryRefs: idListSchema,
    requestsPersonalData: z.boolean(),
    personalDataMode: z.enum([
      "not_applicable",
      "fictitious_or_voluntary",
    ]),
    rubricPoints: textListSchema.min(1),
  })
  .strict();

export const generatedLessonCandidateSchema = z
  .object({
    title: requiredTextSchema.max(180),
    learnerObjective: requiredTextSchema,
    blocks: z.array(generatedBlockSchema).min(1),
    practiceActivities: z.array(generatedPracticeSchema),
    pronunciationActivities: z.array(generatedPronunciationSchema),
    literacyActivities: z.array(generatedLiteracySchema),
    assessmentItems: z.array(generatedAssessmentSchema),
    declaredCoverage: z
      .object({
        capabilityRefs: idListSchema,
        realizationRefs: idListSchema,
        functionRefs: idListSchema,
        patternRefs: idListSchema,
        productionTargetRefs: idListSchema,
      })
      .strict(),
    inventoryUsage: z
      .object({
        patternRefs: idListSchema,
        lexemeRefs: idListSchema,
        functionItemRefs: idListSchema,
        pronunciationRefs: idListSchema,
        literacyRefs: idListSchema,
      })
      .strict(),
  })
  .strict();

export type GeneratedLessonCandidate = z.infer<
  typeof generatedLessonCandidateSchema
>;

export const generatedLessonSchema = z
  .object({
    identity: z
      .object({
        generatedLessonId: z.string().uuid(),
        generationRunId: z.string().uuid(),
        lessonSpecRef: versionedRefSchema,
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
        levelId: domainIdSchema,
        unitId: domainIdSchema,
        routeNodeRef: domainIdSchema,
      })
      .strict(),
    content: generatedLessonCandidateSchema,
    version: semanticVersionSchema,
    status: z.literal("accepted"),
  })
  .strict();

export type GeneratedLesson = z.infer<typeof generatedLessonSchema>;

function duplicateRefIssues(
  refs: string[],
  path: string,
  label: string,
): ValidationIssue[] {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  refs.forEach((ref, index) => {
    if (seen.has(ref)) {
      issues.push(
        validationIssue(
          "DUPLICATE_GENERATED_REFERENCE",
          `${path}.${index}`,
          `Duplicate ${label} ${ref}.`,
          { relatedRefs: [ref] },
        ),
      );
    }
    seen.add(ref);
  });
  return issues;
}

function generatedRefs(candidate: GeneratedLessonCandidate) {
  const refs = new Set<string>();
  const add = (values: string[]) => values.forEach((value) => refs.add(value));

  candidate.blocks.forEach((block) => {
    add(block.targetRefs);
    block.items.forEach((item) => {
      add(item.targetRefs);
      add(item.inventoryRefs);
    });
  });
  candidate.practiceActivities.forEach((item) => {
    add(item.targetRefs);
    add(item.inventoryRefs);
  });
  candidate.pronunciationActivities.forEach((item) => {
    add(item.targetRefs);
    add(item.inventoryRefs);
  });
  candidate.literacyActivities.forEach((item) => {
    add(item.targetRefs);
    add(item.inventoryRefs);
  });
  candidate.assessmentItems.forEach((item) => {
    add(item.targetRefs);
    add(item.inventoryRefs);
  });
  add(candidate.declaredCoverage.capabilityRefs);
  add(candidate.declaredCoverage.realizationRefs);
  add(candidate.declaredCoverage.functionRefs);
  add(candidate.declaredCoverage.patternRefs);
  add(candidate.declaredCoverage.productionTargetRefs);
  add(candidate.inventoryUsage.patternRefs);
  add(candidate.inventoryUsage.lexemeRefs);
  add(candidate.inventoryUsage.functionItemRefs);
  add(candidate.inventoryUsage.pronunciationRefs);
  add(candidate.inventoryUsage.literacyRefs);

  return refs;
}

function authorizedTargetRefs(lesson: LessonSpec) {
  return new Set([
    ...lesson.curriculumBinding.capabilityRefs,
    ...lesson.curriculumBinding.realizationRefs,
    ...lesson.curriculumBinding.sourceAdaptedStepRefs,
    ...lesson.curriculumBinding.assessmentCriterionRefs,
    ...lesson.inputTargets.mustRecognize,
    ...lesson.inputTargets.mayEncounter,
    ...lesson.inputTargets.comprehensionFunctions,
    ...lesson.productiveTargets.requiredFunctions,
    ...lesson.productiveTargets.requiredPatternRefs,
    ...lesson.productiveTargets.productionTargetRefs,
    ...lesson.productiveTargets.deferredAlternatives,
    ...lesson.generationConstraints.mustUse,
    ...lesson.generationConstraints.mustIncludeFunctions,
    ...lesson.generationConstraints.allowedLexicalDomains,
    ...lesson.contentArchitecture.blocks.flatMap((block) => block.targetRefs),
    ...lesson.practicePlan.flatMap((practice) => practice.targetRefs),
    ...lesson.pronunciationPlan.targetRefs,
    ...lesson.literacyPlan.scriptRefs,
    ...lesson.literacyPlan.recognitionItems,
    ...lesson.literacyPlan.productionItems,
    ...lesson.assessmentPlan.evidenceItems.flatMap((item) => [
      ...item.capabilityRefs,
      ...item.realizationRefs,
    ]),
  ]);
}

function authorizedInventoryRefs(lesson: LessonSpec) {
  return new Set([
    ...lesson.languageInventory.patterns.map((item) => item.patternRef),
    ...lesson.languageInventory.coreLexicon.map((item) => item.lexemeId),
    ...lesson.languageInventory.supportingLexicon.map((item) => item.lexemeId),
    ...lesson.languageInventory.recycledLexicon.map((item) => item.lexemeId),
    ...lesson.languageInventory.functionItems.map((item) => item.itemId),
    ...lesson.languageInventory.pronunciationItems.map((item) => item.targetRef),
    ...lesson.languageInventory.literacyItems.map((item) => item.targetRef),
  ]);
}

function pushMissingCoverage(
  issues: ValidationIssue[],
  requiredRefs: string[],
  actualRefs: string[],
  path: string,
  code: string,
  label: string,
) {
  const actual = new Set(actualRefs);
  for (const ref of requiredRefs) {
    if (!actual.has(ref)) {
      issues.push(
        validationIssue(
          code,
          path,
          `Generated lesson is missing required ${label} ${ref}.`,
          { relatedRefs: [ref] },
        ),
      );
    }
  }
}

export function validateLessonSpecForGeneration(input: unknown): ValidationResult {
  const parsed = lessonSpecSchema.safeParse(input);
  if (!parsed.success) {
    return validationResult(zodIssuesToValidationIssues(parsed.error));
  }

  const lesson = parsed.data;
  const issues = [...validateLessonSpec(lesson).issues];

  if (lesson.status !== "canonical") {
    issues.push(
      validationIssue(
        "LESSON_SPEC_NOT_CANONICAL",
        "status",
        "Only canonical LessonSpec versions can enter production generation.",
      ),
    );
  }

  Object.entries(lesson.validation).forEach(([auditName, audit]) => {
    if (audit.status !== "pass") {
      issues.push(
        validationIssue(
          "LESSON_SPEC_AUDIT_NOT_PASSING",
          `validation.${auditName}`,
          `LessonSpec audit ${auditName} must pass before production generation.`,
        ),
      );
    }
  });

  return validationResult(issues);
}

export function validateGeneratedLessonCandidate(
  input: unknown,
  lesson: LessonSpec,
): ValidationResult {
  const parsed = generatedLessonCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return validationResult(zodIssuesToValidationIssues(parsed.error));
  }

  const candidate = parsed.data;
  const issues: ValidationIssue[] = [];
  const authorizedTargets = authorizedTargetRefs(lesson);
  const authorizedInventory = authorizedInventoryRefs(lesson);
  const forbidden = new Set([
    ...lesson.generationConstraints.mustNotIntroduce,
    ...lesson.generationConstraints.forbiddenPatternRefs,
  ]);

  const sourceBlocks = new Map(
    lesson.contentArchitecture.blocks.map((block) => [block.blockId, block] as const),
  );
  const generatedBlockRefs = candidate.blocks.map((block) => block.sourceBlockRef);
  issues.push(
    ...duplicateRefIssues(
      generatedBlockRefs,
      "blocks",
      "source block reference",
    ),
  );

  candidate.blocks.forEach((block, index) => {
    const source = sourceBlocks.get(block.sourceBlockRef);
    if (!source) {
      issues.push(
        validationIssue(
          "GENERATED_BLOCK_WITHOUT_SOURCE",
          `blocks.${index}.sourceBlockRef`,
          `Generated block ${block.sourceBlockRef} has no LessonSpec source block.`,
          { relatedRefs: [block.sourceBlockRef] },
        ),
      );
    } else if (source.blockType !== block.blockType) {
      issues.push(
        validationIssue(
          "GENERATED_BLOCK_TYPE_MISMATCH",
          `blocks.${index}.blockType`,
          `Generated block type ${block.blockType} does not match source type ${source.blockType}.`,
          { relatedRefs: [block.sourceBlockRef] },
        ),
      );
    }
  });

  pushMissingCoverage(
    issues,
    lesson.contentArchitecture.blocks.map((block) => block.blockId),
    generatedBlockRefs,
    "blocks",
    "REQUIRED_CONTENT_BLOCK_MISSING",
    "content block",
  );

  const requiredPractices = lesson.practicePlan.filter((item) => item.required);
  const practiceById = new Map(
    lesson.practicePlan.map((item) => [item.practiceId, item] as const),
  );
  const generatedPracticeRefs = candidate.practiceActivities.map(
    (item) => item.sourcePracticeRef,
  );
  issues.push(
    ...duplicateRefIssues(
      generatedPracticeRefs,
      "practiceActivities",
      "practice source reference",
    ),
  );
  pushMissingCoverage(
    issues,
    requiredPractices.map((item) => item.practiceId),
    generatedPracticeRefs,
    "practiceActivities",
    "REQUIRED_PRACTICE_MISSING",
    "practice",
  );

  candidate.practiceActivities.forEach((activity, index) => {
    const source = practiceById.get(activity.sourcePracticeRef);
    if (!source) {
      issues.push(
        validationIssue(
          "GENERATED_PRACTICE_WITHOUT_SOURCE",
          `practiceActivities.${index}.sourcePracticeRef`,
          `Practice ${activity.sourcePracticeRef} is absent from LessonSpec.`,
          { relatedRefs: [activity.sourcePracticeRef] },
        ),
      );
    } else if (source.supportLevel !== activity.supportLevel) {
      issues.push(
        validationIssue(
          "GENERATED_PRACTICE_SUPPORT_MISMATCH",
          `practiceActivities.${index}.supportLevel`,
          `Practice support must remain ${source.supportLevel}.`,
          { relatedRefs: [activity.sourcePracticeRef] },
        ),
      );
    }
  });

  const evidenceById = new Map(
    lesson.assessmentPlan.evidenceItems.map((item) => [item.evidenceItemId, item] as const),
  );
  const generatedEvidenceRefs = candidate.assessmentItems.map(
    (item) => item.sourceEvidenceItemRef,
  );
  issues.push(
    ...duplicateRefIssues(
      generatedEvidenceRefs,
      "assessmentItems",
      "evidence source reference",
    ),
  );
  pushMissingCoverage(
    issues,
    lesson.assessmentPlan.evidenceItems
      .filter((item) => item.required)
      .map((item) => item.evidenceItemId),
    generatedEvidenceRefs,
    "assessmentItems",
    "REQUIRED_ASSESSMENT_EVIDENCE_MISSING",
    "assessment evidence",
  );

  candidate.assessmentItems.forEach((item, index) => {
    if (!evidenceById.has(item.sourceEvidenceItemRef)) {
      issues.push(
        validationIssue(
          "GENERATED_ASSESSMENT_WITHOUT_SOURCE",
          `assessmentItems.${index}.sourceEvidenceItemRef`,
          `Assessment ${item.sourceEvidenceItemRef} is absent from LessonSpec.`,
          { relatedRefs: [item.sourceEvidenceItemRef] },
        ),
      );
    }
    if (
      lesson.generationConstraints.privacyConstraint ===
        "real_personal_data_not_required" &&
      item.requestsPersonalData &&
      item.personalDataMode !== "fictitious_or_voluntary"
    ) {
      issues.push(
        validationIssue(
          "GENERATED_ASSESSMENT_PRIVACY_VIOLATION",
          `assessmentItems.${index}.personalDataMode`,
          "Personal data tasks must explicitly allow fictitious or voluntary information.",
        ),
      );
    }
  });

  pushMissingCoverage(
    issues,
    lesson.pronunciationPlan.targetRefs,
    candidate.pronunciationActivities.map((item) => item.sourceTargetRef),
    "pronunciationActivities",
    "REQUIRED_PRONUNCIATION_ACTIVITY_MISSING",
    "pronunciation target",
  );
  pushMissingCoverage(
    issues,
    [
      ...lesson.literacyPlan.recognitionItems,
      ...lesson.literacyPlan.productionItems,
    ],
    candidate.literacyActivities.map((item) => item.sourceTargetRef),
    "literacyActivities",
    "REQUIRED_LITERACY_ACTIVITY_MISSING",
    "literacy target",
  );

  const allTargetRefs = [
    ...candidate.blocks.flatMap((block) => [
      ...block.targetRefs,
      ...block.items.flatMap((item) => item.targetRefs),
    ]),
    ...candidate.practiceActivities.flatMap((item) => item.targetRefs),
    ...candidate.pronunciationActivities.flatMap((item) => item.targetRefs),
    ...candidate.literacyActivities.flatMap((item) => item.targetRefs),
    ...candidate.assessmentItems.flatMap((item) => item.targetRefs),
    ...candidate.declaredCoverage.capabilityRefs,
    ...candidate.declaredCoverage.realizationRefs,
    ...candidate.declaredCoverage.functionRefs,
    ...candidate.declaredCoverage.patternRefs,
    ...candidate.declaredCoverage.productionTargetRefs,
  ];
  allTargetRefs.forEach((ref, index) => {
    if (!authorizedTargets.has(ref) && !authorizedInventory.has(ref)) {
      issues.push(
        validationIssue(
          "GENERATED_TARGET_REF_NOT_AUTHORIZED",
          `generatedRefs.${index}`,
          `Generated target reference ${ref} is not authorized by LessonSpec.`,
          { relatedRefs: [ref] },
        ),
      );
    }
  });

  const allInventoryRefs = [
    ...candidate.blocks.flatMap((block) =>
      block.items.flatMap((item) => item.inventoryRefs),
    ),
    ...candidate.practiceActivities.flatMap((item) => item.inventoryRefs),
    ...candidate.pronunciationActivities.flatMap((item) => item.inventoryRefs),
    ...candidate.literacyActivities.flatMap((item) => item.inventoryRefs),
    ...candidate.assessmentItems.flatMap((item) => item.inventoryRefs),
    ...candidate.inventoryUsage.patternRefs,
    ...candidate.inventoryUsage.lexemeRefs,
    ...candidate.inventoryUsage.functionItemRefs,
    ...candidate.inventoryUsage.pronunciationRefs,
    ...candidate.inventoryUsage.literacyRefs,
  ];
  allInventoryRefs.forEach((ref, index) => {
    if (!authorizedInventory.has(ref)) {
      issues.push(
        validationIssue(
          "GENERATED_INVENTORY_REF_NOT_AUTHORIZED",
          `inventoryRefs.${index}`,
          `Generated inventory reference ${ref} is not in LessonSpec inventory.`,
          { relatedRefs: [ref] },
        ),
      );
    }
  });

  const referenced = generatedRefs(candidate);
  forbidden.forEach((ref) => {
    if (referenced.has(ref)) {
      issues.push(
        validationIssue(
          "FORBIDDEN_GENERATION_REFERENCE_USED",
          "generationConstraints",
          `Generated lesson uses forbidden reference ${ref}.`,
          { relatedRefs: [ref] },
        ),
      );
    }
  });

  lesson.generationConstraints.mustUse.forEach((ref) => {
    if (!referenced.has(ref)) {
      issues.push(
        validationIssue(
          "GENERATION_MUST_USE_REF_MISSING",
          "generationConstraints.mustUse",
          `Required generation reference ${ref} is missing.`,
          { relatedRefs: [ref] },
        ),
      );
    }
  });

  pushMissingCoverage(
    issues,
    lesson.generationConstraints.mustIncludeFunctions,
    candidate.declaredCoverage.functionRefs,
    "declaredCoverage.functionRefs",
    "REQUIRED_FUNCTION_NOT_COVERED",
    "function",
  );
  pushMissingCoverage(
    issues,
    lesson.productiveTargets.requiredFunctions,
    candidate.declaredCoverage.functionRefs,
    "declaredCoverage.functionRefs",
    "PRODUCTIVE_FUNCTION_NOT_COVERED",
    "productive function",
  );
  pushMissingCoverage(
    issues,
    lesson.productiveTargets.requiredPatternRefs,
    candidate.inventoryUsage.patternRefs,
    "inventoryUsage.patternRefs",
    "REQUIRED_PATTERN_NOT_USED",
    "productive pattern",
  );
  pushMissingCoverage(
    issues,
    lesson.productiveTargets.productionTargetRefs,
    candidate.declaredCoverage.productionTargetRefs,
    "declaredCoverage.productionTargetRefs",
    "PRODUCTION_TARGET_NOT_COVERED",
    "production target",
  );
  pushMissingCoverage(
    issues,
    lesson.curriculumBinding.capabilityRefs,
    candidate.declaredCoverage.capabilityRefs,
    "declaredCoverage.capabilityRefs",
    "LESSON_CAPABILITY_NOT_COVERED",
    "capability",
  );
  pushMissingCoverage(
    issues,
    lesson.curriculumBinding.realizationRefs,
    candidate.declaredCoverage.realizationRefs,
    "declaredCoverage.realizationRefs",
    "LESSON_REALIZATION_NOT_COVERED",
    "realization",
  );

  if (lesson.variationPolicy.frozen.includes("core_lexicon")) {
    pushMissingCoverage(
      issues,
      lesson.languageInventory.coreLexicon.map((item) => item.lexemeId),
      candidate.inventoryUsage.lexemeRefs,
      "inventoryUsage.lexemeRefs",
      "FROZEN_CORE_LEXICON_NOT_USED",
      "core lexeme",
    );
  }

  return validationResult(issues);
}
