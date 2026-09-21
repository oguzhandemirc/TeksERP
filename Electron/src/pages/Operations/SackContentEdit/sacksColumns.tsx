import type { ColumnDef } from "@tanstack/react-table";
import { MessageSquareText } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { isDarkHex } from "@/pages/SackTags/service";
import { SackTagsBulkMenu } from "./SackTagsBulkMenu";
import { sackStatusLabels, sackStatusOf, type SackSearchRow } from "./types";

const fmtQty = (n: number) =>
  `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/**
 * LOUD durum rozeti — Depoda (emerald) / Sevkte (violet=planlı) / Sevk Edildi (zinc).
 * ETİKET metni `sackStatusLabels`'tan (detay paneliyle tek kaynak); RENK burada
 * bilinçli olarak dolu/loud — listede tarama kolaylığı, panelde tonlu StatusBadge.
 */
const STATUS_CLASS: Record<ReturnType<typeof sackStatusOf>, string> = {
  POOL: "bg-emerald-600 text-white",
  PLANNED: "bg-violet-600 text-white",
  DISPATCHED: "bg-zinc-600 text-white",
};

function statusBadge(sack: SackSearchRow): { label: string; className: string } {
  const key = sackStatusOf(sack);
  return { label: sackStatusLabels[key], className: STATUS_CLASS[key] };
}

/**
 * Çuval listesi sütunları — Siparişler/Sevkiyatlar paritesinde satır-sütunlu tablo.
 * Yalnız `sackNo` ve `createdAt` sıralanabilir (SortableHeader); diğer başlıklar düz.
 * Her sütun `meta.label` taşır (göster/gizle menüsü + CSV başlığı).
 */
const SACKS_KOLONLARI: ColumnDef<SackSearchRow>[] = [
  {
    id: "status",
    header: "Durum",
    meta: {
      label: "Durum",
      exportValue: (s) =>
        `${statusBadge(s).label}${s.shipment ? ` (${s.shipment.shipmentNo})` : ""}`,
    },
    cell: ({ row }) => {
      const s = row.original;
      const b = statusBadge(s);
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              b.className,
            )}
          >
            {b.label}
          </span>
          {s.shipment && (
            <span className="font-mono text-[10px] text-muted-foreground">{s.shipment.shipmentNo}</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "sackNo",
    header: () => <SortableHeader field="sackNo" label="Çuval No" />,
    meta: { label: "Çuval No" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sackNo}</span>,
  },
  {
    // SEVK PARTİSİ içi ambalaj no (2026-09-21) — skaler kolon, SIRALANABİLİR (keyset
    // cursor ifade eder). Grup modunda `sacksKolonlari(…, lotMode=false)` bu sütunu düşürür.
    id: "packageNo",
    accessorKey: "packageNo",
    header: () => <SortableHeader field="packageNo" label="Ambalaj No" />,
    meta: { label: "Ambalaj No", exportValue: (s) => (s.packageNo != null ? String(s.packageNo) : "") },
    cell: ({ row }) =>
      row.original.packageNo != null ? (
        <span className="font-semibold tabular-nums">{row.original.packageNo}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "customer",
    header: "Müşteri",
    meta: { label: "Müşteri" },
    cell: ({ row }) =>
      row.original.customer?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "branch",
    header: "Şube",
    meta: { label: "Şube" },
    cell: ({ row }) => {
      const b = row.original.branch;
      if (!b) return <span className="text-muted-foreground">—</span>;
      return (
        <span>
          {b.name}
          {b.code && (
            <span className="ml-1 font-mono text-xs text-muted-foreground">({b.code})</span>
          )}
        </span>
      );
    },
  },
  {
    id: "match",
    header: "Eşleşen",
    meta: {
      label: "Eşleşen",
      exportValue: (s) =>
        s.matchRollCount === null ? "" : `${s.matchRollCount} top · ${fmtQty(s.matchQty ?? 0)}`,
    },
    cell: ({ row }) => {
      const s = row.original;
      if (s.matchRollCount === null) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="inline-flex whitespace-nowrap rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-primary">
          {s.matchRollCount} top · {fmtQty(s.matchQty ?? 0)}
        </span>
      );
    },
  },
  {
    id: "rolls",
    header: "Top",
    // exportValue SAYI olmalı: eski `"5 +2 kartela"` metni summable ile birlikte
    // rawCellNumber'da rakamlara indirgenip "52" olurdu (5 top + 2 kartela → 52).
    // Kartela adedi hücrede ve içerik dökümünde görünür; bu kolon top sayar.
    meta: { label: "Top", summable: true, exportValue: (s) => s.rollCount },
    cell: ({ row }) => {
      const s = row.original;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">
          <span className="font-medium">{s.rollCount}</span>
          {s.swatchCount > 0 && (
            <span className="ml-1 text-muted-foreground">+{s.swatchCount} kartela</span>
          )}
        </span>
      );
    },
  },
  {
    id: "totalQty",
    header: "Metraj",
    meta: { label: "Metraj", summable: true },
    cell: ({ row }) => (
      <span className="tabular-nums text-xs">{fmtQty(row.original.totalQty)}</span>
    ),
  },
  {
    id: "weightKg",
    header: () => <SortableHeader field="weightKg" label="Kg" />,
    // Tartılmamış çuval toplamda 0 sayılır (null → 0) — toplam "tartılanların kg'ı".
    meta: { label: "Kg", summable: true },
    cell: ({ row }) => {
      const kg = row.original.weightKg;
      return kg === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums text-xs">
          {kg.toLocaleString("tr-TR", { useGrouping: false })}
        </span>
      );
    },
  },
  {
    // PAKETLEME GRUBU (çalışma yaftası) — "bu çuval hangi hazırlıkta".
    // ⚠️ İz sütunuyla AYNI GEREKÇEYLE sıralanmaz: grup bir İLİŞKİDİR, keyset
    // cursor skaler kolon ister. "Grupları bir arada gör" işini üstteki grup
    // ŞERİDİ (filtre) yapar — tıklanan grup listeyi sunucuda süzer.
    // ⚠️ Ad `packingGroup.name`den okunur, `seq`ten KURULMAZ: operatör grubu
    // elle adlandırdığında (`seq` null olur) numara üretmek boş çip basardı.
    id: "packingGroup",
    header: "Grup",
    meta: { label: "Grup", exportValue: (s) => s.packingGroup?.name ?? "" },
    cell: ({ row }) => {
      const g = row.original.packingGroup;
      if (!g) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="inline-flex whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
          {g.name}
        </span>
      );
    },
  },
  {
    id: "note",
    // Not SIRALANABİLİR (skaler kolon → keyset cursor onu ifade edebiliyor).
    // Tartısız/notsuz satırlar SONA düşer (`nulls: "last"`).
    header: () => <SortableHeader field="notes" label="Not" />,
    meta: { label: "Not", exportValue: (s) => s.notePreview ?? "" },
    cell: ({ row }) => {
      const s = row.original;
      // Liste yalnız kırpılmış önizleme alır (notePreview, 80 karakter) — tam metin
      // çuval editöründe. Yorum yoksa sütun sessiz kalır.
      if (!s.hasNote) return <span className="text-muted-foreground">—</span>;
      return (
        <span
          className="flex max-w-[220px] items-center gap-1 text-xs text-muted-foreground"
          title={s.notePreview ?? undefined}
        >
          <MessageSquareText className="h-3 w-3 shrink-0" />
          <span className="truncate italic">{s.notePreview}</span>
        </span>
      );
    },
  },
  {
    // ÇUVAL İZİ (2026-09-04) — paketlemecinin bıraktığı işaretler.
    // ⚠️ SIRALANMAZ ve `sortBy=tag` EKLENMEZ: bir çuvalda N iz var, tek skaler
    // yok; cursor'lu sıralama skaler kolon üzerinden WHERE kurar ve ilişki
    // sıralaması sessizce mükerrer/eksik satır üretirdi. Backend allowlist'i
    // yalnız SKALER kolon kabul eder (`createdAt|sackNo|notes|weightKg`);
    // iz ve grup oraya GİREMEZ, ikisi de ilişkidir.
    // Rozet ile "Etiket" süzgeci sunucuda AYNI yüklemden (`ACTIVE_TAG_WHERE`)
    // beslenir — sevkte temizlenen iz ikisinde de görünmez.
    id: "tags",
    header: "İz",
    meta: { label: "İz", exportValue: (s) => s.tags.map((t) => t.name).join(", ") },
    cell: ({ row }) => {
      const tags = row.original.tags;
      // HIZLI İZ (2026-09-10): iz bırakmak için satırı seçip toplu menüye gitmek
      // gerekiyordu. Tuş HER satırda durur — izsiz çuvala iz bırakmanın yolu da
      // budur (eskiden boş hücrede hiçbir giriş yoktu).
      const hizli = <SackTagsBulkMenu rows={[row.original]} onDone={() => {}} compact />;
      if (tags.length === 0)
        return (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">—</span>
            {hizli}
          </span>
        );
      return (
        <span className="flex max-w-[240px] flex-wrap items-center gap-1">
          {tags.map((t) => (
            <span
              key={t.id}
              title={t.isActive ? t.name : `${t.name} (katalogdan çıkarıldı)`}
              className={cn(
                "inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold",
                // Pasif etiketin ESKİ ataması SOLUK çizilir ama GÖSTERİLİR —
                // gizleme bir görünürlük kararıdır, geçmişi silme değil.
                !t.isActive && "opacity-50",
              )}
              style={{ backgroundColor: t.hex, color: isDarkHex(t.hex) ? "#fff" : "#000" }}
            >
              {t.name}
            </span>
          ))}
          {hizli}
        </span>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Tarih" />,
    meta: { label: "Tarih" },
    cell: ({ row }) => (
      <span className="tabular-nums text-xs">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>
    ),
  },
];

/**
 * ŞUBE KOLONU YALNIZ ŞUBE AÇIKSA (2026-09-07). Kapalı kurulumda kolon hep "—"
 * basıyor ve tabloyu boşuna genişletiyordu; `SacksListView` bayrağı sorar.
 */
export function sacksKolonlari(subeAcik: boolean, lotMode = false): ColumnDef<SackSearchRow>[] {
  return SACKS_KOLONLARI.filter((c) => (subeAcik || c.id !== "branch") && (lotMode || c.id !== "packageNo"));
}
