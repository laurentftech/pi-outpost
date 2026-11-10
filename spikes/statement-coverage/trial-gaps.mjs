// Where each scope loses the most: the files with the most uncovered statements, so the
// daily summary says where tests would raise the figure, not only how high it is.
//
// `files` is the report's per-file list: { path, scope, summary } with an istanbul summary.
// A file with nothing left uncovered, in statements or branches, is not listed.

const uncovered = (metric) => metric.total - metric.covered;

/** The files of one scope that lose the most, most uncovered statements first. */
export function largestGaps(files, scope, limit = 15) {
  return files
    .filter((file) => file.scope === scope)
    .map((file) => ({
      path: file.path,
      statements: file.summary.statements,
      branches: file.summary.branches,
      missedStatements: uncovered(file.summary.statements),
      missedBranches: uncovered(file.summary.branches),
    }))
    .filter((file) => file.missedStatements > 0 || file.missedBranches > 0)
    .sort((a, b) => b.missedStatements - a.missedStatements || b.missedBranches - a.missedBranches || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** The "Largest gaps" section of summary.md: one table per scope. */
export function gapsMarkdown(files, scopes, limit = 15) {
  const sections = scopes.map((scope) => {
    const gaps = largestGaps(files, scope, limit);
    if (gaps.length === 0) return `### ${scope}\n\nNothing uncovered.`;
    const rows = gaps.map(
      (gap) =>
        `| \`${gap.path}\` | ${gap.missedStatements} | ${gap.statements.covered}/${gap.statements.total} (${gap.statements.pct}%) | ${gap.missedBranches} | ${gap.branches.covered}/${gap.branches.total} (${gap.branches.pct}%) |`,
    );
    return `### ${scope}\n\n| File | Uncovered statements | Statements | Uncovered branches | Branches |\n|---|---:|---:|---:|---:|\n${rows.join('\n')}`;
  });
  return `## Largest gaps\n\nPer scope, the ${limit} files with the most uncovered statements (then branches). The full per-file list is in summary.json.\n\n${sections.join('\n\n')}`;
}
