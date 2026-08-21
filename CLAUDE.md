# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CineList is a collaborative movie-tracking PWA for a closed group of friends (Netflix-style catalog, ratings, stats, ranking). It is a **single-file vanilla JS/CSS/HTML app with no build step, no package manager, and no test suite** — `index.html` (~330KB) contains the entire app: all CSS in one `<style>` block and all JS in one `<script>` block. There is no `package.json`.

Backend is Supabase (Postgres + Auth), project ref `iznikddtdwfvkkwqtwxg` (i.e. `https://iznikddtdwfvkkwqtwxg.supabase.co`, matching `SUPA_URL2` in `index.html`). Hosting is GitHub Pages, deployed by pushing to `main` (auto-publishes; Fastly CDN in front has a ~10 min edge cache, so a just-pushed change may take a few minutes to show up live — verify with a cache-busted `curl` if it matters, not by re-pushing).

## Status (2026-08-20)

Mid-way through a multi-phase plan to add achievement trilhas ("Conquistas") and a v2 compatibility formula ("Afinidades"). The full phase-by-phase prompt lives outside this repo — the user brings it into each session, it isn't checked in here.

- **Fase 2 is closed**: the `conquistas` table exists and is backfilled (tag `v1`, the promoted/permanent one — 196 rows, 12 usuários, 10 trilhas, 65 rows with `precisao='indeterminada'`). See the Conquistas section below for the schema and rules.
- **Fase 3 is closed**: `v_filme_stats` and `v_avaliacao_comparativo` views exist, and three new especiais are calibrated (Defensor, Estraga-Prazeres, Termômetro). See the Base de comparação section below. Voz Dissonante was cut from this pass, pending Fase 5.
- **Fase 4 is closed**: the `compatibilidade` table is populated under the promoted tag `versao_formula = 'v2'` (91 rows, 75 with a `pct`, 16 `NULL` for zero filmes em comum). Validated first under `'v2-teste'`, then re-run as-is under `'v2'` — no formula changes between the two, `recalcular_compatibilidade()` just upserts every `(a,b)` in place (no history to preserve, compatibilidade is estado). See the Compatibilidade section below. Not wired into `index.html`.
- **Next up: Fase 5** — UI das conquistas (the `conquistas` table has had no screen reading from it since Fase 2). Compatibilidade's own UI is Fase 6, still after that.

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

### Supabase schema (six tables + push tokens)

| Table | Key | Notes |
|---|---|---|
| `usuarios` | `legacy_id` (text PK, e.g. `USER-003`) | Membership list. SELECT requires an authenticated session (anon key alone returns nothing). `in_ranking` (bool) controls ranking inclusion. A DB trigger auto-generates the next sequential `legacy_id` (`USER-NNN`) when a new row is inserted with that field left empty — the admin "criar membro" flow relies on this and only sends `legacy_id` explicitly when overriding it. A separate DB trigger links a Supabase Auth account to a row here by matching email, in either direction (account created before or after the row). |
| `perfis` | `legacy_id` (text PK, FK → `usuarios.legacy_id`) | Optional per-user profile: `apelido`, `bio`, `bday` (date; unknown year is stored as `1900`, not `0000` — Postgres doesn't accept year 0), `fav_filme` (stores a `filmes.id`, not a name — resolve via the in-memory `FM` map and treat a missing/stale id as "no favorite" rather than erroring), `fav_genre`, `avatar_color`, `avatar_url` (a data: URI — photos are resized client-side to 256×256 JPEG before upload). SELECT is open to anyone; write is restricted to the owning row. |
| `filmes` | `id` (text/uuid, mixed formats) | `id` has two historical formats — `FILME-0211`-style strings from an old migration and UUIDs for everything added since — never assume one or the other. Unique on `(lower(btrim(nome)), coalesce(ano,''))`; a duplicate insert raises Postgres error `23505`, which the UI should catch and show a friendly message for, never the raw driver error. `ano` is `text`, not an integer — compare it as a string (or normalize both sides) rather than `parseInt`ing one side only. `tmdb_id` (int, unique partial index — allows null) is populated on insert from the TMDB search step; 840/841 films have it, the one holdout being a non-standard "saga completa" catalog entry. |
| `avaliacoes` | `(filme_id, usuario_id)` composite | One row per user per film they've rated *or* marked "não quero assistir" (`nota IS NULL` + `vai_assistir='Não'` is the marker for the latter — there's no separate table for it). Writes are `upsert`s with `onConflict: 'filme_id,usuario_id'`. `data_avaliacao` (text) has three live formats — empty string, ISO `YYYY-MM-DD`, and BR `DD/MM/YYYY` — never compare/sort it as a raw string; normalize first. ~1,293 rows have `nota` set but empty `data_avaliacao`, all inserted at the single instant `2026-04-05 03:13:39` (an AppSheet migration) — these are real ratings that lost their date, not "old" data (dated rows go back to 2023), so the UI must say "data não registrada", never guess a date or era for them. |
| `conquistas` | `(usuario_id, trilha, tier)` composite unique, `id` bigserial PK | One row per achievement tier a member has crossed — see the Conquistas section below. SELECT is open to everyone; there is no insert/update/delete policy, so only the Supabase service role can write (RLS blocks anon/authenticated by default). |
| `compatibilidade` | `(a, b)` composite, `a < b` always | State, not history — one row per pair of `in_ranking=true` usuários, fully overwritten on every recalc, no versioning by row. See the Compatibilidade section below. |
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

### Base de comparação com a tropa (Fase 3)

Two views feed both the compatibility formula (Fase 4) and the leave-one-out especiais below. Both are plain (non-materialized) views — the dataset is small enough (841 filmes, 14 usuários `in_ranking`) to recompute live, so no refresh strategy is needed. Both scope to `nota is not null` and `usuarios.in_ranking = true`; dated and undated `avaliacoes` rows are both included (excluding undated rows would drop 38% of the base — see the `avaliacoes` schema row above).

- **`v_filme_stats`** — per-filme `n_avaliacoes`, `media_tropa` (full population), `variancia` (`var_pop`, not `var_samp` — `var_samp` doubles the variance at n=2, which would inflate exactly the small samples that should carry the least weight), `peso` (`variancia / média_da_variância_dos_filmes_com_n≥2`, clamped to `[0.25, 2.2]`). Filmes with `n_avaliacoes = 1` are excluded entirely — a film only one person rated can never be a "filme em comum" between two people, so including it only pollutes the peso distribution (it would always sit at the floor).
- **`v_avaliacao_comparativo`** — one row per avaliação, with three distinctly-named means so they never get swapped: `media_pessoa`/`desvio_pessoal` (that person's own average across their own avaliações — feeds the Pearson correlation in Fase 4), `media_tropa`/`desvio_tropa` (the full-population average from `v_filme_stats` — feeds peso/compatibilidade, never leave-one-out), and `media_tropa_sem_ele`/`desvio_tropa_sem_ele`/`n_outros` (leave-one-out, excludes the person's own nota — feeds only the especiais below, never compatibilidade).

**Regra de método**: leave-one-out vale para todo selo/especial que compara uma pessoa contra a tropa — sem isso a pessoa competiria contra a própria contribuição (com n=4, uma nota isolada já é 25% da média). NÃO vale para peso/compatibilidade — ali a variância é propriedade do filme, não de quem está sendo comparado.

**Regra de calibração** (vale para estes três e para qualquer especial futuro, incluindo Voz Dissonante na Fase 5): alvo de 1 a 4 pessoas de 14 por especial. Especial que zera não existe; especial que 11 de 14 têm não é conquista, é comportamento normal da base.

**Três especiais novos calibrados nesta fase** (todos leave-one-out, `n_outros ≥ 4`, i.e. 5 avaliações no total — a mediana de avaliações por filme na base é 4, então esse piso é o "normal" da base, não um corte artificialmente apertado):
- **Defensor** — `media_tropa_sem_ele < 6.5` e `nota ≥ 8` → 9 casos, 5 pessoas hoje.
- **Estraga-Prazeres** — `media_tropa_sem_ele > 8.2` e `nota ≤ 6` → 4 casos, 2 pessoas hoje. `nota ≤ 6` foi calibrado, não escolhido: com `≤ 5` (o corte simétrico "óbvio" ao 8+ do Defensor) dava 1 caso em 1 pessoa — a tropa avalia alto demais para "dar 5 num filme amado" acontecer.
- **Termômetro** — 60%+ das avaliações elegíveis a menos de 0,5 de `media_tropa_sem_ele`, piso de 50 filmes elegíveis (`n_outros ≥ 4`) → 3 pessoas hoje. 60% também foi calibrado: com tolerância de 0,5 mas sem corte proporcional (contagem absoluta), 11 de 14 pessoas ganhavam — o selo saturava, porque a tropa concorda demais para "estar perto da média" ser incomum.

6.5 ("tropa afundou") e 8.2 ("tropa amou") são estatisticamente simétricos — mesma fração de filmes (11,5%) de cada lado da distribuição de `media_tropa` — não valores redondos escolhidos à mão.

**Voz Dissonante — cortado desta leva, pendente de Fase 5.** O critério original (10 filmes a 3+ pontos da média) dá zero pessoas: a tropa concorda demais para "discordar muito" acontecer 10 vezes com distância bruta. Um corte proporcional (15%+ das avaliações a 2+ pontos, piso de 50) também zera; forçar pra baixo (5%) só captura "discordar de 1 filme em 20", que numa tropa homogênea é ruído, não característica de personalidade. Ideia a revisitar: usar o `peso` de variância de `v_filme_stats` — discordar especificamente nos filmes que racharam a tropa (peso alto), não distância bruta da média num grupo que raramente racha.

### Compatibilidade (Fase 4)

Replaces the old client-side formula in `index.html` (`calcAfinGlobal()`, around line 2784): `score = round(max(0, 100 - avgDiff*20))` over shared-film absolute note differences, minimum 3 filmes em comum. That formula's real range across the 14 `in_ranking` usuários is **59–97** (mediana 83) — not "everyone glued at ~92%" as first assumed mid-session; that impression came from eyeballing three rows on one profile's list, not from the full distribution. The real problem with the old formula, confirmed by the full data, is different: it's imprecise at the top (a narrow, high-anchored range where small note differences don't separate people) and it treats raw note distance as agreement even when two people are just equally generous, which is exactly what desvio pessoal (Fase 3) exists to fix.

**Formula v2** (promoted tag `versao_formula = 'v2'`): weighted Pearson correlation over `desvio_pessoal` (from `v_avaliacao_comparativo`) on filmes em comum between a pair, weighted by `peso` (from `v_filme_stats` — the full-population, non-leave-one-out version; peso is a property of the filme, not of who's being compared). Computed as `r_bruto = Σ(peso·da·db) / √(Σ(peso·da²)·Σ(peso·db²))`, clamped to `[-1, 1]` to absorb float rounding at the edges (matters mainly at `n_comum=1`, where the raw ratio is always exactly ±1 by construction and briefly rounded to `1.0000000000000002` before the clamp — not a real signal, just one shared filme). Sample-size brake: `r_ajustado = (n/(n+K))·r_bruto + (K/(n+K))·r_grupo`, `K=15`, `r_grupo` = average `r_bruto` across all pairs with data in that run (stored per-row in `media_grupo`, so it's auditable later even though it's the same value for every pair in a given run). Display: `pct = round(50 + 50·r_ajustado)`.

`recalcular_compatibilidade(p_versao_formula text)` is a plain SQL function, called by hand — upserts every `in_ranking` pair by `(a,b)` (no history, compatibilidade is *estado*, not conquista: it can legitimately go up or down as anyone rates anything, and the UI must never show a delta or notify on change, the opposite of a selo). **Pairs with zero filmes em comum get `n_comum=0` and `pct = NULL`**, not a value collapsed to `r_grupo` — a number with no basis (e.g. a member with zero avaliações, or two people who happen to share nothing) is worse than no number; the eventual UI (Fase 6) should read `pct is null` as "ainda não dá pra comparar."

**Validation** (91 pairs, 75 with `pct`, 16 `NULL` — 13 of those are one `in_ranking` member with zero avaliações, 3 are small-sample coincidence): range is **55–83**. Similar spread to the old formula's real 59–97 (this is fine — the old formula wasn't actually compressed, see above; equal spread isn't a failure of v2). What v2 fixes is **ordering**: on USER-002's compatibility list, a pair with only 4 filmes em comum (old formula's 3-filme floor barely admits it) went from 1st (92%, old) to 3rd (76%, new); a similar low-`n_comum` pair fell from 1st to 9th; the pair with 326 filmes em comum rose from 3rd to 1st. The brake still doesn't erase a genuinely high `r_bruto` from a small sample (n_comum=1 pairs land around pct 72, not shoved to the group average) — it just stops small samples from *outranking* large, well-supported ones. `K=15` was validated against this behavior and is not being recalibrated.

Validated first under a throwaway tag `versao_formula = 'v2-teste'`, then re-run unchanged under the promoted tag `'v2'` — `recalcular_compatibilidade()` upserts by `(a,b)`, so the same 91 rows just got their `versao_formula` overwritten, no new rows, no formula changes between the two runs.

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
