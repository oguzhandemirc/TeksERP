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
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { AlertTriangle } from "lucide-react";
import { InfoPopover } from "@/components/ui/info-popover";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import {
  supplierDisplayName, supplierPartyQuery, type SupplierParty,
} from "@/components/forms/supplierParty";
import { fmtQty, listOpenLines, type OpenLineRow } from "./service";
import { FIFO_HINT, fulfillmentOf, remainingText } from "./fulfillment";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

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
  /** Sayfanın ortak filtre kutuları (tedarikçi) — panelin araç satırına girer; sekme altında ikinci satır açılmaz. */
  leading?: ReactNode;
}

export function OpenLinesPanel({
  leading,
  supplier,
  itemId,
  onItemChange,
  overdueOnly,
  onOverdueChange,
  onOpenOrder,
}: Props) {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({
    queryKey: [
      "purchase-order-open-lines", supplier?.kind ?? "", supplier?.id ?? "", itemId, overdueOnly, term ?? "",
    ],
    queryFn: () =>
      listOpenLines({
        ...supplierPartyQuery(supplier),
        itemId: itemId ?? undefined,
        overdueOnly,
        search: term,
        limit: LIMIT,
      }),
  });

  const rows: OpenLineRow[] = useMemo(() => q.data?.rows ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const table = useLocalTable({ tableKey: "purchase:open-lines", data: rows, columns: OPEN_LINE_COLUMNS });

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Sipariş no, ürün adı/kodu ya da tedarikçi ara" />
        {leading}
        <div className="w-56 [&_button]:h-8 [&_button]:text-xs">
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
        <ToolbarToggle
          checked={overdueOnly}
          onCheckedChange={onOverdueChange}
          label="Yalnız gecikmişler"
          title="Beklenen tarihi geçmiş kalemler (termin girilmemiş kalemler bu listeye girmez)"
        />
        <InfoPopover label="Kalan nasıl hesaplanır" desc={FIFO_HINT} />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Bekleyen kalemler" />
        </div>
      </ListToolbar>

      <DataTable
        table={table}
        onRowClick={(r) => onOpenOrder(r.purchaseOrder.id)}
        rowTitle={() => "Siparişin tamamını aç"}
        exportName="Bekleyen kalemler"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Açık kalemler yüklenemedi. Siparişleriniz yerinde duruyor."
        onRetry={() => void q.refetch()}
        emptyText={
          overdueOnly
            ? "Termini geçmiş açık kalem yok."
            : supplier || itemId || term
              ? "Bu daraltmayla bekleyen kalem yok."
              : "Bekleyen kalem yok: açık siparişlerin tamamı karşılanmış."
        }
        emptyDescription={
          overdueOnly ? "Beklenen tarihi girilmemiş kalemler bu listeye girmez." : supplier || itemId || term ? "Filtreleri gevşetip tekrar bakın." : undefined
        }
      />
      <ListFooter
        loaded={rows.length}
        total={total}
        label={
          // KIRPMA SESSİZ DEĞİL (dosya başı): sunucu toplamı gösterilenden büyükse yazar.
          rows.length < total ? (
            <span className="flex items-center gap-1 text-amber-700 dark:text-amber-500" title="En yakın termin önce; aradığınızı tedarikçi ya da ürün filtresiyle bulun.">
              <AlertTriangle className="h-3.5 w-3.5" />
              {total} açık kalemin ilk {rows.length} tanesi gösteriliyor
            </span>
          ) : undefined
        }
      />
    </>
  );
}
