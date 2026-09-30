import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FactoryTimezonePending } from "@/services/featureFlagService";
import { formatFactory } from "@/lib/factory-time";

export const FACTORY_TIMEZONE_PERIODS_QUERY_KEY = ["factory-timezone-periods"] as const;

/** Yürürlük anının bir dilimdeki duvar saati (`dd.MM.yyyy HH:mm`). */
export const wallIn = (iso: string, timeZone: string): string => formatFactory(iso, "dd.MM.yyyy HH:mm", "—", timeZone);

/**
 * Bekleyen (henüz başlamamış) saat dilimi değişikliği. İptal SİLME değildir: sunucu aynı anda önceki dilimle ters
 * kayıt yazar ve dönem geçmişinde ikisi de görünür. Yürürlüğe girmiş değişiklik iptal edilemez (geçmiş değişmez).
 */
export function FactoryTimezonePendingBox({ pending, canWrite }: { pending: FactoryTimezonePending; canWrite: boolean }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => featureFlagService.cancelFactoryTimezoneChange({ periodId: pending.id }),
    onSuccess: () => {
      toast.success(`Saat dilimi değişikliği iptal edildi; ${pending.previousTimeZone} sürüyor.`);
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: FACTORY_TIMEZONE_PERIODS_QUERY_KEY });
    },
    // Hata metnini apiClient basar; bu arada yürürlüğe girmiş/iptal edilmişse ekranı tazele.
    onError: () => {
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: FACTORY_TIMEZONE_PERIODS_QUERY_KEY });
    },
  });
  return (
    <div role="status" aria-label="Bekleyen saat dilimi değişikliği" className="space-y-1 rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
      <p className="flex items-center gap-1 font-medium">
        <CalendarClock className="h-4 w-4 text-sky-600" /> Bekleyen değişiklik: {pending.previousTimeZone} → {pending.timeZone}
      </p>
      <p>
        {wallIn(pending.validFrom, pending.timeZone)} ({pending.timeZone}) = {wallIn(pending.validFrom, pending.previousTimeZone)} (
        {pending.previousTimeZone}) itibarıyla geçerli olacak. Geçmiş kayıtlar değişmez.
      </p>
      {canWrite && (
        <Button type="button" size="sm" variant="outline" disabled={mut.isPending} onClick={() => mut.mutate()}>
          Değişikliği iptal et
        </Button>
      )}
    </div>
  );
}
