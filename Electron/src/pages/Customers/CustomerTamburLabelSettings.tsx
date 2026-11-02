// Cari kartı → Etiket Şablonları sekmesi: "Tambur / Etiket" ayarları (Gülkesim S5).
// Kendi Kaydet'i var (Bilgiler formundan bağımsız PATCH) — sekmeler arası taslak karışmasın.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PermissionGate } from "@/components/PermissionGate";
import { customerService } from "./service";
import type { Customer } from "./types";
import { WIDTH_SOURCE_OPTIONS, toForm, toPayload, type TamburLabelSettingsForm } from "./tamburLabelSettings";

export function CustomerTamburLabelSettings({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<TamburLabelSettingsForm>(() => toForm(customer));
  useEffect(() => setForm(toForm(customer)), [customer]);

  const save = useMutation({
    mutationFn: async () => {
      const r = toPayload(form);
      if (!r.ok) throw new Error(r.error);
      return customerService.update(customer.id, r.body as Partial<Customer>);
    },
    onSuccess: () => {
      toast.success("Tambur / etiket ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
    // Sunucu hatası apiClient'ta tek toast; yalnız yerel doğrulama hatası burada.
    onError: (e) => { if (!(e as { isAxiosError?: boolean }).isAxiosError) toast.error((e as Error).message); },
  });

  const hint = WIDTH_SOURCE_OPTIONS.find((o) => o.value === form.widthSource)?.hint;
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Etiketteki en</span>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Etiketteki en">
          {WIDTH_SOURCE_OPTIONS.map((o) => (
            <label key={o.value || "today"} className="flex items-center gap-1.5">
              <input type="radio" name="labelWidthSource" checked={form.widthSource === o.value}
                onChange={() => setForm({ ...form, widthSource: o.value })} />
              {o.label}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.weighRequired}
          onChange={(e) => setForm({ ...form, weighRequired: e.target.checked })} />
        Tamburda tartım zorunlu (kg girilmeden kesim kaydedilmez; kg etikete basılabilir)
      </label>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Bölme ölçüsü önerisi</span>
        <Input className="h-8 w-28" inputMode="decimal" placeholder="ör. 50" value={form.splitLength}
          aria-label="Bölme ölçüsü (m)" onChange={(e) => setForm({ ...form, splitLength: e.target.value })} />
        <span className="text-xs text-muted-foreground">m — tablet kesim metresine öneri</span>
      </div>
      <PermissionGate permission="customer:write">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Kaydediliyor..." : "Ayarları kaydet"}
        </Button>
      </PermissionGate>
    </div>
  );
}
