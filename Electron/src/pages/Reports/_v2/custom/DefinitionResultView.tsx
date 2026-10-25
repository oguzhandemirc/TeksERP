import { Lock } from "lucide-react";
import { HeadlineCard } from "../HeadlineCard";
import { ReportTable } from "../ReportTable";
import { RaporGrafik } from "../grafik/RaporGrafik";
import { SmallMultiples } from "../SmallMultiples";
import { formatFigure } from "../figures";
import type { BlockOutcome, RunResult } from "./custom-api";
import { chartOf, headlineOf, periodTableOf, tableOf, variantOf } from "./result-model";
import { GRID_SPAN_CLASS } from "./layout/grid-classes";
import type { LayoutItem } from "./layout/layout-model";

interface Props {
  result: RunResult;
  /** Grafik bloğunun türü gövdede yazılıdır (`gorsel`); koşu sonucu taşımaz. */
  chartKindOf: (blockId: string) => string;
  /** R2-DUZEN: görünür sıra + genişlik (`orderedLayout`). Verilmezse eski tek sütun akışı birebir. */
  layout?: ReadonlyArray<Pick<LayoutItem, "i" | "w">>;
}

export function BlockBody({ block, chartKind }: { block: BlockOutcome; chartKind: string }) {
  if (block.durum !== "tamam") {
    return (
      <p className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        <Lock className="h-4 w-4 shrink-0" /> {block.mesaj}
      </p>
    );
  }
  if (block.metin) return <p className="text-sm">{block.metin}</p>;
  const r = block.sonuclar[0];
  if (!r) return <p className="text-sm text-muted-foreground">Bu bölüm için veri yok.</p>;
  if (block.tur === "anaSayi") {
    const h = headlineOf(r);
    if (!h) return null;
    return (
      <div className="flex flex-col gap-1">
        <HeadlineCard headline={h.figure} sideFigures={[]} />
        {r.kiyas ? <p className="text-xs text-muted-foreground">Kıyas dönemi: {formatFigure(h.previous, h.figure.birim)}</p> : null}
      </div>
    );
  }
  if (block.tur === "varyant") {
    const v = variantOf(r);
    return v ? <SmallMultiples block={v} /> : null;
  }
  if (block.tur === "donem") {
    const t = periodTableOf(r);
    return t ? <ReportTable table={t} /> : <p className="text-sm text-muted-foreground">Dönem sütunu çıkmadı.</p>;
  }
  if (block.tur === "grafik") {
    const chart = chartOf(r, chartKind);
    return chart ? <RaporGrafik blok={chart} baslik={block.baslik ?? undefined} /> : <p className="text-sm text-muted-foreground">Grafik için kırılım yok.</p>;
  }
  return <ReportTable table={tableOf(r)} />;
}

/** Ana sayı ve kırılım kartları kendi çerçevesini taşır. */
const frameClass = (b: BlockOutcome) => (b.tur === "anaSayi" || (b.tur === "varyant" && b.durum === "tamam") ? "" : "rounded-lg border p-4");

/** Sonuç bloklarını düzen sırasına dizer; düzende olmayan blok sonda tam genişlikte. */
function ordered(blocks: BlockOutcome[], layout: ReadonlyArray<Pick<LayoutItem, "i" | "w">>) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const placed = layout.flatMap((l) => (byId.has(l.i) ? [{ block: byId.get(l.i)!, w: l.w }] : []));
  const seen = new Set(placed.map((p) => p.block.id));
  return [...placed, ...blocks.filter((b) => !seen.has(b.id)).map((b) => ({ block: b, w: 12 }))];
}

/** Kayıtlı raporun koşu sonucu — genel yaprağın parçalarıyla (ana sayı, grafik, tablo) çizilir. */
export function DefinitionResultView({ result, chartKindOf, layout }: Props) {
  const warnings = [...new Set(result.bloklar.flatMap((b) => (b.durum === "tamam" ? b.sonuclar.flatMap((s) => s.uyarilar) : [])))];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{result.itibariylaMetni} itibarıyla</p>
      {warnings.length > 0 ? (
        <ul className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {layout ? (
        <div className="grid grid-cols-12 gap-4">
          {ordered(result.bloklar, layout).map(({ block: b, w }) => (
            <section key={b.id} aria-label={b.baslik ?? b.tur} className={`min-w-0 ${GRID_SPAN_CLASS[w] ?? GRID_SPAN_CLASS[12]} ${frameClass(b)}`}>
              {b.baslik ? <h3 className="mb-2 text-sm font-semibold">{b.baslik}</h3> : null}
              <BlockBody block={b} chartKind={chartKindOf(b.id)} />
            </section>
          ))}
        </div>
      ) : (
        result.bloklar.map((b) => (
          <section key={b.id} aria-label={b.baslik ?? b.tur} className={b.tur === "anaSayi" ? "" : "rounded-lg border p-4"}>
            {b.baslik ? <h3 className="mb-2 text-sm font-semibold">{b.baslik}</h3> : null}
            <BlockBody block={b} chartKind={chartKindOf(b.id)} />
          </section>
        ))
      )}
    </div>
  );
}
