import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { isSackAbsent, sackAbsentLabels, type SackContentRoll } from "./types";

const fmtM = (n: number) => `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/**
 * Çuval içeriği (TOP) sütunları — seçilebilir DataTable. Kartelalar ayrı listede.
 * Seçim kolonu (checkbox) DataTable tarafından otomatik eklenir; burada yok.
 */
/**
 * İki ad üst üste: üstte BİZDEKİ, altında müşterideki karşılık.
 * ⚠️ Karşılık yoksa alt satır HİÇ ÇİZİLMEZ — bizim adımızı oraya koymak
 * "müşteri bunu böyle çağırıyor" yalanını üretirdi (2026-09-06 düzeltmesi).
 */
function IkiAd({ bizdeki, musterideki }: { bizdeki: string; musterideki: string | null }) {
  return (
    <div className="min-w-0 leading-tight">
      <div className="truncate text-sm">{bizdeki}</div>
      {musterideki && (
        <div className="truncate text-[11px] text-muted-foreground" title={`Müşterideki ad: ${musterideki}`}>
          ↳ {musterideki}
        </div>
      )}
    </div>
  );
}

/** Dışa aktarımda tek hücreye sığan etiket özeti. */
function etiketOzet(r: SackContentRoll): string {
  const e = r.etiket;
  if (!e) return "basılmamış";
  const ad = [e.itemName, e.colorName].filter(Boolean).join(" · ");
  if (r.labelDirty) return `BAYAT${ad ? ` — ${ad}` : ""}`;
  return ad || "basıldı (ad yok)";
}

/**
 * Etiket hücresi — üç hâl:
 *   · hiç basılmamış → "—" (sahada o topun üstünde kâğıt yok)
 *   · bayat          → uyarı + kâğıtta yazan ad (kayıtla ayrışmış)
 *   · güncel         → ✓ (ayrıntı başlıkta; tabloyu şişirmez)
 */
function EtiketHucresi({ r }: { r: SackContentRoll }) {
  const e = r.etiket;
  if (!e) return <span className="text-xs text-muted-foreground">— basılmamış</span>;

  const ad = [e.itemName, e.colorName].filter(Boolean).join(" · ");
  const baslik = [
    e.printedAt ? `Basıldı: ${new Date(e.printedAt).toLocaleString("tr-TR")}` : null,
    e.customerName ? `Etiketteki müşteri: ${e.customerName}` : null,
    e.orderNumber ? `Sipariş: ${e.orderNumber}` : null,
    e.operatorName ? `Basan: ${e.operatorName}` : null,
    ad ? `Etikette: ${ad}` : "Etiket adı kayıtlı değil",
  ]
    .filter(Boolean)
    .join("\n");

  if (r.labelDirty) {
    return (
      <div className="min-w-0 leading-tight" title={baslik}>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-500">
          <AlertTriangle className="h-3 w-3" /> bayat
        </span>
        {ad && <div className="truncate text-[11px] text-muted-foreground">{ad}</div>}
      </div>
    );
  }
  return (
    <span className="text-xs text-muted-foreground" title={baslik}>
      ✓{ad ? "" : " (ad yok)"}
    </span>
  );
}

export const sackContentsColumns: ColumnDef<SackContentRoll>[] = [
  {
    accessorKey: "barcode",
    header: "Barkod",
    meta: {
      label: "Barkod",
      exportValue: (r) =>
        `${r.barcode ?? "Açık Kumaş"}${isSackAbsent(r.status) ? ` (BURADA DEĞİL: ${sackAbsentLabels[r.status!] ?? r.status})` : ""}`,
    },
    // HAYALET ROZETİ: backend sayım/belge yüzeylerinde bu topu dışlar ama döküm onu
    // BİLEREK gösterir — kartela/tambur/fason guard'larının hata mesajı operatörü tam
    // bu ekrana yönlendiriyor ("Paketleme / Çuvallar ekranından çuvaldan çıkarın").
    // Rozet olmadan operatör hangi topun sorunlu olduğunu göremez ve mesaj boşa düşer.
    cell: ({ row }) => {
      const r = row.original;
      const absent = isSackAbsent(r.status);
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className={`font-mono text-xs ${absent ? "text-destructive line-through" : ""}`}>
            {r.barcode ?? "Açık Kumaş"}
          </span>
          {absent && (
            <span
              // Rozet doğru sözlüğü kullanıyordu, tooltip ham enum basıyordu
              // ("(SHIPPED)") — aynı satırda iki dil. Tek kaynak: sackAbsentLabels.
              title={`Bu top fiziksel olarak çuvalda DEĞİL (${sackAbsentLabels[r.status!] ?? r.status}). Çuvaldan çıkarın — sayımlara ve belgelere girmiyor, ama sevkiyat kurulumunu bloklar.`}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
            >
              <AlertTriangle className="h-3 w-3" />
              {sackAbsentLabels[r.status!] ?? r.status}
            </span>
          )}
        </span>
      );
    },
  },
  {
    id: "item",
    header: "Kumaş",
    meta: { label: "Kumaş", exportValue: (r) => r.item.name },
    // ⭐ ÜÇ AD KARŞILAŞTIRMASI (2026-09-07): üstte BİZDEKİ ad, altında küçük gri
    //    satırda MÜŞTERİDEKİ karşılık. Karşılık yoksa alt satır HİÇ ÇİZİLMEZ —
    //    bizim adımızı oraya kopyalamak "müşteri bunu böyle çağırıyor" yalanını
    //    üretirdi. Üçüncü ad (etikette yazan) AYRI kolonda, çünkü asıl sorulan
    //    soru "kâğıt ile kayıt tutuyor mu".
    cell: ({ row }) => (
      <IkiAd bizdeki={row.original.item.name} musterideki={row.original.musterideki?.itemName ?? null} />
    ),
  },
  {
    id: "color",
    header: "Renk",
    meta: { label: "Renk", exportValue: (r) => r.color?.name ?? "Ham" },
    cell: ({ row }) => {
      const c = row.original.color;
      return (
        <div className="flex items-start gap-1.5">
          {c?.hex && (
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border" style={{ backgroundColor: c.hex }} />
          )}
          <IkiAd bizdeki={c?.name ?? "Ham"} musterideki={row.original.musterideki?.colorName ?? null} />
        </div>
      );
    },
  },
  {
    id: "etiket",
    header: "Etiket",
    meta: {
      label: "Etiket",
      exportValue: (r) => etiketOzet(r),
    },
    // ⭐ TOPUN ÜSTÜNDEKİ KÂĞIT. Üçü aynıysa göze batmaz (yalnız ✓); ayrıştığında
    //    kendini gösterir. "Etiket hiç basılmamış" ile "bayat etiket" AYRI
    //    durumlardır ve sahada farklı sorunlardır — ayrı gösterilir.
    cell: ({ row }) => <EtiketHucresi r={row.original} />,
  },
  {
    id: "width",
    header: "En",
    meta: { label: "En", exportValue: (r) => (r.width ? `${r.width} cm` : "") },
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.width ? `${row.original.width} cm` : "—"}</span>
    ),
  },
  {
    id: "qty",
    // summable → Excel'e SAYI olarak yazılır + altta TOPLAM satırı doğar. Eskiden
    // exportValue "700 m" METNİ dönüyordu; Excel'de toplanamıyor, TOPLAM hiç çıkmıyordu.
    meta: { label: "Metre", summable: true, exportValue: (r) => Number(r.currentQty) },
    header: "Metre",
    cell: ({ row }) => <span className="text-sm tabular-nums">{fmtM(Number(row.original.currentQty))}</span>,
  },
  {
    accessorKey: "qualityGrade",
    header: "Kalite",
    meta: { label: "Kalite" },
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.qualityGrade ?? "—"}</span>,
  },
];
