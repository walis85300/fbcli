type InsightRow = Record<string, unknown>;

function parseMetric(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function divideOrNull(numerator: number, denominator: number, multiplier = 1): number | null {
  if (denominator <= 0) {
    return null;
  }

  return round((numerator / denominator) * multiplier);
}

function extractLabel(row: InsightRow): Record<string, unknown> {
  const label: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith("_id") || key.endsWith("_name") || key === "date_start" || key === "date_stop") {
      label[key] = value;
    }
  }

  return label;
}

export type RowKpi = {
  label: Record<string, unknown>;
  metrics: {
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
  };
};

export type KpiSummary = {
  rowCount: number;
  rows: RowKpi[];
  totals: {
    impressions: number;
    clicks: number;
    spend: number;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
  };
};

export function computeKpis(rows: unknown[]): KpiSummary {
  type MetricTotals = {
    impressions: number;
    clicks: number;
    spend: number;
  };

  const typedRows: InsightRow[] = rows.filter(
    (row): row is InsightRow => typeof row === "object" && row !== null,
  );

  const rowKpis: RowKpi[] = typedRows.map((row) => {
    const impressions = parseMetric(row.impressions);
    const clicks = parseMetric(row.clicks);
    const spend = parseMetric(row.spend);

    return {
      label: extractLabel(row),
      metrics: {
        ctr: divideOrNull(clicks, impressions, 100),
        cpc: divideOrNull(spend, clicks),
        cpm: divideOrNull(spend, impressions, 1000),
      },
    };
  });

  const totals = typedRows.reduce<MetricTotals>(
    (accumulator, row) => ({
      impressions: accumulator.impressions + parseMetric(row.impressions),
      clicks: accumulator.clicks + parseMetric(row.clicks),
      spend: accumulator.spend + parseMetric(row.spend),
    }),
    {
      impressions: 0,
      clicks: 0,
      spend: 0,
    },
  );

  return {
    rowCount: typedRows.length,
    rows: rowKpis,
    totals: {
      impressions: round(totals.impressions),
      clicks: round(totals.clicks),
      spend: round(totals.spend),
      ctr: divideOrNull(totals.clicks, totals.impressions, 100),
      cpc: divideOrNull(totals.spend, totals.clicks),
      cpm: divideOrNull(totals.spend, totals.impressions, 1000),
    },
  };
}
