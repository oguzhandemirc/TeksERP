// Makine kartı eylemleri. Kayıt ve sır yenileme BİLEREK `useMutation` değildir: mutasyon önbelleği dönen
// veriyi (sırrı) pencere kapandıktan sonra da tutardı. Sır yalnız `reveal` state'inde yaşar; kapanınca null.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
    create: (v: CollectorFormValues) =>
      run(async () => {
        const r = await machineCollectorService.create(v);
        setReveal({ collectorName: r.collector.name, secret: r.secret });
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
