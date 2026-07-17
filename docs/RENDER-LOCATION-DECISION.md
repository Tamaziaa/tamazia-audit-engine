# Render-location decision: where should /audit/* live

Status: research complete, decision NOT executed. No repo other than this doc was touched.
Scope: does audit rendering (today served by `tamazia-website` Pages Functions) move into
`tamazia-audit-engine`, and if so, how, given the constraint that everything audit-related
should live in one repo where feasible.

Owner note: only this file was written. `catalogue/*`, linters, compile scripts and
`tools/facts-abstain/*` / `tools/lib/safe-path*` were not touched (a parallel workflow owns
those).

---

## 1. What exists today (verified by reading the live repo, not assumed)

- `tamazia-website` is a Cloudflare Pages project (`pages_build_output_dir = "dist"`,
  `tamazia-website/wrangler.toml`), custom-domained to `tamazia.co.uk`.
- `/audit/<slug>/<hash>` is served by `functions/audit/[[path]].js`, a Pages Function. It:
  - reads Neon (`audit_pages` table) for the row, falls back to the `AUDITS` R2 bucket for
    the full payload when `payload_json.r2 === true`,
  - runs `payloadToD()` (`functions/audit/_adapter.js`, ~2,200 lines) and `renderShell()`
    (`functions/audit/_shell.js`) to produce the HTML,
  - fires a best-effort PostHog `audit_opened` beacon via `context.waitUntil(fetch(...))`,
  - falls through to Pages' static-asset server (`context.next()`) for anything under
    `/audit/` that looks like a file or lives under `/audit/{fonts,engine-logos,trusted-logos}/`
    — i.e. `audit-app.js`, `audit-charts.js`, `audit.css`, the woff2 fonts and the SVG logos
    are ordinary static files in `tamazia-website/public/audit/`, not code.
- Cache behaviour for those static assets is set in `tamazia-website/public/_headers`
  (Pages-only config: `/audit/fonts/*` → 1-year immutable, `/audit/audit-app.js` /
  `audit-charts.js` / `audit.css` / `kings-logo.png` → `no-cache` so a redeploy is never
  masked by a stale edge copy).
- Stripe: `functions/api/stripe/webhook.js` lives under `/api/stripe/webhook`, not
  `/audit/*`. On a successful payment it runs
  `UPDATE audit_pages SET unlocked = true WHERE slug = $1 AND hash = $2` directly against
  Neon. It does not call into `/audit/*` at all — the coupling is entirely through the
  shared Neon table, not through routing.
- Cloudflare Access is scoped to `tamazia.co.uk/admin/*` only (`references/admin-access.md`),
  applied as a Cloudflare Access Application on the Pages custom domain. It has no
  configured overlap with `/audit/*`.
- `AUDITS` R2 bucket and the Neon connection are both bound in `tamazia-website/wrangler.toml`
  today; the audit engine repo does not currently hold either binding.

## 2. What Cloudflare's docs actually say (verified, cited)

I fetched Cloudflare's own documentation pages directly rather than relying on memory or
blog/forum summaries as authority. Findings below are quoted or closely paraphrased from
the cited page; anything I could not find an explicit sentence for is flagged as
**unconfirmed** rather than asserted.

**(a) Workers Routes: matching and precedence**
- "Routes are a set of rules that evaluate against a request's URL" and route patterns use
  only the wildcard operator (`*`).
- "When more than one route pattern could match a request URL, the most specific route
  pattern wins" — e.g. `example.com/hello/*` beats `example.com/*`.
  Source: https://developers.cloudflare.com/workers/configuration/routing/routes/

**(b) Routes vs Custom Domains**
- A Custom Domain "points all paths of a domain or subdomain to your Worker" (whole
  domain/subdomain). A Route is path-scoped and is the documented mechanism "if you only
  wish [for] some subset of paths to be served by your Worker."
  Sources: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
  and https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
- "Routes can `fetch()` Custom Domains and take precedence if configured on the same
  hostname" — this is documented for a **Worker** Custom Domain, not explicitly for a
  **Pages** custom domain.
  Source: https://developers.cloudflare.com/workers/configuration/routing/

**(c) Workers Route evaluation happens early, ahead of some Page-Rule-driven features**
- "Cloudflare decides if this request is a Worker route. Because this is a Worker route,
  Cloudflare evaluates and disable[s] a number of features" that Page Rules would otherwise
  control.
  Source: https://developers.cloudflare.com/workers/configuration/workers-with-page-rules/

**(d) Static assets vs. Worker code precedence inside a single Worker**
- "Workers... will default to serving static assets ahead of your Worker script, unless you
  have configured `assets.run_worker_first`" — meaning a single Worker (in the newer
  Workers-with-static-assets model) can serve both dynamic render code and static files
  (fonts, JS, CSS, SVGs) from one deploy, with an explicit flag to make code run before
  falling through to assets on specific paths.
  Source: https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/

**(e) Pages Functions' own internal precedence**
- A Pages request first tries to match a Function; if none matches it "will fall back to a
  static asset if there is one... [or] the default routing behaviour for Pages' static
  assets." More specific Function routes win over less specific ones.
  Source: https://developers.cloudflare.com/pages/functions/routing/

**(f) CI/CD is repo-independent, token-scoped**
- Cloudflare's own GitHub Actions guide deploys with `cloudflare/wrangler-action`, authenticated
  purely via `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. The token, not the
  repository, is what's scoped to an account/zone. There is nothing that ties a Workers Route
  or an R2 binding to a particular GitHub repo — any repo's CI with the right token can deploy
  a Worker and create/update a route on a given zone.
  Source: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

**(g) The one thing I could NOT confirm from official docs**
Cloudflare's documentation does not contain an explicit sentence covering the exact scenario
this decision hinges on: *"a Workers Route on `tamazia.co.uk/audit/*`, deployed from a
different repo's CI, while Cloudflare **Pages** (not a Worker Custom Domain) continues to
serve the rest of `tamazia.co.uk`."* The precedence rule that's actually documented (a) is
between two Workers Routes, or (b) a Route vs. a Worker Custom Domain — never Route vs.
**Pages**. Community-forum thread titles strongly suggest this is a common, working pattern
("Route multiple Cloudflare Workers/Pages to different URL paths on a single domain", "Add
Route to Cloudflare Pages"), and the general architecture (Routes are evaluated at the edge
independent of what serves the hostname by default) supports it being possible, but I would
be fabricating false certainty if I asserted it as docs-confirmed. **This is the single
highest-value thing to verify empirically before committing to Option B or C** — see the
spike in §3.

## 3. Recommended verification spike (cheap, reversible, do this before deciding)

1. In `tamazia-audit-engine`, add a 10-line throwaway Worker (`wrangler.toml` +
   `src/spike.js` returning `new Response('engine-worker-alive')`).
2. Deploy it via `wrangler deploy` (a temporary API token scoped to
   `Zone:Workers Routes:Edit` + `Account:Workers Scripts:Edit` for the `tamazia.co.uk` zone)
   with route `tamazia.co.uk/rl-spike/*` — a path Pages does not currently own, so a 404 vs.
   `engine-worker-alive` is unambiguous.
3. `curl -i https://tamazia.co.uk/rl-spike/anything` — confirm it returns the Worker's body,
   not the Pages 404 page.
4. Delete the route and the spike Worker.
This proves or disproves the Route-over-Pages precedence claim with a real request in about
five minutes, at zero risk to production paths, before any migration work starts.

---

## 4. Options

### Option A — status quo+: engine owns a shared `@tamazia/audit-contract` package

The website keeps serving `/audit/*` via its own Pages Functions. The audit engine repo
publishes (or the website vendors, via a git submodule / npm package / scripted sync) the
schema, `payloadToD`, and the validator as one versioned package. The website imports it
instead of maintaining its own 2,200-line copy of `_adapter.js`.

- **Accuracy/coupling benefit**: the single biggest real defect class today (per
  `render-pipeline-freeze` history) is drift between what the engine emits and what the
  website's copy of the adapter expects. A shared, versioned package removes that drift
  at the source — every website deploy pulls a pinned version, and engine changes to the
  contract force an explicit version bump the website must consume, rather than silently
  diverging.
- **Migration steps**: (1) extract `payload/contract/index.js` + schema (already exists in
  the engine repo under `payload/`) into a publishable package; (2) point the website's
  `functions/audit/_adapter.js` imports at that package instead of its local copy; (3) wire
  a CI check in the website repo that fails the build if the vendored contract version is
  older than N releases behind the engine's tagged version.
- **Deploy-pipeline changes**: none to Cloudflare config. Website CI gains one new
  dependency-install step.
- **Risks**: still two deploys (engine cuts a contract release, website consumes it) —
  version-skew window remains, just smaller and explicit instead of silent. No routing
  risk at all since nothing about Cloudflare's request path changes.
- **Rollback**: trivial — pin the website back to the previous contract version.

### Option B — full move: engine repo deploys a Worker owning `tamazia.co.uk/audit/*`

`tamazia-website` loses `functions/audit/` entirely (adapter, shell, commerce, contract,
`[[path]].js`) and the static assets under `public/audit/` (fonts, `audit-app.js`,
`audit-charts.js`, `audit.css`, logos). `tamazia-audit-engine` gains its own Worker (using
Workers Static Assets so one deploy serves both the dynamic slug/hash render and the JS/CSS/
font/logo files — see finding (d)), deployed via its own CI to a Workers Route
`tamazia.co.uk/audit/*`.

- **Accuracy/coupling benefit**: maximal — there is only ever one copy of the render code,
  in the repo that owns the contract. No sync step can drift because there is no second copy.
- **Migration steps**:
  1. Move `functions/audit/_adapter.js`, `_shell.js`, `_commerce.js`, `_contract.js`,
     `[[path]].js` (rewritten as a standalone Worker `fetch` handler) into
     `tamazia-audit-engine`.
  2. Move the static assets (`public/audit/audit-app.js`, `audit-charts.js`, `audit.css`,
     `kings-logo.png`, `fonts/*.woff2`, `engine-logos/*.svg`, `trusted-logos/*.svg`) into
     the engine repo and wire them as Workers Static Assets (`assets.directory` +
     `assets.run_worker_first` for the two-segment slug/hash paths, per finding (d), so
     asset requests still fall through to static files while `/audit/<slug>/<hash>` runs
     the render code).
  3. Re-implement the `_headers` cache rules (finding: Pages' `_headers` file is Pages-only
     and is **not** read by a standalone Worker) as explicit `Cache-Control` response
     headers in the Worker code, matching the existing values exactly (1-year immutable
     for fonts, `no-cache` for the JS/CSS/logo so deploys are never masked).
  4. Bind `AUDITS` R2 and the Neon connection string / pooler secret to the new Worker
     (R2 buckets and env secrets are account-level resources; binding the same bucket from
     a second Worker is a normal, independent binding — it does not detach it from the
     website's binding).
  5. Port the PostHog `audit_opened` `waitUntil` beacon and the HMAC verify helper
     (`verifyHmacHex`) into the new Worker unchanged.
  6. Add a new GitHub Actions workflow in `tamazia-audit-engine` that runs
     `wrangler deploy` with a `CLOUDFLARE_API_TOKEN` scoped to this zone's Workers Routes
     + this account's Workers Scripts (finding (f): repo-independent, token-scoped).
  7. Create the Workers Route `tamazia.co.uk/audit/*` pointing at the new Worker; delete
     `functions/audit/` and `public/audit/` from the website repo in the same change window.
- **Deploy-pipeline changes**: two independent CI pipelines instead of one — website CI no
  longer touches `/audit/*` at all; engine CI owns build + deploy + the route. Website
  deploys become faster and safer for audit rendering (a website-side regression can no
  longer break `/audit/*`, and vice versa).
- **Risks**:
  - **Unconfirmed precedence** (finding (g)) — must run the §3 spike first. If a Workers
    Route does *not* take precedence over Pages for a zone the Pages project already
    serves, Option B is blocked outright and Option C (or A) is the only path.
  - **Stripe webhook**: verified NOT at risk — `/api/stripe/webhook` is outside `/audit/*`
    and only touches Neon, never routes into the audit render path.
  - **Cloudflare Access on `/admin`**: verified NOT at risk in principle — the Access
    Application is scoped to `tamazia.co.uk/admin/*`, a disjoint path prefix from
    `tamazia.co.uk/audit/*`. The real risk is operator error (someone later widens the new
    Workers Route pattern beyond `/audit/*`, e.g. to `tamazia.co.uk/*`, which would then
    sit in front of `/admin/*` too and needs re-verifying against Access). Keep the route
    pattern exactly `tamazia.co.uk/audit/*`.
  - **Cache regression**: real and must be handled explicitly (see migration step 3) —
    Pages' `_headers` file has no equivalent auto-read by a Worker; cache headers must be
    coded, not configured.
  - **Two Cloudflare dashboards/pipelines to reason about** during any incident — an
    on-call person checking "is tamazia.co.uk healthy" now has to know rendering moved.
  - **Secrets duplication**: the Neon pooler connection string now lives as a secret in two
    repos' CI instead of one, widening the leak surface (mitigated by using least-privilege,
    separately rotatable tokens per repo). The `AUDITS` R2 bucket is NOT a duplicated secret:
    the Worker reaches it at runtime through a binding (no credentials in code), and CI needs
    only the scoped Cloudflare API token for the wrangler deploy, alongside the Neon secret.
    This is a binding/configuration concern, not an R2 credential copied into both repos.
- **Rollback**: re-point the Workers Route deletion (or disable it) and restore
  `functions/audit/` + `public/audit/` from git history in the website repo; redeploy
  website. Because Cloudflare Routes are additive/removable independently of Pages, deleting
  the route alone reverts to nothing serving `/audit/*` at the Worker layer, and Pages
  (once its old Function code is redeployed) resumes serving it. This is a clean, mechanical
  rollback but not instantaneous — budget the time to redeploy the website with the
  restored Functions rather than assuming deleting the route alone is sufficient.

### Option C — hybrid: Worker owns the route, static assets stay on Pages

Same as B for the dynamic render path (`tamazia.co.uk/audit/<slug>/<hash>` served by a
Worker deployed from the engine repo), but the static assets (`audit-app.js`, fonts, logos,
CSS) are deliberately left on Pages rather than duplicated into the engine repo.

- **Accuracy/coupling benefit**: same as B for the part that actually drifts today (the
  adapter/contract/render logic) — that is the code that has caused real incidents. Static
  assets essentially never drift (they're versioned by filename/cache-busting already), so
  there is little accuracy upside to moving them, only migration cost.
- **Migration steps**: steps 1, 4, 5, 6, 7 from Option B, but **not** step 2/3 — static
  assets and `_headers` stay exactly where they are in the website repo.
- **The catch (must resolve before this is viable)**: Cloudflare Route patterns are plain
  wildcard strings (finding (a)) — `tamazia.co.uk/audit/*` matches *everything* under
  `/audit/`, including `audit-app.js`, `fonts/*`, `engine-logos/*`. There is no native
  "match only the two-segment slug/hash pattern, let file requests fall through to Pages"
  behaviour in a Route pattern the way today's Pages Function does it in code
  (`context.next()`). And a Worker cannot `fetch()` back into the same zone's Pages project
  (Routes/Workers cannot same-zone-`fetch()` a Custom Domain per finding (a)'s companion
  note, and Pages isn't a Worker Custom Domain in the first place). So the Worker would have
  to either:
  - (i) explicitly `fetch()` the assets from the Pages project's `*.pages.dev` subdomain
    (a **different**, non-same-zone hostname, which same-zone-`fetch()` restrictions do not
    apply to) and proxy the response — adds one extra network hop and a cross-project
    runtime dependency, or
  - (ii) narrow the Route pattern to only the dynamic paths it can express as a wildcard
    (not fully possible given Cloudflare Routes only support one wildcard operator and no
    path-segment awareness — the closest is separate routes per known static filename,
    which is fragile and breaks the moment a new asset filename is added).
  Given this, Option C's "hybrid" framing is technically the more complex option, not the
  simpler one — it avoids duplicating ~7 small static files but pays for that with either
  a cross-project runtime `fetch()` proxy or a brittle set of exclusion routes.
- **Risks**: everything in Option B's risk list, plus the asset-routing complexity above,
  which is itself an unconfirmed-by-docs mechanism (Cloudflare doesn't document "proxy to a
  Pages `.pages.dev` origin from a Workers Route" as a supported pattern for exactly this
  use case; it would work because `.pages.dev` is just another public hostname, but it's
  worth a second small spike before relying on it).
- **Rollback**: same mechanics as Option B.

## 5. Recommendation

**Option A now, Option B later, skip Option C.**

- Option A gets nearly all of the accuracy benefit (the contract/adapter is the thing that
  actually drifts and has caused incidents) for a fraction of the migration risk, with zero
  changes to Cloudflare routing, zero new secrets exposure, and a same-day rollback.
- Option B is the right end state if Aman wants rendering fully inside one repo, but it
  should not be started until the §3 spike has empirically confirmed Workers-Route-over-
  Pages precedence for this exact zone, and until the cache-header and beacon porting work
  is budgeted as real migration work, not an afterthought.
- Option C is not recommended: it claims to be the lighter-touch hybrid but is actually the
  most complex option once the wildcard-route limitation is accounted for, and the assets it
  "saves" from duplication are a handful of small, rarely-changing files (moving them costs
  less than building and maintaining a cross-project asset proxy).

## 6. Founder inputs needed before Option B can start

1. **Cloudflare account access** for the `tamazia.co.uk` zone with permission to create a
   scoped API token (`Zone:Workers Routes:Edit`, `Account:Workers Scripts:Edit`, and — once
   past the spike — `Account:Workers R2 Storage:Edit` for the `AUDITS` bucket binding) for
   `tamazia-audit-engine`'s GitHub Actions.
2. **Explicit go-ahead to run the §3 spike** (a throwaway route on a path nothing currently
   owns, deleted immediately after) — zero production risk, but it is a live change to the
   Cloudflare zone and should be a conscious yes, not assumed.
3. **Decision on secrets duplication**: does the Neon pooler connection string / R2
   credentials get freshly minted for the engine repo's CI (recommended — least privilege,
   independently rotatable), or reused from the website's existing secrets?
4. **A confirmed migration window**: Option B's rollback is mechanical but not instant
   (redeploy the website with restored Functions) — this should happen in a low-traffic
   window with the founder aware, not silently.

## 7. Open questions (carried forward, not resolved by desk research)

- Does a Workers Route actually take precedence over a Cloudflare **Pages** project (as
  opposed to a Worker Custom Domain) for the same zone? Cloudflare's docs confirm this for
  Route-vs-Route and Route-vs-Worker-Custom-Domain, never explicitly for Route-vs-Pages.
  Resolve with the §3 spike before committing engineering time to Option B/C.
- If the spike proves precedence works: is proxying to `*.pages.dev` from a Worker (Option
  C's escape hatch) actually reliable in practice (cold-start latency, whether Cloudflare
  rate-limits or blocks cross-project `.pages.dev` fetches from a Worker)? Not verified —
  only relevant if Option C is reconsidered later.
- No pricing/plan-limit research was done (e.g. whether the account's current Workers plan
  covers the extra Worker + route at the audit-engine's expected request volume) — flag for
  the founder if this becomes a live migration rather than a decision doc.
