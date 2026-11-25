// "Ticari" sekmesi — iplik kartının tedarikçi kalem kodları (yalnız okuma). Kodlar mal kabulde öğrenilir; düzeltme
// ve kaldırma tedarikçi kartında (Düzenle → Tedarikçi Kalem Kodları). Satırdaki tedarikçi adı o kartı açar.
import { useQuery } from "@tanstack/react-query";
import { formatFactory } from "@/lib/factory-time";
import { cariRecordPath } from "@/pages/Definitions/cariler/cari-row";
import { supplierItemCodeService } from "@/pages/Operations/GoodsReceipts/supplierItemCodeService";
import { openScreenTab } from "./itemCommercial";
import { CommercialBlock, MutedLine } from "./CommercialBlock";

export function ItemSupplierCodes({ itemId }: { itemId: string }) {
  const q = useQuery({ queryKey: ["supplier-item-codes", "item", itemId], queryFn: () => supplierItemCodeService.listByItem(itemId) });
  const rows = q.data?.data ?? [];
  return (
    <CommercialBlock
      title="Tedarikçi kalem kodları"
      info="Tedarikçinin irsaliyede yazdığı kod bu iplik kartına eşlenir; mal kabulde kart kendiliğinden önerilir. Kodlar mal kabulde öğrenilir; düzeltme tedarikçi kartında (Düzenle → Tedarikçi Kalem Kodları)."
      openLabel="Cariler ekranında aç"
      openPath="/definitions/cariler"
    >
      {q.isLoading ? (
        <MutedLine>Yükleniyor…</MutedLine>
      ) : q.isError ? (
        <MutedLine>Kodlar okunamadı.</MutedLine>
      ) : rows.length === 0 ? (
        <MutedLine>Henüz eşlenmiş kod yok — ilk mal kabulde öğrenilir.</MutedLine>
      ) : (
        <table className="w-full text-sm" aria-label="Tedarikçi kalem kodları">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Tedarikçi</th>
              <th className="py-1 font-normal">Kod</th>
              <th className="py-1 text-right font-normal">Kullanım</th>
              <th className="py-1 text-right font-normal">Son kabul</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1.5">
                  <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => openScreenTab(cariRecordPath(r.supplierId))}>
                    {r.supplier.name}
                  </button>
                </td>
                <td className="py-1.5 font-mono">{r.rawCode}</td>
                <td className="py-1.5 text-right tabular-nums">{r.hitCount}</td>
                <td className="py-1.5 text-right tabular-nums">{formatFactory(r.lastUsedAt ?? r.createdAt, "dd.MM.yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CommercialBlock>
  );
}
