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
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import {
  supplierDisplayName, supplierPartyQuery, type SupplierParty,
} from "@/components/forms/supplierParty";
import { fmtQty, listOpenLines, type OpenLineRow } from "./service";
import { FIFO_HINT, fulfillmentOf, remainingText } from "./fulfillment";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";

const Sub = ({ children }: { children: React.ReactNode }) => <span className="ml-1.5 text-[11px] text-muted-foreground">{children}</span>;

const OPEN_LINE_COLUMNS: ColumnDef<OpenLineRow>[] = [
  {
    id: "expectedDate",
    header: "Beklenen",
    meta: { label: "Beklenen", exportValue: (r) => fmtDate(r.purchaseOrder.expectedDate) },
    cell: ({ row: { original: r } }) => {
      const tone = expectedTone(r.purchaseOrder.expectedDate, r.purchaseOrder.status);
      const hint = expectedHint(tone);
      return (
        <span className={EXPECTED_TONE_CLASS[tone]}>
          {fmtDate(r.purchaseOrder.expectedDate)}
          {hint && <span className="ml-1.5 text-[11px]">{hint}</span>}
        </span>
      );
    },
  },
  {
    id: "item",
    header: "Ürün",
    size: 240,
    meta: { label: "Ürün", exportValue: (r) => `${r.item.code} — ${r.item.name}` },
    cell: ({ row: { original: r } }) => (
      <span>
        <span className="font-medium">{r.item.name}</span>
        <Sub>{r.item.code}</Sub>
      </span>
    ),
  },
  { id: "supplier", header: "Tedarikçi", meta: { label: "Tedarikçi", exportValue: (r) => supplierDisplayName(r.purchaseOrder) }, cell: ({ row }) => supplierDisplayName(row.original.purchaseOrder) },
  {
    id: "order",
    header: "Sipariş",
    meta: { label: "Sipariş", exportValue: (r) => r.purchaseOrder.orderNo },
    cell: ({ row: { original: r } }) => (
      <span className="font-mono text-xs">
        {r.purchaseOrder.orderNo}
        <Sub>{r.lineNo}. kalem</Sub>
      </span>
    ),
  },
  { id: "qty", header: "Ismarlanan", meta: { label: "Ismarlanan", align: "right", exportValue: (r) => fmtQty(r.qty, r.item.unit) }, cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.qty, row.original.item.unit)}</span> },
  {
    id: "receivedQty",
    header: "Gelen",
    meta: { label: "Gelen", align: "right", exportValue: (r) => fmtQty(r.receivedQty, r.item.unit) },
    cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{fmtQty(row.original.receivedQty, row.original.item.unit)}</span>,
  },
  {
    id: "remaining",
    header: "Kalan",
    // Bu uçta kalan daima > 0 (süzgeç öyle kuruyor); yine de ortak hesap kullanılır ki kural TEK YERDE kalsın.
    meta: { label: "Kalan", align: "right", exportValue: (r) => remainingText(fulfillmentOf(r), r.item.unit) },
    cell: ({ row: { original: r } }) => <span className="font-medium tabular-nums">{remainingText(fulfillmentOf(r), r.item.unit)}</span>,
  },
];

/** Sunucudan çekilen en fazla kalem — backend tavanı 500. */
const LIMIT = 200;

interface Props {
  /** Sayfa şeridindeki tedarikçi filtresi — iki görünüm aynı daraltmayı paylaşır.
   *  C4: taraf {kind,id} taşır; sorgu anahtarını `supplierPartyQuery` seçer. */
  supplier: SupplierParty | null;
  itemId: string | null;
  onItemChange: (id: string | null) => void;
  overdueOnly: boolean;
  onOverdueChange: (v: boolean) => void;
  onOpenOrder: (orderId: string) => void;
}

export function OpenLinesPanel({
  supplier,
  itemId,
  onItemChange,
  overdueOnly,
  onOverdueChange,
  onOpenOrder,
}: Props) {
  const q = useQuery({
    queryKey: [
      "purchase-order-open-lines", supplier?.kind ?? "", supplier?.id ?? "", itemId, overdueOnly,
    ],
    queryFn: () =>
      listOpenLines({
        ...supplierPartyQuery(supplier),
        itemId: itemId ?? undefined,
        overdueOnly,
        limit: LIMIT,
      }),
  });

  const rows: OpenLineRow[] = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const table = useLocalTable({ tableKey: "purchase:open-lines", data: rows, columns: OPEN_LINE_COLUMNS });

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
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
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Bekleyen kalemler" />
        </div>
      </ListToolbar>

      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <>
          <DataTable table={table} onRowClick={(r) => onOpenOrder(r.purchaseOrder.id)} exportName="Bekleyen kalemler" />
          <p className="flex shrink-0 items-start gap-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {FIFO_HINT}
          </p>
          {rows.length < total && (
            <p className="flex shrink-0 items-start gap-1.5 px-4 py-2 text-xs text-amber-700 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {total} açık kalemin ilk {rows.length} tanesi gösteriliyor (en yakın termin önce).
              Aradığınızı bulmak için tedarikçi ya da ürün filtresini kullanın.
            </p>
          )}
        </>
      ) : (
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
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
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              {overdueOnly
                ? "Termini geçmiş açık kalem yok. (Beklenen tarihi girilmemiş kalemler bu listeye girmez.)"
                : supplier || itemId
                  ? "Bu daraltmayla bekleyen kalem yok — filtreleri gevşetip tekrar bakın."
                  : "Bekleyen kalem yok: açık siparişlerin tamamı karşılanmış."}
            </div>
          </ListMessage>
        ) : null}
      </ListBody>
      )}
      {rows.length > 0 && <ListFooter loaded={rows.length} total={total} />}
    </>
  );
}
