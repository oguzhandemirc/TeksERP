import { Lock } from "lucide-react";
import { HeadlineCard } from "../HeadlineCard";
import { ReportTable } from "../ReportTable";
import { RaporGrafik } from "../grafik/RaporGrafik";
import { formatFigure } from "../figures";
import type { BlockOutcome, RunResult } from "./custom-api";
import { chartOf, headlineOf, tableOf } from "./result-model";

interface Props {
  result: RunResult;
  /** Grafik bloğunun türü gövdede yazılıdır (`gorsel`); koşu sonucu taşımaz. */
  chartKindOf: (blockId: string) => string;
}

function BlockBody({ block, chartKind }: { block: BlockOutcome; chartKind: string }) {
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
  if (block.tur === "grafik") {
    const chart = chartOf(r, chartKind);
    return chart ? <RaporGrafik blok={chart} baslik={block.baslik ?? undefined} /> : <p className="text-sm text-muted-foreground">Grafik için kırılım yok.</p>;
  }
  return <ReportTable table={tableOf(r)} />;
}

/** Kayıtlı raporun koşu sonucu — genel yaprağın parçalarıyla (ana sayı, grafik, tablo) çizilir. */
export function DefinitionResultView({ result, chartKindOf }: Props) {
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
      {result.bloklar.map((b) => (
        <section key={b.id} aria-label={b.baslik ?? b.tur} className={b.tur === "anaSayi" ? "" : "rounded-lg border p-4"}>
          {b.baslik ? <h3 className="mb-2 text-sm font-semibold">{b.baslik}</h3> : null}
          <BlockBody block={b} chartKind={chartKindOf(b.id)} />
        </section>
      ))}
    </div>
  );
}
