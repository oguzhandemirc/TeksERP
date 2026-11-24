import { useState } from "react";
import { Calculator, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtKg } from "@/pages/Operations/WarpPlan/warp-plan-model";
import { buildCalcView, parseBeam, type CalcView } from "./preview";
import { totalEnds } from "./YarnRowsEditor";
import { useWarpCalc } from "./useWarpCalc";
import { wasteSourceText, yarnOwnWasteNote } from "@/pages/Operations/WarpPlan/yarn-waste-note";

const num = "text-right tabular-nums";

/** Sağdaki yapışkan "Hesap" paneli: iplik başına tel · denye · 1000 m kg · pay; isteğe bağlı levent boyu × adet. Sayılar sunucudan. */
export function WarpCalcPanel() {
  const [beamLen, setBeamLen] = useState("");
  const [beamCount, setBeamCount] = useState("1");
  const beam = parseBeam(beamLen, beamCount);
  const calc = useWarpCalc(beam);
  const view = calc.per1000 ? buildCalcView(calc.per1000, beam && calc.beamResult ? { input: beam, result: calc.beamResult } : null) : null;
  return (
    <aside className="rounded-xl border border-card-border bg-card shadow-card" data-testid="warp-calc-panel" aria-label="Hesap">
      <header className="flex items-center gap-2 border-b px-5 py-2.5">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Hesap</h3>
        <span className="ml-auto text-xs text-muted-foreground">1000 m çözgü için</span>
      </header>
      <div className="space-y-3 px-5 py-4">
        {!calc.hasBody ? (
          <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">Hesap için her satırda iplik ve tel adedi girin.</p>
        ) : view ? (
          <CalcTable view={view} specWastePct={calc.specWastePct} />
        ) : (
          <p className="text-sm text-muted-foreground">{calc.per1000Error ? "Hesaplanamadı." : "Hesaplanıyor…"}</p>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Toplam tel (kenar dahil)</span>
          <span className={cn(num, "font-semibold")} data-testid="warp-calc-total-ends">{formatQty(totalEnds(calc.yarns), 0)}</span>
          <span className="text-muted-foreground">Toplam kg / 1000 m</span>
          <span className={cn(num, "font-semibold")} data-testid="warp-calc-total-kg">{view ? fmtKg(view.totalNetKg) : "—"}</span>
          {view?.totalGrossKg != null ? (
            <>
              <span className="text-muted-foreground">Fireli kg / 1000 m</span>
              <span className={num}>{fmtKg(view.totalGrossKg)}</span>
            </>
          ) : null}
          {view?.beam ? (
            <>
              <span className="text-muted-foreground">{formatQty(view.beam.count, 0)} levent × {formatQty(view.beam.lengthM, 1)} m</span>
              <span className={cn(num, "font-semibold")} data-testid="warp-calc-beam-total">{fmtKg(view.beam.totalKg)} kg</span>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Levent boyu (m)
            <Input className="h-8 w-28" inputMode="decimal" placeholder="ör. 3000" value={beamLen} onChange={(e) => setBeamLen(e.target.value)} aria-label="Levent boyu (m)" />
          </label>
          <span className="pb-2 text-muted-foreground">×</span>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Adet
            <Input className="h-8 w-16" inputMode="numeric" value={beamCount} onChange={(e) => setBeamCount(e.target.value)} aria-label="Levent adedi" />
          </label>
          <span className="pb-2 text-xs text-muted-foreground">isteğe bağlı · kaydedilmez</span>
        </div>
        <p className="rounded-md border border-dashed px-3 py-1.5 font-mono text-xs" data-testid="warp-calc-formula">kg = tel × denye × metre ÷ 9.000.000</p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Hesap iplik kartındaki denyeyle yapılır; maliyet tablosundaki paylı denye buraya yazılmaz.
        </p>
      </div>
    </aside>
  );
}

/** B6: fire varken satır başına uygulanan yüzde + kaynak; iplik kendi firesini taşıyorsa uyarı rengiyle tam cümle. */
function WasteLine({ row, specWastePct }: { row: CalcView["rows"][number]; specWastePct: number | null }) {
  if (row.wastePct === null) return null;
  const note = yarnOwnWasteNote(row.wasteSource ?? undefined, row.wastePct, specWastePct);
  if (note) return <p className="mt-1 pl-7 text-[11px] text-amber-700 dark:text-amber-400" data-testid={`warp-calc-waste-${row.letter}`}>{note}</p>;
  const src = wasteSourceText(row.wasteSource ?? undefined, row.wastePct);
  return (
    <p className="mt-1 pl-7 text-[11px] text-muted-foreground" data-testid={`warp-calc-waste-${row.letter}`}>
      Fire {row.wastePct > 0 ? `%${formatQty(row.wastePct, 2, 0)}` : "yok"}{src ? ` · ${src}` : ""}
    </p>
  );
}

/** Her iplik iki satır: üstte harf + AD (birincil) + küçük kod · denye; altta sayılar — dar panelde ad kesilmez. */
function CalcTable({ view, specWastePct }: { view: CalcView; specWastePct: number | null }) {
  const withBeam = view.beam !== null;
  const cols = withBeam ? "grid-cols-5" : "grid-cols-4";
  return (
    <div className="text-sm" data-testid="warp-calc-table">
      <div className={cn("grid gap-2 border-b pb-1.5 pl-7 text-xs text-muted-foreground", cols)}>
        <span className={num}>Tel</span>
        <span className={num}>Denye</span>
        <span className={num}>kg/1000 m</span>
        <span className={num}>Pay</span>
        {withBeam ? <span className={num}>Levent kg</span> : null}
      </div>
      {view.rows.map((r) => (
        <div key={r.yarnItemId} className="border-b border-border/50 py-2 last:border-0" data-testid={`warp-calc-row-${r.letter}`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold text-primary">{r.letter}</span>
            <span className="min-w-0 truncate font-medium" title={r.name}>{r.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{r.code}</span>
          </div>
          <div className={cn("mt-1 grid gap-2 pl-7", cols)}>
            <span className={num}>{formatQty(r.endsCount, 0)}</span>
            <span className={num}>{formatQty(r.denier, 1)}</span>
            <span className={cn(num, "font-semibold")}>
              {fmtKg(r.netKg)}
              {r.grossKg !== null ? <span className="block text-[11px] font-normal text-muted-foreground">fireli {fmtKg(r.grossKg)}</span> : null}
            </span>
            <span className={num}>{r.sharePct === null ? "—" : `%${formatQty(r.sharePct, 1)}`}</span>
            {withBeam ? <span className={num}>{fmtKg(r.beamKg)}</span> : null}
          </div>
          <WasteLine row={r} specWastePct={specWastePct} />
        </div>
      ))}
    </div>
  );
}
