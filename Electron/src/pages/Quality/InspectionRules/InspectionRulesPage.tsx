// =============================================================================
// KALİTE GÜVENCE › 4 PUAN KURALLARI (K4P-TANIM)
// =============================================================================
// Fabrika varsayılanı (topun kalite önerisi) + müşteri spesifikasyonları (müşteri bilindiği yerde).
// Kural seti silinmez, pasife alınır; geçmiş muayene kendi kural kopyasını taşır.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { RuleSetSection } from "./RuleSetList";
import { RuleSetFormDialog } from "./RuleSetFormDialog";
import { ruleSetErrorText, ruleSetService, type RuleScope, type RuleSet } from "./service";

export function InspectionRulesPage() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<{ set: RuleSet | null; scope: RuleScope } | null>(null);
  const [toggle, setToggle] = useState<RuleSet | null>(null);
  const q = useQuery({ queryKey: ["four-point-rules", showInactive], queryFn: () => ruleSetService.list(showInactive) });
  const flip = useMutation({
    mutationFn: (s: RuleSet) => ruleSetService.setActive(s.id, !s.isActive),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["four-point-rules"] }); toast.success(r.isActive ? "Kural seti etkinleştirildi." : "Kural seti pasife alındı."); setToggle(null); },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istek `suppressErrorToast` taşır; 409 kapsama göre açıklanır.
    onError: (e, s) => { toast.error(ruleSetErrorText(e, s.scope)); setToggle(null); },
  });
  const rows = q.data ?? [];
  const byActive = (a: RuleSet, b: RuleSet) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, "tr");
  const factory = rows.filter((r) => r.scope === "FACTORY").sort(byActive);
  const customer = rows.filter((r) => r.scope === "CUSTOMER").sort(byActive);
  const hasActiveFactory = factory.some((r) => r.isActive);
  return (
    <PageShell>
      <PageHeader
        title="4 Puan Kuralları"
        description="Muayene puanının (/100 m²) hangi aralıkta hangi kalite derecesine düştüğü. Değişiklik yalnız yeni muayeneleri etkiler."
        actions={
          <PermissionGate permission="inspection:rules">
            <div className="flex flex-wrap gap-2">
              {!hasActiveFactory && <Button onClick={() => setForm({ set: null, scope: "FACTORY" })}><Plus className="mr-1 h-4 w-4" />Fabrika varsayılanı</Button>}
              <Button variant={hasActiveFactory ? "default" : "outline"} onClick={() => setForm({ set: null, scope: "CUSTOMER" })}><Plus className="mr-1 h-4 w-4" />Müşteri spesifikasyonu</Button>
            </div>
          </PermissionGate>
        }
      />
      <PageBody className="space-y-6 p-4 sm:p-6">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Pasifleri de göster</label>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          : q.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Kural setleri yüklenemedi.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
            </div>
          ) : (
            <>
              <RuleSetSection title="Fabrika varsayılanı" hint="Topun kalite önerisi YALNIZ buradan gelir; aynı anda tek aktif set olur."
                empty="Fabrika varsayılanı yok — muayenede puan hesaplanır ama kalite derecesi önerilmez." sets={factory}
                onEdit={(set) => setForm({ set, scope: set.scope })} onToggle={setToggle} />
              <RuleSetSection title="Müşteri spesifikasyonları" hint="Sevk muayene özeti ve muayene raporunda uygulanır: müşteri + ürün → müşteri → fabrika varsayılanı."
                empty="Müşteriye özel kural yok; her yerde fabrika varsayılanı geçerli." sets={customer}
                onEdit={(set) => setForm({ set, scope: set.scope })} onToggle={setToggle} />
            </>
          )}
      </PageBody>
      {form && <RuleSetFormDialog set={form.set} scope={form.scope} onClose={() => setForm(null)} />}
      {toggle && (
        <ConfirmDialog
          open onOpenChange={(v) => !v && setToggle(null)}
          title={toggle.isActive ? `"${toggle.name}" pasife alınsın mı?` : `"${toggle.name}" etkinleştirilsin mi?`}
          description={toggle.isActive
            ? `Yeni muayeneler bu seti kullanmaz${toggle.scope === "FACTORY" ? " ve başka aktif fabrika seti yoksa derece önerilmez" : ""}. Kayıtlı muayeneler değişmez.`
            : "Aynı kapsamda başka aktif set varsa önce onu pasife almanız gerekir."}
          confirmLabel={toggle.isActive ? "Pasife al" : "Etkinleştir"} destructive={toggle.isActive}
          isPending={flip.isPending} onConfirm={() => flip.mutateAsync(toggle).then(() => undefined, () => undefined)}
        />
      )}
    </PageShell>
  );
}
