import { BRANCHES } from "./constants";

export interface ScopeLike {
  year: string | null;
  branch: string | null;
  section: string | null;
}

/**
 * The name of a board, as a student says it: `CSE · Year 3 · Section A`.
 * A missing year/branch/section is simply omitted, so a filter that only
 * names a branch still reads cleanly. Null when nothing is named.
 */
export const formatScopeLabel = (scope: ScopeLike | null): string | null => {
  if (!scope) return null;
  const branch = scope.branch
    ? (BRANCHES[Number(scope.branch)] ?? scope.branch)
    : null;
  const year = scope.year ? `Year ${scope.year}` : null;
  const section = scope.section ? `Section ${scope.section}` : null;
  return [branch, year, section].filter(Boolean).join(" · ") || null;
};
