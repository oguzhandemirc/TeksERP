// Cari kartı → Etiket Şablonları sekmesi: "Tambur / Etiket" ayarları (Gülkesim S5).
// Kendi Kaydet'i var (Bilgiler formundan bağımsız PATCH) — sekmeler arası taslak karışmasın.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { ChoiceChips } from "@/components/ui/toggle-chip";
import { PermissionGate } from "@/components/PermissionGate";
import { customerService } from "./service";
import type { Customer } from "./types";
import { WIDTH_SOURCE_OPTIONS, toForm, toPayload, type TamburLabelSettingsForm } from "./tamburLabelSettings";

export function CustomerTamburLabelSettings({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<TamburLabelSettingsForm>(() => toForm(customer));
  useEffect(() => setForm(toForm(customer)), [customer]);

  // Yerel doğrulama tıklamada (toast burada); sunucu hatası apiClient'ta tek toast.
  const save = useMutation({
    mutationFn: (body: Partial<Customer>) => customerService.update(customer.id, body),
    onSuccess: () => {
      toast.success("Tambur / etiket ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
  const onSave = () => {
    const r = toPayload(form);
    if (!r.ok) { toast.error(r.error); return; }
    save.mutate(r.body as Partial<Customer>);
  };

  const hint = WIDTH_SOURCE_OPTIONS.find((o) => o.value === form.widthSource)?.hint;
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          Etiketteki en {hint ? <InfoPopover label="Etiketteki en: açıklama" desc={hint} /> : null}
        </span>
        <ChoiceChips name="labelWidthSource" ariaLabel="Etiketteki en" value={form.widthSource || "TODAY"}
          options={WIDTH_SOURCE_OPTIONS.map((o) => ({ value: o.value || "TODAY", label: o.label }))}
          onChange={(v) => setForm({ ...form, widthSource: v === "TODAY" ? "" : (v as TamburLabelSettingsForm["widthSource"]) })} />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.weighRequired}
          onChange={(e) => setForm({ ...form, weighRequired: e.target.checked })} />
        Tamburda tartım zorunlu
        <InfoPopover label="Tartım zorunlu: açıklama" desc="kg girilmeden kesim kaydedilmez; kg etikete basılabilir." />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.labelBatchEnabled}
          onChange={(e) => setForm({ ...form, labelBatchEnabled: e.target.checked })} />
        Etikete müşterinin parti no'su basılsın
        <InfoPopover label="Müşteri parti no: açıklama" desc="Tablet kesimde sorar; doluyken bizim parti no basılmaz." />
      </label>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Bölme ölçüsü önerisi</span>
        <Input className="h-8 w-28" inputMode="decimal" placeholder="ör. 50" value={form.splitLength}
          aria-label="Bölme ölçüsü (m)" onChange={(e) => setForm({ ...form, splitLength: e.target.value })} />
        <span className="text-xs text-muted-foreground">m</span>
        <InfoPopover label="Bölme ölçüsü: açıklama" desc="Tablet kesim metresine öneri." />
      </div>
      <PermissionGate permission="customer:write">
        <Button size="sm" disabled={save.isPending} onClick={onSave}>
          {save.isPending ? "Kaydediliyor..." : "Ayarları kaydet"}
        </Button>
      </PermissionGate>
    </div>
  );
}
