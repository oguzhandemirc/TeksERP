// Birleştirme önizlemesi: taşınan kumaşa özel renk adının hedefte değiştireceği ad — KAYIT BAŞINA (soyut sayı yetmez).
import type { MergeShadowRow } from "@/services/mergeService";

export function MergeShadowingList({ rows }: { rows: readonly MergeShadowRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-sm font-medium">Değişecek müşteri renk adları</h4>
      <p className="mb-2 text-xs text-muted-foreground">
        Bu kumaşlarda etikete ve irsaliyeye basılan müşteri renk adı birleştirmeden sonra değişir.
      </p>
      <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[32rem] border-collapse text-sm" aria-label="Değişecek müşteri renk adları">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="p-2 font-medium">Müşteri</th>
              <th className="p-2 font-medium">Kumaş</th>
              <th className="p-2 font-medium">Renk</th>
              <th className="p-2 font-medium">Bugün basılan</th>
              <th className="p-2 font-medium">Birleştirmeden sonra</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${i}|${r.customer}|${r.item}|${r.color}`} className="border-b last:border-0">
                <td className="p-2">{r.customer}</td>
                <td className="p-2">{r.item}</td>
                <td className="p-2">{r.color}</td>
                <td className="p-2">{r.before ?? <span className="text-muted-foreground">bizdeki ad ({r.color})</span>}</td>
                <td className="p-2 font-medium">{r.alias}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
