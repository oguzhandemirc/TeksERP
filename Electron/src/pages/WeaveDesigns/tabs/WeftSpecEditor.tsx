// Atkı kartı düzenleyici — harf = iplik satırının sırası (A, B, C…). Sıra kodu (`A4 B1 A4 C1`) doluysa
// rapordaki adetler gövdeye konmaz, sunucu aynı tx'te türetir; boşsa elle adet (bugünkü davranış).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Package, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { weftSpecApi } from "../service";
import type { WeftSpecDetail } from "../types";
import { decimalToFormText } from "@/lib/decimal-form-text";

interface Row { yarnItemId: string; picks: string }
const MAX_WEFT_LINES = 26;
export const weftLetter = (i: number) => String.fromCharCode(65 + i);

export function buildWeftBody(seq: string, picksPerCm: string, program: string, rows: Row[]): Record<string, unknown> {
  const sequence = seq.trim();
  return {
    sequenceCode: sequence === "" ? null : sequence,
    picksPerCm: picksPerCm.trim() === "" ? null : picksPerCm.trim().replace(",", "."),
    weftProgramNo: program.trim() === "" ? null : program.trim(),
    yarns: rows.map((r) => (sequence === "" ? { yarnItemId: r.yarnItemId, picksInRepeat: Number(r.picks) } : { yarnItemId: r.yarnItemId })),
  };
}

export function WeftSpecEditor({ spec, fabricId, canWrite }: { spec: WeftSpecDetail; fabricId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [seq, setSeq] = useState(spec.sequenceCode ?? "");
  const [picksPerCm, setPicksPerCm] = useState(() => decimalToFormText(spec.picksPerCm));
  const [program, setProgram] = useState(spec.weftProgramNo ?? "");
  const [rows, setRows] = useState<Row[]>(() => spec.yarns.map((y) => ({ yarnItemId: y.yarnItemId, picks: String(y.picksInRepeat) })));
  const derived = seq.trim() !== "";
  const save = useMutation({
    mutationFn: () => weftSpecApi.update(spec.id, buildWeftBody(seq, picksPerCm, program, rows)),
    onSuccess: () => {
      toast.success("Atkı kartı güncellendi.");
      void qc.invalidateQueries({ queryKey: ["weft-specs"] });
      void qc.invalidateQueries({ queryKey: ["item-construction", fabricId] });
    },
  });
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = rows.length > 0 && rows.every((r) => r.yarnItemId && (derived || Number(r.picks) > 0));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Atkı kartı: <span className="font-mono text-xs">{spec.code}</span> · {spec.name}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="wf-seq">Atkı sırası kodu</Label>
          <Input id="wf-seq" value={seq} maxLength={120} disabled={!canWrite} onChange={(e) => setSeq(e.target.value)} placeholder="A4 B1 A4 C1" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wf-ppc">Atkı sıklığı (atkı/cm)</Label>
          <Input id="wf-ppc" value={picksPerCm} inputMode="decimal" disabled={!canWrite} onChange={(e) => setPicksPerCm(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wf-prog">Atkı program no</Label>
          <Input id="wf-prog" value={program} maxLength={16} disabled={!canWrite} onChange={(e) => setProgram(e.target.value)} placeholder="6037" />
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid items-center gap-2 sm:grid-cols-[2rem_1fr_8rem_2.5rem]">
            <span className="font-mono text-sm font-semibold">{weftLetter(i)}</span>
            <EntityPickerModal<Item>
              value={r.yarnItemId || null}
              onChange={(id) => setRow(i, { yarnItemId: id ?? "" })}
              service={itemService}
              queryKey="items-weft-yarn"
              filters={{ itemType: "YARN", lifecycleStatus: "ACTIVE" }}
              getLabel={(it) => it.name}
              getSubLabel={(it) => it.code}
              icon={Package}
              title={`Atkı ${weftLetter(i)} ipliği seç`}
              placeholder="İplik seç"
              disabled={!canWrite}
            />
            <Input aria-label={`Atkı ${weftLetter(i)} rapordaki adet`} value={r.picks} inputMode="numeric" disabled={!canWrite || derived} title={derived ? "Sıra kodundan sunucu türetir" : undefined}
              placeholder={derived ? "sıradan türetilir" : "adet"} onChange={(e) => setRow(i, { picks: e.target.value })} />
            {canWrite && (
              <Button variant="ghost" size="icon" aria-label={`Atkı ${weftLetter(i)} satırını sil`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={rows.length >= MAX_WEFT_LINES} onClick={() => setRows((rs) => [...rs, { yarnItemId: "", picks: "" }])}>
            Atkı ipliği ekle
          </Button>
          <Button size="sm" disabled={!ready || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </div>
      )}
    </div>
  );
}
