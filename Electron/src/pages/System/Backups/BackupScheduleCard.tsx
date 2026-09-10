import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { featureFlagService } from "@/services/featureFlagService";
import { useBackupHour, FEATURE_FLAGS_QUERY_KEY } from "@/hooks/usePricingEnabled";
import { useBackups } from "./hooks";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function label(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/**
 * Otomatik gece yedeğinin saati (SystemSetting `backup.hour`).
 *
 * Sunucu yeniden başlatılmasını GEREKTİRMEZ: zamanlayıcı hedef saati her kontrol
 * turunda (15 dk) DB'den okur. Bu yüzden değişiklik "en geç 15 dakika içinde"
 * geçerli olur — kullanıcıya da böyle söylenir (yanlış beklenti kurmayalım).
 *
 * ⚠️ ZAMANLAYICI KAPALIYSA BU KUMANDA ÖLÜDÜR (O-1, sahada ölçüldü 2026-09-05).
 * `BACKUP_SCHEDULE_ENABLED=false` olan kurulumlarda gece yedeğini harici bir
 * görev (Windows Görev Zamanlayıcı) alır — bilinçli bir tercih: backend
 * çökmüşken de yedek alınsın. O kurulumda saati değiştirmek `backup.hour`
 * satırını yazar ama HİÇBİR ŞEY yapmaz; panel bir saat gösterir, sistem başka
 * saatte yedek alır ve ikisinin ilgisi yoktur. Operatör bunu ancak dışarıdan
 * ölçerek anlayabilirdi.
 *
 * Kumanda GİZLENMEZ, DEVRE DIŞI bırakılır ve sebebi yazılır: gizlemek
 * "böyle bir ayar yok" derdi, oysa ayar var ve başka bir yerden yönetiliyor.
 */
export function BackupScheduleCard() {
  const hour = useBackupHour();
  const qc = useQueryClient();
  // Alan eski sunucuda YOK → `undefined`; o zaman bugünkü davranış (açık).
  const schedulerEnabled = useBackups().data?.scheduleEnabled !== false;

  const mutation = useMutation({
    mutationFn: (backupHour: number) => featureFlagService.update({ backupHour }),
    onSuccess: (_res, backupHour) => {
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      toast.success(
        `Otomatik yedek saati ${label(backupHour)} olarak kaydedildi. ` +
          `En geç 15 dakika içinde geçerli olur.`,
      );
    },
    // Hata toast'ı apiClient interceptor'ından gelir — burada tekrar etmiyoruz.
  });

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Otomatik yedek saati</p>
          {schedulerEnabled ? (
            <p className="text-xs text-muted-foreground">
              Her gün bu saatte tam yedek alınır (<b>sunucunun</b> yerel saati). Sunucu o
              saatte kapalıysa açıldığında telafi edilir.
            </p>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-500">
              Bu sunucuda gece yedeğini <b>harici bir zamanlanmış görev</b> alıyor — backend
              kapalıyken de yedek alınsın diye böyle kurulmuş. <b>Saat buradan değişmez;</b>
              gerçek saat sunucudaki görevden ayarlanır.
            </p>
          )}
        </div>
        <PermissionGate
          permission="admin:settings"
          fallback={<span className="text-sm tabular-nums">{label(hour)}</span>}
        >
          <Select
            value={String(hour)}
            onValueChange={(v) => mutation.mutate(Number(v))}
            disabled={mutation.isPending || !schedulerEnabled}
          >
            <SelectTrigger className="h-9 w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {label(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PermissionGate>
      </CardContent>
    </Card>
  );
}
