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
import { type CostVariant, VariantScopeChoice } from "./variant-scope";

/** Sunum alanlarını yalnız varsa taşır (ayar TRY iken nesne bugünkü gibi kalır). */
function presentationOf(v: CostVersion) {
  const { sunumDovizi, sunumKuru, sunumKuruKaynagi, sunumUyarisi, standartDovizM } = v;
  return sunumDovizi ? { sunumDovizi, sunumKuru, sunumKuruKaynagi, sunumUyarisi, standartDovizM } : {};
}

interface Props { itemId: string; active: CostVersion | null; variants?: CostVariant[] }

export function VersionsTab({ itemId, active, variants = [] }: Props) {
  const qc = useQueryClient();
  // Varsayılan görünüm desen geneli (sorgu anahtarı ve istek bugünkü gibi); varyant seçilince ?recipeId= zinciri.
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: recipeId ? ["cost-items", "versions", itemId, recipeId] : ["cost-items", "versions", itemId],
    queryFn: () => costItemService.versions(itemId, recipeId),
  });
  // Desen genelinde aktif döküm detay yanıtından; varyantta ACTIVE satırın kaydı ayrıca okunur (liste döküm taşımaz).
  const variantActiveId = recipeId ? (q.data ?? []).find((v) => v.durum === "ACTIVE")?.id ?? null : null;
  const variantActive = useQuery({
    queryKey: ["cost-items", "versions", itemId, "one", variantActiveId],
    queryFn: () => costItemService.version(itemId, variantActiveId!),
    enabled: !!variantActiveId,
  });
  const shownActive = recipeId ? (variantActive.data ?? null) : active;
  const [restoreOf, setRestoreOf] = useState<CostVersion | null>(null);
  const restore = useMutation({
    mutationFn: (v: CostVersion) => costItemService.restore(itemId, v.id, `v${v.surumNo} geri yüklendi`),
    onSuccess: (r) => { toast.success(r.message ?? "Yeni sürüm yazıldı."); void qc.invalidateQueries({ queryKey: ["cost-items"] }); setRestoreOf(null); },
  });
  const rows = q.data ?? [];
  const scope = <VariantScopeChoice variants={variants} value={recipeId} onChange={setRecipeId} label="Sürüm geçmişi" />;
  if (!q.isLoading && rows.length === 0) {
    const empty = <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Henüz standart maliyet kaydı yok — Döküm sekmesinden "Standart olarak kaydet".</p>;
    return variants.length === 0 ? empty : <div className="space-y-4">{scope}{empty}</div>;
  }
  return (
    <div className="space-y-4">
      {scope}
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
      {shownActive?.satirlar && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Aktif sürüm v{shownActive.surumNo} — kayıttaki döküm (donmuş)</h3>
          <CostBreakdown
            sonuc={{ satirlar: shownActive.satirlar, cozguKgM: shownActive.cozguKgM, atkiKgM: shownActive.atkiKgM, tezgahMSaat: shownActive.tezgahMSaat, hamTlM: shownActive.hamTlM, mamulTlM: shownActive.mamulTlM, saglamTlM: null, genelGiderTlM: null, standartTlM: shownActive.standartTlM, ...presentationOf(shownActive) }}
            eksikler={[]}
            uyarilar={shownActive.uyarilar}
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
