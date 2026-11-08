// Ekstre bölümü (top · iplik lotu · levent): özet sayıları → konu kırılımı → hareketler. Ekranda hareket listesi
// SCREEN_LINE_CAP satırla sınırlı (çizim maliyeti); dosya (Excel/PDF) HER satırı taşır ve bu ekranda yazılıdır.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportCellText } from "@/lib/number-format";
import { lowerTr } from "@/lib/tr-case";
import type { StatementSection } from "./types";
import { KIND_LABEL, lineColumns, lineRow, qtyFmt, subjectColumns, subjectRows, subjectTotalRow } from "./statementExport";
import { StatementTable } from "./StatementTable";

export const SCREEN_LINE_CAP = 300;

function Figure({ label, value, unit, strong }: { label: string; value: number; unit: string; strong?: boolean }) {
  return (
    <div className="min-w-[7.5rem] px-3 py-1.5">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className={strong ? "text-base font-bold tabular-nums" : "text-sm font-semibold tabular-nums"}>
        {reportCellText(value, qtyFmt(unit as StatementSection["unit"]))} <span className="text-[11px] font-normal text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

export function StatementSectionView({ section: s }: { section: StatementSection }) {
  const [showLines, setShowLines] = useState(false);
  const t = s.totals;
  const lines = showLines ? s.lines.slice(0, SCREEN_LINE_CAP) : [];
  return (
    <section className="flex flex-col gap-2" aria-label={`${KIND_LABEL[s.kind]} bölümü`} data-testid={`statement-section-${s.kind}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 px-1">
        <h3 className="text-sm font-semibold">{KIND_LABEL[s.kind]} ({s.unit})</h3>
        <span className="text-xs text-muted-foreground">Kapsam: {s.scope}</span>
      </div>
      <div className="flex flex-wrap divide-x bg-muted/40" data-testid={`statement-figures-${s.kind}`}>
        <Figure label="Açılış" value={t.opening} unit={s.unit} />
        <Figure label={s.columnLabels.IN} value={t.in} unit={s.unit} />
        <Figure label={s.columnLabels.OUT} value={t.out} unit={s.unit} />
        {s.columnLabels.DSK !== "—" && <Figure label={s.columnLabels.DSK} value={t.dsk} unit={s.unit} />}
        <Figure label={s.columnLabels.SCRAP} value={t.scrap} unit={s.unit} />
        <Figure label="Kalan" value={t.closing} unit={s.unit} strong />
      </div>
      {s.subjects.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">Bu dönemde bu müşterinin {lowerTr(KIND_LABEL[s.kind])} hareketi ya da açılış bakiyesi yok.</p>
      ) : (
        <StatementTable columns={subjectColumns(s)} rows={subjectRows(s)} totalRow={subjectTotalRow(s)} testId={`statement-subjects-${s.kind}`} />
      )}
      {s.lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-1">
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1" aria-expanded={showLines} onClick={() => setShowLines((v) => !v)}>
              {showLines ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {showLines ? "Hareketleri gizle" : `Hareketleri göster (${s.lines.length})`}
            </Button>
            {showLines && s.lines.length > SCREEN_LINE_CAP && (
              <span className="text-xs text-muted-foreground">
                Ekranda ilk {SCREEN_LINE_CAP} hareket; tamamı ({s.lines.length}) Excel'de.
              </span>
            )}
          </div>
          {showLines && (
            <StatementTable
              columns={lineColumns(s)}
              rows={lines.map((l) => lineRow(s, l))}
              rowClassName={(r) => (String(r.columnLabel).endsWith("storno") ? "text-muted-foreground italic" : undefined)}
              testId={`statement-lines-${s.kind}`}
            />
          )}
        </div>
      )}
    </section>
  );
}
