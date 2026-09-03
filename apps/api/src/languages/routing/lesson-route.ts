import { z } from "zod";
import { findDirectedCycle } from "../curriculum/graph.js";
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
  loadDegreeSchema,
  productiveStatusSchema,
  type AdaptedUnitSpec,
} from "../adapted/adapted-unit-spec.js";

const idListSchema = z.array(domainIdSchema);
const textListSchema = z.array(requiredTextSchema);

const scalePolicySchema = z
  .object({
    metric: z.enum([
      "words",
      "characters",
      "utterances",
      "turns",
      "clauses",
      "semantic_units",
      "task_completion",
    ]),
    min: z.number().nonnegative().optional(),
    target: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
    equivalenceAllowed: z.boolean(),
  })
  .strict();

const productionTargetSchema = z
  .object({
    productionTargetId: domainIdSchema,
    role: z.enum(["primary", "supporting"]),
    artifactType: domainIdSchema,
    requiredSemanticUnits: idListSchema,
    realizationRefs: idListSchema,
    scalePolicy: scalePolicySchema,
  })
  .strict();

const routeNodeSchema = z
  .object({
    nodeId: domainIdSchema,
    orderHint: z.number().int().positive(),
    primaryRole: z.enum([
      "acquisition",
      "practice",
      "integration",
      "review",
      "literacy",
      "pronunciation",
      "bridge",
      "assessment",
    ]),
    secondaryRoles: z.array(
      z.enum([
        "acquisition",
        "practice",
        "integration",
        "review",
        "literacy",
        "pronunciation",
        "bridge",
        "assessment",
      ]),
    ),
    mission: requiredTextSchema,
    sourceAdaptedStepRefs: idListSchema.min(1),
    capabilityRefs: idListSchema.min(1),
    realizationRefs: idListSchema,
    newLoad: z
      .object({
        structural: loadDegreeSchema,
        lexical: loadDegreeSchema,
        phonological: loadDegreeSchema,
        literacy: loadDegreeSchema,
        discourse: loadDegreeSchema,
      })
      .strict(),
    recycledLoad: z
      .object({
        capabilityRefs: idListSchema,
        realizationRefs: idListSchema,
        patternRefs: idListSchema,
        lexicalDomainRefs: idListSchema,
      })
      .strict(),
    supportLevel: supportLevelSchema,
    productionTargets: z.array(productionTargetSchema),
    assessmentRole: z.enum([
      "none",
      "practice_evidence",
      "checkpoint",
      "terminal_evidence",
    ]),
    dependencyPolicy: z.enum(["hard", "soft", "none"]),
    estimatedScope: z
      .object({
        minutes: z.number().int().positive().optional(),
        activityBlocks: z.number().int().positive().optional(),
      })
      .strict(),
    optional: z.boolean(),
  })
  .strict();

const routeEdgeSchema = z
  .object({
    fromNodeRef: domainIdSchema,
    toNodeRef: domainIdSchema,
    relation: z.enum([
      "requires",
      "recommended_after",
      "reinforces",
      "prepares_for",
    ]),
  })
  .strict();

const coverageEntrySchema = z
  .object({
    capabilityRef: domainIdSchema,
    introducedAt: idListSchema,
    practicedAt: idListSchema,
    integratedAt: idListSchema,
    assessedAt: idListSchema,
    terminalEvidenceAt: idListSchema,
  })
  .strict();

const realizationCoverageEntrySchema = z
  .object({
    realizationRef: domainIdSchema,
    exposedAt: idListSchema,
    productiveAt: idListSchema,
    recycledAt: idListSchema,
    assessedAt: idListSchema,
  })
  .strict();

const auditSchema = z
  .object({
    status: z.enum(["not_run", "pass", "fail"]),
    findings: textListSchema,
  })
  .strict();

export const lessonRouteSchema = z
  .object({
    identity: z
      .object({
        routeId: domainIdSchema,
        curriculumId: domainIdSchema,
        unitId: domainIdSchema,
        levelId: domainIdSchema,
        languageId: domainIdSchema,
        varietyId: domainIdSchema,
      })
      .strict(),
    sourceBinding: z
      .object({
        adaptedUnitSpecRef: versionedRefSchema,
      })
      .strict(),
    routePolicy: z
      .object({
        progressionShape: z.enum([
          "linear",
          "guided_to_independent",
          "spiral",
          "integration_heavy",
        ]),
        maxNewStructuralLoadPerNode: loadDegreeSchema,
        supportProgression: requiredTextSchema,
        integrationPolicy: requiredTextSchema,
        recyclingPolicy: requiredTextSchema,
        optionalityPolicy: requiredTextSchema,
      })
      .strict(),
    nodes: z.array(routeNodeSchema).min(1),
    edges: z.array(routeEdgeSchema),
    coverageMap: z.array(coverageEntrySchema).min(1),
    realizationCoverage: z.array(realizationCoverageEntrySchema),
    recyclingPlan: z
      .object({
        immediate: idListSchema,
        shortRange: idListSchema,
        integration: idListSchema,
        priorityCapabilityRefs: idListSchema,
      })
      .strict(),
    loadPlan: z
      .object({
        early: requiredTextSchema,
        middle: requiredTextSchema,
        late: requiredTextSchema,
        terminal: requiredTextSchema,
      })
      .strict(),
    assessmentDistribution: z.array(
      z
        .object({
          criterionRef: domainIdSchema,
          nodeRefs: idListSchema.min(1),
        })
        .strict(),
    ),
    completionSemantics: z
      .object({
        viewed: requiredTextSchema,
        completed: requiredTextSchema,
        evidenceObserved: requiredTextSchema,
        mastered: requiredTextSchema,
      })
      .strict(),
    validation: z
      .object({
        coverageAudit: auditSchema,
        productiveCoreAudit: auditSchema,
        loadAudit: auditSchema,
        dependencyAudit: auditSchema,
        recyclingAudit: auditSchema,
        integrationAudit: auditSchema,
        supportAudit: auditSchema,
        assessmentAlignmentAudit: auditSchema,
        sourceTraceAudit: auditSchema,
      })
      .strict(),
    version: semanticVersionSchema,
    status: z.enum(["draft", "review", "canonical", "deprecated"]),
  })
  .strict();

export type LessonRoute = z.infer<typeof lessonRouteSchema>;

export type LessonRouteValidationContext = {
  adaptedUnit?: AdaptedUnitSpec;
};

const supportRank = {
  independent: 0,
  scaffolded: 1,
  guided: 2,
  highly_guided: 3,
} as const;

function pushDuplicateIds(
  issues: ValidationIssue[],
  entries: Array<{ id: string; path: string }>,
  label: string,
) {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push(
        validationIssue(
          "DUPLICATE_DOMAIN_ID",
          entry.path,
          `Duplicate ${label} ${entry.id}.`,
          { relatedRefs: [entry.id] },
        ),
      );
    }
    seen.add(entry.id);
  }
}

function refEqual(
  left: { id: string; version: string },
  right: { id: string; version: string },
) {
  return left.id === right.id && left.version === right.version;
}

export function validateLessonRoute(
  input: unknown,
  context: LessonRouteValidationContext = {},
): ValidationResult {
  const parsed = lessonRouteSchema.safeParse(input);
  if (!parsed.success) return validationResult(zodIssuesToValidationIssues(parsed.error));

  const route = parsed.data;
  const issues: ValidationIssue[] = [];
  pushDuplicateIds(
    issues,
    route.nodes.map((node, index) => ({ id: node.nodeId, path: `nodes.${index}.nodeId` })),
    "route node",
  );
  pushDuplicateIds(
    issues,
    route.coverageMap.map((entry, index) => ({
      id: entry.capabilityRef,
      path: `coverageMap.${index}.capabilityRef`,
    })),
    "capability coverage entry",
  );
  pushDuplicateIds(
    issues,
    route.realizationCoverage.map((entry, index) => ({
      id: entry.realizationRef,
      path: `realizationCoverage.${index}.realizationRef`,
    })),
    "realization coverage entry",
  );

  const nodeById = new Map(route.nodes.map((node) => [node.nodeId, node] as const));
  const nodeIds = route.nodes.map((node) => node.nodeId);
  route.edges.forEach((edge, index) => {
    if (!nodeById.has(edge.fromNodeRef) || !nodeById.has(edge.toNodeRef)) {
      issues.push(
        validationIssue(
          "BROKEN_ROUTE_NODE_REFERENCE",
          `edges.${index}`,
          `Route edge references an unknown node.`,
          { relatedRefs: [edge.fromNodeRef, edge.toNodeRef] },
        ),
      );
    }
  });
  const cycle = findDirectedCycle(
    nodeIds,
    route.edges
      .filter((edge) => edge.relation === "requires")
      .map((edge) => ({ from: edge.fromNodeRef, to: edge.toNodeRef })),
  );
  if (cycle) {
    issues.push(
      validationIssue(
        "CYCLE_DETECTED",
        "edges",
        `Hard route dependency cycle detected: ${cycle.join(" -> ")}.`,
        { relatedRefs: cycle },
      ),
    );
  }

  const allCoverageNodeRefs = (entry: z.infer<typeof coverageEntrySchema>) => [
    ...entry.introducedAt,
    ...entry.practicedAt,
    ...entry.integratedAt,
    ...entry.assessedAt,
    ...entry.terminalEvidenceAt,
  ];
  route.coverageMap.forEach((entry, index) => {
    allCoverageNodeRefs(entry).forEach((ref) => {
      if (!nodeById.has(ref)) {
        issues.push(
          validationIssue(
            "BROKEN_ROUTE_NODE_REFERENCE",
            `coverageMap.${index}`,
            `Coverage map references unknown node ${ref}.`,
            { relatedRefs: [ref] },
          ),
        );
      }
    });
  });
  route.realizationCoverage.forEach((entry, index) => {
    [...entry.exposedAt, ...entry.productiveAt, ...entry.recycledAt, ...entry.assessedAt].forEach(
      (ref) => {
        if (!nodeById.has(ref)) {
          issues.push(
            validationIssue(
              "BROKEN_ROUTE_NODE_REFERENCE",
              `realizationCoverage.${index}`,
              `Realization coverage references unknown node ${ref}.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      },
    );
  });

  route.nodes.forEach((node, index) => {
    if (node.assessmentRole === "terminal_evidence" && node.newLoad.structural === "heavy") {
      issues.push(
        validationIssue(
          "TERMINAL_NODE_HAS_HEAVY_NEW_STRUCTURE",
          `nodes.${index}.newLoad.structural`,
          "Terminal evidence nodes cannot introduce heavy new structural load.",
        ),
      );
    }
  });

  if (context.adaptedUnit) {
    const unit = context.adaptedUnit;
    if (
      !refEqual(route.sourceBinding.adaptedUnitSpecRef, {
        id: unit.identity.adaptedUnitId,
        version: unit.version,
      })
    ) {
      issues.push(
        validationIssue(
          "ADAPTED_UNIT_SOURCE_REF_MISMATCH",
          "sourceBinding.adaptedUnitSpecRef",
          "LessonRoute is not pinned to the supplied AdaptedUnitSpec.",
        ),
      );
    }

    const capabilityById = new Map(
      unit.capabilityRealizations.map((entry) => [entry.capabilityRef, entry] as const),
    );
    const realizationById = new Map(
      unit.languageRealizations.map((entry) => [entry.realizationId, entry] as const),
    );
    const adaptedStepIds = new Set(unit.adaptedLearningRoute.map((step) => step.adaptedStepId));
    const patternById = new Map(
      unit.linguisticTargets.patterns.map((pattern) => [pattern.patternId, pattern] as const),
    );

    route.nodes.forEach((node, nodeIndex) => {
      node.sourceAdaptedStepRefs.forEach((ref, refIndex) => {
        if (!adaptedStepIds.has(ref)) {
          issues.push(
            validationIssue(
              "BROKEN_ADAPTED_STEP_REFERENCE",
              `nodes.${nodeIndex}.sourceAdaptedStepRefs.${refIndex}`,
              `Route node references unknown adapted step ${ref}.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
      node.capabilityRefs.forEach((ref, refIndex) => {
        if (!capabilityById.has(ref)) {
          issues.push(
            validationIssue(
              "BROKEN_CAPABILITY_REFERENCE",
              `nodes.${nodeIndex}.capabilityRefs.${refIndex}`,
              `Route node references unknown capability ${ref}.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
      node.realizationRefs.forEach((ref, refIndex) => {
        if (!realizationById.has(ref)) {
          issues.push(
            validationIssue(
              "DOWNSTREAM_REALIZATION_INVENTION",
              `nodes.${nodeIndex}.realizationRefs.${refIndex}`,
              `Route node introduces realization ${ref} absent from AdaptedUnitSpec.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
      node.recycledLoad.patternRefs.forEach((ref, refIndex) => {
        if (!patternById.has(ref)) {
          issues.push(
            validationIssue(
              "BROKEN_PATTERN_REFERENCE",
              `nodes.${nodeIndex}.recycledLoad.patternRefs.${refIndex}`,
              `Route node recycles unknown pattern ${ref}.`,
              { relatedRefs: [ref] },
            ),
          );
        }
      });
      node.productionTargets.forEach((target, targetIndex) => {
        target.realizationRefs.forEach((ref, refIndex) => {
          const realization = realizationById.get(ref);
          if (!realization) {
            issues.push(
              validationIssue(
                "DOWNSTREAM_REALIZATION_INVENTION",
                `nodes.${nodeIndex}.productionTargets.${targetIndex}.realizationRefs.${refIndex}`,
                `Production target references unknown realization ${ref}.`,
                { relatedRefs: [ref] },
              ),
            );
          } else if (realization.productiveCore.length === 0) {
            issues.push(
              validationIssue(
                "RECOGNITION_ONLY_REALIZATION_USED_PRODUCTIVELY",
                `nodes.${nodeIndex}.productionTargets.${targetIndex}.realizationRefs.${refIndex}`,
                `Realization ${ref} has no productive core.`,
                { relatedRefs: [ref] },
              ),
            );
          }
        });
      });
    });

    const coverageByCapability = new Map(
      route.coverageMap.map((entry) => [entry.capabilityRef, entry] as const),
    );
    for (const capability of unit.capabilityRealizations) {
      if (capability.status !== "fully_realized") continue;
      const coverage = coverageByCapability.get(capability.capabilityRef);
      if (!coverage) {
        issues.push(
          validationIssue(
            "CAPABILITY_MISSING_FROM_ROUTE_COVERAGE",
            "coverageMap",
            `Capability ${capability.capabilityRef} lacks route coverage.`,
            { relatedRefs: [capability.capabilityRef] },
          ),
        );
      }
    }

    unit.assessmentContract.supportCeilings.forEach((ceiling) => {
      const coverage = coverageByCapability.get(ceiling.capabilityRef);
      if (!coverage) return;
      for (const nodeRef of coverage.terminalEvidenceAt) {
        const node = nodeById.get(nodeRef);
        if (!node) continue;
        if (supportRank[node.supportLevel] > supportRank[ceiling.supportCeiling]) {
          issues.push(
            validationIssue(
              "TERMINAL_SUPPORT_CEILING_EXCEEDED",
              `coverageMap.${ceiling.capabilityRef}.terminalEvidenceAt`,
              `Terminal node ${nodeRef} uses ${node.supportLevel}, above ceiling ${ceiling.supportCeiling}.`,
              { relatedRefs: [ceiling.capabilityRef, nodeRef] },
            ),
          );
        }
      }
    });

    const realizationCoverageById = new Map(
      route.realizationCoverage.map((entry) => [entry.realizationRef, entry] as const),
    );
    for (const realization of unit.languageRealizations) {
      if (realization.productiveCore.length === 0) continue;
      const coverage = realizationCoverageById.get(realization.realizationId);
      if (!coverage || coverage.productiveAt.length === 0) {
        issues.push(
          validationIssue(
            "PRODUCTIVE_REALIZATION_NEVER_PRACTICED",
            "realizationCoverage",
            `Productive realization ${realization.realizationId} is never practiced productively.`,
            { relatedRefs: [realization.realizationId] },
          ),
        );
      }
    }

    route.realizationCoverage.forEach((coverage, index) => {
      if (!realizationById.has(coverage.realizationRef)) {
        issues.push(
          validationIssue(
            "DOWNSTREAM_REALIZATION_INVENTION",
            `realizationCoverage.${index}.realizationRef`,
            `Coverage declares realization ${coverage.realizationRef} absent from AdaptedUnitSpec.`,
            { relatedRefs: [coverage.realizationRef] },
          ),
        );
      }
    });

    route.assessmentDistribution.forEach((entry, index) => {
      if (!unit.assessmentContract.inheritedCriterionRefs.includes(entry.criterionRef)) {
        issues.push(
          validationIssue(
            "BROKEN_ASSESSMENT_CRITERION_REFERENCE",
            `assessmentDistribution.${index}.criterionRef`,
            `Route distributes unknown criterion ${entry.criterionRef}.`,
            { relatedRefs: [entry.criterionRef] },
          ),
        );
      }
    });
  }

  return validationResult(issues);
}

export function routePatternStatus(
  adaptedUnit: AdaptedUnitSpec,
  patternRef: string,
): z.infer<typeof productiveStatusSchema> | undefined {
  return adaptedUnit.linguisticTargets.patterns.find((pattern) => pattern.patternId === patternRef)
    ?.productiveStatus;
}
