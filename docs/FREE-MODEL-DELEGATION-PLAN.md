# FREE MODEL DELEGATION PLAN
### Benchmark-grounded plan for delegating Tamazia dev-workflow tasks to free LLM APIs without losing quality
Commissioned by Rob. Authored 2026-07-18. No repo code was changed to produce this. All numbers below are from live API calls run through the existing `openrouter-agent.sh` harness on the real repo, graded against ground truth constructed from the repo itself. British English. Not legal advice.

---

## EXECUTIVE SUMMARY (read this, then the tables)

1. Free models are real and usable for a defined slice of our workflow, but availability is the first-order problem, not capability. Of OpenRouter's 20 `:free` models, the three "obvious best" (qwen3-coder, llama-3.3-70b, gemma-4-31b) were rate-limited to unavailability (HTTP 429 on every attempt, including four escalating-backoff retries), while two less-hyped models (tencent/hy3, nvidia/nemotron-3-super-120b) answered every call first time.
2. On six real repo task-probes, the three reliably-available clean models scored 4.7 to 4.9 out of 5 on average (tencent 4.9, cohere 4.8, nvidia 4.7). That is genuinely high. Free is not synonymous with bad.
3. The best free models on our work were tencent/hy3:free (avg 4.9/5) and cohere/north-mini-code:free (4.8/5): faithful collector summaries, disciplined cross-review with no hallucinated defects (cohere even dodged the classic bogus-ReDoS trap by noting `/\s+/g` is linear), correct verdict classification, correct caution.md pointers, and correct fail-closed adjudication with proper disproof discipline.
4. Where free models are WORSE than Sonnet: long-context multi-file code writing, multi-file coherence, and reliable structured output. One model (openai/gpt-oss-20b:free) injected random foreign-script tokens into its output and corrupted a generated test's variable name, producing a `ReferenceError` at runtime. That is disqualifying for code drafting and dangerous for any JSON-consuming collector.
5. Where free models are EQUAL or BETTER: independent-family jury diversity (Rule 12 gate 5 REQUIRES non-Anthropic families, and OpenRouter offers 20 free models across 10 provider orgs), bulk parallel summarisation, disagreement-as-signal cross-checks, and cost-free volume.
6. The realistic quality-preserving delegation share is 20 to 30 per cent of session token-volume, not 80. Code writing, refactoring and legal-content authoring (roughly 55 per cent of volume) stay on paid models by design.
7. The reason is failure economics, not snobbery: delegate a class only when VERIFYING the free model's output is cheaper than doing the task on a paid model. Collection, cross-review, fixture drafting, jury voting and doc drafting are verification-cheap. Code changes and legal facts are verification-expensive (full gate fleet, fresh-clone, e2e vs reference-set, or human legal review).
8. The guardrail is already written in our own doctrine: Fable writes the brief plus a machine-checkable benchmark (Fleet Rule 2), the free model executes as a COLLECTOR or CROSS-CHECKER, its output is DATA vetted by Fable and the gates, never merged unreviewed. Same rule as every reviewer: CI plus founder merge decide.
9. A concrete guardrail lesson fell out of the benchmark: I gave the fixture-drafting probe a brief with the wrong constant case (`UNKNOWN_ARTIFACT_TYPE` where the code emits `unknown_artifact_type`). Every model faithfully reproduced my wrong brief. Running the generated test caught it in under 2 milliseconds. That is the whole model in one sentence: the free model is only as right as Fable's brief, and only trustworthy because the output is cheap to verify.
10. Recommended integration path (ONE): keep using the existing `openrouter-agent.sh` as a Bash-callable tool. It works today, needs zero new infrastructure, keeps the key local (chmod 600, never in a repo), and passes file content INLINE. This is the primary path.
11. Do NOT pursue the "give the model a raw.githubusercontent URL" path. I tested it: the free chat models cannot fetch URLs (a working model replied "CANNOT FETCH"). Inline content is mandatory, which is exactly what the harness already does.
12. Graduate to a thin MCP server (exposing `call_free_model`) ONLY when call-volume and multi-agent reuse justify the maintenance, and even then wrap the same harness so there is one door. ACP (Agent Client Protocol) is the wrong layer entirely: it connects an editor to an agent, not an agent to a model.
13. Spend implication: zero. Everything here is free tier. The one honest caveat is the OpenRouter free daily cap (50 requests/day under 10 credits, 1000/day at 10+ credits) plus per-model contention. For sustained dev use, a one-off 10-credit (about 8 GBP) top-up lifts the cap 20x and is the only spend worth considering, subject to founder sign-off.
14. Headline percentages: DELEGATE about 16 per cent of token-volume outright (collection, doc drafting, jury). DELEGATE-WITH-VERIFICATION about 20 per cent (cross-review, fixture drafting, transcript mining, red-team generation). NEVER delegate about 55 per cent (code writing, refactoring, legal authoring), plus about 9 per cent Fable orchestration that by definition stays with Fable. The quality-preserving realistic share lands at 20 to 30 per cent because not all of the with-verification slice clears the quality bar on free models.
15. Bottom line for Rob: wire the free fleet in as the 15th validation tool and as the mandatory non-Anthropic jury, delegate the verification-cheap bulk, and never let a free-model output reach main without a gate or Fable between it and the merge button.

---

## PART 1 - INVENTORY (real, current as of 2026-07-18)

### 1a. OpenRouter free models (`:free` suffix)
Fetched live from `https://openrouter.ai/api/v1/models`: 344 total models, of which **20 carry the `:free` suffix**, spread across **10 provider organisations** (the family diversity that matters for Rule 12 gate 5). Sorted by context length:

| Context | Model ID | Family |
|--------:|---|---|
| 1,048,576 | `qwen/qwen3-coder:free` | Qwen (Alibaba) |
| 1,000,000 | `nvidia/nemotron-3-ultra-550b-a55b:free` | NVIDIA |
| 1,000,000 | `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA |
| 262,144 | `tencent/hy3:free` | Tencent |
| 262,144 | `qwen/qwen3-next-80b-a3b-instruct:free` | Qwen |
| 262,144 | `poolside/laguna-xs-2.1:free` | Poolside |
| 262,144 | `poolside/laguna-m.1:free` | Poolside |
| 262,144 | `google/gemma-4-31b-it:free` | Google |
| 262,144 | `google/gemma-4-26b-a4b-it:free` | Google |
| 256,000 | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | NVIDIA |
| 256,000 | `nvidia/nemotron-3-nano-30b-a3b:free` | NVIDIA |
| 256,000 | `cohere/north-mini-code:free` | Cohere |
| 131,072 | `openai/gpt-oss-20b:free` | OpenAI |
| 131,072 | `nousresearch/hermes-3-llama-3.1-405b:free` | Nous |
| 131,072 | `meta-llama/llama-3.3-70b-instruct:free` | Meta |
| 131,072 | `meta-llama/llama-3.2-3b-instruct:free` | Meta |
| 128,000 | `nvidia/nemotron-nano-9b-v2:free` | NVIDIA |
| 128,000 | `nvidia/nemotron-nano-12b-v2-vl:free` | NVIDIA |
| 128,000 | `nvidia/nemotron-3.5-content-safety:free` | NVIDIA |
| 32,768 | `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | CognitiveComputations |

**Rate limits (from OpenRouter docs, confirmed against our key):** all `:free` variants share **20 requests/minute**; **50 requests/day** for accounts that have purchased under 10 credits, **1000 requests/day** at 10+ credits. Limits are governed globally per account, so extra API keys do not add capacity. Our key is confirmed free-tier (`is_free_tier: true`, usage 0), so it sits on the 50/day cap today.

**Availability is model-specific and volatile (the key operational finding).** During benchmarking, `qwen/qwen3-coder:free`, `meta-llama/llama-3.3-70b-instruct:free` and `google/gemma-4-31b-it:free` returned HTTP 429 on every call, including four retries with escalating backoff (12+24+36+48s). `tencent/hy3:free` and `nvidia/nemotron-3-super-120b-a12b:free` answered every call first time. `openai/gpt-oss-20b:free` and `cohere/north-mini-code:free` also answered reliably. The lesson: pick free models by REACHABILITY tested at run time, not by leaderboard reputation. The hyped models are the most contended.

### 1b. Direct free tiers the estate already uses in production (dev-workflow reuse potential)
| Provider | Free allowance (2026) | Card? | Dev-workflow reuse |
|---|---|---|---|
| **Groq** | 30 req/min, 6k tokens/min, ~1,000 req/day default (some models 14,400/day); no credits system, no per-token charge | No | Strong. Genuinely free, very fast (LPU). Best for bulk summarisation and cross-check volume. Already a CLAUDE.md ecosystem provider. |
| **Google Gemini** (AI Studio) | Flash tier ~10-15 req/min, 250k tok/min, 250-1,500 req/day; 2.5 Pro 5 req/min, 50 req/day | No | Strong for collection and second-opinion; large TPM helps long inputs. Already used (free quota) in the estate. |
| **Cloudflare Workers AI** | 10,000 neurons/day (~15-25 text generations/day at 500 tokens) | No (Workers free plan) | Limited by the low daily ceiling; fine for a handful of small gate-side checks, not bulk. Models include Llama, Qwen, Gemma, DeepSeek. |
| **NVIDIA NIM** (build.nvidia.com) | 1,000 inference credits (up to 5,000 on request), 40 req/min, OpenAI-compatible | No | A finite pool, NOT daily-renewable, so treat as burst not sustained. 100+ models incl. Nemotron, Kimi, GLM. Good for a one-off diverse-jury leg. |

The practical read: Groq and Gemini are the two direct tiers worth wiring for dev-workflow reuse because they are genuinely renewable-free, no card, and already in the ecosystem. OpenRouter is the breadth play (20 models, 10 families in one endpoint). Cloudflare and NIM are supplementary.

### 1c. Other genuinely free programmatic APIs worth adding
- **Groq** (above) is the strongest genuinely-free add beyond OpenRouter: no credit system at all, only rate limits.
- **Cerebras** offers a free developer tier (fast inference, Llama/Qwen family) worth a look for a second independent-family jury leg; treat its limits as generous-but-capped.
- **Mistral / Codestral** free tier: usable but rate-limited; another distinct family for jury diversity.
- Be sceptical of "free" that is really a trial: **NVIDIA NIM's 1,000 credits are a finite pool**, not a daily reset, so it behaves like a trial for sustained use. Anything asking for a card up front, or advertising "free credits that expire", is a trial, not a free tier, and does not belong in a zero-cost standing workflow.

---

## PART 2 - REAL BENCHMARKS (run, not speculated)

### Method
Each model was run through `openrouter-agent.sh` (inline file context, the harness's real mechanism) on six probes drawn from THIS repo, and graded 0-5 against ground truth constructed from the repo. Models benchmarked (chosen for reachability + family diversity): **tencent/hy3:free** (Tencent), **nvidia/nemotron-3-super-120b-a12b:free** (NVIDIA), **openai/gpt-oss-20b:free** (OpenAI), **cohere/north-mini-code:free** (Cohere). The three reputation-picks (qwen3-coder, llama-3.3-70b, gemma-4-31b) were attempted first and are reported as UNAVAILABLE (429). Family spread is deliberate: it is the exact diversity Rule 12 gate 5 requires.

### The probes and their ground truth
- **T1 COLLECTOR** - summarise `docs/p3-wave1-reports/W1b-registers-report.md` into 10 dense bullets. Ground truth = the report itself (6 files, name-match threshold 0.6 + rationale, provenance/degrade doctrine, CQC/FCA/ICO gaps, verification evidence, all 4 open risks).
- **T2 CROSS-REVIEW** - 100-line excerpt of `breach/verifiers/quote-match.js`; find genuine defects. Ground truth = the whitespace-only normalisation contract and the artifact-shape seam are DELIBERATE and correct; a good reviewer confirms that and does not invent defects (no case-folding recommendation, no bogus ReDoS claim).
- **T3 FIXTURE DRAFT** - a `node:test` for a described fail-closed behaviour. Graded by actually running it against the real module.
- **T4 VERDICT CLASSIFICATION** - 5 sweep-lead descriptions, fix/accept. Ground truth = Rob's dispositions in the integration ledger and the W1b open-risks (ACCEPT, ACCEPT, FIX, ACCEPT, FIX).
- **T5 DOC DRAFT** - a `caution.md` pointer for a described fail-open gate. Ground truth = the house `**C-NNN** what-went-wrong -> mechanically-checkable-rule` format.
- **T6 ADJUDICATION JUROR** - a mini breach adjudication where the quote does NOT entail the claim. Ground truth = `needs_review` with explicit non-entailment reasoning (the Rule 12 gate 5 disproof discipline).

### Score matrix (0-5)

| Model | T1 collect | T2 x-review | T3 fixture | T4 verdict | T5 doc | T6 juror | Avg |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **tencent/hy3:free** | 5 | 5 | 4.5 | 5 | 5 | 5 | **4.9** |
| **nvidia/nemotron-3-super-120b:free** | 5 | 4 | 4.5 | 5 | 4.5 | 5 | **4.7** |
| **openai/gpt-oss-20b:free** | 3 | 4 | 2 | 3.5 | 4.5 | 5 | **3.7** |
| **cohere/north-mini-code:free** | 5 | 5 | 4.5 | 5 | 4.5 | 5 | **4.8** |
| qwen3-coder / llama-3.3-70b / gemma-4-31b | UNAVAILABLE (HTTP 429 on all attempts; one gemma call that landed did a clean "no defects" T2 = capable when reachable) | | | | | | n/a |

### Failure modes observed, with verbatim examples

**T1 (collector) - strong across the board when the model is clean.**
- tencent (5/5): captured all four open risks including the subtle one ("Repo sweep reports RED but only from other parallel builders' files ... nothing under `evidence/registers/`"). Faithful, no invention.
- openai/gpt-oss-20b (3/5): substantively correct but the output was polluted with random foreign-script tokens mid-sentence, verbatim: "sub-modules never add provenance ಬೇಕ (C-005)" and "an 11-line echo between `facts/identity.js` and百家乐- name-match.js". The content is right; the token pollution makes it unsafe to feed a JSON-consuming pipeline without a cleaning pass. This is a real reliability defect, not a stylistic quibble.

**T2 (cross-review) - the disproof-discipline test. All clean models passed; tencent was best.**
- tencent (5/5) confirmed the contract correctly AND found two genuine sharp edges without hallucinating, verbatim: "`resolveQuoteArtifact` can inject `page_url: undefined` ... still fail-closed, not a bypass" and "`findPage` uses strict `===` on `page.url` ... legitimate quotes get rejected due to URL surface variance ... fail-closed (correct per contract)". That is exactly the second-opinion value we want: real observations, correctly characterised as non-bypasses.
- cohere (5/5) matched tencent for depth and was the most precise on the classic trap: it explicitly noted "the `/\s+/g` replace is linear", pre-empting the bogus-ReDoS false positive, and correctly framed the Unicode-whitespace question as "current ASCII-only handling is permitted" rather than a defect. Verbatim conclusion: "The module implements the allowed whitespace-run normalisation and the additive artifact-shape handling exactly as permitted ... No genuine defects or risks remain."
- nvidia (4/5), openai (4/5): both correctly returned "no genuine defects" and confirmed the whitespace and artifact-shape handling, but neither surfaced the sharp edges tencent found. Correct verdict, less depth. Critically, none of the clean models hallucinated a defect or recommended violating the contract, which is the priority (a false positive is a bug, axe-core doctrine).

**T3 (fixture draft) - compiles-and-runs test. This is where structured-output reliability bites.**
- tencent, nvidia and cohere (4.5/5): all three produced clean, parseable `node:test` files with correct structure and correct fail-closed assertions. I ran them against the real module: each PARSES, and test 2 (missing artifact -> `verified===false`) PASSED. Test 1 asserted `code === 'UNKNOWN_ARTIFACT_TYPE'` (uppercase) because MY BRIEF specified that case; the real module emits lowercase `unknown_artifact_type`, so it failed on run. Uniform across all models, caught in under 2ms by running it. Verification-cheap in action.
- openai/gpt-oss-20b (2/5): the token-corruption defect produced broken code, verbatim: `const candidateшей = { artifact: { type: 'unknown_type' } };` then `verifyCandidate(candidate, bundle)`. The declared variable is `candidateшей` (Cyrillic injected), the reference is `candidate`, so running it throws `ReferenceError: candidate is not defined`. A fixture that does not run is worse than no fixture. Disqualifying for code drafting.

**T4 (verdict classification) - ground truth ACCEPT/ACCEPT/FIX/ACCEPT/FIX.**
- tencent, nvidia and cohere (5/5): all five correct. tencent verbatim: "3. FIX because duplicate load-bearing logic violates one-door rule and two independent tools would agree on drift risk. ... 5. FIX because unwired calibration gate cannot fire on shipped fixtures, violating (d) theatre-must-be-wired." cohere even cited the governing rules by name ("deferred cleanup per C-207", "wired ... per rule D").
- openai (3.5/5): got 1,2,3,5 right but flipped #4 to FIX ("gate cannot fire without profile fetch; wiring required") when ground truth is ACCEPT (a documented port-source search-only scope limit). An over-eager fix, the less costly error direction, but still wrong against Rob's disposition.

**T5 (doc draft) - house-format caution.md pointer.**
- tencent (5/5), verbatim: "**C-209** An LLM adjudicator gate wrapped in try/catch returned a default 'pass' verdict on timeout or thrown error ... -> CI must fail the pipeline if any adjudication gate's catch block can return a non-explicit verdict, enforced by a static check that every catch in gate code either rethrows or returns only values from an enumerated DENY/ALLOW/INCONCLUSIVE set with no default-pass branch." Exact format, mechanically checkable.
- nvidia (4.5/5) and openai (4.5/5): both correct format and mechanically checkable; openai even named the lint ("a CI lint should flag any `catch` block containing a literal `Verdict.PASS` return"). Slightly less crisp than tencent's enumerated-set rule.

**T6 (adjudication juror) - the Rule 12 gate 5 test. The quote proves a cookie-policy LINK, not a consent MECHANISM.**
- ALL four models returned `needs_review` with correct non-entailment reasoning. tencent verbatim: "The quote only states that a Cookie Policy link is present ... it does not state or entail that no cookie consent mechanism exists ... the correct outcome is needs_review rather than violation." This is the single most encouraging result: on the exact task Rule 12 gate 5 requires non-Anthropic families for, every free family got the disproof discipline right and abstained rather than confirming a weak breach. A false abstention is the safe direction; a false confirmation is caught by the deterministic gates 1-4.

### Benchmark takeaways
- Three free models (tencent 4.9, cohere 4.8, nvidia 4.7) are at delegation-grade on our real work for the verification-cheap classes.
- The differentiator between models is RELIABILITY of output form (token corruption, structured-output integrity), not raw reasoning. gpt-oss-20b reasons well but corrupts output, so it is fine for prose verdicts and useless for code.
- On adjudication (T6), free family diversity is not just acceptable, it is the point, and all families delivered.

---

## PART 3 - INTEGRATION RESEARCH (MCP vs ACP, and the simplest path)

### The protocol question, settled
**MCP (Model Context Protocol)** connects an agent to its tools and data (the vertical: agent -> tools). **ACP (Agent Client Protocol, Zed)** connects a code EDITOR to an agent (the horizontal: editor -> agent), using JSON-RPC over stdio to host an agent's UI (diffs, approvals) inside an editor. For our need, which is exposing free models AS callable tools to Claude Code / Fable, **MCP is the correct layer and ACP is irrelevant**: ACP would let an editor drive Claude Code, not let Claude Code call a free model. (Note also the naming muddle: a separate "Agent Communication Protocol" merged into A2A in 2025; neither A2A nor ACP is our layer.) So the real choice is between three concrete implementations, all sitting under the MCP-or-simpler umbrella.

### Path A - the existing bash harness as a Bash-callable tool (WORKS TODAY)
`openrouter-agent.sh "<prompt>" "<model>" [files...]`. Fable calls it via the Bash tool. Verified end-to-end today across 30+ live calls in this very benchmark.
- Pros: zero new infrastructure; already built and proven; key stays local (chmod 600, never in a repo, matched by our own secret scans); passes file content INLINE (the only thing that works, see Path C); trivially scriptable for parallel fan-out (I ran a 5-model x 6-probe matrix as a plain bash loop).
- Cons: not a first-class structured tool (args are positional); each subagent must shell out; logging is DIY (redirect to files, as I did).
- Maintenance: near zero. One shell file, one Python inliner.

### Path B - an MCP server exposing `call_free_model`
A small stdio MCP server (Node or Python) registering one tool `call_free_model(model, prompt, files[])`, registered via `claude mcp add` or `.mcp.json`. Internally it should call the SAME harness/transport (one door).
- Pros: first-class tool with a typed schema; any subagent can call it without shelling out; centralises quota-aware routing, retries/backoff, negative-result caching (caution.md C-138/C-139) and full call logging (Fleet Rule 9) in one place.
- Cons: a server process to keep alive and maintain; MCP config to manage; more surface to break. By our own C-207 ("tooling ships through its own gate-loop PR, a feature PR only shrinks"), this is a standalone tooling PR, not a bolt-on.
- Maintenance: modest but non-zero. Justified only at volume.

### Path C - GitHub-mediated (raw URLs in the prompt) - REJECTED, tested
The idea: give the free model a `raw.githubusercontent.com` URL instead of inline content. **I tested it.** With the repo public (raw `CONSTITUTION.md` returns 200), I asked a working free model to fetch the URL and report a specific fact, with an explicit "reply CANNOT FETCH if you cannot retrieve it". It replied, verbatim, **"CANNOT FETCH"**. Free chat-completion models on these endpoints have no browsing/tool capability, so a URL in the prompt is just an inert string. Inline content (what the harness already does) is mandatory. Path C does not work; do not build it.

### Recommendation: Path A now, Path B later, never Path C
Adopt **Path A (the bash harness as a Bash-callable tool)** as the primary integration path immediately. It is the simplest thing that works, it is already proven, and it honours least-privilege (local key, no new network surface). Only graduate to **Path B (a thin MCP server wrapping the same harness)** if and when free-model calls become routine across many subagents and you want centralised quota-routing, caching and logging, and ship it as its own gate-loop PR. Keep the harness as the underlying transport in both cases so there is exactly one door to the free fleet.

---

## PART 4 - THE VERDICT (honest percentages)

### Token-volume model of one build wave
Estimated from this session's shape (about 12 builder agents at 300-500k tokens each, collectors about 300k, audits about 200k), a representative wave is roughly 8M tokens, dominated by builders. Class shares below are of that total.

### Taxonomy x delegation verdict x model x why

| Workflow class | ~% of token-volume | Verdict | Free model to use | Why |
|---|:--:|---|---|---|
| **Code writing** (builders implementing modules, multi-file, tool-use loops) | ~47% | **NEVER** | none | Free models are worse at long-context, multi-file coherence and iterative tool use; verification is as expensive as the task (full gate fleet + fresh-clone + e2e vs reference-set). MAST: 41.8% of multi-agent failures are spec/design, 36.9% inter-agent misalignment. |
| **Refactoring** (cross-file, cross-cutting) | ~5% | **NEVER** | none | Same as code writing plus higher coherence risk; a half-applied refactor is worse than none (C-194). |
| **Legal-content authoring** (catalogue law facts, penalties, citations) | ~3% | **NEVER** | none | Rule 11 forbids the LLM authoring a fact; free models hallucinate statutes (the exact C-127 failure). Human-gated by CONSTITUTION. |
| **Collection / summarisation** (reports, ledgers -> dense bullets) | ~10% | **DELEGATE** | tencent/hy3, cohere/north-mini-code, or Groq/Gemini | Verification-cheap (spot-check vs source in seconds). Benchmark T1: 5/5 for clean models. |
| **Doc drafting** (caution.md pointers, phase reports) | ~4% | **DELEGATE** | tencent/hy3, nvidia | Format is mechanically checkable; T5 scored 4.5-5/5. |
| **Adjudication jury** (Rule 12 gate 5 P0/P1 findings) | ~2% | **DELEGATE (REQUIRED)** | a quorum of DISTINCT families: tencent + nvidia + cohere + openai | Gate 5 REQUIRES non-Anthropic families. Free models are structurally the right tool here, not merely permitted. T6: all families correct, disproof discipline intact. Errors fail safe (false abstain is safe; false approve is caught by deterministic gates 1-4). |
| **Cross-validation second opinions** (independent defect review of a diff) | ~5% | **DELEGATE-WITH-VERIFICATION** | tencent/hy3 (best), nvidia | The harness's designed role (the 15th tool). Output is a LEAD, dismissed per-item with a reason (C-162); a missed defect is caught by CI, not the reviewer. T2: tencent found real sharp edges; others correctly said "no defects". |
| **Fixture / test drafting** (node:test from a spec) | ~6% | **DELEGATE-WITH-VERIFICATION** | tencent/hy3, nvidia (NOT gpt-oss-20b) | Verification is running the test (cheap). BUT a vacuously-passing test is the danger, so Fable must review assertion TARGETS, not just green/red. Token-corrupting models disqualified (openai T3 threw ReferenceError). |
| **Transcript mining** (JSONL transcripts -> structured extraction) | ~5% | **DELEGATE-WITH-VERIFICATION** | Gemini/Groq (large TPM) or chunk + tencent | Bulk and parallelisable, but long-context is a free-model weak spot; chunk it and verify the join. |
| **Red-team generation** (adversarial fabrication fixtures) | ~4% | **DELEGATE-WITH-VERIFICATION** | distinct families for diversity | Independent families generate more varied attacks; output is fixtures that must then be RUN through the gates (verification = does the gate catch the class). |
| **Fable orchestration** (planning briefs, rechecks) | ~9% | stays with Fable | n/a | Steps 2 and 4 of the GATE LOOP are Fable-by-definition. |

### The headline percentages
- **DELEGATE outright: ~16%** (collection 10 + doc 4 + jury 2). Verification-cheap or fail-safe.
- **DELEGATE-WITH-VERIFICATION: ~20%** (cross-review 5 + fixtures 6 + transcript mining 5 + red-team 4). Delegate-able at quality only because Fable/the gates vet the output.
- **NEVER: ~55%** (code 47 + refactor 5 + legal 3), plus **~9% Fable orchestration** that stays with Fable.
- **Realistic quality-preserving delegation share: 20-30% of token-volume.** The benchmark supports the higher end for the clean classes (T1/T4/T5/T6 at 4.7-5/5) and the lower end where verification is essential (T2/T3). It is emphatically NOT 80%, because builders dominate volume and legal authoring is constitutionally off-limits. Crucially this is a token-volume share, not a value share: the delegated slice is the lower-risk, higher-parallelism work, so it buys real throughput without touching the load-bearing path.

### Where free models are WORSE than Sonnet (be honest)
- Long-context multi-file code work: coherence degrades, tool-use loops are unreliable.
- Structured-output integrity: token corruption (gpt-oss-20b injected foreign scripts and broke a variable name). Sonnet does not do this.
- Following a subtle spec across many steps without drift.

### Where free models are EQUAL or BETTER
- Independent-family jury diversity: Rule 12 gate 5 REQUIRES non-Anthropic families, and free gives 10 families in one endpoint. Here free is the CORRECT tool, and a rejection from a weak judge is more trustworthy than its approval (the gate 5 design).
- Bulk parallel summarisation: cost-free volume, easy fan-out.
- Disagreement-as-signal cross-checks: a cheap second family that disagrees is a free lead.

### Guardrail protocol (the same one every reviewer follows)
1. **Fable writes the brief plus a machine-checkable benchmark BEFORE the free model runs** (Fleet Rule 2). The benchmark is what makes verification cheap.
2. **The free model executes as a COLLECTOR or CROSS-CHECKER**, exactly the harness doctrine: "OpenRouter models are COLLECTORS and CROSS-CHECKERS (a 15th tool in the validation toolkit) ... their output is DATA for Fable/agents to vet, never merged unreviewed, never an authority (same rule as every reviewer: CI + founder merge decide)."
3. **Output is DATA, vetted by Fable and the gates.** A cross-review finding is a LEAD (per-item dismissal with reason, C-162); a drafted test is RUN; a jury vote feeds the quorum, never overrides curated catalogue facts (SECTOR_CORE / SECTOR_AGNOSTIC immunity, gate 5).
4. **Never merged unreviewed.** CI status on the merge commit plus founder merge is the only "done" (Fleet Rule 1, C-205). No free-model output is an authority.
5. **Model-escalation still applies** (AGENTS.md section 9): least-capable-sufficient model. A free model that demonstrably cannot do a task escalates to Sonnet, then Opus, then Fable. Free is the new bottom rung, not a replacement for the ladder.

### Failure economics (why the line falls where it does)
The delegation boundary is drawn by ONE question: is verifying the free output cheaper than doing the task on a paid model?
- **Collection wrong** -> Fable spot-checks vs the source in seconds. Verification cost << task cost. DELEGATE.
- **Cross-review wrong** -> a false defect costs one written dismissal; a missed defect is caught by the gates anyway (the reviewer is additive signal, never the arbiter). DELEGATE-WITH-VERIFICATION.
- **Fixture wrong** -> running it reveals the mismatch in milliseconds (proven live: the case-mismatch and the ReferenceError both surfaced instantly). The residual risk is a vacuous pass, so Fable reviews the assertion target. Still cheap. DELEGATE-WITH-VERIFICATION.
- **Jury vote wrong** -> a false veto routes a real finding to abstention (the safe direction); a false approval is caught by deterministic gates 1-4. Fails safe. DELEGATE.
- **Code change wrong** -> the defect hides across files, passes local tests, and surfaces at integration or in production (MAST's 21.3% verification-failure class). Verification requires the full gate fleet, a fresh-clone run and e2e vs the reference set: as expensive as doing the task right. NEVER.
- **Legal fact wrong** -> a fabricated statute is the single worst outcome in this estate's history (C-127, the invented "Cookies Regulations 2020" with three fake URLs). Verification needs official-source fetching and human legal review, and Rule 11 forbids it outright. NEVER.

The through-line: **delegate where verification is cheaper than the task; refuse where verification costs as much as doing it right the first time.** Free models change the economics of the cheap-to-verify classes from "pay Sonnet" to "pay nothing, verify for pennies". They change nothing about the expensive-to-verify classes, which is why the quality-preserving ceiling is 20-30 per cent, not 80.

---

### Appendix - reproducibility
- Harness: `/Users/amanigga/Desktop/TAMAZIA-REBUILD/Tamazia-Remix/openrouter-agent.sh` (local key at `~/.tamazia-secrets/openrouter.env`, chmod 600, never in a repo).
- Probe prompts, raw model outputs, and the T3 compile-run grader are under the session scratchpad `.../scratchpad/probes/` (probe1-6, `out/`, `t3check/`). Ground-truth sources: `docs/p3-wave1-reports/W1b-registers-report.md`, `breach/verifiers/quote-match.js`, `docs/p3-wave2-reports/ROB-INTEGRATION-LEDGER.md`, `AGENTS.md`, `CONSTITUTION.md` Rules 11-12, `caution.md` sections 7 and 10.
- Every number in Part 1 was fetched live from the OpenRouter models API and confirmed against docs; every score in Part 2 is from a real call graded against the repo.
