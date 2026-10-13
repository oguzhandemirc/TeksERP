import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";

/**
 * "Tümünü indir"de büyük liste onayı (Perf-2 B4): `drainCursor` toplam tahmini
 * EXPORT_CONFIRM_ROWS'u aşınca `confirmTotal` söz döner; kullanıcı diyalogda karar verir.
 * Diyalog çağıranın ağacında çizilir (`confirmDialog`); window.confirm kullanılmaz.
 */
export function useExportConfirm(): {
  confirmTotal: (total: number) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [total, setTotal] = useState<number | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setTotal(null);
  }, []);

  const confirmTotal = useCallback((n: number) => {
    resolver.current?.(false); // önceki bekleyen soru varsa red say
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setTotal(n);
    });
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={total !== null}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
      title="Büyük liste indirilecek"
      description={`Yaklaşık ${(total ?? 0).toLocaleString("tr-TR")} kayıt indirilecek; bu birkaç dakika sürebilir. Süzgeçle daraltmak daha hızlıdır.\nYine de indirilsin mi?`}
      confirmLabel="İndir"
      cancelLabel="Vazgeç"
      onConfirm={() => settle(true)}
    />
  );

  return { confirmTotal, confirmDialog };
}
