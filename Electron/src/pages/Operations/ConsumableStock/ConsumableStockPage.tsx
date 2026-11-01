// =============================================================================
// SARF STOĞU (kuşak / kurşun şeridi)
// =============================================================================
// Bakiye backend defterinden türetilir; giriş mal kabulden, düşüm üretim izinden (kurşun / tambur) doğar —
// bu ekranda yazım yok. Eksi bakiye HATA değildir (tüketim girişten önce yazılmış): görünür, nötr uyarılır.
// "İstek düştü" ile "kayıt yok" ayrı cümledir (İplik Stoğu emsali). Süzme sunucuda.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listConsumableStock, type ConsumableStockRow } from "./service";
import { ConsumableMovementsSheet } from "./ConsumableMovementsSheet";

export function ConsumableStockPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<ConsumableStockRow | null>(null);
  const q = useQuery({ queryKey: ["consumable-stock", search], queryFn: () => listConsumableStock(search) });
  const data = q.data;
  return (
    <PageShell>
      <PageHeader
        title="Sarf Stoğu"
        description="Kuşak ve kurşun şeridi gibi sarf malzemeleri. Giriş mal kabulden, düşüm üretim adımından gelir; satırlar silinmez, geri alma ters kayıt yazar."
      />
      <PageBody>
        {data && !data.enabled && (
          <p className="mb-3 rounded-md border p-3 text-sm text-muted-foreground">
            Sarf stoğu takibi kapalı — Ayarlar › Mal Kabul &amp; Alış › &quot;Sarf stoğu tut&quot; açılınca mal kabul sarf satırı alır ve üretim düşer.
          </p>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input className="w-full sm:w-72" placeholder="Kalem adı ya da kodu ara" value={search} onChange={(e) => setSearch(e.target.value)} />
          {data && (
            <span className="text-sm text-muted-foreground">
              {data.summary.itemCount} kalem{data.summary.negativeCount > 0 ? ` · ${data.summary.negativeCount} eksi bakiye` : ""}
            </span>
          )}
        </div>
        {q.isError ? (
          <p className="text-sm text-destructive">Sarf stoğu yüklenemedi — bağlantıyı, Ticaret modülünü ve yetkinizi kontrol edin.</p>
        ) : data && data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sarf türünde kalem yok. Ürün kartında türü &quot;Sarf&quot; olan kalemler burada listelenir.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="p-2">Kod</th>
                  <th className="p-2">Kalem</th>
                  <th className="p-2 text-right">Bakiye</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r) => (
                  <tr key={r.itemId} className="border-t">
                    <td className="p-2 font-mono">{r.code}</td>
                    <td className="p-2">
                      {r.name}
                      {!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(pasif)</span>}
                    </td>
                    <td className={`p-2 text-right tabular-nums ${r.negative ? "text-amber-600" : ""}`}>
                      {r.negative && <AlertTriangle className="mr-1 inline h-4 w-4" aria-label="Eksi bakiye — mal kabul girişini kontrol edin" />}
                      {r.balance} {r.unit}
                    </td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Hareketler</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
      <ConsumableMovementsSheet row={open} onClose={() => setOpen(null)} />
    </PageShell>
  );
}
