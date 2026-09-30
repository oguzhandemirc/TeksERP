import { AlertTriangle } from "lucide-react";
import { useFactoryTimezoneWarning } from "@/hooks/usePricingEnabled";

/**
 * Kayıtlı fabrika saat dilimi geçersiz: sunucu varsayılan dilimle açıldı ve gün sınırları o dilimden.
 * Metin sunucunundur (`FACTORY_TIMEZONE_INVALID_STORED`); düzeltme Şirket Bilgileri → Saat dilimi.
 * Şerit, modal değil (`LicenseBanner` kalıbı); uyarı yoksa hiç çizilmez.
 */
export function FactoryTimezoneBanner() {
  const warning = useFactoryTimezoneWarning();
  if (!warning) return null;
  return (
    <div
      role="status"
      data-testid="saat-dilimi-bandi"
      className="flex shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-foreground"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{warning.message}</span>
    </div>
  );
}
