// Makine kartı eylemleri. Kayıt ve sır yenileme BİLEREK `useMutation` değildir: mutasyon önbelleği dönen
// veriyi (sırrı) pencere kapandıktan sonra da tutardı. Sır yalnız `reveal` state'inde yaşar; kapanınca null.
// Kayıt `clientToken`ı deneme başınadır (`useAttemptToken`); replay sırrı YENİDEN VERMEZ → sır yenilemeye yönlendirilir.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import type { CollectorFormValues } from "./collector-model";
import { machineCollectorService } from "./service";
import type { MachineCollector } from "./types";

export const MACHINE_COLLECTORS_QUERY_ROOT = "machine-collectors";

export interface SecretReveal {
  collectorName: string;
  secret: string;
}

export function useCollectorActions() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<SecretReveal | null>(null);
  const attempt = useAttemptToken();
  const refresh = () => void qc.invalidateQueries({ queryKey: [MACHINE_COLLECTORS_QUERY_ROOT] });

  /** Hata apiClient toast'una düşer; burada yalnız sonuç (true = başarılı) döner. */
  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return {
    busy,
    reveal,
    closeReveal: () => setReveal(null),
    /** Yeni kayıt formu açıldı: yeni mantıksal deneme. */
    startCreate: () => attempt.renew(),
    /** `onWithheld`: replay — kart kayıtlı ama sır gösterilemez; çağıran sır yenileme onayını açar. */
    create: (v: CollectorFormValues, onWithheld?: (c: MachineCollector) => void) =>
      run(async () => {
        try {
          const r = await machineCollectorService.create({ ...v, clientToken: attempt.token() });
          attempt.onSuccess();
          if (r.secret === null) {
            toast.warning(`${r.collector.name} zaten kayıtlı — sır yalnız ilk kayıtta gösterilir. Kartı kurmak için sırrı yenileyin.`);
            onWithheld?.(r.collector);
            return;
          }
          setReveal({ collectorName: r.collector.name, secret: r.secret });
        } catch (e) {
          attempt.onFailure(e);
          throw e;
        }
      }),
    update: (c: MachineCollector, v: CollectorFormValues) =>
      run(async () => {
        await machineCollectorService.update(c.id, v);
        toast.success("Kart güncellendi");
      }),
    rotate: (c: MachineCollector) =>
      run(async () => {
        const r = await machineCollectorService.rotateSecret(c.id);
        setReveal({ collectorName: r.collector.name, secret: r.secret });
      }),
    revoke: (c: MachineCollector) =>
      run(async () => {
        await machineCollectorService.revoke(c.id);
        toast.success(`${c.name} iptal edildi`);
      }),
  };
}
