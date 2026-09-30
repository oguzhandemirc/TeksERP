import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FEATURE_FLAGS_QUERY_KEY, useFactoryTimezoneWarning } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import { apiErrorText } from "@/lib/api-error";
import { DEFAULT_FACTORY_TIMEZONE, fmtFactoryDateTime } from "@/lib/factory-time";
import { useFactoryTimezone } from "@/lib/factory-time-react";
import { FieldLabel } from "./SettingRow";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";

/** Tarayıcının bildiği IANA dilimleri (arama listesi); eski motorda en azından varsayılan + UTC. */
function zoneCatalog(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? [];
  return [...new Set([DEFAULT_FACTORY_TIMEZONE, "UTC", ...list])].sort((a, b) => a.localeCompare(b));
}

function errorCode(error: unknown): string | undefined {
  return (error as { response?: { data?: { details?: { code?: string } } } })?.response?.data?.details?.code;
}

/**
 * Fabrika saat dilimi — KURULUM DEĞERİ: fabrika günü ve bütün tarih/saat gösterimi buna bağlıdır.
 * Değiştirmek gün sınırlarını kaydırır; önce önizleme (etki) gösterilir, yazım yalnız `admin:settings` +
 * ayar şifresiyle ve önizlemedeki dilim hâlâ geçerliyse (`expectedCurrent`) yapılır.
 */
export function FactoryTimezoneField() {
  const qc = useQueryClient();
  const current = useFactoryTimezone();
  const canWrite = useRoleAccess().hasPermission(SETTINGS_ADMIN_PERMISSION);
  // Kayıtlı değer geçersizken yürürlükteki dilimi seçip kaydetmek de onu düzeltir.
  const invalidStored = useFactoryTimezoneWarning();
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

  const mut = useMutation({
    mutationFn: (p: { timeZone: string; expectedCurrent: string }) => featureFlagService.updateFactoryTimezone(p),
    onSuccess: (r) => {
      toast.success(`Fabrika saat dilimi ${r.data?.timeZone ?? ""} oldu.`);
      setPicked(null);
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
    // Hata metnini apiClient basar; burada yalnız eşzamanlı değişikliğe (409) göre ekranı tazele.
    onError: (e) => {
      if (errorCode(e) !== "FACTORY_TIMEZONE_CHANGED") return;
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void previewQ.refetch();
    },
  });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <FieldLabel
        htmlFor="factory-timezone-search"
        label="Saat dilimi"
        desc="Fabrika günü, raporların gün sınırları ve programdaki/belgelerdeki bütün tarih-saatler bu dilimden gösterilir — bilgisayarın saat diliminden değil."
      />
      <p className="text-sm">
        Geçerli: <b>{current}</b> · şu an {fmtFactoryDateTime(new Date())}
      </p>
      {invalidStored && (
        <p role="alert" className="flex items-center gap-1 text-sm font-medium text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /> {invalidStored.message}
        </p>
      )}
      {!canWrite ? (
        <p className="text-xs text-muted-foreground">Değiştirmek için “Ayarlar (yönetici)” yetkisi gerekir.</p>
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
                {picked === current ? `Geçersiz kayıt ${picked} ile düzeltilecek` : `Gün sınırları kayar: ${current} → ${picked}`}
              </p>
              {previewQ.isLoading && <p className="text-muted-foreground">Etki hesaplanıyor…</p>}
              {previewQ.isError && <p className="text-destructive">{apiErrorText(previewQ.error, "Önizleme alınamadı.")}</p>}
              {preview && (
                <>
                  <p>
                    Fark: {preview.currentOffset} → {preview.proposedOffset} · bugün {preview.todayCurrent} → {preview.todayProposed}
                  </p>
                  <p>
                    Son {preview.windowDays} günde günü değişecek kayıt: {preview.recentRollsShifted} top · {preview.recentShipmentsShifted} sevkiyat
                  </p>
                  {preview.warnings.length > 0 && (
                    <ul className="list-disc pl-5">
                      {preview.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
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
    </div>
  );
}
