import { BarChart3, CalendarRange, FileText, Gauge, LayoutGrid, MessageSquareText, Sigma, Table2, type LucideIcon } from "lucide-react";
import { MAX_BLOCKS, PALETTE, type BlockKind } from "./layout-model";

const ICONS: Record<BlockKind, LucideIcon> = {
  anaSayi: Gauge,
  grafik: BarChart3,
  tablo: Table2,
  varyant: LayoutGrid,
  donem: CalendarRange,
  metin: FileText,
  anlati: MessageSquareText,
  analiz: Sigma,
};

interface Props {
  blockCount: number;
  /** Kırılım isteyen bloklar (grafik, kırılım kartları) için konuda kategori boyutu var mı. */
  hasDimension: boolean;
  onAdd: (kind: BlockKind) => void;
}

/** Bölüm paleti: tıkla → tuvalin sonuna eklenir (sonra sürükleyerek yerine taşınır). */
export function BlockPalette({ blockCount, hasDimension, onAdd }: Props) {
  const full = blockCount >= MAX_BLOCKS;
  return (
    <section aria-label="Bölüm ekle" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Bölüm ekle</h2>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {PALETTE.map((p) => {
          const Icon = ICONS[p.kind];
          const needsDim = (p.kind === "grafik" || p.kind === "varyant" || p.kind === "analiz") && !hasDimension;
          const reason = p.unavailable ?? (full ? `En çok ${MAX_BLOCKS} bölüm olabilir.` : needsDim ? "Bu konuda kırılım yok." : null);
          return (
            <li key={p.kind}>
              <button
                type="button"
                disabled={reason !== null}
                onClick={() => onAdd(p.kind)}
                className="flex w-full items-start gap-2 rounded-md border bg-card p-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{reason ?? p.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
