# Language AI Boundary (M6)

This directory contains the first model-facing boundary for the versioned language curriculum runtime.

Rules enforced by the runtime:

- Models produce candidates, never canonical domain artifacts.
- Candidate output is structurally parsed and semantically validated before acceptance.
- Invalid candidates may be retried only within a small bounded attempt budget.
- Validation feedback is explicit and machine-readable; raw model output is never trusted as a domain artifact.
- Master-document extraction produces review-only `CurriculumUnitSpec` candidates and preserves exact document provenance.
- Adaptation decision proposals are allowed only for `registry_reasoning` research tasks.
- Decision proposals may use only the supplied `LanguageProfile` and `LanguageDecisionRegistry`; external research gaps must escalate upstream.
- AI-proposed decisions remain `provisional` and `machine_synthesized`; models cannot self-promote decisions to `validated`.
- Provider-specific request code is kept outside the provider-neutral candidate acceptance loop.
- No persistence, database write, public API route, or lesson generation happens in M6.
