// =============================================================================
// RAPOR GÖRÜNÜRLÜĞÜ — süperadmin yüzeyi (Raporlar K6)
// =============================================================================
// Modüller ekranının "Raporlar" bölümü: katalogdaki her rapor bir satır, kategori
// başlıkları altında; anahtar tek listedir (`reports.closedKeys` → `reportsClosedKeys`),
// modül anahtarı DEĞİL (K2). Yazma süperadmin (`canWrite`), fabrika yöneticisi görür
// ama değiştiremez — modül kalıbıyla aynı yüklem. Modülü kapalı raporun satırı kilitli:
// rapor zaten çizilmiyor, "açık" göstermek yalan olurdu; modül açılınca satır çözülür.
//
// Liste OKUNAMADI (`null`): panel fail-closed, hiçbir rapor çizilmiyor — bu bölüm onu
// açıkça söyler ve süperadmine tek onarım yolu verir (listeyi boş yaz = hepsi açık).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { MODULE_LABELS, type ModuleFlagKey } from "@/lib/module-flags";
import { REPORT_CATALOG, type ReportCatalogEntry } from "@/lib/report-catalog";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { FlagToggle } from "@/pages/GeneralSettings/SettingRow";
import { reportCategoryTitle } from "@/pages/Reports/tile-config";
import { featureFlagService } from "@/services/featureFlagService";

const SINIF_ETIKETI: Record<ReportCatalogEntry["sinif"], string> = { basit: "Basit", gelismis: "Gelişmiş" };

/** Katalog `modul`ü bir modül anahtarıysa onu döner; çekirdek/planlanan satırlar modüle bağlı değildir. */
export function reportModuleFlag(modul: string): ModuleFlagKey | null {
  return modul in MODULE_LABELS ? (modul as ModuleFlagKey) : null;
}

/** Raporun modülü bu kurulumda kapalı mı — ctx ETKİN değerleri okur (dokuma = production && dokuma). */
export function isReportModuleClosed(entry: ReportCatalogEntry, ctx: OperationsVisibilityContext): boolean {
  const flag = reportModuleFlag(entry.modul);
  if (flag === null) return false;
  // ctx yalnız yüzeyi olan modülleri taşır; taşımadığı anahtar (kumaş teknik, tezgah) kapatmaz.
  const value = (ctx as Partial<Record<ModuleFlagKey, boolean>>)[flag];
  return value === false;
}

/** Kategori sırası katalogdaki ilk görünüm sırasıdır (elle liste yok). */
export function reportCategories(): string[] {
  const seen: string[] = [];
  for (const r of REPORT_CATALOG) {
    const cat = r.key.split("/")[0]!;
    if (!seen.includes(cat)) seen.push(cat);
  }
  return seen;
}

export function ReportVisibilitySection({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const ctx = useOperationsVisibilityContext();
  const closed: readonly string[] | null | undefined = flagsQ.data?.data?.reportsClosedKeys;

  const writeMut = useMutation({
    mutationFn: (next: string[]) => featureFlagService.update({ reportsClosedKeys: next }),
    onSuccess: () => {
      toast.success("Rapor görünürlüğü kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
    // Hata toast'ı apiClient interceptor'dan (çift toast yok).
  });

  const setOpen = (key: string, open: boolean) => {
    if (!closed) return;
    const next = new Set(closed);
    if (open) next.delete(key);
    else next.add(key);
    writeMut.mutate([...next].sort());
  };

  if (flagsQ.isLoading) return <Skeleton className="h-24 w-full" data-testid="rapor-gorunurluk-yukleniyor" />;

  if (closed === null || closed === undefined) {
    return (
      <Callout tone="warning" title="Rapor listesi okunamadı">
        Kapalı rapor listesi sunucudan okunamadı; panel bu durumda <strong>hiçbir raporu çizmez</strong>{" "}
        (yanlışlıkla kapalı bir raporu göstermek yerine). Liste onarılınca satırlar gelir.
        {canWrite ? (
          <div className="mt-2">
            <Button size="sm" variant="outline" disabled={writeMut.isPending} onClick={() => writeMut.mutate([])}>
              Listeyi sıfırla (hepsini aç)
            </Button>
          </div>
        ) : null}
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      {reportCategories().map((cat) => (
        <div key={cat} className="rounded-md border p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {reportCategoryTitle[cat] ?? cat}
          </p>
          <div className="space-y-3">
            {REPORT_CATALOG.filter((r) => r.key.startsWith(`${cat}/`)).map((r) => {
              const moduleClosed = isReportModuleClosed(r, ctx);
              const moduleFlag = reportModuleFlag(r.modul);
              const isOpen = !closed.includes(r.key);
              return (
                <div key={r.key} data-testid={`rapor-satir:${r.key}`} className="space-y-1">
                  <FlagToggle
                    title={r.baslik}
                    desc={r.soru}
                    hint="inline"
                    checked={isOpen}
                    disabled={!canWrite || moduleClosed || writeMut.isPending}
                    onChange={(next) => setOpen(r.key, next)}
                  />
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant={r.sinif === "gelismis" ? "secondary" : "muted"}>{SINIF_ETIKETI[r.sinif]}</Badge>
                    <code>{r.key}</code>
                  </div>
                  {moduleClosed ? (
                    <p
                      data-testid={`rapor-kilit:${r.key}`}
                      className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      <Lock className="h-3 w-3" />
                      Modül kapalı ({moduleFlag ? MODULE_LABELS[moduleFlag] : r.modul}) — bu rapor zaten çizilmiyor; modül
                      açılınca bu satır düzenlenebilir.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
