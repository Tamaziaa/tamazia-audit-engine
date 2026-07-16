# Founder actions — tamazia-audit-engine

Everything on this list needs a human click by Aman. Each item states exactly where to click and which phase it blocks. Items marked **BLOCKS P0** stop the foundation exit gate; later-phase items can wait until that phase starts.

Legend: **BLOCKS Px** = the phase cannot pass its exit gate without this. *Before Px* = do it any time before that phase begins.

---

## 1. CodeScene — add the fresh repo + PR gate (BLOCKS P0)

CodeScene is one of the 12 continuous tools; the P0 exit gate requires the full fleet live from commit 1.

1. Open the existing project: https://codescene.io/projects/82581
2. Project settings -> Repositories -> add `Tamaziaa/tamazia-audit-engine`.
3. Enable the PR integration (delta analysis app) with the same configuration already proven on cowork-os (findings doc §6.7):
   - Excluded source branches pattern: `^(main|full-tree-base|empty-base)$`
   - Comment on all pull requests: ON
   - Delta analysis via the CodeScene GitHub app (install/approve the app on the new repo if prompted: https://github.com/apps/codescene-delta-analysis).
4. Confirm a test PR on the new repo gets a CodeScene delta comment.

Cost note: free tier first (open question #24 default). No paid upgrade without hitting the $100/month ceiling alert (question #29 default).

## 2. CodeRabbit — enable + port the custom rules (BLOCKS P0)

Pro Plus is already paid.

1. Open https://app.coderabbit.ai/ -> Repositories -> enable `Tamaziaa/tamazia-audit-engine` (approve the GitHub app on the repo if prompted).
2. Once cowork-os PR #335 (the custom bug-class rules in `.coderabbit.yaml`) is merged: copy that `.coderabbit.yaml` into the root of this repo. Source: https://github.com/Tamaziaa/tamazia-cowork-os/pull/335
   - If #335 is still open when P0 needs it, copy the file from the PR branch — the rules matter more than the merge state.
3. Confirm CodeRabbit reviews a test PR on the new repo.

## 3. GitHub repo settings (BLOCKS P0)

All at https://github.com/Tamaziaa/tamazia-audit-engine/settings

1. **Code scanning**: Settings -> Advanced Security (or Code security and analysis) -> CodeQL default setup **OFF / "Advanced"**. We run our own `codeql.yml` workflow; the default setup conflicts with it.
2. **Branch protection on `main`**: Settings -> Branches -> Add rule for `main`:
   - Require status checks to pass before merging: `ci.yml`, `codeql`, `semgrep` (exact check names appear after the first workflow runs — pick the three from the list).
   - Require a pull request before merging.
3. **Dependabot**: Settings -> Advanced Security -> enable **Dependabot security updates only** (alerts + security updates). Do NOT enable version updates — no Renovate-style dependency churn in this repo.

## 4. Repo secrets — add when the phase needs them

Settings -> Secrets and variables -> Actions -> New repository secret. Add nothing before its phase; a public repo carries zero secrets in code, only in Actions secrets.

| Secret | What it is | Needed for | Blocks |
|---|---|---|---|
| `NEON_URL` | Neon connection string, **read-only role** (create a dedicated read-only role in the Neon console first: https://console.neon.tech) | Catalogue migration reads the 187 laws / 696 rules | Before P2 |
| `GROQ_API_KEY` | https://console.groq.com/keys | Free-first LLM chain (adjudication) | Before P3 |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Free-first LLM chain (quorum member) | Before P3 |
| `CLOUDFLARE_WORKERS_AI` token | Cloudflare dashboard -> AI -> Workers AI -> API token | Free-first LLM chain (10k neurons/day lead) | Before P3 |
| NVIDIA NIM key | https://build.nvidia.com (API key) | Free-first LLM chain | Before P3 |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys (sk-ant-api03 class) | Haiku paid backstop — **ONLY if the P5 benchmark shows the free chain measurably degrades adjudication quality**. Do not add pre-emptively. | P5, conditional |

## 5. Semgrep cloud (optional, before P0 exit if wanted)

Semgrep OSS runs keyless in CI regardless. For the cloud dashboard + supply-chain rules:

1. https://semgrep.dev -> add project `Tamaziaa/tamazia-audit-engine`.
2. Settings -> Tokens -> create a token -> add as repo secret `SEMGREP_APP_TOKEN`.

Optional: the sweep counts Semgrep OSS as the tool; cloud is a bonus signal.

## 6. Open decisions — the 22 remaining questions (PRD §10)

Rob proceeds on the stated defaults unless you override. Answer inline in docs/PRD.md §10 or by message. Grouped by which phase first consumes the answer:

**Consumed by P1-P2 (answer early):**
- (9) Sector/sub-sector list — default: ~24-parent canonical tree, UK priority legal -> healthcare (incl. aesthetics/dental/pharmacy/care-homes) -> finance -> real-estate -> accounting -> hospitality -> education -> ecommerce/retail -> charity -> marketing.
- (13) English-only gate for v1 — default yes (non-English sites quarantine honestly).
- (14) B2B consumer-law suppression — default yes (consumer law needs B2C evidence).
- (15) Name display: legal name in identity block, trading name in headlines — default yes.
- (17) Reference-set additions beyond the 27 proposed firms — send targets, else the 27 stand.
- (27) "100%" definition: zero false claims + honest abstention + coverage disclosure — default yes.

**Consumed by P3-P4:**
- (16) Currency doctrine: statutory currency per regime, home-currency total with stated basis, no invented FX — default yes.
- (18) PDF download + share card — default: build in P4.
- (19) Per-recipient HMAC + superseded-page redirect-to-latest — default yes/redirect.
- (20) £495 unlock + pricing surfaces — default: keep mechanics, restyle only.

**Consumed by P5-P6:**
- (10) US states priority — default CA/NY/TX/FL/IL; state privacy attaches only on observable nexus, else advisory tier.
- (11) EU member states priority — default DE/FR/NL/IE/ES.
- (12) Gulf honest-frontier sign-off — default yes (conservative hand-curated rules, explicit confidence labels).
- (23) Paused 2,858-row queue stays paused until P3 exit, then re-mint — default yes.

**Process / money (standing):**
- (21) Merge cowork-os PR #342 (sweep tooling); #343 stays open as review vehicle — default yes. **Blocks P0's sweep port if #342 is unmerged and the branch drifts.**
- (22) After the port: freeze audit-path modules in cowork-os (CODEOWNERS + CI guard pointing here); agency pipeline untouched — default yes.
- (24) Tools money: CodeScene free tier first, Korbit trial only, no Copilot seat — default yes.
- (25) Phase-exit sign-off by Aman; caution.md reviewed monthly — default yes.
- (26) Telegram phase reports — default yes (bot exists).
- (28) SEND stays OFF throughout; flipping it is founder-only — default yes.
- (29) Combined monthly ceiling for paid tools + LLM backstop — default $100 alert threshold.
- (30) Repo name `Tamaziaa/tamazia-audit-engine` — default yes (this repo).

---

## Quick blocking summary

| Phase | Blocked by |
|---|---|
| P0 | Items 1 (CodeScene), 2 (CodeRabbit), 3 (repo settings); item 6 question 21 (PR #342 merge) |
| P2 | `NEON_URL` read-only secret (item 4) |
| P3 | The four free-tier LLM keys (item 4) |
| P5 | Nothing pre-committed; `ANTHROPIC_API_KEY` only if the benchmark demands it |
