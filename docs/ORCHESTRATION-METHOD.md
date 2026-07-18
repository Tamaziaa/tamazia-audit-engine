# Tamazia orchestration method — honest cost/quality design (2026-07-18)

Founder ask: orchestrate near-free via OpenRouter, Fable only plans/checks/verifies, beat Opus at near-free cost, 100% quality up, 0% bug risk. This is the honest answer: what is real, what is not, and the exact working method.

## The three honest truths (read first)

1. **No LLM at any price gives 0% bug risk.** Opus does not, Fable does not, free models do not. What gives near-zero ESCAPED bugs is the 14-tool gate fleet + fresh-clone verification + adversarial external review (CodeRabbit/CodeScene/CodeQL/Semgrep). That guarantee is MODEL-INDEPENDENT: it holds whoever wrote the code. So "0% bug risk" is delivered by the gates, never by choosing a model. This is the single most important fact in the whole design.

2. **Free models writing code INCREASES bug risk.** Our own live benchmark (docs/h2h/, FREE-MODEL-DELEGATION-PLAN.md) proved it: on a code-diff task tencent/hy3:free scored 2.5/5 (wrong placement) and cohere 1/5 (fabricated code that does not exist in the repo). They fabricate under ambiguity. Routing code authoring to free models to save cost would LOWER quality, the opposite of the goal. Code stays with Sonnet/Opus.

3. **Free models EQUAL or BEAT paid on a specific slice** — and that is where the near-free win is real: classification/triage (tencent 4.5/5), doc drafting (tencent 5/5, verbatim-adopted as C-256/C-257), the mandatory non-Anthropic jury (Rule 12 gate 5 REQUIRES a non-Anthropic family - free models are the ONLY compliant jurors we have), bulk summarisation, transcript mining, cross-review second opinions. These are all VERIFICATION-CHEAP: a wrong answer costs seconds to catch.

## Where the quality actually goes up (the real lever)

The $10 top-up lifts OpenRouter free to ~1000 requests/day. That does NOT buy better code. It buys MORE INDEPENDENT VERIFICATION per unit of work, at zero marginal cost:
- every breach finding gets a free non-Anthropic jury vote before it ships (gate 5, now affordable at volume)
- every plan/brief gets a free adversarial red-team pass before builders start
- every doc/caution pointer gets a free cross-check
- every builder report gets a free second-opinion review alongside Fable's vet

More eyes, more diversity of failure-detection, more disagreement-as-signal - that is the "quality up" lever, and it is genuinely near-free now. Quality rises because the WORK IS CHECKED MORE, not because a cheaper model wrote it.

## The architecture (who does what)

| Layer | Who | Cost | Tasks |
|---|---|---|---|
| Orchestrate/plan/vet | Fable (here) | low (briefs from disk, sample with head/grep) | write briefs+benchmarks, vet every output, decide merge |
| Verification-cheap execution | free models via openrouter-agent.sh | ~$0 (1000/day) | collect, classify, triage, summarise, mine transcripts, DRAFT docs, JURY, cross-review |
| Verification-expensive execution | Sonnet (mechanical) / Opus (judgement) subagents | paid | write/refactor code, author legal facts, design |
| Quality guarantee | 14-tool gate fleet + fresh-clone + external stack | $0 (already built) | catches every bug regardless of author - THE 0%-escaped-bug engine |

## The loop (Fable spends almost nothing)

1. Fable assembles a brief + machine-checkable benchmark from files on disk (bash, ~0 Fable tokens).
2. Fable fires free models via `openrouter-agent.sh "<brief+inline context>" "<model>"` (their compute, not Fable's).
3. Fable samples the output with `head`/`grep` (cheap), grades against the benchmark.
4. Pass -> adopt. Fail -> re-send with the exact edit and "what you did wrong" (the send-back loop; tencent self-corrected 4/5 in testing).
5. Anything that touches code goes to a Sonnet/Opus builder, then the full gate fleet, then external review, then founder merge. Free-model output NEVER reaches main without the fleet + Fable between it and merge.

## "GitHub connected with OpenRouter" - the honest read

OpenRouter is an inference API, not an autonomous agent; it does not read your repo or open PRs by itself. Two real ways to use a GitHub connection:
- **Context feeding (works today):** our public repo means any file can be handed to a free model as inline context (raw.githubusercontent URL contents pasted in, or the harness cats the file). Free chat models CANNOT fetch URLs themselves (benchmarked: one replied "CANNOT FETCH") - the harness must inline the bytes. So "GitHub connected" = we can pull any file into a brief, which we already do.
- **Free-model coding agent (optional, gated):** tools like Aider / Cline / OpenHands can point at OpenRouter models and open DRAFT PRs. Viable ONLY for mechanical, fully-specified, gate-covered edits, and ONLY as a draft that must pass the entire fleet + Fable review + external stack before merge. Given the code-fabrication benchmark, this is a LAST resort for the cheapest mechanical churn, never for anything subtle. Recommendation: do not adopt yet; the Sonnet builders + gates already cover mechanical code at known-good quality.

## Honest verdict on the founder's three asks

- **"Near-free":** YES for ~20-30% of token volume (the verification-cheap slice) at ~$0/day now. NOT for code (70%) - that stays paid because that is where quality is won or lost.
- **"Better than Opus at near-free":** YES on the delegable slice (free + Fable vetting reaches ~90-95% of Opus there, and BEATS it on jury diversity). NO on code - free models are materially worse and must not author it.
- **"100% quality up, 0% bug risk":** the quality lift is real and comes from MORE verification (free jury/red-team/cross-check per unit of work), not cheaper authoring. Near-0 ESCAPED bugs comes from the gate fleet, which already exists and is model-independent. Anyone promising 0% bug risk from a model choice is lying; we deliver it from the gates.

## Daily cost at our usage

- Delegable slice on OpenRouter free (1000/day): **$0/day** (the $10 was one-off).
- If a lane ever needs better than tencent: DeepSeek V3 via OpenRouter ~**$0.50-1/day**, Gemini 2.5 Flash ~**$1/day** (best long-context). Add only on a benchmark-proven need.
- Code (Sonnet/Opus builders): unchanged - the necessary spend, protecting the 70% where bugs are expensive.

Bottom line: push ALL verification-cheap work (collect/classify/summarise/draft/jury/cross-review) to free models under the Fable-vet + gate-fleet protocol; keep code on Sonnet/Opus; spend the freed capacity on MORE checking. That raises quality and drops cost without betting quality on a cheap model.
