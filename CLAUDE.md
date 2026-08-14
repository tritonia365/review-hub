# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Spec + implementation for **리얼 테이블 (Real Table)**, a Seoul-only restaurant review service whose pitch is "no ads, real reviews only." The repo currently contains:

- `PRD_1.md` — full product requirements (all phases, Phase 0 through Phase 3+).
- `DESIGN_2.md` — the visual design system.
- `index.html` — the only code artifact: a single self-contained static HTML file implementing the Phase 0 landing page plus a client-side auth demo.

There is no build system, package manager, test suite, or backend in this repo. Not a git repository.

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
2. **HTML body**: sticky header → `#hero` → content sections in PRD_1.md §16.2's S2–S11 order (`#problem`, `#principles`, `#usecases`, `#trust`, `#insights`, `#billboard`, `#roadmap`, `#signup`, `#admin-panel`, `#faq`) → footer → auth modals (`#modal-login`, `#modal-signup`) at the end of `<body>`.
3. **`<script>` IIFE** (~L1480–1904): scroll-reveal via `IntersectionObserver` (`.reveal` class), an animated donut chart (rating distribution) drawn with `conic-gradient` progressed via `requestAnimationFrame` rather than an SVG/canvas library, a word cloud (font-size on a sqrt scale of mention count, top 3 in gold), a FAQ accordion, and the auth system described below. All motion respects `prefers-reduced-motion`.

### `#insights` section data is intentionally fake

The rating-distribution donut and the keyword word cloud are static example arrays hardcoded in the script (`ratingData`, `keywords`), explicitly labeled "예시 데이터입니다" in the markup per PRD_1.md §16.2 (S6 requires dummy data marked as an example — real aggregation is Phase 0.5/1 work described in PRD_1.md §8 and §11.3, not implemented here). Both have an accessible fallback: a hidden `<table>` toggled into view via a "표로 보기" / "키워드 목록 보기" button, per PRD_1.md §11.2/§11.3's requirement that screen readers get the same data as the chart. Preserve that toggle pattern if you touch this section.

### Auth is a client-side mock, not real backend integration

PRD_1.md stages real auth (Supabase) into Phase 1 (§17.2); Phase 0 per the PRD is landing-page-only with no login. This repo's `index.html` intentionally goes beyond that PRD scope — login/signup/admin were added on explicit user request, with no backend available, so they're implemented as a `localStorage`-only simulation:

- `rt_users` — array of `{ email, passwordHash (SHA-256 via `crypto.subtle`), nickname, avatar, role: "guest"|"admin", createdAt }`.
- `rt_session` — `{ email }` of the currently "logged in" user.
- An admin account is auto-seeded on first load: `admin@realtable.kr` / `RealTable!2026` (see `seedAdmin()`). Logging in with it reveals `#admin-panel`, a read-only table of everyone who has signed up in that browser.
- Signup validation intentionally mirrors PRD_1.md §5.2/§5.4 rules: nickname 2–12 chars + uniqueness + a forbidden-word list blocking impersonation of "admin"/"관리자", password ≥8 chars with ≥2 of {letters, digits, symbols}, age-14+ checkbox.

This has no real security or persistence guarantees (visible in devtools, per-browser only, no rate limiting). Don't extend this mock further under the assumption it's a real auth system — if real accounts are needed, that's a Supabase integration per PRD_1.md §17.2–§17.4, not more localStorage code.

## Scope check before adding features

Everything in PRD_1.md marked 🔜 (Phase 0.5) or 📋 (Phase 1+) — search/filter, real restaurant/review data, Supabase, reporting/moderation, billboard scoring, owner accounts — is spec only and **not implemented** in `index.html`. Before wiring up something that looks like it should "just work" (e.g. making the billboard or insights data real), check whether the PRD phase-gates it; if so, that's a larger data-layer change (PRD_1.md §8's JSON→Supabase `Repository` abstraction), not a tweak to the existing static markup.
