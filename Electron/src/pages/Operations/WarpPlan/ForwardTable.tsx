// "Leventten" sonucu: iplik başına formül (firesiz) kg · fireli öneri (yalnız fire girilmişse) · deverecide ·
// gönderilecek · depoda · emanet · eksik. Sayılar sunucudan; burada yalnız biçim ve sütun görünürlüğü.
import { Info } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtKg, fmtM, stockText, wasteSourceText, yarnLetter } from "./warp-plan-model";
import type { WarpPlanForward, WarpPlanResult } from "./types";

interface Props {
  res: WarpPlanResult;
  forward: WarpPlanForward;
}

/** Görünür sütunlar — tek kaynak; test de buradan ölçer. */
export function forwardColumns(res: WarpPlanResult, forward: WarpPlanForward) {
  return {
    gross: forward.hasWaste,
    fason: res.stock.subcontractorId !== null,
    emanet: res.stock.emanetAcik,
  };
}

export function ForwardTable({ res, forward }: Props) {
  const col = forwardColumns(res, forward);
  const num = "text-right tabular-nums";
  return (
    <section className="space-y-2" aria-label="İplik ihtiyacı">
      <p className="text-sm">
        <span className="font-medium">{fmtM(forward.lengthM)} m çözgü</span>
        {forward.grossLengthM !== forward.lengthM && <span className="text-muted-foreground"> · sabit fire ile {fmtM(forward.grossLengthM)} m sarılır</span>}
        {!res.stock.known && <span className="text-muted-foreground"> · iplik stoğu bilinmiyor (iplik modülü kapalı)</span>}
      </p>
      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>İplik</TableHead>
              <TableHead className={num}>Tel</TableHead>
              <TableHead className={num}>Formül (firesiz) kg</TableHead>
              {col.gross && <GrossHead text={wasteSourceText(forward.wasteSources, res.yarns)} />}
              {col.fason && <TableHead className={num}>Deverecide kg</TableHead>}
              {col.fason && <TableHead className={num}>Gönderilecek kg</TableHead>}
              <TableHead className={num}>Depoda kg</TableHead>
              {col.emanet && <TableHead className={num}>Emanet kg</TableHead>}
              <TableHead className={num}>Eksik kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forward.lines.map((l, i) => {
              const y = res.yarns.find((x) => x.yarnItemId === l.yarnItemId);
              const short = l.depoShortKg !== null && l.depoShortKg > 0;
              return (
                <TableRow key={l.yarnItemId}>
                  <TableCell>
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-muted text-xs font-semibold">{yarnLetter(i)}</span>
                    <span className="font-medium">{y?.name ?? "—"}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{y ? `${y.code} · ${y.denier} den` : ""}</span>
                  </TableCell>
                  <TableCell className={num}>{l.endsCount}</TableCell>
                  <TableCell className={cn(num, "font-medium")}>{fmtKg(l.netKg)}</TableCell>
                  {col.gross && <TableCell className={cn(num, "font-medium")}>{fmtKg(l.grossKg)}</TableCell>}
                  {col.fason && <TableCell className={num}>{stockText(l.fasondaKg)}</TableCell>}
                  {col.fason && <TableCell className={num}>{fmtKg(l.sendKg)}</TableCell>}
                  <TableCell className={num}>{stockText(l.depoKg)}</TableCell>
                  {col.emanet && <TableCell className={num}>{stockText(y?.emanetKg)}</TableCell>}
                  <TableCell className={cn(num, short && "font-semibold text-destructive")}>{l.depoShortKg === null ? "bilinmiyor" : short ? fmtKg(l.depoShortKg) : "yok"}</TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell>Toplam</TableCell>
              <TableCell className={num}>{forward.lines.reduce((s, l) => s + l.endsCount, 0)}</TableCell>
              <TableCell className={num}>{fmtKg(forward.totals.netKg)}</TableCell>
              {col.gross && <TableCell className={num}>{fmtKg(forward.totals.grossKg)}</TableCell>}
              {col.fason && <TableCell />}
              {col.fason && <TableCell className={num}>{fmtKg(forward.totals.sendKg)}</TableCell>}
              <TableCell colSpan={col.emanet ? 3 : 2} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Formül: tel × denye × metre ÷ 9.000.000 = kg (kâğıttaki formül gram verir; burada kg). Depoda = kalite bekletmedeki lotlar hariç bizim iplik{col.emanet ? "; emanet ayrı sütunda" : ""}.
      </p>
    </section>
  );
}

function GrossHead({ text }: { text: string }) {
  return (
    <TableHead className="text-right">
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1">Fireli öneri kg <Info className="h-3.5 w-3.5" aria-label={`Fire: ${text}`} /></span>
          </TooltipTrigger>
          <TooltipContent>Fire: {text}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </TableHead>
  );
}
