// Kural seti formu. Kapsam/müşteri/ürün YALNIZ oluştururken seçilir (sunucu değiştirmez — yeni set açılır).
// Geçmiş muayene kural snapshot'ı taşıdığı için düzenleme geçmişi DEĞİŞTİRMEZ; bunu formda söyleriz.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { PermissionGate } from "@/components/PermissionGate";
import { BandTable } from "./BandTable";
import { CAP_LABEL, UNIT_LABEL, initialState, missingFields, toBody, type RuleSetFormState } from "./ruleSetForm";
import { ruleSetErrorText, ruleSetService, type RuleScope, type RuleSet } from "./service";

/** 2–3 seçenekli alan: düğme grubu (açılır liste/combobox yok — UI tercihi). */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {(Object.keys(options) as T[]).map((k) => (
          <Button key={k} type="button" size="sm" role="radio" aria-checked={value === k} variant={value === k ? "default" : "outline"} onClick={() => onChange(k)}>{options[k]}</Button>
        ))}
      </div>
    </div>
  );
}

interface Props { set: RuleSet | null; scope: RuleScope; onClose: () => void }

export function RuleSetFormDialog({ set, scope, onClose }: Props) {
  const qc = useQueryClient();
  const [s, setS] = useState<RuleSetFormState>(() => initialState(set, scope));
  const [itemOpen, setItemOpen] = useState(false);
  const [tried, setTried] = useState(false);
  const isEdit = Boolean(set);
  const missing = missingFields(s);
  const up = (p: Partial<RuleSetFormState>) => setS((prev) => ({ ...prev, ...p }));
  const save = useMutation({
    mutationFn: () => {
      const body = toBody(s);
      return set ? ruleSetService.update(set.id, { name: body.name, unit: body.unit, runningCap: body.runningCap, bands: body.bands }) : ruleSetService.create(body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["four-point-rules"] }); toast.success("Kural seti kaydedildi."); onClose(); },
  });
  const submit = () => { setTried(true); if (missing.length === 0) save.mutate(); };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Kural setini düzenle" : s.scope === "FACTORY" ? "Yeni fabrika varsayılanı" : "Yeni müşteri spesifikasyonu"}</DialogTitle>
          <DialogDescription>
            {s.scope === "FACTORY"
              ? "Topun kalite önerisi bu setten gelir. Her bant bir kalite derecesine bağlanır."
              : "Müşteri bilindiği yerde (sevk muayene özeti, muayene raporu) uygulanır; derece önermez, yalnız GEÇTİ/KALDI der."}
            {isEdit && " Değişiklik yalnız bundan sonraki muayeneleri etkiler; kayıtlı muayeneler kendi kural kopyasını taşır."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="rs-name">Ad</Label><Input id="rs-name" maxLength={80} value={s.name} onChange={(e) => up({ name: e.target.value })} placeholder={s.scope === "FACTORY" ? "ör. Fabrika standardı" : "ör. Zara — penye özel"} /></div>
            {s.scope === "CUSTOMER" && (
              <>
                <div className="space-y-1"><Label>Müşteri</Label><CustomerPickerField value={s.customerId} onChange={(id) => up({ customerId: id })} disabled={isEdit} /></div>
                <div className="space-y-1">
                  <Label>Ürün (isteğe bağlı)</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" disabled={isEdit} onClick={() => setItemOpen(true)}>{s.item ? "Ürünü değiştir" : "Ürün seç…"}</Button>
                    <span className="min-w-0 truncate text-sm">{s.item ? s.item.name : <span className="text-muted-foreground">Müşterinin bütün ürünleri</span>}</span>
                    {s.item && !isEdit && <Button type="button" variant="ghost" size="sm" onClick={() => up({ item: null })}>Kaldır</Button>}
                  </div>
                </div>
              </>
            )}
            <Segmented label="Birim" value={s.unit} options={UNIT_LABEL} onChange={(unit) => up({ unit })} />
            <Segmented label="Koşu tavanı" value={s.runningCap} options={CAP_LABEL} onChange={(runningCap) => up({ runningCap })} />
          </div>
          <div className="space-y-2">
            <Label>Bantlar</Label>
            <BandTable scope={s.scope} bands={s.bands} onChange={(bands) => up({ bands })} disabled={save.isPending} />
          </div>
          {tried && missing.length > 0 && <p role="alert" className="text-sm text-destructive">Eksik: {missing.join(" · ")}</p>}
          {save.isError && <p role="alert" data-testid="rule-set-error" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{ruleSetErrorText(save.error, s.scope)}</p>}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <PermissionGate permission="inspection:rules">
            <Button disabled={save.isPending} onClick={submit}>{save.isPending ? "Kaydediliyor…" : "Kaydet"}</Button>
          </PermissionGate>
        </DialogFooter>
        <ItemPickerModal open={itemOpen} onOpenChange={setItemOpen} onPick={(r) => { up({ item: { id: r.id, name: r.name } }); setItemOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}
