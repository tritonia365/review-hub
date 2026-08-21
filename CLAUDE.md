# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Spec + implementation for **리얼 테이블 (Real Table)**, a Seoul-only restaurant review service whose pitch is "no ads, real reviews only." The repo currently contains:

- `PRD_1.md` — full product requirements (all phases, Phase 0 through Phase 3+).
- `DESIGN_2.md` — the visual design system.
- `index.html` — the main code artifact: a single self-contained static HTML file implementing the Phase 0 landing page plus real Supabase-backed auth.
- `api/*.js` — Vercel serverless functions that proxy third-party API keys (Kakao, Google Places, Gemini) and handle Supabase Auth Admin operations (`delete-account.js`) server-side, so those keys never reach the browser.

There is no build system, package manager, or test suite in this repo. The only backend is the `api/*.js` Vercel serverless functions (plain Node, no npm dependencies) plus the Supabase project's built-in Auth — there is no custom database/application server.

## Commands

None. `index.html` is self-contained (inline `<style>` + inline `<script>`, fonts loaded from CDN). To view it, open the file directly in a browser — no server, install, or build step. There is no lint/test tooling configured; when validating changes, at minimum re-check:

- JS syntax: extract the `<script>` body and run it through `new Function(...)` (catches syntax errors without executing DOM code).
- Tag balance: `<div>`/`</div>` and `<section>`/`</section>` counts should match.
- Every `document.getElementById("X")` call has a corresponding `id="X"` in the HTML.

## Document precedence: DESIGN_2.md overrides PRD_1.md §3

`DESIGN_2.md` explicitly supersedes `PRD_1.md` §3 (brand/design tokens) — see DESIGN_2.md's header note and its §12 delta table. When the two disagree, **DESIGN_2.md wins**. The most consequential override, easy to miss because PRD_1.md §16.2 states it the other way:

- PRD_1.md §16.2 says the Hero background should be `--rt-yellow-pale`.
- DESIGN_2.md §3.3 and §13 explicitly forbid yellow as a header/hero background ("대면적 금지: 헤더 바, 섹션 전체 배경, 히어로 배경에 노랑 금지") and cap yellow to ≤5% of any screen's area, used only for the single primary CTA/active-filter element per screen.
- Ratings/stars are always ink-colored, never yellow (DESIGN_2.md §7.1, §8.4) — yellow reads as "action," not "achievement." Gold (`--rt-gold`) is the separate color for medals/achievement, and must stay out of the yellow's 5% budget.

`index.html` follows DESIGN_2.md's stricter interpretation throughout (ivory hero background, ink-colored rating ring/stars, gold used only for medal/billboard accents). Keep this precedence when adding UI — don't "fix" the hero background to match PRD_1.md §16.2 literally.

Other DESIGN_2.md rules baked into the current CSS that matter when extending it:
- Dual type system: Noto Serif KR (`--rt-font-display`) for headings/hero only, never body/buttons/inputs/labels/data — Pretendard (`--rt-font-body`) for everything else. Serif text must never go below 18px.
- `word-break: keep-all` is set globally on `body` — required for Korean line-wrapping, don't remove it.
- Numeric values (ratings, counts, prices) use `.numeric` (`font-variant-numeric: tabular-nums`).
- Border-radius stays ≤14–20px (`--rt-radius-*` tokens) — larger rounding reads too casual for this brand's "미슐랭 톤."

## Architecture of index.html

Single file, three parts in order:

1. **`<style>` block** (~L34–994): CSS custom properties under `:root` are a 1:1 mapping of DESIGN_2.md §14.1 tokens (`--rt-paper`, `--rt-ink`, `--rt-yellow`, `--rt-gold`, spacing/radius/shadow/motion scales). Component styles follow, then per-section styles in the same order as the markup.
2. **HTML body**: sticky header → `#hero` → content sections in PRD_1.md §16.2's S2–S11 order (`#problem`, `#principles`, `#usecases`, `#trust`, `#insights`, `#billboard`, `#roadmap`, `#signup`, `#faq`) → footer → auth modals (`#modal-login`, `#modal-signup`, `#modal-mypage`) at the end of `<body>`.
3. **`<script>` IIFE** (~L1480–1904): scroll-reveal via `IntersectionObserver` (`.reveal` class), an animated donut chart (rating distribution) drawn with `conic-gradient` progressed via `requestAnimationFrame` rather than an SVG/canvas library, a word cloud (font-size on a sqrt scale of mention count, top 3 in gold), a FAQ accordion, and the auth system described below. All motion respects `prefers-reduced-motion`.

### `#insights` section data is intentionally fake

The rating-distribution donut and the keyword word cloud are static example arrays hardcoded in the script (`ratingData`, `keywords`), explicitly labeled "예시 데이터입니다" in the markup per PRD_1.md §16.2 (S6 requires dummy data marked as an example — real aggregation is Phase 0.5/1 work described in PRD_1.md §8 and §11.3, not implemented here). Both have an accessible fallback: a hidden `<table>` toggled into view via a "표로 보기" / "키워드 목록 보기" button, per PRD_1.md §11.2/§11.3's requirement that screen readers get the same data as the chart. Preserve that toggle pattern if you touch this section.

### Auth is real Supabase Auth (email + password), ahead of PRD_1.md's phase gate

PRD_1.md stages real auth into Phase 1 (§17.2); Phase 0 per the PRD is landing-page-only with no login. This repo's `index.html` intentionally goes beyond that PRD scope on explicit user request — login/signup/mypage are wired to a real Supabase project (`qpeyzjsmikuchthtntjq`, see `.env.example`), not a mock:

- The client (`supabase-js@2`, loaded via CDN) is created once at the top of the `<script>` IIFE with the project URL + anon/publishable key — safe to ship, since RLS (not key secrecy) is what would protect any real tables. No tables exist yet; auth alone doesn't need any (Supabase's built-in `auth.users` covers it), so there is no `profiles` table.
- No nickname/avatar concept — the signup form only collects email + password (plus an age-14+ checkbox mirroring PRD_1.md §5.4). The header/mypage display name is derived client-side from the email's local-part (`user.email.split("@")[0]`).
- `currentUser()` returns the live Supabase `user` object (or `null`), kept in sync via `supabaseClient.auth.onAuthStateChange` + an initial `getSession()` call — this is the single source of truth other features (e.g. the "나의 담기" save button) should call to check who's logged in. Session persistence/refresh across reloads is handled entirely by supabase-js's default localStorage-backed session storage — don't hand-roll it.
- Password changes and account deletion live in the `#modal-mypage` modal. Both re-authenticate via `signInWithPassword` before acting (defense against a stolen/left-open session): change-password then calls `supabaseClient.auth.updateUser({ password })`; delete-account calls the `/api/delete-account` Vercel function (server-side, using `SUPABASE_SERVICE_ROLE_KEY`) since deleting an auth user requires the Admin API, which the anon key cannot call.
- Korean error messages are centralized in `mapAuthError()` — extend that map rather than inlining new error-string checks at each call site.
- "이메일 인증 대기" (email confirmation) is intentionally skipped for now, per explicit user request — this requires **"Confirm email" to be turned off in the Supabase Dashboard** (Authentication → Sign In / Providers → Email), which cannot be set via the MCP tools available in this repo's session. If signup ever stops auto-logging-in and instead shows "가입은 완료됐지만 자동 로그인에 실패했어요," check that setting first.

There is no admin panel / admin role in this implementation (the earlier mock's `admin@realtable.kr` seed account and `#admin-panel` were mock-only and were removed with it). If an admin surface is needed later, it belongs in a Supabase-backed `profiles`/`roles` table with RLS, not client-side role-checking.

## Scope check before adding features

Everything in PRD_1.md marked 🔜 (Phase 0.5) or 📋 (Phase 1+) — search/filter, real restaurant/review data, Supabase, reporting/moderation, billboard scoring, owner accounts — is spec only and **not implemented** in `index.html`. Before wiring up something that looks like it should "just work" (e.g. making the billboard or insights data real), check whether the PRD phase-gates it; if so, that's a larger data-layer change (PRD_1.md §8's JSON→Supabase `Repository` abstraction), not a tweak to the existing static markup.
