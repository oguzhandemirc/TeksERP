import { useQuery } from "@tanstack/react-query";
import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { featureFlagService } from "@/services/featureFlagService";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";

/**
 * "Son Kullanılan Parti No: P47" — planlamacıya fikir veren rozet (2026-08-17).
 *
 * ⚠️ SON KULLANILANI yazar, SIRADAKİNİ DEĞİL. Numara parti doğduğu anda
 * atanıyor; aradaki her yeni parti sırayı kaydırır. "Sıradaki P48" yazmak
 * tutulamayacak bir söz olurdu — bu yüzden metin bilinçli olarak bir GÖZLEM
 * bildirir, tahmin değil. Ayrıca fabrikadaki numaralı fiziksel parti
 * plakalarıyla karşılaştırılabilecek tek yüzey budur.
 *
 * Üç durumda hiç çizilmez: rozet ayarı kapalı · kısa numara rejimi kapalı
 * (o rejimde "son numara" kavramı yok) · henüz hiç kısa parti doğmamış.
 */
export function LastBatchBadge({ className }: { className?: string }) {
  const flagsQ = useFeatureFlags();
  const hintEnabled = flagsQ.data?.data?.batchLastNumberHintEnabled !== false;
  const q = useQuery({
    queryKey: ["batch-number-state"],
    queryFn: featureFlagService.getBatchNumberState,
    staleTime: 30_000,
    // Ayar kapalıysa uca hiç gitme — gereksiz istek, boş rozet.
    enabled: hintEnabled,
  });

  if (!hintEnabled) return null;
  const s = q.data?.data;
  if (!s?.enabled || !s.lastCode) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10",
        "px-2 py-0.5 text-[11px] font-semibold text-primary",
        className,
      )}
      title="Son verilmiş parti numarası. Sıradaki numarayı garanti etmez."
    >
      <Hash className="h-3 w-3" />
      Son Kullanılan Parti No: <span className="font-mono">{s.lastCode}</span>
    </span>
  );
}
