import { Badge } from "@/components/ui/badge";
import { StatusBadge, type Tone } from "@/components/operations/StatusBadge";
import { eIrsaliyeStatusLabels, type EIrsaliyeStatus } from "@/types/enums";

export const eIrsaliyeStatusTones: Record<EIrsaliyeStatus, Tone> = {
  TASLAK: "neutral",
  OLUSTURULDU: "info",
  GONDERILDI: "progress",
  KABUL: "success",
  KISMI_KABUL: "warning",
  REDDEDILDI: "danger",
  HATA: "danger",
  IPTAL: "muted",
};

/** Durum rozeti; kayıt yoksa "Hazırlanmadı". Simülasyon kaydı ayrıca kırmızı işaret taşır. */
export function EIrsaliyeStatusBadge({
  status,
  simulasyon = false,
  className,
}: {
  status: EIrsaliyeStatus | string | null | undefined;
  simulasyon?: boolean;
  className?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {status ? (
        <StatusBadge status={status} labels={eIrsaliyeStatusLabels} tones={eIrsaliyeStatusTones} className={className} />
      ) : (
        <StatusBadge status="NONE" labels={{ NONE: "Hazırlanmadı" }} defaultTone="muted" className={className} />
      )}
      {simulasyon && (
        <Badge variant="destructive" className="px-1 py-0 text-[10px]" title="Simülasyon kaydı — GİB'e gönderilmez">
          Simülasyon
        </Badge>
      )}
    </span>
  );
}
