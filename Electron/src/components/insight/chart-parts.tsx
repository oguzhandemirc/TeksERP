/** Lejant noktası — grafikle aynı belirteç (`--chart-N`); 6'dan sonrası başa döner. */
export const SERIES_DOT = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"] as const;

/** Boş grafiğin üstündeki kısa not — iskelet eksen/halka altta soluk kalır (büyük boşluk yerine). */
export function ChartEmptyNote({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rounded-full border border-card-border bg-card/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">{text}</span>
    </div>
  );
}
