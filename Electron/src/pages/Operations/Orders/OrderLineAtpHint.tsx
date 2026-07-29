import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { orderService } from "./service";

interface Props {
  itemId: string;
  colorId: string | null;
  width: number | null;
}

/** Tamsayı metre, tr-TR gruplama (1.250). */
function fmtM(v: number): string {
  return Math.round(v).toLocaleString("tr-TR", { useGrouping: true });
}

/**
 * Sipariş giriş formunda satır bazında "Depoda: X m · Üretimde: Y m (· Ham: Z m)"
 * anlık müsaitlik ipucu. Kaydedilmemiş satır için spec-bazlı (kumaş+renk+en) çeker.
 * ANLIK FOTOĞRAF — rezervasyon değildir (title metni bunu söyler; "müsait/ayrıldı"
 * gibi söz veren dil kullanılmaz).
 *
 * Ayrı dosya: OrderLinesEditor zaten 300 satır sınırı üstünde; ipucu buraya izole.
 */
export function OrderLineAtpHint({ itemId, colorId, width }: Props) {
  // 0/negatif eni null'a indir — backend Zod `.positive()` aksi halde 400 döner
  // ve apiClient interceptor'u her satır için toast basar.
  const normWidth = width != null && width > 0 ? width : null;
  const debouncedWidth = useDebouncedValue(normWidth, 300);

  const q = useQuery({
    queryKey: ["order-spec-availability", itemId, colorId ?? null, debouncedWidth],
    queryFn: () => orderService.getSpecAvailability(itemId, colorId, debouncedWidth),
    enabled: Boolean(itemId),
    staleTime: 30_000,
  });

  // Kumaş seçilmeden ipucu yok (renk seçici zaten "Önce kumaş seçin" gösterir).
  if (!itemId) return null;

  if (q.isLoading) {
    return <p className="text-[10px] text-muted-foreground">Stok bakılıyor…</p>;
  }
  if (!q.data?.data) return null;

  const { freeWarehouse, inProduction, freeStock } = q.data.data;
  const hasNone = freeWarehouse <= 0 && inProduction <= 0 && freeStock <= 0;

  return (
    <p
      className="text-[10px] text-muted-foreground"
      title="Anlık serbest stok — rezervasyon değildir"
    >
      {hasNone ? (
        <span>Serbest stok yok — üretim gerekecek</span>
      ) : (
        <>
          Depoda:{" "}
          <span className="font-medium tabular-nums text-foreground">{fmtM(freeWarehouse)} m</span>
          {" · "}Üretimde:{" "}
          <span className="font-medium tabular-nums text-foreground">{fmtM(inProduction)} m</span>
          {freeStock > 0 && (
            <>
              {" · "}Ham:{" "}
              <span className="font-medium tabular-nums text-foreground">{fmtM(freeStock)} m</span>
            </>
          )}
        </>
      )}
    </p>
  );
}
