import { useQuery } from "@tanstack/react-query";
import { featureFlagService, type FactoryTimezonePeriodStatus } from "@/services/featureFlagService";
import { fmtFactoryDateTime, getFactoryBaseTimezone, getFactoryTimezonePeriods } from "@/lib/factory-time";
import { FACTORY_TIMEZONE_PERIODS_QUERY_KEY, wallIn } from "./FactoryTimezonePending";

const STATUS_LABEL: Record<FactoryTimezonePeriodStatus, string> = {
  YURURLUKTE: "Yürürlükte",
  BEKLIYOR: "Bekliyor",
  GECMIS: "Geçmiş",
  IPTAL_EDILDI: "İptal edildi",
  IPTAL_KAYDI: "İptal kaydı",
  ETKISIZ: "Etkisiz",
};

/**
 * Saat dilimi dönem geçmişi. Yönetici defterin tamamını görür (kim, ne zaman, iptaller dahil); diğerleri yalnız
 * etkin dönemleri (ayar yanıtından). Başlangıç anı o dönemin kendi diliminde basılır.
 */
export function FactoryTimezoneHistory({ canWrite }: { canWrite: boolean }) {
  const q = useQuery({
    queryKey: FACTORY_TIMEZONE_PERIODS_QUERY_KEY,
    queryFn: () => featureFlagService.listFactoryTimezonePeriods(),
    enabled: canWrite,
  });
  const rows = canWrite ? (q.data?.data ?? []) : [];
  const effective = getFactoryTimezonePeriods();
  if (canWrite ? rows.length === 0 : effective.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Dönem geçmişi boş: bütün kayıtlar {getFactoryBaseTimezone()} saatiyle kaydedildi.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" aria-label="Saat dilimi dönem geçmişi">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-2">Geçerlilik başlangıcı</th>
            <th className="py-1 pr-2">Dilim</th>
            {canWrite && <th className="py-1 pr-2">Durum</th>}
            {canWrite && <th className="py-1 pr-2">Kaydeden</th>}
            {canWrite && <th className="py-1 pr-2">Kayıt zamanı</th>}
            {canWrite && <th className="py-1">Not</th>}
          </tr>
        </thead>
        <tbody>
          {canWrite
            ? rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1 pr-2">{wallIn(r.validFrom, r.valid ? r.timeZone : getFactoryBaseTimezone())}</td>
                  <td className="py-1 pr-2">{r.timeZone}{r.valid ? "" : " (geçersiz)"}</td>
                  <td className="py-1 pr-2">{STATUS_LABEL[r.status]}</td>
                  <td className="py-1 pr-2">{r.createdBy?.fullName ?? "—"}</td>
                  <td className="py-1 pr-2">{fmtFactoryDateTime(r.createdAt)}</td>
                  <td className="py-1">{r.reason ?? ""}</td>
                </tr>
              ))
            : [...effective].reverse().map((p) => (
                <tr key={p.validFrom} className="border-t">
                  <td className="py-1 pr-2">{wallIn(p.validFrom, p.timeZone)}</td>
                  <td className="py-1 pr-2">{p.timeZone}</td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
