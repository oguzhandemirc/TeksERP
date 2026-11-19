// "Eldeki iplikten" sonucu: en çok metre, kısıtlayan iplik (vurgulu), artan kg, kaç tam levent. Sayılar sunucudan.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtKg, fmtM, stockText, wasteSourceText, yarnLetter } from "./warp-plan-model";
import type { WarpPlanResult, WarpPlanReverse } from "./types";

interface Props {
  res: WarpPlanResult;
  reverse: WarpPlanReverse;
}

export function ReverseResult({ res, reverse }: Props) {
  const constraint = res.yarns.find((y) => y.yarnItemId === reverse.constraintYarnItemId) ?? null;
  const num = "text-right tabular-nums";
  return (
    <section className="space-y-3" aria-label="Eldeki iplikle en çok metre">
      {reverse.maxLengthM !== null && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="En çok çözgü" value={`${fmtM(reverse.maxLengthM)} m`} strong />
          <Stat label="Kısıtlayan iplik" value={constraint ? constraint.name : "—"} />
          <Stat
            label="Tam levent"
            value={reverse.fullBeams === null ? "Levent boyu girilmedi" : `${reverse.fullBeams} levent${reverse.remainderM ? ` + ${fmtM(reverse.remainderM)} m artar` : ""}`}
          />
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>İplik</TableHead>
              <TableHead className={num}>Kullanılabilir kg</TableHead>
              <TableHead className={num}>Tek başına yeter (m)</TableHead>
              <TableHead className={num}>Artan kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reverse.lines.map((l, i) => {
              const y = res.yarns.find((x) => x.yarnItemId === l.yarnItemId);
              const isC = l.yarnItemId === reverse.constraintYarnItemId;
              return (
                <TableRow key={l.yarnItemId} className={cn(isC && "bg-warning/10")}>
                  <TableCell>
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-muted text-xs font-semibold">{yarnLetter(i)}</span>
                    <span className="font-medium">{y?.name ?? "—"}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{y ? `${y.code} · ${y.denier} den` : ""}</span>
                    {isC && <Badge variant="warning" className="ml-2">kısıtlayan</Badge>}
                  </TableCell>
                  <TableCell className={num}>{stockText(l.availableKg)}</TableCell>
                  <TableCell className={num}>{l.maxLengthM === null ? "—" : fmtM(l.maxLengthM)}</TableCell>
                  <TableCell className={num}>{l.leftoverKg === null ? "—" : fmtKg(l.leftoverKg)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Kullanılabilir = depoda (bekletmedeki lotlar hariç){res.stock.subcontractorId ? " + seçilen deverecide duran" : ""}. Artan kg, en çok metre sarıldıktan sonra kalan iplik.
        {reverse.hasWaste ? ` Fire düşüldü: ${wasteSourceText(reverse.wasteSources, res.yarns)}.` : ""}
      </p>
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 tabular-nums", strong ? "text-2xl font-semibold" : "text-sm font-medium")}>{value}</div>
    </div>
  );
}
