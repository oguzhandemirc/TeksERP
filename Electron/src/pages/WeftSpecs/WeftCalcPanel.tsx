import { useState } from "react";
import { AlertTriangle, Calculator } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fmtKg } from "@/pages/Operations/WarpPlan/warp-plan-model";
import type { WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { buildWeftCalcBody, LENGTH_CHAIN_INFO, LENGTH_SOURCE_TEXT, useWeftCalc, type WeftCalcCtx, type WeftCalcResult, type WeftCalcRow } from "./weft-calc";

const num = "text-right tabular-nums";

/** Sağdaki "Hesap" paneli: 1000 m kumaş için iplik başına atkı kg'ı (firesiz/fireli) + pay. Sayılar sunucudan, panel hesaplamaz. */
export function WeftCalcPanel({ content, ctx }: { content: WeftContent; ctx?: WeftCalcCtx }) {
  const [lengthCm, setLengthCm] = useState("");
  const body = buildWeftCalcBody(content, ctx, lengthCm);
  const q = useWeftCalc(body);
  const data = body ? (q.data ?? null) : null;
  return (
    <aside className="rounded-xl border border-card-border bg-card shadow-card lg:sticky lg:top-0 lg:self-start" data-testid="weft-calc-panel" aria-label="Atkı hesabı">
      <header className="flex items-center gap-2 border-b px-5 py-2.5">
        <Calculator className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Hesap</h3>
        <span className="ml-auto text-xs text-muted-foreground">1000 m kumaş için atkı ihtiyacı</span>
      </header>
      <div className="space-y-3 px-5 py-4">
        {!body ? (
          <p className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground">Hesap için her satırda iplik ve atış adedi (ya da sıra kodu) girin.</p>
        ) : data ? (
          <CalcRows rows={data.rows} />
        ) : (
          <p className="text-sm text-muted-foreground">{q.isError ? "Hesaplanamadı." : "Hesaplanıyor…"}</p>
        )}
        <Totals data={data} />
        <LengthInput value={lengthCm} onChange={setLengthCm} data={data} />
        {data && data.missing.length > 0 ? (
          <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" data-testid="weft-calc-missing">
            {data.missing.map((m) => (
              <li key={m.code} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{m.text}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}

function Totals({ data }: { data: WeftCalcResult | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">Toplam kg / 1000 m</span>
      <span className={cn(num, "font-semibold")} data-testid="weft-calc-total-net">{fmtKg(data?.totalNetKg)}</span>
      <span className="text-muted-foreground">Fireli kg / 1000 m{data?.wastePct != null ? ` (%${formatQty(data.wastePct, 2)})` : ""}</span>
      <span className={num} data-testid="weft-calc-total-gross">{fmtKg(data?.totalGrossKg)}</span>
      <span className="text-muted-foreground">Atkı sıklığı</span>
      <span className={num}>{data?.picksPerCm != null ? `${formatQty(data.picksPerCm, 2)} atkı/cm` : "—"}</span>
    </div>
  );
}

function LengthInput({ value, onChange, data }: { value: string; onChange: (v: string) => void; data: WeftCalcResult | null }) {
  const src = data?.lengthSource ? LENGTH_SOURCE_TEXT[data.lengthSource] : null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">Atkı boyu (cm)<InfoPopover label="Atkı boyu nereden gelir" desc={LENGTH_CHAIN_INFO} /></span>
        <Input className="h-8 w-28" inputMode="decimal" aria-label="Atkı boyu (cm)" value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={data?.lengthCm != null ? formatQty(data.lengthCm, 1) : "ör. 300"} />
      </label>
      <span className="pb-2 text-xs text-muted-foreground" data-testid="weft-calc-length-source">
        {src ? `kaynak: ${src}` : "isteğe bağlı"} · kaydedilmez
      </span>
    </div>
  );
}

/** Her iplik iki satır: üstte harf + AD + küçük kod; altta kg (firesiz, altında fireli) ve pay. KG dışı iplik kg'a girmez. */
function CalcRows({ rows }: { rows: WeftCalcRow[] }) {
  return (
    <div className="text-sm" data-testid="weft-calc-table">
      <div className="grid grid-cols-2 gap-2 border-b pb-1.5 pl-7 text-xs text-muted-foreground">
        <span className={num}>kg/1000 m</span>
        <span className={num}>Pay</span>
      </div>
      {rows.map((r) => (
        <div key={r.letter} className="border-b border-border/50 py-2 last:border-0" data-testid={`weft-calc-row-${r.letter}`}>
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold text-primary">{r.letter}</span>
            <span className="min-w-0 truncate font-medium" title={r.name}>{r.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{r.code}</span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 pl-7">
            {r.unit ? (
              <span className="text-right text-xs text-muted-foreground">kg&apos;a girmez</span>
            ) : (
              <span className={cn(num, "font-semibold")}>
                {fmtKg(r.netKg)}
                {r.grossKg !== null ? <span className="block text-[11px] font-normal text-muted-foreground">fireli {fmtKg(r.grossKg)}</span> : null}
              </span>
            )}
            <span className={num}>{r.sharePct === null ? "—" : `%${formatQty(r.sharePct, 1)}`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
