import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { StatusBadge, rollStatusTones } from "@/components/operations/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat } from "@/lib/format";
import { rollStatusLabels, RollStatus } from "@/types/enums";
import { type Roll, shipmentScopeLabels, activeDispatchOf, activeCategoryOf } from "./types";

/**
 * Roll'un fiziksel/işlenmiş durumunu renk ve duruma göre türet.
 * - Ham:        renk yok ve aktif üretimde değil (stokta bekleyen çiğ kumaş)
 * - İşleniyor:  aktif üretimde (IN_PRODUCTION / AT_SUBCONTRACTOR)
 * - Açık Kumaş: fason dönüşü açık kumaş (parentReceiptId set, henüz Tambur'a
 *               girmemiş — boyalı olsa bile "Bitmiş" değildir, Tambur kararı
 *               bekliyor)
 * - Bitmiş:     WAREHOUSE (Tambur'dan çıkmış, depoya alınmış)
 * - Arşiv:      tambur'da bölünmüş, fasonda tüketilmiş veya sevkten dönmüş
 */
function rollProcessingState(
  roll: Roll,
): "ham" | "isleniyor" | "acik" | "bitmis" | "arsiv" {
  if (
    roll.status === RollStatus.TAMBUR_CONSUMED ||
    roll.status === RollStatus.SUBCONTRACTOR_CONSUMED ||
    roll.status === RollStatus.KARTELA_CONSUMED ||
    roll.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR
  ) {
    return "arsiv";
  }
  // Bitmiş ürün ailesi: depo (WAREHOUSE+A1 — backend FINISHED_STOCK kapsamıyla
  // aynı), kartelada bekleyen bitmiş top ve sevk edilmiş top. Eskiden yalnız
  // WAREHOUSE sayılıyordu — A1/kartela/sevkli top "İşleniyor" görünüyordu.
  if (
    roll.status === RollStatus.WAREHOUSE ||
    roll.status === RollStatus.A1_STOCK ||
    roll.status === RollStatus.AT_KARTELA ||
    roll.status === RollStatus.SHIPPED
  ) {
    return "bitmis";
  }
  // Fason dönüşü açık kumaş — boyalı bile olsa Tambur'a girmediği için "Bitmiş"
  // değildir. parentReceiptId tek başına yeterli sinyal (KK1 girişi vb. yok).
  if (roll.parentReceiptId) {
    return "acik";
  }
  if (roll.status === RollStatus.STOCK) {
    return roll.colorId ? "bitmis" : "ham";
  }
  if (roll.colorId) return "isleniyor";
  return "ham";
}

const processingLabels: Record<ReturnType<typeof rollProcessingState>, string> = {
  ham: "Ham",
  isleniyor: "İşleniyor",
  acik: "Açık Kumaş",
  bitmis: "Bitmiş",
  arsiv: "Arşiv",
};

export const rollColumns: ColumnDef<Roll>[] = [
  {
    accessorKey: "barcode",
    header: () => <SortableHeader field="barcode" label="Barkod" />,
    meta: { label: "Barkod" },
    cell: ({ row }) =>
      row.original.barcode ? (
        <span className="font-mono text-xs">{row.original.barcode}</span>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          Açık Kumaş
        </Badge>
      ),
  },
  {
    id: "item",
    header: "Kumaş",
    cell: ({ row }) => (
      <span className="text-xs font-medium">
        {row.original.item?.name ?? "—"}
      </span>
    ),
  },
  {
    id: "color",
    header: "Renk",
    cell: ({ row }) =>
      row.original.color ? (
        <span className="inline-flex items-center gap-1 text-xs">
          {row.original.color.hex && (
            <span
              className="h-2.5 w-2.5 rounded-full border border-black/10"
              style={{ backgroundColor: row.original.color.hex }}
            />
          )}
          {row.original.color.name}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
  },
  {
    id: "properties",
    header: "Özellikler",
    cell: ({ row }) => {
      const props = row.original.properties ?? [];
      if (props.length === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      return (
        <div className="flex flex-wrap gap-0.5">
          {props.slice(0, 2).map((p) => (
            <Badge key={p.propertyId} variant="muted" className="text-[10px]">
              {p.property.name}
            </Badge>
          ))}
          {props.length > 2 && (
            <Badge variant="muted" className="text-[10px]">
              +{props.length - 2}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "processing",
    header: "Tip",
    meta: { exportValue: (r) => processingLabels[rollProcessingState(r)] },
    cell: ({ row }) => {
      const state = rollProcessingState(row.original);
      const variant =
        state === "bitmis" ? "default" : state === "arsiv" ? "muted" : "outline";
      return (
        <Badge variant={variant} className="text-[10px]">
          {processingLabels[state]}
        </Badge>
      );
    },
  },
  {
    id: "subcontractorCategory",
    header: "İşlem",
    meta: {
      label: "İşlem",
      exportValue: (r) =>
        r.status === RollStatus.AT_SUBCONTRACTOR ? activeCategoryOf(r)?.name ?? "" : "",
    },
    enableSorting: false,
    // Yalnız fasondaki topta göster — dispatchItems include'u anlık status-geçiş/
    // bayat cache'te dolu gelebilir, statü guard'ı savunma amaçlı şart. Kategori
    // adımdan boşsa firmanın kategorisine düşer (activeCategoryOf).
    cell: ({ row }) => {
      const cat =
        row.original.status === RollStatus.AT_SUBCONTRACTOR
          ? activeCategoryOf(row.original)
          : null;
      return cat ? (
        <Badge variant="outline" className="text-[10px]">
          {cat.name}
        </Badge>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      );
    },
  },
  {
    id: "subcontractor",
    header: "Fason Firması",
    meta: {
      label: "Fason Firması",
      exportValue: (r) =>
        r.status === RollStatus.AT_SUBCONTRACTOR
          ? activeDispatchOf(r)?.subcontractor.name ?? ""
          : "",
    },
    enableSorting: false,
    cell: ({ row }) => {
      const d =
        row.original.status === RollStatus.AT_SUBCONTRACTOR
          ? activeDispatchOf(row.original)
          : null;
      if (!d) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="text-xs font-medium">
          {d.subcontractor.name}
          {d.subcontractor.code ? (
            <span className="ml-1 text-muted-foreground">({d.subcontractor.code})</span>
          ) : null}
        </span>
      );
    },
  },
  {
    accessorKey: "currentQty",
    header: () => <SortableHeader field="currentQty" label="Metre" />,
    meta: { label: "Metre", summable: true },
    // SADECE topun şu anki metrajı. Giriş metrajı ve "kesik" işareti listede
    // GÖSTERİLMEZ — sahada kafa karıştırıyordu (eski `700 / 800` gösterimi
    // "hangisi elimde, 800 hedef mi?" diye okunuyordu). Giriş metrajı ve doluluk
    // detay panelinde durur (izlenebilirlik yüzeyi).
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {row.original.currentQty.toLocaleString("tr-TR", { useGrouping: false })}
      </div>
    ),
  },
  {
    accessorKey: "width",
    header: () => <SortableHeader field="width" label="En" />,
    meta: { label: "En" },
    cell: ({ row }) =>
      row.original.width != null ? (
        <span className="tabular-nums text-xs">{row.original.width} cm</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    // KAT — topun kalıcı fiziksel özelliği (2026-08-04). Varsayılan GİZLİ:
    // "Sütunlar" menüsünden açılır. Gerekçe: her operatörü ilgilendirmiyor ve
    // liste yüzeyi anlık karar için sade kalmalı; ihtiyaç duyan açar.
    accessorKey: "foldType",
    header: () => <SortableHeader field="foldType" label="Kat" />,
    meta: { label: "Kat" },
    cell: ({ row }) =>
      row.original.foldType ? (
        <span className="text-xs">{row.original.foldType}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "qualityGrade",
    header: () => <SortableHeader field="qualityGrade" label="Kalite" />,
    meta: { label: "Kalite" },
    cell: ({ row }) => {
      const grade = row.original.qualityGrade;
      if (grade === "FIRE") {
        return (
          <Badge variant="destructive" className="text-[10px]">
            Fire
          </Badge>
        );
      }
      if (grade === "A1") {
        return (
          <Badge
            variant="outline"
            className="text-[10px] border-warning text-warning"
          >
            A1
          </Badge>
        );
      }
      // Kalite yalnız kalite istasyonlarında belirlenir — bakılmamışsa null → "—".
      return (
        <span className="text-xs">
          {grade ?? <span className="text-muted-foreground">—</span>}
        </span>
      );
    },
  },
  {
    id: "kartela",
    header: () => <span className="text-xs">Kartela</span>,
    meta: {
      label: "Kartela",
      exportValue: (r) => (r.markedForKartela ? "Kartelalık" : ""),
    },
    enableSorting: false,
    cell: ({ row }) =>
      row.original.markedForKartela ? (
        <Badge className="text-[10px] border-transparent bg-[#7c3aed] text-white hover:bg-[#7c3aed]">
          Kartelalık
        </Badge>
      ) : null,
  },
  {
    accessorKey: "status",
    header: () => <SortableHeader field="status" label="Durum" />,
    meta: { label: "Durum", exportValue: (r) => rollStatusLabels[r.status] ?? r.status },
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <StatusBadge
          status={row.original.status}
          labels={rollStatusLabels}
          tones={rollStatusTones}
        />
        {row.original.labelDirty && (
          // Etiket bayat: veri/metraj düzeltildi, fiziksel etiket yeniden basılmadı.
          <span title="Etiket güncel değil — veri düzeltildi, yeniden basılmalı." className="inline-flex">
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-label="Etiket güncel değil"
            />
          </span>
        )}
      </div>
    ),
  },
  {
    id: "reservation",
    header: () => <span className="text-xs">Konum</span>,
    meta: {
      label: "Konum",
      exportValue: (r) => {
        // Çuvala VEYA sevkiyata bağlı → serbest DEĞİL. Bir çuvala konmuş ama henüz
        // sevkiyata atanmamış top (sackId dolu, shipmentId null) de "Çuvalda"dır.
        const inSack = r.sackId != null || r.sack != null;
        if (r.shipmentId || inSack) {
          const scope = r.shipment ? r.shipment.shipmentNo : "Sevk bekliyor";
          return `Çuvalda${r.sack ? ` (${r.sack.sackNo})` : ""} · ${scope}`;
        }
        return r.status === RollStatus.WAREHOUSE ? "Serbest depo" : "";
      },
    },
    enableSorting: false,
    cell: ({ row }) => {
      const r = row.original;
      // Çuvala/sevkiyata bağlı top serbest stok DEĞİL — sarı "Çuvalda" rozeti.
      // ÖNEMLİ: yalnız shipmentId'ye bakma — çuval sevkiyata atanmadan önce
      // (sackId dolu, shipmentId null) top fiziksel olarak çuvaldadır; "Serbest"
      // göstermek çift-tahsis riski yaratır (çuval havuzu modeli: serbest = ne
      // çuvalda ne sevkiyatta).
      const inSack = r.sackId != null || r.sack != null;
      if (r.shipmentId || inSack) {
        // Alt metin: sevkiyata bağlıysa aşama etiketi (Planlı Sevkiyat / Sevk
        // Edildi); yalnız çuvaldaysa henüz sevkiyatı yok → "Sevk bekliyor".
        const scope = r.shipment ? shipmentScopeLabels[r.shipment.status] : "Sevk bekliyor";
        return (
          <div className="flex flex-col gap-0.5">
            <Badge
              variant="outline"
              className="w-fit text-[10px] border-amber-500 text-amber-600"
            >
              Çuvalda
            </Badge>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {scope}
              {r.sack ? ` · ${r.sack.sackNo}` : ""}
            </span>
          </div>
        );
      }
      // Ne çuvalda ne sevkiyatta olan depo topu = gerçek serbest stok.
      if (r.status === RollStatus.WAREHOUSE) {
        return <span className="text-[10px] text-emerald-600">Serbest</span>;
      }
      return <span className="text-muted-foreground">—</span>;
    },
  },
  {
    // TEK görünür tarih = SON İŞLEM (envanter listesi standardı: "bu top ne zaman
    // buraya geldi / en son ne zaman dokunuldu"). Oluşturma tarihi operatörün
    // günlük kararına girmez — detay panelinde ("Oluşturma · Son güncelleme") ve
    // aşağıdaki opt-in "Giriş" kolonunda duruyor.
    //
    // DİKKAT: `updatedAt` gerçek "hareket" değil, satırın son değişme anıdır
    // (etiket yeniden basımı / not düzenlemesi de günceller). Bu yüzden kolon
    // "Son Hareket" DEĞİL "Son İşlem" diye adlandırıldı. Gerçek stok yaşlandırma
    // (FIFO "en eski topu önce sevk et") istenirse yalnız statü geçişlerinde
    // damgalanan ayrı bir kolon gerekir.
    accessorKey: "updatedAt",
    header: () => <SortableHeader field="updatedAt" label="Son İşlem" />,
    meta: { label: "Son İşlem", exportValue: (r) => safeFormat(r.updatedAt, "dd.MM.yyyy HH:mm") },
    cell: ({ row }) => {
      const d = row.original.updatedAt;
      return (
        <span className="text-xs tabular-nums leading-tight">
          {safeFormat(d, "dd.MM.yyyy")}
          <span className="ml-1 text-muted-foreground">{safeFormat(d, "HH:mm")}</span>
        </span>
      );
    },
  },
  {
    // Oluşturma tarihi — varsayılan GİZLİ, "Sütunlar" menüsünden açılır. İzlenebilirlik
    // sorusu ("bu top fabrikaya ne zaman girdi") için duruyor, günlük listeyi meşgul etmiyor.
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Giriş" />,
    meta: { label: "Giriş", exportValue: (r) => safeFormat(r.createdAt, "dd.MM.yyyy HH:mm") },
    cell: ({ row }) => {
      const d = row.original.createdAt;
      return (
        <span className="text-xs tabular-nums leading-tight">
          {safeFormat(d, "dd.MM.yyyy")}
          <span className="ml-1 text-muted-foreground">{safeFormat(d, "HH:mm")}</span>
        </span>
      );
    },
  },
];
