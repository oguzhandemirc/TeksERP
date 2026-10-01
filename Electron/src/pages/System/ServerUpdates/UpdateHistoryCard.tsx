import type { UpdateHistoryItem } from "@/types/server-update";
import { LicenseCard as UpdateCard, when } from "../License/LicenseParts";
import { resultCodeLabel, resultLabel } from "./labels";

/** Son denemeler (en yeni önce) — PostgreSQL adımı ayrı satır, ön koşul olduğu backend sürümüyle. */
export function UpdateHistoryCard({ items }: { items: UpdateHistoryItem[] }) {
  return (
    <UpdateCard title="Geçmiş">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kayıt yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">Başlangıç</th>
                <th className="py-1 pr-3 font-normal">Sürüm</th>
                <th className="py-1 pr-3 font-normal">Sonuç</th>
                <th className="py-1 font-normal">Neden</th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.kayitId} className="border-t">
                  <td className="py-1 pr-3 whitespace-nowrap">{when(h.baslangic)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {h.urun === "pg" ? `PostgreSQL ${h.pgSurum ?? ""} (${h.hedefSurum} için)` : h.kaynakSurum ? `${h.kaynakSurum} → ${h.hedefSurum}` : h.hedefSurum}
                  </td>
                  <td className="py-1 pr-3 whitespace-nowrap">{resultLabel(h.sonuc)}</td>
                  <td className="py-1">
                    {resultCodeLabel(h.kod) ?? "—"}
                    {h.veriGeriYuklendi ? " · veri yedekten geri yüklendi" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </UpdateCard>
  );
}
