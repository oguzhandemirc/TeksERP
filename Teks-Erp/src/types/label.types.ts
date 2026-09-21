// =============================================================================
// TeksERP — Etiket yükü SÖZLEŞMESİ (tip-only) — 2026-08-09 denetimi, F-BLG-MIM-001
// =============================================================================
// ⚠️ BU DOSYA DEĞER İHRAÇ ETMEZ ve etmemeli. Var oluş sebebi tam olarak budur.
//
// `LabelPayload` yirmi dosyanın ortak sözleşmesiydi ama 1.991 satırlık
// `services/label.service.ts`in İÇİNDE yaşıyordu; on dosya onu
// `import type { LabelPayload } from "../label.service"` ile alıyordu. Bugün
// runtime döngüsü YOK — çünkü o import'ların hepsinde `type` kelimesi yazılı ve
// TypeScript `import type` kenarını derlemede SİLİYOR. Yani tüm koruma tek bir
// kelimenin disiplinli yazılmasıydı.
//
// KIRILMA YOLU somut: bir geliştirici aynı servisten bir DEĞER de kullanmak
// isteyip `import type { LabelPayload }` satırını `import { LabelPayload, BIR_SABIT }`
// yaparsa gerçek bir modül döngüsü doğar. Derleme GEÇER, tip kontrolü GEÇER,
// `npm test` GEÇER — çünkü CI'da döngü kontrolü YOK (`.github/workflows/ci.yml`
// içinde madge/dependency-cruiser geçmiyor, ölçüldü). Node döngüdeki ikinci
// modül için YARIM nesne verir; etiket alt sisteminde modül seviyesinde çözülen
// katalog/sabit dizileri olduğu için sonuç `undefined` bir katalogla basılan
// yanlış/eksik etikettir — boot'ta değil ilk baskıda, yani vardiya ortasında.
//
// Tip burada durdukça o döngü YAPISAL OLARAK imkânsızdır: değer taşımayan bir
// modülden değer import edilemez. Koruma `type` kelimesinden mimariye taşındı.
//
// ⚠️ Buraya fonksiyon, sabit, enum ya da sınıf EKLEME. Eklersen dosya değer
// taşımaya başlar ve garantiyi kendi elinle kaldırırsın (bekçi: value-only SCC).
// =============================================================================

import type { LabelKind } from "@prisma/client";
import type { NameSource } from "../services/helpers/customer-name.helper";

export type { NameSource };

export interface LabelPayload {
  // Roll core
  rollId: string;
  barcode: string;
  status: string;
  qualityGrade: string;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number | null;
  // Tambur'da kartela için işaretlendi mi — true ise etikette mor "KARTELALIK"
  // damgası basılır (kartelaMark alanı template'te açıksa).
  markedForKartela: boolean;

  // Item/Color (effective ↔ default ayrı tutulur, frontend istediğini gösterir)
  itemCode: string;
  itemName: string; // effective (cascade)
  itemNameDefault: string; // bizim isim (Item.name)
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null; // effective (cascade) — colorId null ise null
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;

  // Customer/Order — allocation YOKSA HEPSİ NULL (frontend bloğu render etmez)
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;

  // Batch (parti) + İş Emri
  batchNumber: string | null;
  workOrderNumber?: string | null;
  printedAt: string;

  /**
   * KAT — topun kalıcı özelliği (`Roll.foldType`, katalog kodu: "2-KAT"/"6-KAT"/"TUP").
   *
   * Katalog KODU basılır, görünen ad DEĞİL: kod topun kimliğidir ve etiketi okuyan
   * (bizim depo, fason, müşteri) kayıttaki değerin aynısını görmeli. Katalogdan ad
   * çözmek etikete DB okuması eklerdi ve ad değişince geçmiş baskılarla uyuşmazdı.
   * Kat girilmemiş topta null → alan şablonda dursa bile baskıda atlanır.
   */
  foldType?: string | null;

  // --- SWATCH (kartela) için opsiyonel alanlar — roll payload'unda undefined.
  //     Builder'lar yalnız `kind === SWATCH` iken basar; roll çağrıları dokunmaz. ---
  /** Etiket türü ayırt edici — verilmezse roll (ROLL_RAW/ROLL_FINISHED) kabul edilir. */
  kind?: LabelKind;
  /** Kartela kart no (KRT...). */
  cardNumber?: string | null;
  /** Kartela Boy (cm) — roll'da metraj (lengthMeters) kullanılır. */
  lengthCm?: number | null;
  /** Kartelanın doğduğu bitmiş topun barkodu. */
  parentRollBarcode?: string | null;

  // --- SACK (çuval) için opsiyonel alanlar — roll/swatch payload'unda undefined.
  //     Yalnız `kind === SACK` iken doldurulur. Çuvalda ÜRÜN/RENK alanı YOK
  //     (karışık içerik → tek ürün adı sessizce yanlış olur). ---
  /** Çuval kodu (CV+GGAAYY+NNNN) — barkod/QR ile AYNI değer (tek kod kuralı). */
  sackNo?: string | null;
  /** Çuvaldaki (ölü olmayan) top adedi. */
  rollCount?: number | null;
  /** Çuvalın müşteri şubesi. */
  branchName?: string | null;
  /** Çuval yorumu (iç not) — şablona sürüklenmişse basılır, boşsa eleman atlanır. */
  sackNote?: string | null;
  /** Sevk partisi içi ambalaj no (partisiz çuvalda null → eleman atlanır). */
  packageNo?: number | null;
  /** Sevk partisi adı (SP-3 / "Cuma tırı"); partisiz çuvalda null. */
  packingGroupName?: string | null;
}

export interface SwatchLabelPayload {
  swatchId: string;
  cardNumber: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;
  widthCm: number | null;
  lengthCm: number | null;
  weightKg: number | null;
  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;
  batchNumber: string | null;
  parentRollBarcode: string | null;
  printedAt: string;
}
