# OpenMailStack Worklog

This file records meaningful work performed by AI agents or humans while developing OpenMailStack.

The worklog is not a raw terminal transcript. It is a concise engineering memory for future sessions.

Agents must append a new entry after every product engineering loop cycle, even if no code changed.

Do not include:

- secrets
- credentials
- private emails
- OAuth tokens
- cookies
- message bodies
- sensitive customer/user data
- huge command output dumps

Do include:

- date
- agent/tool used, if known
- branch
- git state summary
- selected task
- why the task was chosen
- files changed
- tests/checks run
- proof
- failures or blocked items
- risks
- next recommended task

---

## Entry Template

```md
## YYYY-MM-DD — Short task title

Agent/tool: Codex / Claude / human / unknown  
Branch: `branch-name`  
Starting git state: clean / dirty / unknown  
Ending git state: clean / dirty / unknown  

### Selected task

Describe the one bounded task selected for this cycle.

### Why this task

Explain why this was the highest-value next task according to the OpenMailStack quality rubric.

### Changes made

- `path/to/file`
  - Summary of change

### Proof / checks run

- `command`
  - Result

### Acceptance criteria

- [x] Criterion 1
- [x] Criterion 2
- [ ] Criterion not completed, with reason

### Risks / notes

Document uncertainty, failing checks, skipped checks, or things future agents should know.

### Next recommended task

Name exactly one recommended next task.

---

## 2026-07-02 — Repository intake + lazy-load Notes feature for code splitting

Agent/tool: Claude Code (Claude)  
Branch: `main`  
Starting git state: dirty (11 modified files, 3 untracked)  
Ending git state: dirty (11 modified files, 3 untracked — same set, App.tsx diff updated)  

### Selected task

Lazy-load the Notes feature route in `App.tsx` to code-split react-quill-new (~200KB), Yjs/WebRTC, and highlight.js out of the main bundle. This also fixes the `INEFFECTIVE_DYNAMIC_IMPORT` build warning caused by `SettingsPanel.tsx` using `lazy(() => import('react-quill-new'))` while the module was statically imported by blot files and `LiveNoteEditor.tsx`.

### Why this task

According to the OpenMailStack quality rubric:
- **Severity 3**: Build warning masking real issues, unnecessarily large main bundle affecting initial load
- **Reach 5**: Affects all first-time visitors (initial page load performance)
- **Confidence 5**: Clear evidence (build warning) and clear fix (route-level lazy loading)
- **Effort 1**: Small — 10-line change in one file
- **Score**: (3×4) + (5×3) + (5×2) - 1 = 12 + 15 + 10 - 1 = **36**

### Changes made

- `webmail-frontend/src/App.tsx`
  - Added `lazy, Suspense` import from React
  - Added `Skeleton` import (used as Suspense fallback)
  - Replaced static `import { NotesRoutes } from './notes/routes'` with `const NotesRoutes = lazy(() => import('./notes/routes').then(m => ({ default: m.NotesRoutes })))`
  - Wrapped `<NotesRoutes />` in `<Suspense fallback={<Skeleton />}>`

### Proof / checks run

- `webmail-backend npm run build` (tsc) — **0 errors**
- `webmail-backend npm test` — **26/26 tests pass**
- `webmail-frontend npx tsc -b` — **TypeScript: No errors found**
- `webmail-frontend npx vite build` — **Built in 2.30s**, no warnings except chunk size advisory

Build output comparison:

| Metric | Before | After | Change |
|---|---|---|---|
| Main JS (index) | 1,407 KB | 963 KB | **-32%** |
| Main CSS (index) | 46.6 KB | 21.8 KB | **-53%** |
| Async chunks | 0 | 444 KB (lib + routes) | New, lazy loaded |
| `INEFFECTIVE_DYNAMIC_IMPORT` warning | Yes | **Gone** | Fixed |

### Acceptance criteria

- [x] Frontend TypeScript compiles without errors
- [x] Frontend Vite build succeeds
- [x] Backend TypeScript compiles without errors
- [x] Backend tests pass (26/26)
- [x] `INEFFECTIVE_DYNAMIC_IMPORT` warning eliminated
- [x] Main bundle size reduced (>30% reduction confirmed)
- [x] react-quill-new + Yjs moved to async chunk
- [x] Diff is focused (1 file, 10 lines changed)

### Risks / notes

- The Notes feature now has a brief Skeleton shimmer on first navigation while the async chunk loads. This is the intended UX for route-level code splitting.
- The `SettingsPanel.tsx` lazy import of react-quill-new now actually works — the shared `lib` chunk serves both Notes and Settings signature editor.
- Other feature routes (Admin with recharts, Mail with pdfjs-dist) could also benefit from lazy loading in future cycles.
- This was the first engineering cycle. No prior WORKLOG entries existed — the template was empty.
- The working tree still has uncommitted changes from a prior session (ErrorBoundary, EmptyState for mail, calendar slug fix, spam settings test update). These are coherent improvements that should be committed in a following cycle.

### Next recommended task

Audit and commit the uncommitted working tree changes (ErrorBoundary, EmptyState, calendar slug `.toLowerCase()` fix, spam settings test update, TECHNICAL.md redirect), verify each change is intentional and complete, then commit with focused messages.

---

## 2026-07-02 — Commit working tree changes + lazy-load Admin routes

Agent/tool: Claude Code (Claude)  
Branch: `main`  
Starting git state: dirty (11 modified files, 3 untracked)  
Ending git state: clean (7 commits ahead of origin)  

### Selected task

Two-part cycle:
1. Audit, verify, and commit all 11 modified + 2 new source files from the working tree into focused commits
2. Lazy-load Admin routes to code-split recharts out of the main bundle

### Why this task

The previous cycle left uncommitted improvements that were verified but not committed. These needed to be preserved before risking conflicts.

For the Admin lazy-loading, per the quality rubric:
- **Severity 3**: Main bundle at 962KB impacts initial load for all users
- **Reach 5**: Every user pays for recharts (~120KB) on first load, but only admins visit the admin panel
- **Confidence 5**: Exact same proven pattern as Notes lazy-loading from previous cycle
- **Effort 1**: 2-line change in one file
- **Score**: (3×4) + (5×3) + (5×2) - 1 = **36**

### Changes made

6 commits for working tree cleanup:

- `.gitignore` — added AGENTS.md and .playwright-mcp/ to gitignore
- `TECHNICAL.md` — converted 198-line architecture doc into a 7-line redirect stub pointing to `docs/engineering/ARCHITECTURE.md`
- `docs/engineering/` — committed ARCHITECTURE.md, OPENMAILSTACK_PRODUCT_LOOP.md, QUALITY_BAR.md, WORKLOG.md
- `webmail-backend/src/calendar-format.{ts,js}` + maps — `.toLowerCase()` slug fix for consistent calendar name matching
- `webmail-backend/src/api.js` + `api.js.map` — compiled JS catching up to TS source (parallel message parsing via Promise.all, fire-and-forget search index updates)
- `webmail-backend/test/user-settings.test.cjs` — added `spam: { blockedSenders: [], safeSenders: [] }` expected defaults
- `webmail-frontend/src/App.tsx` — ErrorBoundary wrapping + lazy-loaded Notes
- `webmail-frontend/src/mail/MessageList.tsx` — EmptyState for empty inbox/folders and empty search results
- `webmail-frontend/src/shared/components/ErrorBoundary.tsx` — new component with crash recovery UI

1 commit for new improvement:

- `webmail-frontend/src/App.tsx`
  - Replaced static `import { AdminRoutes }` with `const AdminRoutes = lazy(() => import('./admin/routes').then(m => ({ default: m.AdminRoutes })))`
  - Wrapped `<AdminRoutes />` in `<Suspense fallback={<Skeleton />}>`

### Proof / checks run

- `webmail-backend npm test` — **26/26 tests pass**
- `webmail-frontend npx tsc -b` — **TypeScript: No errors found**
- `webmail-frontend npx vite build` — **Built in 2.01s**, no warnings

Build output comparison for Admin lazy-loading:

| Metric | Before | After | Change |
|---|---|---|---|
| Main JS (index) | 962.5 KB | 477.2 KB | **-50.4%** |
| Main JS (gzip) | 262.7 KB | 136.9 KB | **-47.9%** |
| Async chunks | 2 | 4 | +admin chunk (474 KB) |
| Combined total reduction (from 1,407 KB original) | — | — | **-66%** |

Audit findings on committed changes:
- `api.js` was stale compiled output — the TS source (`api.ts`) already had Promise.all parallel parsing, but the committed `.js` had old sequential for-loops. Confirmed by diffing both files.
- All other changes verified as intentional, complete, and correct.
- `.playwright-mcp/` was untracked — added to `.gitignore` rather than committed.

### Acceptance criteria

- [x] All uncommitted working tree changes audited and committed with focused messages
- [x] Frontend TypeScript compiles without errors
- [x] Frontend Vite build succeeds
- [x] Backend tests pass (26/26)
- [x] Main bundle reduced >40% from Admin lazy-loading (actual: 50.4%)
- [x] recharts moved to async chunk
- [x] Clean working tree (nothing left uncommitted)
- [x] No build warnings introduced

### Risks / notes

- Admin panel now has a brief Skeleton shimmer on first navigation while the async chunk loads. Acceptable UX trade-off.
- The main bundle is now down to 477KB gzip (from 1,407KB two cycles ago). Further route-level splitting (Mail, Calendar) would have diminishing returns since they're core workflows visited by all users.
- The only remaining heavy static import in the main bundle is likely `date-fns` (tree-shaken, small) and the mail/calendar/contacts/settings routes themselves.
- The repo is now 7 commits ahead of origin — ready for push/PR.
- `api.js` and `api.js.map` are tracked build artifacts. Consider whether these should be gitignored and generated during deploy instead.

### Next recommended task

Add lazy-loaded Admin routes entry to the list of completed code-splitting tasks, then investigate the compose/send flow for any UX gaps (e.g., send-as alias switching, attachment handling, draft autosave reliability).
