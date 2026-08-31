// =============================================================================
// FATURA DETAYININ SAF KATMANI — kapama satırlarının okunması
// =============================================================================
// Detay yüzeyi iki ayrı kaynaktan beslenir ve ikisi AYNI şeyi söylemek zorundadır:
//   • `Invoice.paidTotal` — DENORMALİZE sayaç (kapamalarda ham atomik UPDATE ile
//     yazılır; `settlementOf` AÇIK/KISMİ/KAPALI'yı ondan türetir).
//   • `PaymentAllocation` satırları — asıl DEFTER (`/api/finance/allocations`).
// Sayaç defterin özetidir; ayrışırlarsa ekran "kapalı" der ama karşılığında tek
// satır göstermez. Bu dosya o karşılaştırmayı yapar ve farkı GİZLEMEZ.
//
// ⚠️ TOPLAMA KURUŞTA (`allocationMath` sözleşmesi): float toplamı 1 kuruşluk
// hayali fark üretir ve tam da "defter tutmuyor" uyarısı olarak ekrana düşerdi —
// yani sağlam bir faturayı bozuk gösterirdi. Bölme YALNIZ gösterim anında.
//
// ⚠️ Kaynak XOR'dur (backend: bir kapama ya TAHSİLATA ya ÇEKE bağlıdır) ama bu
// katman ona GÜVENMEZ: ikisi de boş/dolu gelirse "BİLİNMİYOR" döner. Ekran
// uydurma bir kaynak adı basmaktansa boşluğu söyler.
// =============================================================================
import { toKurus } from "./Allocations/allocationMath";
import type { Settlement } from "./service";

/** Kapama satırının bu ekranda okunan kısmı (`Allocations/service.AllocationRow` alt kümesi). */
export interface AllocationLike {
  amount: number | string;
  payment: { docNo: string; direction: "IN" | "OUT"; paymentDate: string } | null;
  cheque: { docNo: string; kind: "RECEIVED" | "ISSUED"; dueDate: string } | null;
}

export type AllocationSourceKind = "PAYMENT" | "CHEQUE" | "UNKNOWN";

export interface AllocationSource {
  kind: AllocationSourceKind;
  /** Ekranda basılan tür adı — "Tahsilat" / "Ödeme" / "Aldığımız çek"… */
  label: string;
  /** Kaynağın belge numarası; çözülemezse `null` (ekran "—" basar). */
  docNo: string | null;
  /** Kaynağın KENDİ tarihi — tahsilatta işlem günü, çekte VADE. */
  date: string | null;
  /** Tarihin ne anlama geldiği; iki farklı tarih tek etiketle basılamaz. */
  dateLabel: string | null;
}

/**
 * Kapama satırının kaynağı.
 *
 * ⚠️ TARİH ETİKETİ DEĞERLE BİRLİKTE DÖNER. Tahsilatın `paymentDate`'i ile çekin
 * `dueDate`'i AYNI KOLONDA "tarih" diye basılırsa kullanıcı vadeyi ödeme günü
 * sanır (ChequeDetailDialog'un "iki tarih ayrı etiketle" kuralının aynısı).
 */
export function allocationSourceOf(row: AllocationLike): AllocationSource {
  const hasPayment = Boolean(row.payment);
  const hasCheque = Boolean(row.cheque);
  // XOR ihlali → iddia yok. (Backend bunu garanti ediyor; burada sessizce
  // birini seçmek, veri bozulduğu gün ekranı yanlış ama emin gösterirdi.)
  if (hasPayment === hasCheque) {
    return { kind: "UNKNOWN", label: "Kaynak çözülemedi", docNo: null, date: null, dateLabel: null };
  }
  if (row.payment) {
    return {
      kind: "PAYMENT",
      label: row.payment.direction === "IN" ? "Tahsilat" : "Ödeme",
      docNo: row.payment.docNo,
      date: row.payment.paymentDate,
      dateLabel: "işlem",
    };
  }
  const c = row.cheque!;
  return {
    kind: "CHEQUE",
    label: c.kind === "RECEIVED" ? "Aldığımız çek/senet" : "Verdiğimiz çek/senet",
    docNo: c.docNo,
    date: c.dueDate,
    dateLabel: "vade",
  };
}

/** Kapama satırlarının toplamı — KURUŞ (tam sayı). */
export function sumAllocationsK(rows: readonly AllocationLike[]): number {
  return rows.reduce((acc, r) => acc + toKurus(r.amount), 0);
}

/**
 * SAYAÇ ↔ DEFTER FARKI (kuruş).
 *
 * Pozitif → sayaç defterden FAZLA ("kapandı" der ama karşılığı yok).
 * Negatif → defter sayaçtan fazla (kapama satırı var, sayaca işlememiş).
 *
 * ⚠️ Kapama sorusu OLMAYAN faturada (TASLAK/İPTAL — `settlementOf` `null`)
 * DAİMA 0 döner: iptalde kapamalar zaten çözülür ve orada bir "fark" hesabı
 * yapmak, kullanıcıyı olmayan bir tutarsızlığa bakmaya gönderirdi.
 */
export function paidDriftK(settlement: Settlement | null, rows: readonly AllocationLike[]): number {
  if (!settlement) return 0;
  return settlement.paidK - sumAllocationsK(rows);
}
