# Phase 4.6: calibration before paid comparison

The original GOV.UK corpus and 344-job dry-run remain archived separately. That
schedule is not a mandate to run. Paid model generation remains unapproved.

Prepared locally: 12 GOV.UK calibration texts, an explicitly machine-authored
23-event draft, 25 exact evidence spans, and separate blank A/B human review forms.
The blind package contains no machine draft or reviewer notes. Human labels remain
0/100. Give A/B their blind packages before revealing the draft. Do not enter fake
names or method=human for agent work. An independent reviewer has not been assigned.

The separate multi-source pilot contains 7 retrieved official English publications
from Australia, Japan, Singapore, Qatar, India, Kenya and MERCOSUR. It is a candidate
collection, not a frozen benchmark. Three failed/interstitial source responses were
excluded. Original English government-source bias is reduced geographically but
remains by source kind and language. Check body boundaries (especially Singapore),
date/rights/category and story clusters; add editorial sources and other languages
before generalizing to global news. Source texts are local review materials, not
committed here or connected to production ingestion.

## Offline human-form validation

After backend build:

```text
node benchmark/review-preparation/check-review.mjs DATASET.json REVIEW_A.json REVIEW_B.json OUTPUT.json
```

This reads the review package's source text, verifies hashes, UTF-16 evidence
offsets, schema taxonomy, roles, relationship endpoints and evidence references.
Completed reviews require a real reviewer ID, method=human, status=submitted and
per-article reviewedAt. Blank forms and machine drafts are never accepted as final.
Both reviewers' declared IDs must differ before comparison. Identity declarations
cannot prove actual independence. Do not use one agent under two IDs.

Differences are conservative textual/schema differences, not semantic disagreement
scores. Different paraphrases can be equivalent; equal answers can both be wrong.
All disputed international relationships require human resolution. The tool never
writes ground-truth.json or changes Verified/Ready status. Human reviewers must also
check evidence attribution, country-role meaning, omissions and factual modality;
valid source spans alone do not prove that a relationship is supported.

## Next gates

1. Independent human calibration, resolve granularity/type/modality rules.
2. Review multi-source provenance/coverage/rights, annotate and freeze a separate
   evaluation set. If calibration changes rules/prompts, exclude its 12 IDs from
   the final holdout; do not silently rewrite the archived GOV.UK manifest.
3. New dry-run and separate budget approval for smoke only; validate schema,
   actual model ID, usage including thinking, HTTP handling and reservations.
4. Human-labelled paired evaluation, then main-run budget approval. Keep source
   subsets separate and account for story-cluster dependence in uncertainty.
5. Report Relationship F1, False Relationship Rate, Event F1, cost and latency,
   including coverage and provider failures; no automatic production switch.
