// =============================================================================
// MAL KABUL SONRASI GERİ BİLDİRİM (B5) — "toplar NEREYE düştü"
// =============================================================================
// SAHA NOTU: depocu fişi kaydediyor, topları Kumaş Stoğu'nda aramaya gidiyor ve
// bulamıyor sanıyordu. Davranış doğruydu (toplar Bitmiş Depo sekmesinde,
// `updatedAt desc` ile en üstte); eksik olan tek şey CÜMLEYDİ.
//
// ⚠️ YENİ SEKME/YÜZEY AÇILMADI (plan kararı): ikinci bir "yeni girenler"
// listesi, mevcut sekme sözleşmesiyle yarışır ve aynı topu iki yerde farklı
// sırayla gösterir. Çözüm bir EKRAN değil, bir CÜMLEDİR.
//
// ⚠️⚠️ SAYILAR YANITTAN OKUNUR, FORM TASLAĞINDAN DEĞİL. Backend satır atlayabilir
// (`failed[]`: ürün pasif, kalem bulunamadı…). Taslaktan sayarsak toast "5 top
// eklendi" der, envanterde 3 top vardır — sessiz ve tam ters bir sonuç.
//
// ⚠️ HEDEF SATIR SINIFINA BAĞLIDIR (EK 7): ham satır `STOCK` → ham stok sekmesi,
// yarı mamul satır → Yarı Mamul sekmesi, bitmiş satır → depo sekmesi; aynı fişte
// birden çok sınıf olabilir ⇒ cümle HER hedef sekmeyi sayar. Tek bir sekme adı
// yazmak, kullanıcıyı doğru sekmede boş listeye bakarken bırakırdı.
//
// ⚠️⚠️ SEKME ADI SABİT YAZILMAZ, `rollTabLabel`DEN ÇÖZÜLÜR. İlk yazımda burada
// `"Ham Stok" / "Bitmiş Depo"` sabitleri vardı ve BU EKRANDA TANIM GEREĞİ
// YANLIŞTI: Mal Kabul yalnız ticaret kurulumunda çıkıyor, orada
// `finance.enabled` AÇIK ve Kumaş Stoğu şeridi o sekmeleri "Yeni Giren" / "Depo"
// diye çiziyor (`tabs-regime.TRADE_LABELS`). Yani cümle kullanıcıyı ekranda
// OLMAYAN bir sekmeye gönderiyordu — bu dosyanın var oluş sebebi olan şikâyeti
// ("malı bulamıyorum") aynen yeniden üreterek. Bir yüzey sekme adını ikinci kez
// yazdığı anda kopya bayatlar; tek kaynak `tabs-regime`.
//
// ⚠️ "fasona sevk edilebilir" GİBİ SÜREÇ VAADİ BASILMAZ: Fason Sevk yüzeyi
// `workorder:*` arkasında ve ham stok fişi açabilen TEK rol (WEB_TRADE) o izni
// taşımıyor — tutulamayacak bir söz, hiç söz vermemekten kötüdür. Cümle yalnız
// kaydın GERÇEĞİNİ söyler: mal işlenecek olarak alındı ve şu sekmede duruyor.
//
// Bekçi: `receiptFeedback.test.ts`.
// =============================================================================
import { rollTabLabel } from "@/pages/Operations/Rolls/tabs-regime";
import type { RollTabKey } from "@/pages/Operations/Rolls/tabs-config";
import type { ReceiptLineClass } from "./receiptLineTypes";

export interface ReceiptOutcome {
  /** Yanıttaki fiş numarası — cümlenin başında belge kimliği durur. */
  receiptNo?: string | null;
  /** Yanıttaki CANLI top sayısı (`totals.rollCount`). */
  rollCount: number;
  /** Yanıttaki iplik satırı sayısı (`totals.yarnLineCount`). */
  yarnLineCount: number;
  /** Fişteki kumaş satırlarının SINIFLARI (tekil; EK 7) — hedef sekme(ler) bundan çözülür. */
  lineClasses: readonly ReceiptLineClass[];
  /**
   * `finance.enabled` — sekme ETİKETLERİNİ değiştirir (ticarette "Bitmiş Depo"
   * yerine "Depo"). Bayrak henüz yüklenmemişse `false` geçilir: fabrika
   * adlandırması bugünkü davranıştır.
   */
  financeEnabled: boolean;
}

/**
 * Kumaş Stoğu sekmesinin adı — topların gerçekten düştüğü yer, EKRANDA YAZDIĞI
 * ADLA. Kaynak `tabs-regime` (şerit · komut paleti · özet indirmesi de onu
 * okur); burada ikinci bir sözlük tutulmaz.
 */
const SHELF_TAB: Record<ReceiptLineClass, RollTabKey> = { RAW: "RAW_STOCK", SEMI_FINISHED: "SEMI_FINISHED", FINISHED: "FINISHED_STOCK" };

export function receiptShelfTab(cls: ReceiptLineClass, financeEnabled: boolean): string {
  return rollTabLabel(SHELF_TAB[cls], financeEnabled);
}

/**
 * Kayıt sonrası başarı cümlesi.
 *
 * Sıra: belge no → nereye düştü. Hiç satır girilmemiş fişte (kap olarak açılan
 * fiş meşrudur) yalnız belge cümlesi basılır — "0 top Bitmiş Depo'da" demek,
 * olmayan bir malı arattırırdı.
 */
export function receiptSuccessText(o: ReceiptOutcome): string {
  const head = o.receiptNo ? `${o.receiptNo} oluşturuldu.` : "Mal kabul fişi oluşturuldu.";
  const classes = Array.from(new Set(o.lineClasses.length > 0 ? o.lineClasses : ["FINISHED" as const]));
  const shelves = classes.map((c) => receiptShelfTab(c, o.financeEnabled));
  const parts: string[] = [];
  if (o.rollCount > 0) {
    const note = classes.length === 1 && classes[0] === "RAW" ? " (işlenecek mal olarak alındı)" : classes.length === 1 && classes[0] === "SEMI_FINISHED" ? " (yarı mamul olarak alındı)" : "";
    parts.push(`${o.rollCount} top Kumaş Stoğu → ${shelves.join(" · ")} ${shelves.length > 1 ? "sekmelerinde" : "sekmesinde"}${note}.`);
  }
  if (o.yarnLineCount > 0) {
    parts.push(`${o.yarnLineCount} iplik satırı İplik Stoku'na işlendi.`);
  }
  return parts.length === 0 ? head : `${head} ${parts.join(" ")}`;
}
