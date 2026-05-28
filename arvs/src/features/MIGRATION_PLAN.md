# Feature Migration Plan

## Phase 1 (completed)
- Add `src/features/*` module entry points.
- Re-export existing modules to avoid breaking imports.

## Phase 2 (completed)
- Update imports in `App.tsx`, pages, and services to consume `src/features/*`.
- Keep legacy paths until all imports are switched.

## Phase 3 (completed)
- Move physical files from `src/pages`, `src/components`, `src/hooks`, `src/services`
  into their feature folders.
- Replace old files with thin compatibility re-export shims.

## Phase 4 (completed)
- Remove legacy shims and keep only feature-first structure.
