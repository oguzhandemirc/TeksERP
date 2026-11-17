// İplik sevki satır tablosu — iplik başına öneri bağlamı + depo/lot seçici + kg; notlar satırın ALTINDA (renk ve
// metin `dispatch-model.lineNotes` tek yükleminden). Aynı iplikten ikinci lot için "+ lot" satır ekler.
import { Fragment } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { addLotLine, lineNotes, overPlanNote, type DispatchLineDraft } from "./dispatch-model";
import { fmtKg } from "./order-model";
import { LotPicker, WarehousePicker } from "./YarnSourcePickers";
import type { WarpingDispatchPreview, WarpingDispatchPreviewYarn } from "./yarn-types";

const num = "text-right tabular-nums";

/** Önerinin nereden geldiği — sıfır olan terimler yazılmaz. */
function contextText(y: WarpingDispatchPreviewYarn): string {
  const sent = Number(y.dispatchedKg) - Number(y.returnedKg) + Number(y.transferInKg) - Number(y.transferOutKg);
  const parts = [`plan ${fmtKg(y.planGrossKg)} kg`];
  if (sent !== 0) parts.push(`gönderilmiş net ${fmtKg(sent)} kg`);
  if (Number(y.carryOverKg) > 0) parts.push(`devreden ${fmtKg(y.carryOverKg)} kg`);
  if (y.depoKg !== null) parts.push(`depoda ${fmtKg(y.depoKg)} kg`);
  return parts.join(" · ");
}

interface RowProps {
  line: DispatchLineDraft;
  first: boolean;
  yarn: WarpingDispatchPreviewYarn;
  preview: WarpingDispatchPreview;
  lines: DispatchLineDraft[];
  onChange: (next: DispatchLineDraft[]) => void;
}

function LineRow({ line, first, yarn, preview, lines, onChange }: RowProps) {
  const set = (patch: Partial<DispatchLineDraft>) => onChange(lines.map((l) => (l === line ? { ...l, ...patch } : l)));
  const notes = lineNotes(line, lines, yarn, preview);
  const over = first ? overPlanNote(yarn, lines) : null;
  return (
    <Fragment>
      <TableRow className={cn(notes.length > 0 || over ? "border-b-0" : undefined)}>
        <TableCell className="align-top">
          {first ? (
            <>
              <span className="font-medium">{yarn.letter} · {yarn.code}</span> <span className="text-muted-foreground">{yarn.name}</span>
              <span className="block text-xs text-muted-foreground">{contextText(yarn)}</span>
            </>
          ) : (
            <span className="pl-4 text-xs text-muted-foreground">↳ aynı iplik, başka lot</span>
          )}
        </TableCell>
        <TableCell className={cn(num, "align-top")}>{first ? fmtKg(yarn.suggestedKg) : ""}</TableCell>
        <TableCell className="w-44 align-top"><WarehousePicker itemId={yarn.yarnItemId} code={yarn.code} value={line.warehouse} onChange={(warehouse) => set({ warehouse })} /></TableCell>
        <TableCell className="w-40 align-top"><LotPicker itemId={yarn.yarnItemId} code={yarn.code} value={line.lot} onChange={(lot) => set({ lot })} /></TableCell>
        <TableCell className="w-28 align-top">
          <Input aria-label={`${yarn.code} sevk kg`} inputMode="decimal" className="h-8 text-right tabular-nums" value={line.qtyKg} onChange={(e) => set({ qtyKg: e.target.value })} />
        </TableCell>
        <TableCell className="w-10 align-top">
          {first ? (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`${yarn.code} için başka lot satırı ekle`} title="Bu iplikten başka bir lot da gönder" onClick={() => onChange(addLotLine(lines, yarn.yarnItemId))}>
              <Plus className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`${yarn.code} lot satırını kaldır`} onClick={() => onChange(lines.filter((l) => l !== line))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </TableCell>
      </TableRow>
      {(notes.length > 0 || over) && (
        <TableRow>
          <TableCell colSpan={6} className="pt-0 text-xs">
            {notes.map((n) => (
              <span key={n.text} className={cn("mr-3 block sm:inline", n.blocking ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>{n.text}</span>
            ))}
            {over && <span className="block text-muted-foreground sm:inline">{over}</span>}
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

export function DispatchLinesTable({ preview, lines, onChange }: { preview: WarpingDispatchPreview; lines: DispatchLineDraft[]; onChange: (next: DispatchLineDraft[]) => void }) {
  const seen = new Set<string>();
  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>İplik</TableHead>
            <TableHead className={num} title="Plan brüt − gönderilmiş net − devreden bakiye">Öneri kg</TableHead>
            <TableHead>Depo</TableHead>
            <TableHead>Lot</TableHead>
            <TableHead className={num}>Sevk kg</TableHead>
            <TableHead><span className="sr-only">Satır</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const first = !seen.has(l.yarnItemId);
            seen.add(l.yarnItemId);
            const yarn = preview.yarns.find((y) => y.yarnItemId === l.yarnItemId)!;
            return <LineRow key={l.key} line={l} first={first} yarn={yarn} preview={preview} lines={lines} onChange={onChange} />;
          })}
        </TableBody>
      </Table>
    </div>
  );
}
