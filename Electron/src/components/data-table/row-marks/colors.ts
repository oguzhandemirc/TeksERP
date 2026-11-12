import type { RowMarkColor } from "@/services/rowMarkService";

/** İşaret renkleri tema belirteçlerinden (`--tile-*`, koyu kipte ayrı ton); sınıflar Tailwind için düz metin. */
export const ROW_MARK_COLOR_META: Record<RowMarkColor, { label: string; stripe: string; swatch: string }> = {
  YELLOW: { label: "Sarı", stripe: "bg-[hsl(var(--tile-amber))]", swatch: "bg-[hsl(var(--tile-amber))]" },
  RED: { label: "Kırmızı", stripe: "bg-[hsl(var(--tile-rose))]", swatch: "bg-[hsl(var(--tile-rose))]" },
  GREEN: { label: "Yeşil", stripe: "bg-[hsl(var(--tile-green))]", swatch: "bg-[hsl(var(--tile-green))]" },
  BLUE: { label: "Mavi", stripe: "bg-[hsl(var(--tile-blue))]", swatch: "bg-[hsl(var(--tile-blue))]" },
  PURPLE: { label: "Mor", stripe: "bg-[hsl(var(--tile-violet))]", swatch: "bg-[hsl(var(--tile-violet))]" },
};
