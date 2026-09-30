import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FEATURE_FLAGS_QUERY_KEY, useFactoryTimezonePending, useFactoryTimezoneWarning } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FactoryTimezonePreview } from "@/services/featureFlagService";
import { apiErrorText } from "@/lib/api-error";
import { DEFAULT_FACTORY_TIMEZONE, fmtDayKey, fmtFactoryDateTime } from "@/lib/factory-time";
import { useFactoryTimezone } from "@/lib/factory-time-react";
import { FieldLabel } from "./SettingRow";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";
import { FACTORY_TIMEZONE_PERIODS_QUERY_KEY, FactoryTimezonePendingBox } from "./FactoryTimezonePending";
import { FactoryTimezoneHistory } from "./FactoryTimezoneHistory";

/** Tarayıcının bildiği IANA dilimleri (arama listesi); eski motorda en azından varsayılan + UTC. */
function zoneCatalog(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? [];
  return [...new Set([DEFAULT_FACTORY_TIMEZONE, "UTC", ...list])].sort((a, b) => a.localeCompare(b));
}

function PreviewDetails({ preview }: { preview: FactoryTimezonePreview }) {
  return (
    <>
      {preview.effectiveFrom && (
        <p>
          Yürürlük: <b>{preview.effectiveFromProposedLocal}</b> ({preview.proposed}) = {preview.effectiveFromCurrentLocal} ({preview.current}) ·
          fark {preview.currentOffset} → {preview.proposedOffset}
        </p>
      )}
      {preview.transitionDays.some((d) => d.hours !== 24) && (
        <p>
          Geçiş günü:{" "}
          {preview.transitionDays.filter((d) => d.hours !== 24).map((d) => `${fmtDayKey(d.day)} ${d.hours} saat`).join(" · ")}
        </p>
      )}
      {preview.warnings.length > 0 && (
        <ul className="list-disc pl-5">
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Fabrika saat dilimi — TARİHLİ DÖNEMLER: bir değişiklik yeni dilimin bir sonraki gün başından geçerli olur,
 * geçmiş kayıtların saati/günü değişmez. Önce önizleme (yürürlük anı iki dilimde, geçiş günü) gösterilir; yazım
 * yalnız `admin:settings` + ayar şifresiyle ve önizlemedeki dilim hâlâ geçerliyse (`expectedCurrent`). Bekleyen
 * değişiklik başlamadan iptal edilebilir (ters kayıt).
 */
export function FactoryTimezoneField() {
  const qc = useQueryClient();
  const current = useFactoryTimezone();
  const canWrite = useRoleAccess().hasPermission(SETTINGS_ADMIN_PERMISSION);
  // Kayıtlı değer geçersizken yürürlükteki dilimi seçip kaydetmek de onu düzeltir.
  const invalidStored = useFactoryTimezoneWarning();
  const pending = useFactoryTimezonePending();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const zones = useMemo(zoneCatalog, []);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones).slice(0, 200);
  }, [zones, search]);

  const previewQ = useQuery({
    queryKey: ["factory-timezone-preview", picked],
    queryFn: () => featureFlagService.previewFactoryTimezone(picked ?? ""),
    enabled: canWrite && picked !== null && (picked !== current || invalidStored !== null),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: FACTORY_TIMEZONE_PERIODS_QUERY_KEY });
  };
  const mut = useMutation({
    mutationFn: (p: { timeZone: string; expectedCurrent: string }) => featureFlagService.updateFactoryTimezone(p),
    onSuccess: (r) => {
      const at = r.data?.effectiveFrom;
      toast.success(at ? `${r.data?.timeZone ?? ""} ${fmtFactoryDateTime(at)} itibarıyla geçerli olacak.` : "Değişiklik yok.");
      setPicked(null);
      refresh();
    },
    // Hata metnini apiClient basar; burada yalnız eşzamanlı değişikliğe (409) göre ekranı tazele.
    onError: () => {
      refresh();
      void previewQ.refetch();
    },
  });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <FieldLabel
        htmlFor="factory-timezone-search"
        label="Saat dilimi"
        desc="Fabrika günü, raporların gün sınırları ve programdaki/belgelerdeki tarih-saatler bu dilimden gösterilir — bilgisayarın saat diliminden değil. Değişiklik ertesi gün başından geçerli olur; geçmiş kayıtlar kaydedildikleri andaki dilimle kalır."
      />
      <p className="text-sm">
        Şu anki dilim: <b>{current}</b> · şu an {fmtFactoryDateTime(new Date())}
      </p>
      {invalidStored && (
        <p role="alert" className="flex items-center gap-1 text-sm font-medium text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /> {invalidStored.message}
        </p>
      )}
      {pending && <FactoryTimezonePendingBox pending={pending} canWrite={canWrite} />}
      {!canWrite ? (
        <p className="text-xs text-muted-foreground">Değiştirmek için “Ayarlar (yönetici)” yetkisi gerekir.</p>
      ) : pending ? (
        <p className="text-xs text-muted-foreground">Yeni bir değişiklik için önce bekleyen değişikliği iptal edin.</p>
      ) : (
        <>
          <input
            id="factory-timezone-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Dilim ara (örn. Istanbul, Berlin, New_York)"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          />
          <ul className="max-h-40 overflow-y-auto rounded-md border text-sm" role="listbox" aria-label="Saat dilimleri">
            {shown.map((z) => (
              <li key={z}>
                <button
                  type="button"
                  role="option"
                  aria-selected={z === (picked ?? current)}
                  onClick={() => setPicked(z === current && !invalidStored ? null : z)}
                  className={`w-full px-3 py-1 text-left hover:bg-muted ${z === (picked ?? current) ? "bg-muted font-medium" : ""}`}
                >
                  {z}
                  {z === current ? " (geçerli)" : ""}
                </button>
              </li>
            ))}
          </ul>
          {picked && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="flex items-center gap-1 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600" />{" "}
                {picked === current ? `Geçersiz kayıt ${picked} ile düzeltilecek` : `Yeni dilim: ${current} → ${picked} (geçmiş kayıtlar değişmez)`}
              </p>
              {previewQ.isLoading && <p className="text-muted-foreground">Etki hesaplanıyor…</p>}
              {previewQ.isError && <p className="text-destructive">{apiErrorText(previewQ.error, "Önizleme alınamadı.")}</p>}
              {preview && <PreviewDetails preview={preview} />}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!preview?.changed || mut.isPending}
                  onClick={() => preview && mut.mutate({ timeZone: preview.proposed, expectedCurrent: preview.current })}
                >
                  Saat dilimini değiştir
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(null)}>
                  Vazgeç
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <FactoryTimezoneHistory canWrite={canWrite} />
    </div>
  );
}
