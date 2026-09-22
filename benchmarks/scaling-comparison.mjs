/** Ratios are post/baseline; null means absent or incompatible evidence, never zero. */
export function compareScalingRows(baseline, current) {
  const key = (row) => `${row.operation}:${row.mode}:${row.digits}`;
  const old = new Map(baseline.map((row) => [key(row), row]));
  if (old.size !== baseline.length) throw new Error("Duplicate baseline row");
  const seen = new Set();
  const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);
  const compared = current.map((row) => {
    const id = key(row),
      before = old.get(id);
    if (seen.has(id) || !before) throw new Error(`Unmatched/duplicate row: ${id}`);
    seen.add(id);
    if (before.source !== row.source || (row.source && (!row.verifiedHash || !before.verifiedHash)))
      throw new Error(`Missing verification or changed input: ${id}`);
    if (before.verifiedHash !== row.verifiedHash) throw new Error(`Verified digits differ: ${id}`);
    if (row.verifiedHash && (before.verifiedDigits < row.digits || row.verifiedDigits < row.digits))
      throw new Error(`Insufficient verified result: ${id}`);
    return {
      operation: row.operation,
      mode: row.mode,
      digits: row.digits,
      baselineMs: before.timeMs,
      postMs: row.timeMs,
      timeRatio: ratio(row.timeMs, before.timeMs),
      extractionRatio: ratio(row.extractionMs, before.extractionMs),
      rssRatio: ratio(row.rssMiB, before.rssMiB),
      heapRatio: ratio(row.heapMiB, before.heapMiB),
      checkpointRatio: ratio(row.checkpoints, before.checkpoints),
      termRatio:
        row.termMetric === before.termMetric ? ratio(row.termCount, before.termCount) : null,
      baselineTermMetric: before.termMetric,
      postTermMetric: row.termMetric,
      algorithmSelected: row.algorithmSelected ?? null,
      specialGamma: (row.specialGammaState?.entries ?? 0) > 0,
      verifiedMatch: row.verifiedHash ? true : null
    };
  });
  if (seen.size !== old.size) throw new Error("Missing post-AR rows");
  return compared;
}
