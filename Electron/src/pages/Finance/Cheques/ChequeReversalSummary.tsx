// Storno onayının somut bandı — terslenecek ileri olay detay ucundan okunur;
// okunamazsa bunu da SÖYLER, kesin cevap sunucunundur (backend fail-closed).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCheque, type ChequeEventType, type ChequeRow } from "./service";
import { latestEventOfType, reversalSummary } from "./reversal";

interface Props {
  row: ChequeRow;
  reverses: ChequeEventType;
  open: boolean;
}

export function ChequeReversalSummary({ row, reverses, open }: Props) {
  const detailQ = useQuery({
    queryKey: ["finance", "cheque", row.id],
    queryFn: () => getCheque(row.id),
    enabled: open,
  });
  const text = useMemo(
    () => reversalSummary(reverses, latestEventOfType(detailQ.data?.events ?? [], reverses), row),
    [detailQ.data, reverses, row],
  );

  return (
    <div className="rounded-md border px-3 py-2 text-xs">
      {detailQ.isLoading ? (
        <span className="text-muted-foreground">Olay kaydı okunuyor…</span>
      ) : text ? (
        <span>{text}</span>
      ) : (
        <span className="text-amber-700 dark:text-amber-500">
          Geri alınacak olayın kaydı buradan okunamadı — işlem denenirse sunucu kesin cevabı verir (kayıt
          eksikse stornoyu reddeder ve sebebini söyler).
        </span>
      )}
    </div>
  );
}
