// =============================================================================
// ⭐ "NE ISMARLADIM, NE GELDİ" — AÇIK KALEMLER
// =============================================================================
// Bu ekranın var oluş sebebi tek bir soru: "hangi maldan ne kadar bekliyorum".
// Sipariş listesi bunu cevaplayamaz çünkü orada satır SİPARİŞ'tir; burada satır
// KALEM'dir ve sıralama BEKLENEN TARİHE göredir — yani en yakın termin en üstte.
//
// ⚠️ SÜZME SUNUCUDA. Kalan hesabı (`receivedQty < qty`) backend'de yapılır.
// İstemcide süzmek yalnız O ANKİ SAYFAYI süzer ve satın almacı "açık kalem yok"
// sanardı; oysa kalem bir sonraki sayfadadır.
//
// ⚠️ KIRPMA SESSİZ DEĞİL: sunucu toplamı gösterilen satırı aşarsa ekranda YAZAR.
// "İlk 200 kalem" gerçeği söylenmezse, aradığını bulamayan kullanıcı o kalemin
// sistemde olmadığı sonucuna varır.
//
// ⚠️ "GECİKMİŞ" TANIMI BACKEND'İNKİYLE AYNI: beklenen tarih GEÇMİŞ. Tarihi
// olmayan kalem gecikmiş SAYILMAZ — bilgi yokluğunu suçlamaya çevirmek, termin
// girilmemiş her kalemi kırmızıya boyayıp gerçek gecikmeleri görünmez yapardı.
//
// ⚠️ "HATA" ile "KAYIT YOK" AYRI EKRANLARDIR: istek düşerse elimizde boş bir
// dizi kalır ve onu "hepsi geldi" diye basmak DÜPEDÜZ YALANDIR — satın almacı
// bekleyen malı olmadığı sonucuna varır.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { cn } from "@/lib/utils";
import { fmtQty, listOpenLines, type OpenLineRow } from "./service";
import { FIFO_HINT, fulfillmentOf, remainingText } from "./fulfillment";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";

/** Sunucudan çekilen en fazla kalem — backend tavanı 500. */
const LIMIT = 200;

interface Props {
  /** Sayfa şeridindeki tedarikçi filtresi — iki görünüm aynı daraltmayı paylaşır. */
  supplierId: string | null;
  itemId: string | null;
  onItemChange: (id: string | null) => void;
  overdueOnly: boolean;
  onOverdueChange: (v: boolean) => void;
  onOpenOrder: (orderId: string) => void;
}

export function OpenLinesPanel({
  supplierId,
  itemId,
  onItemChange,
  overdueOnly,
  onOverdueChange,
  onOpenOrder,
}: Props) {
  const q = useQuery({
    queryKey: ["purchase-order-open-lines", supplierId, itemId, overdueOnly],
    queryFn: () =>
      listOpenLines({
        supplierId: supplierId ?? undefined,
        itemId: itemId ?? undefined,
        overdueOnly,
        limit: LIMIT,
      }),
  });

  const rows: OpenLineRow[] = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64">
          <ReferenceSelect<Item>
            value={itemId}
            onChange={onItemChange}
            service={itemService}
            queryKey="items"
            getLabel={(it) => `${it.code} — ${it.name}`}
            placeholder="Tüm ürünler"
            nullable
            noneLabel="Tüm ürünler"
          />
        </div>
        <Button
          variant={overdueOnly ? "default" : "outline"}
          size="sm"
          onClick={() => onOverdueChange(!overdueOnly)}
          title="Beklenen tarihi geçmiş kalemler (termin girilmemiş kalemler bu listeye girmez)"
        >
          Yalnız gecikmişler
        </Button>
        {rows.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {total} açık kalem{rows.length < total ? ` · ilk ${rows.length} tanesi gösteriliyor` : ""}
          </span>
        )}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : q.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
          <p className="font-medium text-destructive">Açık kalemler yüklenemedi.</p>
          <p className="mt-1 text-muted-foreground">
            Bu “bekleyen mal yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
            Siparişleriniz yerinde duruyor.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
            Tekrar dene
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {overdueOnly
            ? "Termini geçmiş açık kalem yok. (Beklenen tarihi girilmemiş kalemler bu listeye girmez.)"
            : supplierId || itemId
              ? "Bu daraltmayla bekleyen kalem yok — filtreleri gevşetip tekrar bakın."
              : "Bekleyen kalem yok: açık siparişlerin tamamı karşılanmış."}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Beklenen</th>
                  <th className="px-3 py-2 text-left">Ürün</th>
                  <th className="px-3 py-2 text-left">Tedarikçi</th>
                  <th className="px-3 py-2 text-left">Sipariş</th>
                  <th className="px-3 py-2 text-right">Ismarlanan</th>
                  <th className="px-3 py-2 text-right">Gelen</th>
                  <th className="px-3 py-2 text-right">Kalan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const po = r.purchaseOrder;
                  const tone = expectedTone(po.expectedDate, po.status);
                  const hint = expectedHint(tone);
                  const f = fulfillmentOf(r);
                  return (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t hover:bg-muted/40"
                      onClick={() => onOpenOrder(po.id)}
                      title="Siparişin tamamını aç"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={EXPECTED_TONE_CLASS[tone]}>{fmtDate(po.expectedDate)}</span>
                        {hint && (
                          <div className={cn("text-[11px]", EXPECTED_TONE_CLASS[tone])}>{hint}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.item.name}</div>
                        <div className="text-[11px] text-muted-foreground">{r.item.code}</div>
                      </td>
                      <td className="px-3 py-2">{po.supplier?.name ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {po.orderNo}
                        <div className="text-[11px] text-muted-foreground">{r.lineNo}. kalem</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(r.qty, r.item.unit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {fmtQty(r.receivedQty, r.item.unit)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {/* Bu uçta kalan daima > 0 (süzgeç öyle kuruyor); yine de
                            ortak hesap kullanılır ki kural TEK YERDE kalsın. */}
                        {remainingText(f, r.item.unit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {FIFO_HINT}
          </p>

          {rows.length < total && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {total} açık kalemin ilk {rows.length} tanesi gösteriliyor (en yakın termin önce).
              Aradığınızı bulmak için tedarikçi ya da ürün filtresini kullanın.
            </p>
          )}
        </>
      )}
    </div>
  );
}
