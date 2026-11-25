// Desen ailesine toplu atkı ücreti (SY-C3) — toplu yazım kuralı: önce ailenin HER kumaşı mevcut ücretiyle listelenir,
// yazım yalnız işaretli satırlara gider (varsayılan: aktif kumaşlar). Kayıtlı standart maliyetler değişmez.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { FieldGrid, FormCard, WideFormDialog } from "@/components/forms/WideFormDialog";
import type { Currency } from "@/pages/Finance/service";
import { CurrencySelect } from "../shared/CurrencySelect";
import { fmtDecFull, toDecimalText } from "../shared/format";
import { SOURCE_LABEL } from "../shared/labels";
import { pickFamilyService, type PickFamilyRow } from "./family-pick-rate.service";

const currentText = (r: PickFamilyRow) =>
  r.current.rate ? `${fmtDecFull(r.current.rate)} ${r.current.currency} · ${SOURCE_LABEL[r.current.source] ?? r.current.source}` : "Yok";

function RowsTable({ rows, picked, toggle }: { rows: PickFamilyRow[]; picked: Set<string>; toggle: (id: string, on: boolean) => void }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
          <tr><th className="w-8 p-2" /><th className="p-2">Kumaş</th><th className="p-2">Desen</th><th className="p-2 text-right">Bugünkü atkı ücreti</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className="border-t">
              <td className="p-2"><Checkbox checked={picked.has(r.itemId)} onCheckedChange={(v) => toggle(r.itemId, v === true)} aria-label={`${r.code} seç`} /></td>
              <td className="p-2"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">{r.code}</span>{!r.isActive && <span className="ml-1 text-xs text-muted-foreground">(pasif)</span>}</td>
              <td className="p-2 text-muted-foreground">{r.designName}</td>
              <td className="p-2 text-right tabular-nums">{currentText(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FamilyPickRateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fams = useQuery({ queryKey: ["cost-pick-families"], queryFn: pickFamilyService.list });
  const [family, setFamily] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const pv = useQuery({ queryKey: ["cost-pick-families", "preview", family], queryFn: () => pickFamilyService.preview(family), enabled: !!family, staleTime: 0 });
  const rows = useMemo(() => pv.data?.rows ?? [], [pv.data]);
  const sel = picked ?? new Set(rows.filter((r) => r.isActive).map((r) => r.itemId));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(sel);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const rateText = toDecimalText(rate);
  const apply = useMutation({
    mutationFn: () => pickFamilyService.apply({ familyLabel: family, rate: rateText!, currency, itemIds: [...sel] }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Atkı ücreti güncellendi.");
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      void qc.invalidateQueries({ queryKey: ["cost-pick-families"] });
      onClose();
    },
  });
  const canSave = !!family && !!rateText && sel.size > 0 && !apply.isPending;
  return (
    <WideFormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Desen ailesine atkı ücreti"
      description="Seçtiğiniz ailenin kumaşlarına aynı atkı başı ücreti yazar. Yalnız işaretli kumaşlar değişir; kayıtlı standart maliyetler değişmez, yeni ücret yeni hesaba girer."
      onSubmit={(e) => { e.preventDefault(); if (canSave) apply.mutate(); }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" disabled={!canSave}>{sel.size ? `${sel.size} kumaşa yaz` : "Yaz"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormCard title="Aile ve ücret" icon={Coins}>
          <FieldGrid cols={3}>
            <FormField label="Desen ailesi" required info="Desen kartındaki “Desen ailesi” alanı (ör. BALIK). Ailesi boş desenler listede yoktur.">
              <Select value={family} onValueChange={(v) => { setFamily(v); setPicked(null); }}>
                <SelectTrigger aria-label="Desen ailesi"><SelectValue placeholder={fams.isLoading ? "Yükleniyor…" : "Aile seçin"} /></SelectTrigger>
                <SelectContent>
                  {(fams.data ?? []).map((f) => <SelectItem key={f.familyLabel} value={f.familyLabel}>{f.familyLabel} · {f.itemCount} kumaş</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Atkı başı ücret" htmlFor="fpr-rate" required info="Dokuma = atkı sıklığı (atkı/cm) × bu ücret; ör. 17 atkı × 0,02 $ = 0,34 $/m.">
              <div className="flex gap-2">
                <Input id="fpr-rate" className="text-right tabular-nums" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0,02" />
                <CurrencySelect value={currency} onChange={setCurrency} />
              </div>
            </FormField>
            <FormField label="Parametre varsayılanı">
              <p className="pt-2 text-sm text-muted-foreground">{pv.data?.parameterDefault ? `${fmtDecFull(pv.data.parameterDefault.rate)} ${pv.data.parameterDefault.currency}` : "Yok"}</p>
            </FormField>
          </FieldGrid>
        </FormCard>
        <FormCard title={family ? `Etkilenecek kumaşlar (${sel.size}/${rows.length} seçili)` : "Etkilenecek kumaşlar"} icon={Layers}>
          {!family ? (
            <p className="text-sm text-muted-foreground">Aile seçince kumaşları bugünkü ücretleriyle burada görürsünüz.</p>
          ) : pv.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu ailede kumaş yok.</p>
          ) : (
            <RowsTable rows={rows} picked={sel} toggle={toggle} />
          )}
        </FormCard>
      </div>
    </WideFormDialog>
  );
}
