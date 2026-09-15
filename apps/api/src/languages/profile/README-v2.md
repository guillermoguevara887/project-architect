# LanguageProfile Evidence Contract — S1

S1 defines structure and vocabulary only. It contains no coverage resolver and
does not classify requirements as covered, partial or missing. No existing
consumer, route, stored profile or registry is switched to v2. S2 now implements
the separate pure evaluator in `requirement-evidence.ts`, documented below.
S3A adds pure human lifecycle/promotion in `profile-lifecycle-v2.ts`; S3B adds the
transactional persistence boundary described below. Registry Grounding now adds
explicit durable Registry bindings to S3B canonicals. M4/M13/M14 integrations
remain deferred.

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

`covered` means epistemological/evidential coverage; by itself it does not
authorize durable consumption. Consumers must use the public
`canConsumeRequirementEvidenceDurably(result)` guard as the official durable
boundary. The result is discriminated by `durableConsumable`: the `true` branch
narrows to durable mode with covered status, while preview and every other
non-authorized result remain in the `false` branch. The resolver derives that
discriminant from the same centralized mode, lifecycle and coverage decision used
by the guard; consumers do not reconstruct those rules.

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

Later phases must integrate this resolver into M4/M13/M14. No consumer is
integrated in S2 or S3A. Real authority verification, editorial-independence
research and evidence freshness are not implemented here. S3A's snapshot
fingerprint below binds review content; it does not prove evidence authenticity.

## S3A: explicit human lifecycle and pure promotion

The stages remain separate: S1 defines knowledge/evidence contracts; S2 resolves
evidence; S3A records human review and produces canonical snapshots through pure
functions; S3B provides durable persistence. `covered ≠ approved`,
`durableConsumable ≠ human ACCEPT`, and `review ≠ canonical`.

`profile-lifecycle-v2.ts` exports two operations:

- `createProfileReviewCandidateV2({ profile, proposedVersion, origin,
  parentCanonical })` validates S1, normalizes a new review snapshot and returns
  an immutable candidate. It never produces canonical. The explicit parent is
  either the complete current canonical profile or `null` for bootstrap.
- `reviewProfileCandidateV2(candidate, decision, currentCanonical)` validates the
  sealed candidate, decision and exact parent binding. It returns an accepted
  outcome with a new canonical snapshot, a rejected outcome with `canonical:
  null`, or an error. Both successful outcomes retain the candidate and decision.

`profileReviewDecisionV2Schema` validates the decision input. There is no helper
that manufactures ACCEPT from a score, evidence result, lifecycle, research run
or timestamp. A decision requires `ACCEPT | REJECT`, `candidateSha256`,
`contentSha256`, an explicit `{ kind: "human", reviewerRef }`, and `decidedAt`.
An optional note records context. Time is supplied by the caller, never read from
the clock. Human identity is a required contract assertion, not an authenticated
attestation; S3A does not verify users or external authority. A caller fabricating
a human assertion is outside this pure contract's trust boundary. The future
authenticated integration must bind review decisions to a human action; research/AI output must never
be allowed to populate that action on the user's behalf.

### Exact snapshot and lineage

A candidate contains an immutable `snapshotJson` string and a snapshot reference
with `profileId`, content `version`, `schemaVersion`, target `contractVersion`,
lifecycle `status` and `contentSha256`. SHA-256 covers the UTF-8 bytes of the
stored JSON. S1 parsing/normalization occurs **before** that snapshot is offered
for review. Key order follows the S1 parser; array order remains significant.
ACCEPT revalidates but cannot silently normalize or replace the stored snapshot.

`candidateSha256` hashes the review snapshot and its complete envelope: snapshot
reference, source reference, parent canonical reference and origin. Origin has a
closed kind (`manual`, `generated`, `researched`, `corrected`), an explicit
`originRef` and an optional `runRef`. The candidate digest is a content/context
identity, not a DB ID. Changing content changes the content SHA; changing source,
parent, proposed version or origin changes the candidate identity. Either change
requires a new decision. Same inputs intentionally recreate the same identity.

The source reference identifies the exact input profile before its explicit
conversion to review. A canonical source must equal the supplied parent. For a
revision, the candidate and parent retain profile/language/variety IDs, and the
caller supplies a content version distinct from the parent. Version allocation
and uniqueness across historical records remain S3B responsibilities; S3A does
not infer a version bump or a global latest version. The chosen version is part
of the review snapshot, so ACCEPT cannot substitute an unreviewed version.

On ACCEPT, all reviewed fields and the proposed version are preserved; only
`status: "review"` becomes `status: "canonical"` in a **new** JSON snapshot.
Consequently the canonical has its own SHA. The outcome keeps the complete
reviewed snapshot, its SHA, decision, origin and exact parent binding. The review
snapshot and previous canonical remain untouched. REJECT retains the same audit
context and produces no canonical; it does not introduce a `rejected` profile
state. A rejected review snapshot still cannot pass S2's durable guard.

All returned successful records are recursively frozen and readonly. JSON strings
make the profile payload immutable without changing the existing S1/S2 types.
There is no IO, randomness, implicit clock, mutable global state or in-place
transition. Hashing uses Node's local SHA-256 primitive. Identical inputs produce
identical outcomes, including replay of a decision.

### Allowed and forbidden transitions

| Source | Operation | Result |
| --- | --- | --- |
| `draft` | Create candidate | New sealed `review` snapshot; source unchanged |
| `review` | Create candidate | Sealed `review`; changed content/context requires a new decision |
| `canonical` | Create revision with exact parent and distinct version | New `review`; previous canonical unchanged |
| `review` candidate | Matching human `ACCEPT`, valid S1 and parent | New `canonical` snapshot plus audit outcome |
| `review` candidate | Matching human `REJECT` | Decision retained, no canonical |
| `draft`, `canonical`, `deprecated` | Direct ACCEPT | Forbidden: only sealed `review` is eligible |
| `deprecated` | Create candidate | Forbidden: no silent resurrection |
| Any state | Coverage, durable flag, AI, metadata or missing decision | No promotion |
| Any state | In-place lifecycle mutation | Unsupported |
| `canonical` | Deprecation | No deprecation operation in S3A; policy deferred |

The four existing lifecycle states are unchanged. Other transitions are not
provided by this API. Contract-invalid profiles cannot become candidates or be
promoted, even if a caller recomputes hashes. Errors distinguish
`candidate_invalid`, `snapshot_mismatch`, `decision_invalid`,
`illegal_lifecycle_transition`, `stale_decision` and `lineage_mismatch`.
ACCEPT on a non-review snapshot is an illegal transition; REJECT is a successful
review outcome rather than an error. A changed current canonical is a lineage
mismatch, never an automatic rebase of the human decision.

### Deferred persistence and consumers

S3A checks the parent supplied by its caller and does not know whether it is
still current in storage. Pure replays remain deterministic. S3B below now
provides append-only records, durable identities, terminal/version uniqueness
and atomic parent-current checks. No SQL, repository, HTTP route, authentication
or migration is part of the S3A pure module.

M4/M13/M14 integration is deferred. M4 must not treat historical profileCoverage
as authority; M13 must use eligible claims specific to each target; M14 may
research only authorized existing targets and end in review, with no automatic
ACCEPT. Human approval does not make an unknown or insufficient target covered:
S2 must still evaluate evidence and its official durable guard remains required.

Registry Grounding, documented below, binds a Registry to the exact canonical
record, `profileId`, version, schemaVersion, canonical SHA and target contract
version. A new canonical requires a new explicit Registry artifact/version;
the old binding never authorizes the new snapshot. S3A itself neither creates
nor changes a Registry. The pre-existing literal-types/readonly LOW remains
deferred; S3A's local immutable records do not change that scope.

## S3B: transactional lifecycle persistence

`profile-lifecycle-store-v2.ts` supplies `ProfileLifecycleStoreV2`, an internal
repository with the service/transaction boundary inside its write operations.
It uses the existing Drizzle/PostgreSQL client and accepts an injected database
factory for isolated tests. It opens no connection merely by being imported.
It adds no HTTP route, UI or M4/M13/M14/Registry consumer.

`0026_create_language_profile_v2_lifecycle.sql` creates only these new objects:

| Table | Durable content and constraints |
| --- | --- |
| `language_profile_v2_candidates` | UUID record ID, review snapshot/ref, context SHA, source/origin lineage, nullable exact parent record, DB event order and created time; context SHA is unique |
| `language_profile_v2_decisions` | UUID, candidate FK, explicit action, complete S3A decision JSON including both hashes/reviewer/caller timestamp/note, optional canonical FK, DB event order/time; candidate FK is unique |
| `language_profile_v2_canonicals` | UUID, exact canonical snapshot/ref, reviewed candidate and decision FKs, nullable parent FK, DB event order/time; profileId/version is historically unique |

The shared `language_profile_v2_event_sequence` supplies bigint ordering for all
three tables. IDs use the repo's UUID convention. Record creation times come
from PostgreSQL; the decision's original caller timestamp is retained inside
its JSON unchanged. There is no owner/auth field invented by this phase:
`profileId` is the namespace within the v2 store; future authenticated access
must explicitly authorize access to it before exposing this internal API.

### Exact representation, append-only and integrity

`snapshot_json` is TEXT containing the exact normalized S3A JSON, alongside its
contractual SHA and reference columns. JSONB stores only candidate lineage and
decision metadata. PostgreSQL JSONB key order is never used as the content hash
authority. S3A's `validateProfileReviewCandidateV2()` exposes its existing checks
without manufacturing ACCEPT/REJECT; S3B uses it when writing/reading candidates.
S3A still computes hashes and the review-to-canonical transformation.

Historical candidates, decisions and canonicals have no update/delete operation
in this API. Promotion inserts a new canonical, never changes a review snapshot
or an old canonical. Tables have no cascading history deletion. This is an
application write boundary with DB uniqueness/referential enforcement, not
tamper-proof storage against a privileged SQL administrator. Deployment roles
must not expose arbitrary table mutation to consumers. Tests deliberately corrupt
isolated rows to verify conservative read failures; no repair tool is provided.

Readers validate runtime row shapes, then replay S3A validation in DB event order
against historical parent snapshots. They check exact JSON, hashes, profile IDs,
references, action/outcome consistency and complete ACCEPT/canonical pairs.
Malformed or inconsistent history raises `storage_integrity`; it is not returned
as a trusted profile through TypeScript casts. Reads use one REPEATABLE READ,
read-only transaction so a concurrent commit cannot expose half an outcome.
The initial implementation validates the complete history of one profile for
each read; it introduces no cache or alternative authority.

### Terminal writes, locks and current canonical

Both writes use explicit READ COMMITTED transactions and a transaction-level
advisory lock on `hashtextextended('language-profile-v2:' + profileId, 0)`.
Every writer for that profile takes the same lock, including bootstrap and
candidate insertion. After waiting, subsequent queries observe the winner's
commit. Hash collisions only serialize unrelated profiles; they cannot allow
two writers for the same profile to proceed concurrently. No mutable head table
or `is_current` flag is needed.

The current canonical is the validated canonical with the largest DB event
sequence for that profile. Allocation order is commit order for successful
same-profile writes because they share the lock. Sequence gaps after rollback
are harmless. Caller timestamps and SemVer ordering never determine the head.

`recordReviewDecision(candidateRecordId, decision)` loads the durable candidate,
checks terminal uniqueness and exact current parent inside the lock, then calls
S3A. It accepts no caller replacement candidate. ACCEPT inserts the terminal
decision and the canonical in the same transaction. Mutually linked deferred
FKs prevent an ACCEPT without its canonical from committing, and prevent a
canonical from referencing REJECT. Candidate/profile composite FKs keep their
identities aligned. The transaction rolls back both writes on any failure.
REJECT inserts only its terminal decision and leaves the head unchanged.

Terminal retry policy is **B**: every later decision, identical or different,
returns `decision_already_recorded`. A UNIQUE constraint on candidate record ID
enforces one durable terminal row independently of application checks. Candidate
insertion is idempotent by context SHA; retrying it returns the same record,
including after a terminal decision. A fresh review of a rejected proposed
version must use a new S3A content/context identity. Candidate versions are not
unique; only canonical `(profileId, version)` pairs are historically unique.
Version comparison remains S3A's distinct-string rule, with historical reuse
blocked by S3B; monotonic SemVer allocation is not inferred.

A stale parent yields `stale_parent` without a decision or canonical write.
This conservatively applies to both ACCEPT and REJECT, matching S3A's current
parent requirement. Bootstrap with parent=null only succeeds while no canonical
exists. Concurrent siblings therefore have one winner; the second observes a
new head and fails. Partial unique indexes additionally enforce one root per
profile and one canonical child per parent. Foreign parents are rejected by
application validation and composite profile FKs. No triggers are necessary.

### Internal API and isolated verification

- `persistReviewCandidate({ candidate, parentCanonicalRecordId })`
- `getReviewCandidate(recordId)` / `getReviewDecision(candidateRecordId)`
- `recordReviewDecision(candidateRecordId, decision)` (complete transaction)
- `getCanonical(recordId)` / `getCurrentCanonical(profileId)`
- `listProfileHistory(profileId)` (all candidates, decisions and canonicals in DB order)

Use `corepack pnpm test:integration:profile-lifecycle` from the repository root.
The existing Docker runner starts a fresh PostgreSQL 16 container bound only to
loopback, clears DATABASE_URL for the test process, and removes the container and
its volumes afterward. The suite requires an explicit local-test opt-in and
admin database name, creates a distinct disposable database, and applies only
0026 through the normal migration runner. It never reads a production URL.
Concurrency tests hold a third connection's profile lock until both contenders
are visibly blocked in PostgreSQL, then assert one winner and no partial writes.
Unit tests separately cover runtime reconstruction and corrupted row shapes.

Still deferred after S3B and Registry Grounding: effective reviewer authentication,
HTTP/API access, review UI, M4/M13/M14, production migration/rollout, external
attestations and authority verification. `reviewerRef` remains caller-declared;
S3B does not claim cryptographic human verification. The known literal-types/
readonly debt is unchanged. No production migration has been executed.

## Registry Grounding: exact canonical identity

`Registry ≠ profileId`

`Registry ≠ current profile`

`Registry binding = exact canonical identity`

The existing Registry is `LanguageDecisionRegistry` in
`decisions/language-decision-registry.ts`. It contains its own `registryId`,
language/variety/curriculum identity, content version, lifecycle status,
decisions, dependency graph and coverage. Decision triggers use curricular
adaptation requirement refs (such as `AR04`); coverage uses closed requirement
domains. These refs are not themselves the S2 evidence target IDs. Decisions
can reference profile features, mechanisms and claims. Its artifact schema has
no separate `schemaVersion` field; Registry `version` is a content revision.

Registry artifacts already have durable, user-scoped storage in
`language_decision_registry_versions` (0022). Manual registration and M11 review
promotion write them; existing adaptation planning, orchestration and resolution
use the legacy v1 profile/Registry path. M6 constructs temporary Registries for
candidate validation. None of those consumers or generators is switched to v2
by this phase. The `evidenceRegistry` embedded inside a Profile is a different
contract, not a replacement for `LanguageDecisionRegistry`.

### Binding and SHA choice

`decisions/registry-profile-binding-v2.ts` defines a strict binding envelope:

| Field | Meaning |
| --- | --- |
| `bindingVersion` | Grounding contract format, `1.0.0` |
| `profileId` | Stable identity of the S3B canonical profile |
| `profileVersion` | Canonical content revision, independent of Registry version |
| `schemaVersion` | Profile schema, `2.0.0` |
| `contractVersion` | Requirement evidence target catalog contract, `1.0.0` |
| `canonicalRecordId` | Exact S3B canonical UUID |
| `canonicalSha256` | SHA of the materialized canonical snapshot |

The canonical SHA is S3A's existing digest after the explicit review-to-canonical
status transition. It is not the reviewed content SHA. The approved candidate
and its reviewed SHA remain reachable through S3B lineage; the binding does not
duplicate that identity or invent another profile digest. The existing Registry
`content_sha256` still hashes the Registry artifact and has a different purpose.

`compareRegistryProfileBindingsV2(actual, expected)` is the single pure comparison
of every binding field. It is deterministic and returns a discriminated result:
`registry_unbound`, malformed-binding diagnostics or `registry_profile_mismatch`
with field names. This predicate compares identities; it cannot establish DB
provenance for arbitrary caller objects. Use the durable service below for that.
Matching language, profileId, version, partial content or SHA alone never suffices.

### Durable API and atomicity

`knowledge/registry-grounding-v2.ts` provides `RegistryGroundingStoreV2`:

- `createRegistry({ userId, canonicalRecordId, registry })`
- `getRegistry(userId, registryRecordId)`
- `checkRegistryGrounding(userId, registryRecordId, canonicalRecordId)`
- `getRegistryForCurrentCanonical({ userId, profileId, registryRef: { id, version } })`

Creation accepts only an explicit canonical UUID. It rereads and validates that
record through S3B, validates the Registry against the explicit v2 profile context,
then constructs the binding privately. Raw profiles, candidates, review snapshots,
deprecated profiles and fabricated canonical objects are not accepted as durable
identity. The Registry validator reuses its existing semantic/reference checks;
the v2 context is explicit and cannot be mixed with a v1 context. S1/S2 evidence
resolution and S3A promotion rules are not reimplemented here.

Artifact generation remains outside this service: a producer reads a pinned
canonical and constructs the existing Registry artifact from it. Binding creation
occurs with persistence, after artifact construction. Artifact and binding are
inserted into one row in one transaction, so neither can be partially persisted.
This records exact source identity; it does not attest that arbitrary reasoning
was independently verified, approve Registry decisions, or authorize evidence
consumption. Registry status is preserved, not promoted by grounding.

Migration `0027_ground_language_decision_registries_v2.sql` extends the existing
table, with no new table and no backfill. `profile_record_id` remains the legacy
v1 FK but becomes nullable. New `canonical_record_id` references S3B; new
`profile_binding_v2` contains the full binding. A CHECK requires exactly one path:
legacy profile with no binding, or v2 canonical with a binding. Further CHECKs
validate the envelope, supported contract versions and agreement between its
canonical UUID and the FK column. Full equality with the referenced canonical,
including hashes and version, is enforced by the service and readers. The DB FK
alone does not validate a JSON digest against canonical content.

The existing UNIQUE `(user_id, registry_id, version)` is preserved. Reusing that
identity, even for an identical retry, returns `registry_version_exists`;
concurrent attempts cannot overwrite the winner. Rebinding requires an explicitly
new Registry version or ID. The API has no update/rebind/delete operation.
Inherited user ownership/FKs remain; this is append-only through the workflow,
not protection against administrative SQL or the existing user deletion cascade.

### History, currentness and corruption

New canonical B → Registry A remains historical → create Registry B explicitly.

Registry A remains valid for canonical A after B is current. A check against B
returns a mismatch. Explicitly creating for A after B was promoted is still an
operation for historical A, never a claim that A is current. There is no ambiguous
"bind to current" write API.

Current lookup reads S3B current and finds the requested exact Registry ID/version
for that canonical. Missing grounding returns `registry_not_found_for_canonical`;
it never selects an older, latest-by-time or merely compatible Registry. Reads
and creation use REPEATABLE READ. S3B reads share the outer transaction through
its existing transaction boundary. If a promotion commits during a lookup, its
returned canonical and Registry still belong to the same database snapshot.
This is currentness as of that read, not a lease against future promotions.

Readers runtime-validate the envelope, row metadata and Registry structure,
reconstruct the existing Registry hash from schema-normalized JSONB, reread the
referenced canonical through S3B, and compare all binding fields. Broken hashes,
bindings, missing references or payload mismatches fail conservatively with
`storage_integrity`. No casts or fallback create a trusted replacement binding.
Legacy rows remain `registry_unbound` for the v2 guard. Existing legacy repository
queries exclude v2 rows, preserving their non-null v1 profile contract. No existing
Registry is silently relabeled as derived from a v2 canonical.

### Verification and remaining integrations

`corepack pnpm test:integration:registry-grounding` uses the existing disposable
PostgreSQL runner. It verifies incremental 0027 migration with legacy data,
exact bindings, historical/current behavior, explicit rebinding, ownership,
concurrent creation/promotion, constraints, rollback and corrupted reads. The
normal migration integration suite also applies the complete chain on fresh DBs.
Migration execution is limited to isolated local tests; production rollout is
separate and has not been executed.

Future M4/M13/M14 must use this central grounding boundary and the appropriate
S2 evidence authorization, not manual profileId comparisons. They remain
unintegrated: no auto research, routes, UI, reviewer authentication or automatic
promotion is introduced. Canonical access authorization, production rollout and
general literal-types/readonly hardening remain deferred.
