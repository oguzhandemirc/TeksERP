// Sürümler: saklanan (donmuş) sayılar; aktif sürümün satır dökümü detay yanıtından. "Bu sürümden geri yükle"
// YENİ sürüm yazar (eski girdinin fotoğrafıyla), hiçbir eski satırı değiştirmez.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { CostBreakdown } from "../shared/CostBreakdown";
import type { CostVersion } from "../shared/cost-types";
import { fmtDec } from "../shared/format";
import { presentationAmount } from "../shared/PresentationNote";
import { costItemService } from "./service";

/** Sunum alanlarını yalnız varsa taşır (ayar TRY iken nesne bugünkü gibi kalır). */
function presentationOf(v: CostVersion) {
  const { sunumDovizi, sunumKuru, sunumKuruKaynagi, sunumUyarisi, standartDovizM } = v;
  return sunumDovizi ? { sunumDovizi, sunumKuru, sunumKuruKaynagi, sunumUyarisi, standartDovizM } : {};
}

export function VersionsTab({ itemId, active }: { itemId: string; active: CostVersion | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-items", "versions", itemId], queryFn: () => costItemService.versions(itemId) });
  const [restoreOf, setRestoreOf] = useState<CostVersion | null>(null);
  const restore = useMutation({
    mutationFn: (v: CostVersion) => costItemService.restore(itemId, v.id, `v${v.surumNo} geri yüklendi`),
    onSuccess: (r) => { toast.success(r.message ?? "Yeni sürüm yazıldı."); void qc.invalidateQueries({ queryKey: ["cost-items"] }); setRestoreOf(null); },
  });
  const rows = q.data ?? [];
  if (!q.isLoading && rows.length === 0) {
    return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Henüz standart maliyet kaydı yok — Döküm sekmesinden "Standart olarak kaydet".</p>;
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-2 text-sm">
        {rows.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <span>
              <span className="font-medium">v{v.surumNo}</span>{" "}
              {v.durum === "ACTIVE" ? <Badge>Aktif</Badge> : <Badge variant="muted">Geçersiz</Badge>}{" "}
              <span className="tabular-nums">{fmtDec(v.standartTlM)} TL/m</span>
              {v.sunumDovizi && <span className="tabular-nums text-muted-foreground"> · {presentationAmount(v, v.standartDovizM)}</span>}
              <span className="text-muted-foreground"> · {fmtFactoryDateTime(v.hesaplananAt)}{v.gerekce ? ` · ${v.gerekce}` : ""}</span>
            </span>
            {v.durum !== "ACTIVE" && (
              <PermissionGate permission="cost:write">
                <Button size="sm" variant="outline" onClick={() => setRestoreOf(v)}>Bu sürümden geri yükle</Button>
              </PermissionGate>
            )}
          </li>
        ))}
      </ul>
      {active?.satirlar && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Aktif sürüm v{active.surumNo} — kayıttaki döküm (donmuş)</h3>
          <CostBreakdown
            sonuc={{ satirlar: active.satirlar, cozguKgM: active.cozguKgM, atkiKgM: active.atkiKgM, tezgahMSaat: active.tezgahMSaat, hamTlM: active.hamTlM, mamulTlM: active.mamulTlM, saglamTlM: null, genelGiderTlM: null, standartTlM: active.standartTlM, ...presentationOf(active) }}
            eksikler={[]}
            uyarilar={active.uyarilar}
          />
        </section>
      )}
      <ConfirmDialog
        open={!!restoreOf}
        onOpenChange={(o) => !o && setRestoreOf(null)}
        title={`v${restoreOf?.surumNo ?? ""} geri yüklensin mi?`}
        description={`v${restoreOf?.surumNo ?? ""} kaydındaki girdiyle YENİ bir sürüm yazılır ve aktif olur; mevcut aktif sürüm geçersiz olur ama silinmez, hiçbir eski kayıt değişmez.`}
        confirmLabel="Geri yükle"
        isPending={restore.isPending}
        onConfirm={() => { if (restoreOf) restore.mutate(restoreOf); }}
      />
    </div>
  );
}
