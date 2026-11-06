// Yazım + kaldırma. Token MANTIKSAL DENEME başına: hücre + fiyat + yürürlük aynı kaldıkça (belirsiz hatada
// yeniden denemede) aynı token gider; kesin 4xx'te ya da başarıda yenilenir (`attemptToken` tek kaynak).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAttemptToken } from "@/lib/attemptToken";
import { revokeServicePrice, writeServicePrice, type Currency, type PriceUnit } from "./service";
import { validFromPayload } from "./servicePrices";

export interface WriteArgs {
  itemId: string;
  propertyValueId: string | null;
  customerId: string | null;
  currency: Currency;
  price: number;
  priceUnit?: PriceUnit | null;
  /** Fabrika gün anahtarı; null = hemen. */
  validFromDay: string | null;
}

export const SERVICE_PRICES_KEY = ["service-prices"] as const;

export function useServicePriceMutations() {
  const qc = useQueryClient();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Bir deneme = bir hücre + fiyat + yürürlük (`keyed`); başarı ya da kesin 4xx denemeyi yeniler.
  const attempt = useAttemptToken();
  const keyOf = (a: WriteArgs) =>
    [a.itemId, a.propertyValueId, a.customerId, a.currency, a.price, a.validFromDay].join("|");

  const write = useMutation({
    mutationFn: async (a: WriteArgs) => {
      try {
        const res = await writeServicePrice({
          clientToken: attempt.keyed(keyOf(a)),
          itemId: a.itemId,
          propertyValueId: a.propertyValueId,
          customerId: a.customerId,
          currency: a.currency,
          price: a.price,
          priceUnit: a.priceUnit ?? null,
          validFrom: validFromPayload(a.validFromDay),
        });
        attempt.onSuccess();
        return res;
      } catch (e) {
        attempt.onFailure(e);
        throw e;
      }
    },
    onSuccess: (res) => {
      if (res.message) toast.success(res.message);
      void qc.invalidateQueries({ queryKey: SERVICE_PRICES_KEY });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeServicePrice(id),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fiyat kaldırıldı.");
      void qc.invalidateQueries({ queryKey: SERVICE_PRICES_KEY });
    },
  });

  /** Hücreden çağrılır: true = kaydedildi (hücre kapanır). Hata toast'ı `apiClient`te — burada ikinci toast yok. */
  const save = async (cell: string, a: WriteArgs): Promise<boolean> => {
    setSavingKey(cell);
    try {
      await write.mutateAsync(a);
      return true;
    } catch {
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  return { save, savingKey, revoke };
}
