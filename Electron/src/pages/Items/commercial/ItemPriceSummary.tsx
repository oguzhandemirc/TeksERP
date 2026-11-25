// "Ticari" sekmesi — fiyat özeti (yalnız okuma). Fiyat sürümlü ayardır; tek yazım yeri Kalem Fiyatları ekranı.
import { useQuery } from "@tanstack/react-query";
import { unitLabel } from "@/lib/item-unit";
import { PRICE_KIND_LABEL, listItemPrices, priceText } from "@/pages/Definitions/ItemPrices/service";
import { COMMERCIAL_PATHS, summarizeItemPrices } from "./itemCommercial";
import { CommercialBlock, MutedLine } from "./CommercialBlock";

export function ItemPriceSummary({ itemId, unit }: { itemId: string; unit: string }) {
  const q = useQuery({ queryKey: ["item-prices", "item-summary", itemId], queryFn: () => listItemPrices({ itemId }) });
  const lines = summarizeItemPrices(q.data?.data ?? []);
  const per = unitLabel(unit);
  return (
    <CommercialBlock
      title="Fiyatlar"
      info="Kart varsayılanı herkese, müşteri istisnası yalnız o müşteriye uygulanır. Fiyat burada değiştirilmez; Kalem Fiyatları ekranında yazılır, geçmiş faturalar etkilenmez."
      openLabel="Kalem Fiyatları ekranında aç"
      openPath={COMMERCIAL_PATHS.prices(itemId)}
    >
      {q.isLoading ? (
        <MutedLine>Yükleniyor…</MutedLine>
      ) : q.isError ? (
        <MutedLine>Fiyatlar okunamadı.</MutedLine>
      ) : lines.length === 0 ? (
        <MutedLine>Fiyat girilmemiş.</MutedLine>
      ) : (
        <table className="w-full text-sm" aria-label="Fiyat özeti">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Yön</th>
              <th className="py-1 text-right font-normal">Kart varsayılanı</th>
              <th className="py-1 text-right font-normal">Müşteriye özel</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.kind}:${l.currency}`} className="border-t">
                <td className="py-1.5">{PRICE_KIND_LABEL[l.kind]} · {l.currency}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {l.defaultPrice === null ? <span className="text-muted-foreground">girilmemiş</span> : `${priceText(l.defaultPrice, l.currency)} / ${per}`}
                </td>
                <td className="py-1.5 text-right tabular-nums">{l.exceptions > 0 ? `${l.exceptions} müşteri` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CommercialBlock>
  );
}
