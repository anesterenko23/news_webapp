# Phase 4.7 — semantic extraction, backend mapping

The engine now asks the LLM what happened, who interacted, how, and why if the
source states a cause. The LLM does not allocate identifiers, resolve ISO codes,
anchor offsets, manage publication or perform database deduplication.

## Existing architecture audit

| Component | Decision |
|---|---|
| Metered Mistral/Gemini adapters | Retain endpoints, usage, budgets, errors, redaction and retries; select smaller wire schema by prompt version |
| Versioned extraction | Add `world-lens-semantic/4.7.0` as default; retain 1.2.1/1.2.0/1.1.0 replay paths |
| Country catalogue / entity resolution | Reuse country aliases; expand known organizations; unknown names remain visible for review |
| Validation | Preserve historical validator. New mapper separates schema, evidence matching, semantic uncertainty and source verification |
| Canonical Events / deduplication | Reuse existing strict lineage/action/actor/type/direction/time matching; no LLM dedup decisions |
| Prisma/history/source lineage | Retain all tables and migrations. Semantic metadata/reason live in existing validationResults JSON; rawClaim/rawOutput remain original |
| AI Lab | Add semantic version to existing selector and show attributed reason; no new interface or workflow |
| Country Explorer / globe | Preserve main demo and renderer; extend preview DTO with organizations, unresolved names, reason and per-arc modality |

The former contract required temporary evidence IDs, attribution references, ISO
codes, action/object quotations, dates and confidence. Valid semantic answers were
rejected for non-country ISO affiliations and harmless paraphrases. The new wire
contract removes those backend responsibilities rather than weakening the retained
historical validator or silently editing old claims.

## Wire contract

`backend/src/semantic-contract.ts` defines and exports both the Zod schema and JSON
Schema. Reuses existing event taxonomy and roles. Shape:

```json
{
  "events": [{
    "title": "UK and Spain sign education cooperation agreement",
    "summary": "The UK and Spain signed an education cooperation agreement.",
    "eventType": "international_agreement",
    "status": "completed",
    "participants": [
      {"name":"United Kingdom","type":"country","role":"partner"},
      {"name":"Spain","type":"country","role":"partner"}
    ],
    "relationships": [{"from":"United Kingdom","to":"Spain","type":"international_agreement","direction":"bidirectional"}],
    "reason": null,
    "evidence": "Source passage, if available"
  }]
}
```

Evidence may be null. `direction` also allows unknown, which never becomes an
invented directed globe arc. Reason is null or `{text, attribution, statedBy}`;
attribution is reporter/party/speculation. The backend does not fill a missing
reason from general knowledge or claim independent causal verification.

Participants include countries, international organizations, government bodies,
people, companies, locations and unspecified groups. Relationships may name
non-country participants. Only resolved country-country interactions become
country arcs; semantic non-country relationships are preserved without expanding
organizations into their membership or individuals into whole-country targets.

## Mapping and review

`semantic-mapper.ts` resolves country names and known organizations, anchors source
evidence, assigns internal evidence IDs, and converts to the existing claim shape.
It preserves original semantic participants/relationships/reason in validation
metadata. Unknown entities are kept with original names and review warnings.

No exact evidence match => NeedsRepair / NeedsReview, not Refuted; raw event and
article remain persisted. A malformed event is retained as Invalid alongside valid
siblings. A malformed root response remains a failed processing run with rawOutput.

Conservative deterministic checks suppress self-links, context-only actors,
unknown directions, unsupported types, personal/company-target expansions,
condemnation-as-conflict, causal-target confusion and unsubstantiated cliques.
They are **not** an independent semantic verifier. A source cue or exact quote can
still accompany an incorrect relation. Every event requires review; all new
canonical records remain Unverified / NeedsReview. No auto publication is added.

Internal database confidence columns remain for compatibility; the new wire
contract omits confidence and the public claim DTO returns null instead of
pretending the mapper's storage placeholder is model confidence.

Historical 4.5 revalidation explicitly skips 4.7 runs, so name-based raw outputs
are not reinterpreted as ISO-based payloads. Historical records are not rewritten
to the new contract. No migration or destructive data operation is needed.

## Provider choice

Gemini is the candidate in `.env.example`; Mistral remains supported. Actual
backend/.env, deployed provider selection and model IDs are unchanged. The example
uses output cap8000 and timeout60000. Only the new Gemini semantic profile requests
thinkingLevel=low (Gemini2.5 retains its existing thinkingBudget handling).
Previous benchmark prompt versions keep their original requests/configuration.

## Verification

- 10 reviewed offline fixtures on real source passages cover sanctions/restrictions,
  conflict, diplomacy, agreement, unilateral statement, multiple actions,
  international organization, domestic control, planned action, contradictory claims.
- Fixtures are explicitly **reviewed test responses, not live Gemini outputs**.
- A separate actual Mistral call with the new contract processed the full original
  UK–Spain education publication. HTTP200, one valid claim, one canonical event,
  correct GB/ES resolution and GBR↔ESP preview. 973 input / 587 output tokens,
  $0.000234 estimated. Saved response is replayed in regression tests.
- Gemini's new schema/request is tested offline. Fresh Gemini semantic extraction
  has not been measured: the preceding diagnostic exhausted its project daily quota.
  No new comparative benchmark or unnecessary quota retries were performed.
- Retained protocol regressions explicitly select their original prompt versions.

Commands: `npm run backend:build`, `npm run test:backend`, `npm test`, `npm run build`.
In restricted Windows environments where esbuild cannot inspect ancestor folders,
use `npm test -- --configLoader runner` and `npm run build -- --configLoader runner`.

## Limits

Semantic accuracy still depends on the model. Deterministic cues are conservative,
mostly English/Russian and do not establish factual truth. Unknown aliases,
organization names, ambiguous attribution, complex reasons and indirect actions
need review. Missing evidence can withhold valid arcs; malformed roots cannot be
recovered without a separately authorized retry. Event date remains null rather
than being guessed from publication time. Source independence is not inferred
from repeated articles. Full new-contract live coverage with Gemini remains a
follow-up once its provider quota permits it.
