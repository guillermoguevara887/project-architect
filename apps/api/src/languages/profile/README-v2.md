# LanguageProfile Evidence Contract — S1

S1 defines structure and vocabulary only. It contains no coverage resolver and
does not classify requirements as covered, partial or missing. No existing
consumer, route, stored profile or registry is switched to v2. S2 now implements
the separate pure evaluator in `requirement-evidence.ts`, documented below.

## Versions and compatibility

- `language-profile.ts` remains the historical v1 schema and semantic validator.
  Its original imports, required `profileCoverage`, fixtures and behavior remain.
- `language-profile-v2.ts` defines `LanguageProfileV2`, `languageProfileV2Schema`
  and `validateLanguageProfileV2`. `schemaVersion` is the required literal
  `"2.0.0"`; `profile.version` independently versions the profile's contents.
- `language-profile-compatibility.ts` provides an explicit boundary returning
  `{ contract: "v1" | "v2", profile }`. A payload without `schemaVersion` is
  parsed only with v1. A present version must be exactly `2.0.0`; unknown versions,
  malformed v2 payloads and relabeled v1 payloads are rejected without fallback.
  There is no conversion, evidence promotion, or automatic interpretation of
  historical `reviewed` / `A1_sufficient` as v2 evidence.
- Test data is synthetic and local to the test file. The German v1 fixture is
  unchanged, including `de.standard`; a separate contract-only test accepts
  `languageId: "de"`, `varietyId: "de-DE"` without asserting linguistic facts.

## Profile shape and knowledge states

The v2 root contains `schemaVersion`, `version`, `status`, `identity`, `knowledge`
and `evidenceRegistry`. Identity holds stable IDs and display names. Researched
identity scope (region, scripts and reference register) lives in
`knowledge.identity`; the ten linguistic sections live alongside it.

Every authorized field in `knowledge` is required and uses the same strict union:

```ts
{ state: "known", value: /* field-specific typed value */ }
{ state: "unknown", reason?: string }
{ state: "not_applicable", reason: string }
```

There are no defaults. Unknown and not applicable cannot carry values. A known
inventory can explicitly contain `[]`: researched emptiness is distinct from
unknown, non-applicability and a bare empty array. Text cannot be empty.
Known absence of a phenomenon is separately expressed by a feature's
`applicability: "absent"`, with no active values or mechanisms. Non-applicability
is an explicit assertion whose evidence sufficiency remains unevaluated in S1.
All slots can be unknown even when the snapshot is canonical: canonical status
does not assert curriculum completeness.

Feature values retain descriptions, applicability, values, mechanisms, conditions
and variation. Claims own evidence, confidence and review status. Explicit
`relevance` annotations can mark features for initial intelligibility and age
expression, and mechanisms for age realization. Empty annotations make no
relevance assertion. S2 must evaluate the relevant exact subject.

`profileCoverage` is omitted from persisted v2 and rejected by its strict schema.
Dependency inspection found its current authority in v1 validation, adaptation
planning and research/promotion consumers; these remain on v1. Derived adaptation
signals are likewise not persisted in v2. Any future summary is derived and
non-authoritative. Writing facts contain no pedagogical support strategy.

## Closed subjects

`ProfileKnowledgeSubjectRef` supports:

| Kind | Locator |
| --- | --- |
| `section` | Closed section enum, including researched identity scope |
| `slot` | Closed `section.field` enum derived from the knowledge schema |
| `feature` | Authorized feature slot and an exact `featureId` |
| `feature_mechanism` | Authorized feature slot, `featureId` and `mechanismId` |
| `structural_item` | Script, transliteration or argument-marking inventory slot and exact `itemId` |

Slot IDs are enum values, never free JSONPath or user-defined paths. Feature and
item IDs must exist within the declared slot in the same profile snapshot.
Collections have exact item locators; whole inventories and scalars can be
grounded with slot refs. Section refs provide context and cannot substitute for
the exact slot of a target. Profile validation checks target-to-slot binding and
all internal source, evidence, claim, conflict, feature, mechanism and script
references. These are integrity checks, not eligibility rules.

## One requirement evidence catalog

`requirement-evidence-targets.ts` is the only catalog, initially `1.0.0`, validated
and recursively frozen. Its groups, target bindings and relevance requirements
are closed for that version. A target ID is `<domain>.<section>.<field>`; group
IDs are listed below. Target refs include `{ catalogVersion, targetId }`.

| Curriculum domain | Group IDs (requirement / aggregation) |
| --- | --- |
| `writing.beginner_system` | `writing.beginner_system.core` (required / all) |
| `phonology.initial_intelligibility` | `phonology.initial_intelligibility.intelligibility` (required / any) |
| `sociolinguistics.initial_register` | `sociolinguistics.initial_register.core` (required / all); `sociolinguistics.initial_register.corroboration` (optional / all) |
| `participant.basic_reference` | `participant.basic_reference.core` (required / all); `participant.basic_reference.contextual` (optional / all) |
| `nominal.beginner_package` | `nominal.beginner_package.core` (required / all); `nominal.beginner_package.contextual` (optional / all) |
| `predication.identity_state` | `predication.identity_state.core` (required / all) |
| `age.basic_expression` | `age.basic_expression.core` (required / all); `age.basic_expression.numerals` (required / all); `age.basic_expression.realization` (required / any) |
| `possession.basic` | `possession.basic.core` (required / all) |
| `action.basic_pattern` | `action.basic_pattern.core` (required / all) |
| `localization.first_contact` | `localization.first_contact.core` (required / all); `localization.first_contact.reusable` (optional / all) |

Future semantics: every required group must be satisfied; all requires every
target, any requires at least one, and optional groups do not block. S1 stores
these rules without evaluating them.

Writing includes both conventions and diacritics. Phonology offers nine explicit
feature/inventory slots and requires initial-intelligibility relevance; it never
assumes tone, stress, length or another particular subsystem applies. Age core
includes semantic age and questions, numerals require age relevance, and realization
offers exact mechanisms in existing predication/verbal features or discourse
particles. No verb, copula or possession construction is universalized. These
alternatives are vocabulary, not assertions that every alternative applies.

Animacy, clusivity and demonstratives are contextual; nominal modification is
optional. Possession lives in its own domain. Identity/state predication does not
require location or existence. Action excludes mood, polarity and voice from its
required targets. Localization contains scope and sociolinguistic facts without
choosing teaching scenarios, cities or names.

The domain enum was moved unchanged to the dependency leaf
`curriculum-requirement-domain-values.ts` and re-exported through the historical
path. Curriculum metadata adds `evidenceTargetCatalogRef: { catalogVersion, domain }`
by deriving the link for every domain. Imports flow from metadata to catalog to
the enum leaf; there is no circular import or second target map in consumers.

## Claims and provenance

A claim includes its ID, short statement, exact subject refs, one or more versioned
target refs, evidence refs, confidence, review status, originating curriculum
requirement refs, and either `originRunRef` or explicit manual authorship/date.
Manual work may explicitly have no originating curriculum requirements. Provider,
model and request metadata belong outside the claim behind the run reference.

The registry stores sources, short evidence records, claims and conflicts:

- Sources have a closed source type, title, author/publisher, URL with access
  timestamp or bibliographic citation, source language, closed authority class,
  and structured `independenceKey: { responsibleEntityId, workId, lineageId }`.
  `authoritative` is an explicit classification, not a classification inferred
  by S1. Work/lineage identities support future handling of editions and reuse;
  equal or different keys do not trigger any independence decision in S1.
- Evidence records identify a source, a locator of at most 300 characters and
  a summary of at most 1200 characters. Sources contain no full document text.
- Each claim's evidence ref explicitly records `unvalidated` or
  `human_validated` with reviewer and timestamp. Validation belongs to that
  exact claim-to-source relation, not all claims citing the same source.
- Conflicts reference existing claims and their targets, with explicit open or
  resolved status. An open conflict is valid contract data.

## Frozen global baseline and S2 work

`BASELINE_EVIDENCE_POLICY_V2` is global contract data, not a per-profile setting:

- `machine_synthesized` cannot cover a canonical target alone.
- `needs_review` never covers.
- `cross_checked` later requires at least two independent sources.
- `human_reviewed` may be sufficient with one authoritative source whose exact
  claim/source relationship has been explicitly validated.
- Open conflicts later block covered status.
- The S2 minimum confidence is `medium` (also accepting `high`); only
  `authorityClass: "authoritative"` satisfies the authoritative-source rule.

Target policies are additive only. They can restrict the allowed review statuses,
raise the independent/authoritative source minima, or repeat the required true
validation/conflict flags. Strict schemas reject lower minima, forbidden review
statuses, false flags and arbitrary override fields. Omission inherits baseline;
target policy must never replace it.

S1 intentionally accepts structurally valid claims with insufficient or
unreviewed evidence and does not infer coverage from labels or profile status.
S2 evaluates these contracts separately. Consumer integration, real research,
real profiles and persistence remain out of scope.

## S2 — pure requirement evidence resolver

```ts
resolveRequirementEvidence(
  requirement: RequirementEvidenceInput, // { requirementRef, domain }
  languageProfileV2: unknown,
  options?: RequirementEvidenceOptions, // { mode?, targetPolicies? }
): RequirementEvidenceResolution
```

The boundary accepts unknown profile input so it can diagnose a historical v1
payload, missing source or malformed subject without converting it to v2. Invalid
requirements or options throw `ZodError`; there is no fallback domain or policy.
The only catalog is S1's frozen catalog. Options allow additional restrictions
keyed by existing versioned target refs, never replacement target mappings.

The result includes requirement/domain, JSON profile identity and content version,
schema/catalog versions, mode, durable consumability, global status, groups,
targets, exact subjects, local claim evaluations and unique claim summaries, concrete
evidence/source refs and assessments, used source records, relevant conflicts,
and gaps localized by group/target/subject/claim/evidence/source. Missing JSON
identity fields are null; no record ID, digest or timestamp is invented.

`claimEvaluations` holds applicable evaluations per claim/target/exact subject,
including acceptance, useful evidence, reasons, sources, independence witnesses,
conflicts and `contractGaps`. Subject and target results expose these evaluations;
the root also lists them in canonical order. Unrelated target/subject pairs are
not evaluated. An unclaimed sibling has no claim rejection. A declared subject
that cannot ground its target receives a diagnostic evaluation in its own
context (`claim_wrong_subject`), outside the subject coverage calculation.

The root's `acceptedClaims` and `rejectedClaims` now contain unique summaries by
`claimId`, not local assessments. Each summary retains all its `evaluations`,
reasons, contract gaps and useful-evidence result. A claim with any accepted
evaluation appears once in `acceptedClaims`: `accepted` if all evaluations pass,
or `partially_accepted` if other applicable evaluations fail. With only rejected
evaluations it appears once in `rejectedClaims` with status `rejected`. The arrays
are disjoint. Claims targeting only other domains are absent from both arrays.
Malformed claims without a valid S1 claim ID retain rejected local evaluations
with `claimId: null` and localized contract gaps; they cannot receive a summary
by ID or collide with a real claim through an invented fallback identifier.
An applicable contract error makes the entire claim ineligible in every local
evaluation, so it can only have a rejected summary and no useful evidence.

Coverage still derives exclusively from eligible local subject evaluations,
before summaries are built. Summaries never pool sources, witnesses or votes:
two evaluations of one claim do not constitute two independent claims or double
its sources. Witness and source fields belong to each local evaluation, never to
an arbitrarily chosen representative assessment in a summary. This intentionally
changes the pre-S3 public TypeScript output; no production consumers existed.

S1's shared claim/reference
validation runs independently of unrelated malformed fields. Any applicable
contract error rejects the entire claim and excludes it from useful evidence;
healthy sibling claims retain their local evaluation. The global invalid-profile
gate still prevents consumption, including when the faulty claim is in another
domain. Existing source, policy and conflict rejection reasons remain available.

The shared S1/S2 knowledge-integrity layer collects IDs at declared positions
before structural parsing. `featureId` is globally unique across feature slots;
`mechanismId` is globally unique across nested mechanisms and structural argument
items. `scriptId` is unique within the scripts inventory, and `systemId` within
the transliteration inventory. These four namespaces remain distinct.
Counting a valid ID does not require a complete parent subject reference. An
occurrence under an incomplete parent retains its ID and path with a null subject;
the complete counterpart still identifies the affected claim. Missing or invalid
wrapper state cannot hide present IDs. Both entry points use the same layer,
preserving duplicate and missing-field
errors without repairing the input or inventing IDs/references. Missing or invalid
IDs are never counted as duplicate identifiers.
The same layer checks per-list uniqueness and resolution of script references in
`identity.scriptScope`, `primaryScriptStrategy.scriptRefs`, `scripts[].coexistsWith`
and `transliterationSystems[].targetScriptRefs`. Reference diagnostics identify
their owning subject; references to duplicate script IDs are ambiguous. These
checks do not depend on unrelated fields such as `writingSystem.direction`.
S2 uses those S1 issues to invalidate claims that reference an ambiguous identity
or its enclosing feature/slot. Exact healthy siblings, including mechanisms in
the same feature, remain eligible. Duplicate occurrences retain their diagnostic
paths; each identical target/subject context is evaluated once. An unrelated
structural error cannot disable this identity check. Global profile invalidity
still prevents durable consumption, even when a healthy local target covers.

Contract gaps retain the affected claim/subject/evidence/source IDs and an
optional `validationIssue` using the existing ValidationIssue contract (code,
severity, path, message, relatedRefs). Diagnostic paths in resolver output refer
to a canonical copy of the registry and ID-bearing knowledge collections:
entries, mechanisms and set-like reference arrays are structurally sorted before
validation. Ordered linguistic values are preserved. Paths are not offsets into the caller's
original array order. This keeps diagnostics deterministic under reordering;
the accompanying IDs locate the original records. Inputs are never mutated.

### Status and consumption

- `covered`: every required group is epistemically covered and profile gates pass.
- `partial`: coverage is incomplete but some required target has useful relevant
  evidence: exact target/subject/state, medium/high confidence, an eligible review
  class and at least one valid source for cross-checked evidence, or at least one
  explicitly validated authoritative source for human-reviewed evidence.
  Insufficient independence, stricter-policy minima or unresolved conflicts can
  leave this useful evidence partial. A merely present, wrong, low-confidence,
  unvalidated-human or machine-only claim does not create partial.
- `missing`: required groups are incomplete and have no such useful evidence.

`durable` is the default and requires canonical profile status. Draft, review and
deprecated profiles cannot produce durable covered. `preview` evaluates evidence
epistemically but always returns `durableConsumable: false`, even for canonical
profiles. Per-group results remain epistemic; they never override the global
status or authorize consumption. Invalid v2 contracts cannot produce global
covered in either mode. Unversioned/v1 profiles return missing with
`unsupported_schema_version`; no v1 claims are evaluated.

Required/all needs every target; required/any needs at least one. Optional groups
are evaluated but neither block global coverage nor create global partial alone.
Gaps/rejections in optional groups or unused any alternatives remain visible even
when the enclosing group or requirement is covered; the group tree records which
failures are non-blocking.

### Exact grounding and knowledge state

Unknown, missing and malformed subjects do not cover. Known values need eligible
claims, including known empty inventories. Whole-slot claims can ground scalar or
inventory facts. A singleton feature and its slot are equivalent; one mechanism
or one inventory item cannot substitute for evidence about an entire inventory.

For targets with relevance requirements, the resolver expands only explicitly
annotated, non-absent features/mechanisms. An exact eligible annotated feature
can satisfy an intelligibility alternative; an exact age-realization mechanism
is needed for age realization. A collection-level claim does not establish which
feature is relevant. One qualifying item suffices within these existential
relevance targets. A non-applicable alternative cannot bypass the requirement
for an actually relevant intelligibility/realization subject.

S1's minimal additive extension `claim.subjectStateAssertions?` contains
`{ subjectRef, state: "known" | "not_applicable" }` entries. Each assertion must
name an exact subject already referenced by the claim, without duplicates.
Non-applicability needs an explicit matching assertion and otherwise follows the
same source, confidence, review and conflict rules. Text is never interpreted to
discover non-applicability. Opposite-state assertions reject the claim. Existing
S1 claims remain structurally valid without this optional field.

### Evidence rules

All referenced evidence and sources must exist and satisfy their S1 schemas.
Only medium/high confidence and cross-checked/human-reviewed claims are eligible.
Machine-synthesized and needs-review claims do not contribute useful evidence.

Cross-checked claims require a pairwise independent subset of at least two
distinct sources, or the higher target-policy minimum. Source identities must be
complete. Sharing a responsible entity, work or lineage conservatively prevents
independence. Different URLs/hosts do not change that. A deterministic search
finds a sufficient subset instead of relying on an order-dependent greedy choice;
if insufficient, it reports the largest structural subset. This is conservative
identity accounting, not proof of real editorial independence.

`REQUIREMENT_EVIDENCE_INDEPENDENCE_LIMITS` in `evidence-policy-v2.ts` centralizes
the bounds: at most **12 distinct sources per cross-checked claim evaluation**
and at most **12 required independent sources**. Target-policy minima above 12
fail Zod validation, including caller options, before evaluation. The baseline
minimum remains 2. No source count is silently reduced or requirement weakened.

The exact search runs only for a cross-checked claim with no prior rejection:
contract integrity, subject/target/state/relevance, confidence, review eligibility,
allowed review policy, source validity and relevant open conflicts are checked
first. Human-reviewed claims use authority and explicit relationship validation;
they never need the independence search or inherit its source-count cap.

Assessments expose `independenceEvaluation`: `evaluated`, `skipped`, or
`limit_exceeded`. Skipped assessments return no independence witness and do not
assert independence insufficiency merely because no search ran. An otherwise
eligible cross-check with more than 12 distinct sources returns
`independence_evaluation_limit_exceeded` before sorting/search recursion, with
empty `independentSourceRefs` and `usedSourceRefs`. All source/evidence refs remain
in its assessment, with the target's effective minimum and a localized gap.
No prefix is selected, no approximate witness is accepted, and it cannot cover.
Its valid, relevant evidence can still be useful for `partial`, as with other
insufficient evidence; that never authorizes durable consumption. A healthy
sibling claim is evaluated independently.

Within the bound, the original exact traversal, pruning and canonical witness
selection are preserved. With n <= 12 it can visit at most 2^12 = 4,096 subset
states, with depth at most 12 and a conservative n^2 * 2^n bound of 589,824
pair-compatibility checks per search. These fixed bounds accommodate the usual
two/three-source corroboration and stricter small evidence sets without exposing
an unbounded exponential dimension. There are no timers, work-budget cutoffs,
randomness or shared mutable counters. Registry parsing and reference traversal
still scale with the input size; this is a bound on the exact search per claim
assessment, not a cap on the entire profile or number of claims.

Human-reviewed claims need the required number of distinct authoritative sources
with an explicit human-validated claim/evidence/source relation, including reviewer
and timestamp. The closed baseline recognizes only the `authoritative` class;
titles, publishers and URLs never establish authority. No review attestation is
inferred from a claim's review label. Authority classification and recorded human
attestation are trusted contract assertions, not externally verified credentials.

Only unresolved conflicts matching the target and an overlapping exact subject
of an involved claim block that subject. A slot overlaps its items; different
features in the same collection do not automatically conflict. Further claims
about the same conflicted subject cannot bypass the conflict. Resolved conflicts
are reported without blocking, and unrelated conflicts do not block the profile.

Effective policies intersect allowed statuses and take maximum source minima
across baseline, catalog target policy and optional caller restrictions. Required
validation/conflict flags remain true. Weak or duplicate option policies fail
validation before evaluation.

### Purity, compatibility and deferred integration

There is no IO, network, AI, DB, wall-clock access or mutation. Output ordering is
deterministic using structural keys and code-point comparison; claim, source,
evidence and reference ordering does not affect output. IDs and scope are read
from the supplied JSON; no linguistic prose interpretation occurs.

The resolver explicitly ignores an extra historical `profileCoverage` property.
The persisted S1 v2 schema still rejects that field. V2 has no `coverageDepth`, so
no depth eligibility rule or invented threshold is applied. The unchanged v1
schema, fixtures and consumers retain their historical behavior.

S3+ must integrate this resolver into M4/M13/M14 and define persistence/promotion
boundaries. No consumer is integrated in S2. Real authority verification,
editorial-independence research, profile bootstrapping and any evidence freshness
or content fingerprinting are not implemented here.
