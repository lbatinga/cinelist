# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CineList is a collaborative movie-tracking PWA for a closed group of friends (Netflix-style catalog, ratings, stats, ranking). It is a **single-file vanilla JS/CSS/HTML app with no build step, no package manager, and no test suite** — `index.html` (~330KB) contains the entire app: all CSS in one `<style>` block and all JS in one `<script>` block. There is no `package.json`.

Backend is Supabase (Postgres + Auth), project ref `iznikddtdwfvkkwqtwxg` (i.e. `https://iznikddtdwfvkkwqtwxg.supabase.co`, matching `SUPA_URL2` in `index.html`). Hosting is GitHub Pages, deployed by pushing to `main` (auto-publishes; Fastly CDN in front has a ~10 min edge cache, so a just-pushed change may take a few minutes to show up live — verify with a cache-busted `curl` if it matters, not by re-pushing).

## Status (2026-08-20)

Mid-way through a multi-phase plan to add achievement trilhas ("Conquistas") and a v2 compatibility formula ("Afinidades"). The full phase-by-phase prompt lives outside this repo — the user brings it into each session, it isn't checked in here.

- **Fase 2 is closed**: the `conquistas` table exists and is backfilled (tag `v1`, the promoted/permanent one — 196 rows, 12 usuários, 10 trilhas, 65 rows with `precisao='indeterminada'`). See the Conquistas section below for the schema and rules.
- **No screen in `index.html` reads from `conquistas` yet** — it's backend-only until Fase 5 (UI das conquistas).
- **Next up: Fase 3** — a base comparison against the group average, which will feed both the new compatibility formula and four new especiais (Defensor, Estraga-Prazeres, Termômetro, Voz Dissonante). Not started.

## Commands

There is no build/lint/test tooling — edit `index.html` directly.

- **Run locally**: serve the directory with any static file server, e.g. `python -m http.server 8080`, then open `http://localhost:8080`. The Service Worker and push notifications require HTTPS, so those specific features won't work over plain `http://localhost`.
- **Deploy**: `git push` to `main` — GitHub Pages serves directly from the repo root, no CI/build step.
- **Verify a change without a browser**: the four Supabase tables can be queried directly via the REST API using the anon key already embedded in `index.html` (`SUPA_URL2`/`SUPA_KEY2`), e.g. `curl "$SUPA_URL2/rest/v1/filmes?select=id&limit=1" -H "apikey: $SUPA_KEY2"`. Useful for checking row counts or schema without waiting on the UI. Note `usuarios` has RLS requiring an authenticated session — the anon key alone gets zero rows back from it (this is expected, not a bug).
- **DB export/backup**: `scripts/backup-console.js` is meant to be pasted into the browser DevTools console on the live, logged-in app (see `scripts/README.md`) — it reuses the page's already-authenticated Supabase client (`supa`) to dump all four tables to CSV, which sidesteps the `usuarios` RLS restriction. There is no Node-based equivalent in this environment/repo (no Node install was available when this was built; do not assume one exists).

## Architecture

### Data flow: `STATIC` seed → live Supabase overwrite

`index.html` embeds a `const STATIC = {...}` JSON blob (near the top of the main `<script>`) that seeds the initial in-memory state (`RAW.usuarios`, `RAW.users_stats`, etc.) before the network round-trip to Supabase completes. Historically this blob held full frozen snapshots of every derived stat, which caused real bugs (a stale "não quero assistir" list kept getting merged back in after being deleted from the DB; a login gate that trusted the frozen member list instead of a live query). Most of `STATIC`'s keys have since been emptied out — only `STATIC.usuarios` still carries real seed data, because `applyUserToUI()`/`buildUD()` synchronously read `USERS` (aliased to `RAW.usuarios`) during the very first paint after login, **before** the background fetch (`loadFilmsFromSupabase()` → `loadUsuariosFromSupabase()` → `calcUserStats()`) has resolved. Every other `RAW.*` key derived from `STATIC` (stats, highlights, monthly activity, per-user personal stats, available years/genres, recent-films list) is fully recomputed from live `FILMES`/`STATS` inside `calcUserStats()` on every load, so their `STATIC` seed values are inert placeholders (kept as `{}`/`[]` rather than removed, since other code reads `RAW.xxx` unconditionally).

If you ever need to hand-edit the `STATIC` line: it's one extremely long line (tens of KB), so `Read` with a line range will blow the tool's token cap — extract/patch it with `awk`/`sed`/PowerShell's `ConvertFrom-Json`/`ConvertTo-Json` instead of trying to view it directly. The file is UTF-8 without BOM, CRLF line endings — preserve both if you touch it outside the normal `Edit` tool.

### Global state (top of the main `<script>`)

- `RAW` — the mutable root object; most other globals are references into it.
- `USERS` = `RAW.usuarios` (keyed by `legacy_id`, e.g. `"USER-003"`), `STATS` = `RAW.users_stats` — both cleared and rebuilt wholesale by `loadUsuariosFromSupabase()` on every load (`Object.keys(...).forEach(delete)` then `Object.assign`), not merged.
- `FILMES` (array) / `FILMES_MAP` aliased as `FM` (object by id) — the catalog, populated by `loadFilmsFromSupabase()`.
- `CU` — the logged-in user's `legacy_id` (their "current user" key into `USERS`/`STATS`).
- `profileData` — keyed by `legacy_id`, sourced from the `perfis` table (apelido, bio, avatar, birthday, favorite film id) via `getProfile(uid)`.
- `supa` — the Supabase client (`window.supa`), created once at the top with the anon key; carries the authenticated session after login.

### Rendering

No framework — every view is a function that builds an HTML string and assigns it to `.innerHTML`. `render()` is the dispatcher that re-renders whichever top-level view (`CV`) is currently active (`renderHome`/`renderFilmes`/`renderPendentes`/`renderAvaliacoes`/`renderRecentes`/`renderRanking`/`renderDescobertas`). Film detail panels are duplicated per view (`#filmDetailPanel`, `#pendDetailPanel`, `#avDetailPanel`, `#recentDetailPanel`, plus a mobile full-screen modal `#mfmContent`) and each write action (rate, mark "não quero", add film) has to explicitly re-render whichever of these panels is currently showing the affected film — `render()` alone does not do this, since it may re-render a detail panel to a different film entirely. `displayName(uid)` and `avatarHTML(uid, opts)` are the shared helpers for showing a member's name/avatar with `perfis` apelido/photo fallback to `usuarios.nome`/generated color+initials — use these instead of reading `USERS[uid].nome` directly when adding a new place that shows a member.

### Dates

Always build "today" as a local calendar date with `localDateStr(d)`, never `new Date().toISOString().split('T')[0]` — `toISOString()` is UTC and rolls over to the next day in the evening in Brazil (UTC-3), which previously caused `avaliacoes.data_avaliacao` to be off by one day. `toISOString()`/`Date.now()`-style values are still correct for genuine instants (`created_at`/`updated_at` timestamp columns, backup export filenames) — the distinction is calendar-date-as-seen-by-a-human vs. absolute-instant.

### Supabase schema (five tables + push tokens)

| Table | Key | Notes |
|---|---|---|
| `usuarios` | `legacy_id` (text PK, e.g. `USER-003`) | Membership list. SELECT requires an authenticated session (anon key alone returns nothing). `in_ranking` (bool) controls ranking inclusion. A DB trigger auto-generates the next sequential `legacy_id` (`USER-NNN`) when a new row is inserted with that field left empty — the admin "criar membro" flow relies on this and only sends `legacy_id` explicitly when overriding it. A separate DB trigger links a Supabase Auth account to a row here by matching email, in either direction (account created before or after the row). |
| `perfis` | `legacy_id` (text PK, FK → `usuarios.legacy_id`) | Optional per-user profile: `apelido`, `bio`, `bday` (date; unknown year is stored as `1900`, not `0000` — Postgres doesn't accept year 0), `fav_filme` (stores a `filmes.id`, not a name — resolve via the in-memory `FM` map and treat a missing/stale id as "no favorite" rather than erroring), `fav_genre`, `avatar_color`, `avatar_url` (a data: URI — photos are resized client-side to 256×256 JPEG before upload). SELECT is open to anyone; write is restricted to the owning row. |
| `filmes` | `id` (text/uuid, mixed formats) | `id` has two historical formats — `FILME-0211`-style strings from an old migration and UUIDs for everything added since — never assume one or the other. Unique on `(lower(btrim(nome)), coalesce(ano,''))`; a duplicate insert raises Postgres error `23505`, which the UI should catch and show a friendly message for, never the raw driver error. `ano` is `text`, not an integer — compare it as a string (or normalize both sides) rather than `parseInt`ing one side only. `tmdb_id` (int, unique partial index — allows null) is populated on insert from the TMDB search step; ~841/842 films have it, the one holdout being a non-standard "saga completa" catalog entry. |
| `avaliacoes` | `(filme_id, usuario_id)` composite | One row per user per film they've rated *or* marked "não quero assistir" (`nota IS NULL` + `vai_assistir='Não'` is the marker for the latter — there's no separate table for it). Writes are `upsert`s with `onConflict: 'filme_id,usuario_id'`. `data_avaliacao` (text) has three live formats — empty string, ISO `YYYY-MM-DD`, and BR `DD/MM/YYYY` — never compare/sort it as a raw string; normalize first. ~1,293 rows have `nota` set but empty `data_avaliacao`, all inserted at the single instant `2026-04-05 03:13:39` (an AppSheet migration) — these are real ratings that lost their date, not "old" data (dated rows go back to 2023), so the UI must say "data não registrada", never guess a date or era for them. |
| `conquistas` | `(usuario_id, trilha, tier)` composite unique, `id` bigserial PK | One row per achievement tier a member has crossed — see the Conquistas section below. SELECT is open to everyone; there is no insert/update/delete policy, so only the Supabase service role can write (RLS blocks anon/authenticated by default). |
| `fcm_tokens` | `email` | Push notification device tokens; unrelated to `usuarios.legacy_id`, keyed by email directly. |

### Conquistas (achievement trilhas)

`conquistas` records, once and permanently, the moment each member crosses each tier of an achievement trilha (Volume, Curadoria, Pioneirismo, Maratona Mensal, Tempo na Tela, Diversidade de Gêneros, Viajante do Tempo, Filmes Longos, Consistência, Influência). It's populated by replaying `avaliacoes`/`filmes` chronologically per user — not something `index.html` does; there is no client-side "conquistas" computation, unlike the rest of `RAW.*`.

**Selo nunca revogado**: once a `(usuario_id, trilha, tier)` row exists, no normal run ever updates or deletes it — every insert (backfill or incremental) uses `on conflict (usuario_id, trilha, tier) do nothing`. This holds for every trilha, not just the obviously volatile ones — Pioneirismo can lose its underlying condition the moment someone else rates a "solo" film, and a duplicate-film merge can retroactively lower any counter, but the achievement date/precision already on record must never change.

**Correction model**: because of the above, deleting rows and re-running is only safe while a `versao_backfill` tag is still a test tag (see below). Once a tag is promoted, fixing bad data is an incremental replay — the same insert, same `on conflict do nothing` — never `delete` + re-run, since a delete would let the next run silently mint a *different* date for an achievement someone already experienced.

**`versao_backfill`**: a free-text tag stamped on every row by whichever run inserted it, so one execution can be identified and, while still under test, wiped with `delete from conquistas where versao_backfill = '<tag>'`. The current promoted tag is `v1`.

**`precisao='indeterminada'`** (with `data=null`) marks a tier crossed while replaying the ~1,293-row undated migration batch in `avaliacoes` (see the schema table above). Only Volume, Tempo na Tela, Diversidade, Viajante do Tempo and Filmes Longos can land there. Maratona Mensal and Consistência already exclude undated rows from their own counters entirely (an unrelated, older decision — see the "avaliações sem data" warnings surfaced in the Conquistas/Ranking UI); Curadoria always has a `created_at` fallback so it's never indeterminate; Pioneirismo and Influência depend on *other* members' dated activity so they essentially never land in the undated block either.

**Degraus infinitos (trilhas sem teto)**: Volume, Curadoria, Pioneirismo, Maratona Mensal, Tempo na Tela, Filmes Longos, Consistência and Influência have no ceiling — past the last named tier, more are generated up to 12 total per trilha (named + synthetic) using

```
passo   = max(5, 5 * 10^(dígitos(limiar) - 2))
próximo = ceil(limiar * 1.3 / passo) * passo
```

(`dígitos(x)` = number of digits in `floor(x)` — this proportional step, not a flat `/25`, is what keeps the ladder sane at both small scale, e.g. Consistência's 24→35→50→65→85, and large, e.g. Volume's 900→1200→2000→3000). The synthetic tier's name is the last named tier's selo plus a roman numeral (`Divindade II`, `Divindade III`, ...), except Tempo na Tela, whose synthetic name is just the value with a pt-BR thousand separator (`1.500 Horas`). Diversidade de Gêneros and Viajante do Tempo are capped ("teto") trilhas and never get synthetic tiers.

### Auth & admin

Login is Supabase Auth email/password (`supa.auth.signInWithPassword`/`signUp`/`resetPasswordForEmail`). After a successful auth, `onLogin()` does a live `usuarios` lookup by email — if it comes back empty the account exists but isn't a recognized member yet (shown as a distinct message, app doesn't load). There's no roles table; admin access is a single hardcoded email check (`ADMIN_EMAIL`) gating the admin panel UI and its Supabase writes (which are enforced by RLS server-side too, not just hidden client-side).

### Notifications

Push (FCM) is wired through a separate Google Apps Script deployment (`apps_script_notificacoes.js`, not part of the `index.html` bundle — see the header comment in that file for the manual deploy steps) that the app calls via a plain `fetch` to a Web App URL (`APPS_SCRIPT_URL`), since a static GitHub Pages site can't send push itself.

### External APIs used client-side

TMDB (movie metadata/posters, catalog search-and-add autocomplete), plus IMDb/Rotten Tomatoes ratings and "where to watch" lookups shown on the film detail panel. All API keys are embedded directly in `index.html` (anon/public-scoped keys — there is no server, so there's nowhere else for them to live); this is intentional, not an oversight.

## Working conventions established in this repo

- Commits are small and scoped to one logical change each; stage `index.html` (and only the specific other files actually touched) explicitly rather than `git add -A`, since untracked scratch/export files (`*.csv`, `backups/`) are gitignored but other stray local files may not be.
- Never commit CSV files or anything under `backups/` — both are gitignored on purpose (DB exports/backups are local-only, not repo content). Don't override the ignore for a one-off "just this once".
- Show the diff and wait for explicit approval before committing or pushing.
