import {
  validateAdaptedUnitSpec,
  type AdaptedUnitSpec,
  type AdaptedUnitValidationContext,
} from "./adapted-unit-spec.js";
import {
  validateLessonRoute,
  type LessonRoute,
} from "../routing/lesson-route.js";
import {
  validateLessonSpec,
  type LessonSpec,
} from "../lessons/lesson-spec.js";
import {
  validationIssue,
  validationResult,
  type ValidationIssue,
  type ValidationResult,
} from "../curriculum/validation.js";

export type AdaptedCurriculumRuntimeInput = {
  adaptedUnit: AdaptedUnitSpec;
  route: LessonRoute;
  lessonSpecs: LessonSpec[];
  upstream?: AdaptedUnitValidationContext;
  requireCompleteLessonSet?: boolean;
};

function appendIssues(
  target: ValidationIssue[],
  result: ValidationResult,
  prefix: string,
) {
  for (const issue of result.issues) {
    target.push({
      ...issue,
      path: issue.path ? `${prefix}.${issue.path}` : prefix,
    });
  }
}

export function validateAdaptedCurriculumRuntime(
  input: AdaptedCurriculumRuntimeInput,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  appendIssues(
    issues,
    validateAdaptedUnitSpec(input.adaptedUnit, input.upstream),
    "adaptedUnit",
  );
  appendIssues(
    issues,
    validateLessonRoute(input.route, { adaptedUnit: input.adaptedUnit }),
    "route",
  );

  const lessonIds = new Set<string>();
  const routeNodeIds = new Set(input.route.nodes.map((node) => node.nodeId));
  const lessonNodeRefs = new Set<string>();

  input.lessonSpecs.forEach((lesson, index) => {
    appendIssues(
      issues,
      validateLessonSpec(lesson, {
        route: input.route,
        adaptedUnit: input.adaptedUnit,
      }),
      `lessonSpecs.${index}`,
    );

    if (lessonIds.has(lesson.identity.lessonSpecId)) {
      issues.push(
        validationIssue(
          "DUPLICATE_LESSON_SPEC_ID",
          `lessonSpecs.${index}.identity.lessonSpecId`,
          `Duplicate LessonSpec id ${lesson.identity.lessonSpecId}.`,
          { relatedRefs: [lesson.identity.lessonSpecId] },
        ),
      );
    }
    lessonIds.add(lesson.identity.lessonSpecId);

    if (lessonNodeRefs.has(lesson.identity.routeNodeRef)) {
      issues.push(
        validationIssue(
          "MULTIPLE_CANONICAL_LESSONS_FOR_ROUTE_NODE",
          `lessonSpecs.${index}.identity.routeNodeRef`,
          `More than one supplied LessonSpec targets route node ${lesson.identity.routeNodeRef}.`,
          { relatedRefs: [lesson.identity.routeNodeRef] },
        ),
      );
    }
    lessonNodeRefs.add(lesson.identity.routeNodeRef);

    if (!routeNodeIds.has(lesson.identity.routeNodeRef)) {
      issues.push(
        validationIssue(
          "ORPHAN_LESSON_SPEC",
          `lessonSpecs.${index}.identity.routeNodeRef`,
          `LessonSpec targets unknown route node ${lesson.identity.routeNodeRef}.`,
          { relatedRefs: [lesson.identity.routeNodeRef] },
        ),
      );
    }
  });

  if (input.requireCompleteLessonSet) {
    for (const node of input.route.nodes) {
      if (node.optional) continue;
      if (!lessonNodeRefs.has(node.nodeId)) {
        issues.push(
          validationIssue(
            "ROUTE_NODE_WITHOUT_LESSON_SPEC",
            "lessonSpecs",
            `Required route node ${node.nodeId} has no LessonSpec.`,
            { relatedRefs: [node.nodeId] },
          ),
        );
      }
    }
  }

  return validationResult(issues);
}
