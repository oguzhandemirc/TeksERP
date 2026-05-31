// recharts paleti — index.css `--chart-*` token'larına bağlı. Tema (light/dark)
// ve kişisel accent değiştiğinde grafikler de otomatik uyumlanır. recharts
// fill/stroke'a bu CSS değerleri doğrudan verilir.

export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
];

/** Semantik grafik renkleri — başarı/uyarı/hata serileri için. */
export const CHART_SEMANTIC = {
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--destructive))",
  info: "hsl(var(--info))",
  brand: "hsl(var(--brand))",
} as const;
