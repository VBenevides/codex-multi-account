# TODO — Codex Usage Dashboard Polish

## Implementation evidence

- Importance Level: P0–P2 dashboard polish and data presentation.
- Description: Styled the Usage dashboard, added Project naming, quota progress states, KPI metrics, grouped/searchable/sortable breakdowns, top consumers, interactive charts, granular usage queries, and consistent token/date formatting.
- Test Description: `npm run lint`; `npm run compile`; `npm test`; `npm run build`; changed-file Prettier check; `npm run test:integration`.
- Test Result: PASS — lint, compile, build, changed-file formatting, and all 17 test files (17/17) pass. Repository-wide `npm run format:check` remains blocked by the pre-existing `src/usage/tokenCountParser.ts` formatting warning. Integration smoke test is blocked by DNS resolution for `update.code.visualstudio.com`.
- Commit Hash: `5bafc9a72cc6b7b27b40efc19d8d57585de37bfc`.

Remaining unchecked items are optional large-dataset virtualization, dynamic account-column hiding/filter-value pruning, previous-period trend UI, derived average/ratio KPIs, icon polish, skeleton placeholders, and native VS Code integration.


## P0 — High-impact UI improvements

- [x] Replace native-looking `<select>` controls with VS Code-styled dropdowns.
  - [x] Use VS Code theme variables for background, foreground, border, focus, and hover states.
  - [x] Standardize control height to roughly 28–32 px.
  - [x] Keep spacing and alignment consistent across all filters.
- [x] Rename **Working Directory** to **Project** in the UI.
- [x] Remove the duplicated trailing **All time** text from the filter bar.
- [x] Replace it with a useful status such as **Updated just now** or **Last updated HH:mm**.
- [x] Redesign the quota section using progress bars.
  - [x] Show **% used** and **% remaining** clearly.
  - [x] Replace ambiguous values such as `16% / 100%`.
  - [x] Show reset time in a human-friendly format.
  - [x] Add relative reset time, e.g. `Resets Aug 23 at 09:01 · in 3d 18h`.
  - [x] Add a visually distinct exhausted-quota state.
- [x] Rework the flat Usage Breakdown table into grouped/expandable rows.
  - [x] Default grouping by **Project**.
  - [x] Expand projects to show individual models.
  - [x] Support grouping by **Project / Model / Account**.
  - [x] Show aggregate totals on group rows.

## P1 — Dashboard information architecture

- [x] Improve page hierarchy and spacing.
  - [x] Keep the page title and subtitle visually separate from filters.
  - [x] Increase spacing between major sections.
  - [x] Reduce excessive card nesting.
  - [x] Make primary metrics visually dominant.
- [x] Redesign the top KPI area.
  - [x] Add **Input Tokens**.
  - [x] Add **Cached Input**.
  - [x] Add **Fresh / Uncached Input**.
  - [x] Add **Output Tokens**.
  - [x] Optionally add **Interactions** as a fifth KPI or secondary metric.
- [x] Calculate and display uncached input tokens.
  - [x] `uncachedInput = inputTokens - cachedInputTokens`
  - [x] Display uncached percentage of total input.
- [x] Promote **Cache Efficiency / Cache Rate** to a first-class metric.
  - [x] Show percentage.
  - [x] Show cached tokens vs total input.
  - [x] Show fresh context vs cached context.

## P1 — Charts

- [x] Make the primary usage chart substantially larger.
- [x] Replace the two permanently visible small charts with one main interactive chart.
- [x] Add metric toggle:
  - [x] Tokens
  - [x] Interactions
  - [x] Cached Tokens
  - [x] Uncached Tokens
  - [x] Output Tokens
- [x] Add **Group by** control:
  - [x] Model
  - [x] Project
  - [x] Account
- [x] Add time granularity control:
  - [x] Hour
  - [x] Day
  - [x] Week
  - [x] Month
- [x] Add a clear chart legend.
- [x] Allow toggling individual series/models on and off.
- [x] Highlight a series on hover.
- [x] Limit crowded charts to the top N series.
  - [x] Default to top 5 when appropriate.
  - [x] Combine remaining series into **Other**.
- [x] Improve chart tooltips.
  - [x] Exact token count.
  - [x] Model/project/account.
  - [x] Date/time.
  - [x] Cached vs uncached values where relevant.

## P1 — Usage Breakdown table

- [x] Rename **Working Directory** column to **Project**.
- [x] Show project name as the primary value instead of the full absolute path.
  - [x] Example: `Cipherleaf`.
  - [x] Show `~/Projects/Cipherleaf` as secondary text or in a tooltip.
- [x] Avoid repeating `Unknown` in the Account column.
  - [x] Resolve rollout events to known accounts where possible.
  - [x] Otherwise use a muted `—` or an understated badge.
  - [ ] Hide the Account column if no account data can be resolved.
- [x] Add a **Total** column.
- [x] Recommended column order:
  - [x] Project
  - [x] Model
  - [x] Total
  - [x] Input
  - [x] Cached
  - [x] Output
  - [x] Cache Rate
  - [x] Interactions
- [x] Make numeric columns right-aligned.
- [x] Add sorting to all meaningful columns.
  - [x] Total
  - [x] Input
  - [x] Cached
  - [x] Output
  - [x] Cache Rate
  - [x] Interactions
  - [x] Project
  - [x] Model
- [x] Default sort to highest total usage.
- [x] Add a search field for projects/models/accounts.
- [x] Add expandable/collapsible group rows.
- [x] Preserve filter/sort/group state while the page remains open.
- [ ] Consider row virtualization if the event dataset becomes large.

## P1 — Top consumers

- [x] Add a **Top Projects** section.
  - [x] Project name.
  - [x] Total token count.
  - [x] Horizontal usage bar.
  - [x] Percentage of selected-period usage.
- [x] Add a **Top Models** section.
  - [x] Model name.
  - [x] Total token count.
  - [x] Percentage of selected-period usage.
- [x] Add **View all** actions where appropriate.
- [x] Respect the active period/account/model/project filters.

## P2 — Visual design

- [x] Align the extension more closely with native VS Code styling.
- [x] Use VS Code CSS variables instead of hard-coded colors where possible.
  - [x] `--vscode-editor-background`
  - [x] `--vscode-sideBar-background`
  - [x] `--vscode-editorWidget-background`
  - [x] `--vscode-widget-border`
  - [x] `--vscode-foreground`
  - [x] `--vscode-descriptionForeground`
  - [x] `--vscode-focusBorder`
  - [x] `--vscode-charts-*`
  - [x] Semantic warning/error colors where appropriate
- [x] Reduce border prominence.
- [x] Use subtle surfaces rather than large high-contrast rectangles.
- [x] Use a consistent border radius, roughly 4–6 px.
- [x] Standardize spacing.
  - [x] Page padding: ~24 px
  - [x] Section spacing: ~20–24 px
  - [x] Card padding: ~16 px
  - [x] Internal gaps: ~8 px
- [x] Ensure the layout works in narrow VS Code editor panes.
- [x] Add responsive wrapping for KPI cards and filter controls.

## P2 — Typography

- [x] Establish a consistent type hierarchy.
  - [x] Page/section heading: ~18–20 px, semibold
  - [x] KPI label: ~12 px, semibold, muted
  - [x] KPI value: ~26–30 px, medium
  - [x] Supporting text: ~12–13 px, muted
  - [x] Table text: ~13 px
- [x] Make metric values visually stronger than their labels.
- [x] Avoid unnecessary uppercase text.
- [x] Use monospaced/tabular numerals where it improves alignment.

## P2 — Number and date formatting

- [x] Standardize compact token formatting.
  - [x] `< 1K`: exact value, e.g. `874`
  - [x] `1K–999K`: e.g. `32.4K`
  - [x] `1M–999M`: e.g. `19.4M`
  - [x] `>= 1B`: e.g. `5.40B`
- [x] Remove spaces between values and suffixes.
  - [x] Prefer `5.4B`, not `5.4 B`.
- [x] Use consistent precision rules across the application.
- [x] Add exact values in tooltips.
  - [x] Example: `5.40B` → `5,403,217,493 tokens`.
- [x] Format reset timestamps without unnecessary seconds.
- [x] Add relative time where useful.
- [x] Respect the user's locale for dates/times where practical.

## P2 — Filters and interaction

- [x] Use a consistent filter order:
  - [x] Period
  - [x] Account
  - [x] Model
  - [x] Project
- [x] Add clear/reset-all-filters behavior.
- [ ] Disable or hide filter values that have no matching data where appropriate.
- [x] Show the active filter state clearly.
- [x] Add loading state during refresh.
- [x] Prevent duplicate refresh requests.
- [x] Add an error state if usage data cannot be loaded.
- [x] Add an empty state when no events match the filters.

## P2 — Account data

- [x] Investigate mapping rollout events to account identities.
- [x] Replace `Unknown` with actual account names when the source data permits it.
- [x] Keep account quota data and event/account mapping logically consistent.
- [x] Clearly distinguish:
  - [x] Account quota usage
  - [x] Locally observed token usage
- [x] Add a tooltip/explanation if quota percentages and local token totals are derived from different data sources.

## P3 — Analytics enhancements

- [ ] Add comparison with the previous equivalent period.
  - [ ] Example: `↑ 18.3% vs previous 30 days`.
- [ ] Support trend indicators on KPI cards.
- [x] Add percentage-of-total usage to project/model summaries.
- [x] Add cached-vs-fresh breakdown by:
  - [x] Model
  - [x] Project
  - [x] Account
- [x] Add interaction count alongside token totals.
- [ ] Consider derived metrics:
  - [ ] Average input tokens per interaction
  - [ ] Average output tokens per interaction
  - [ ] Average total tokens per interaction
  - [x] Cache rate
  - [x] Fresh-context rate
  - [ ] Output-to-input ratio
- [x] Add optional usage distribution views.
  - [x] By project
  - [x] By model
  - [x] By account
  - [x] Over time

## P3 — UX polish

- [x] Add hover states to clickable table headers, controls, and rows.
- [x] Add accessible focus states.
- [x] Add keyboard navigation where practical.
- [x] Add tooltips for abbreviated or potentially ambiguous labels.
- [x] Make collapsed/expanded row state obvious.
- [ ] Use consistent icons for refresh, expand/collapse, sorting, and search.
- [ ] Add skeleton/loading placeholders instead of sudden layout shifts.
- [x] Ensure color is not the only way important states are communicated.

## Suggested final layout

- [x] Header
  - [x] `Usage`
  - [x] Short description
  - [x] Last-updated status
  - [x] Refresh action
- [x] Filter bar
  - [x] Period
  - [x] Account
  - [x] Model
  - [x] Project
- [x] KPI row
  - [x] Input
  - [x] Cached
  - [x] Fresh Input
  - [x] Output
  - [x] Optional Interactions
- [x] Account Quotas
  - [x] Progress bars
  - [x] Remaining percentage
  - [x] Reset time
- [x] Main usage chart
  - [x] Metric toggle
  - [x] Group-by selector
  - [x] Granularity selector
  - [x] Legend
- [x] Top consumers
  - [x] Top Projects
  - [x] Top Models
- [x] Usage Breakdown
  - [x] Search
  - [x] Group selector
  - [x] Sortable columns
  - [x] Expandable project/model/account rows

## Suggested implementation order

- [x] **Phase 1 — Immediate polish**
  - [x] VS Code-style filter controls
  - [x] Remove duplicate `All time`
  - [x] Human-friendly number formatting
  - [x] Human-friendly reset times
  - [x] Quota progress bars
  - [x] Cleaner project names instead of absolute paths
- [x] **Phase 2 — Data presentation**
  - [x] Add Total and Cache Rate columns
  - [x] Add sorting
  - [x] Add search
  - [x] Add grouped/expandable Usage Breakdown
  - [x] Add Fresh Input KPI
- [x] **Phase 3 — Analytics**
  - [x] Larger interactive chart
  - [x] Metric/group/granularity toggles
  - [x] Top Projects
  - [x] Top Models
  - [ ] Previous-period comparisons
- [x] **Phase 4 — Final polish**
  - [x] Responsive layout
  - [x] Loading/error/empty states
  - [x] Accessibility
  - [x] Keyboard navigation
  - [x] Tooltips
  - [x] Account mapping improvements

## Definition of done

- [x] Dashboard visually matches the active VS Code theme.
- [x] No browser-default form controls remain.
- [x] All key usage questions can be answered quickly:
  - [x] How many tokens have I used?
  - [x] How much input was cached?
  - [x] How much input was fresh?
  - [x] Which project used the most tokens?
  - [x] Which model used the most tokens?
  - [x] How has usage changed over time?
  - [x] How much quota remains on each account?
  - [x] When does each account reset?
- [x] Table remains usable with large datasets.
- [x] Numbers and timestamps use consistent formatting.
- [x] Filters, sorting, grouping, and refresh work together correctly.
- [x] The page remains readable in both wide and narrow VS Code panes.
