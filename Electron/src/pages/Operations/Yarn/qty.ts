// =============================================================================
// KG BİÇİMLENDİRME + MİKTAR GİRDİSİ DOĞRULAMASI (saf katman)
// =============================================================================
// NEDEN AYRI DOSYA: bu iki kural ekrandan bağımsızdır ve tersine çevrilmesi
// hiçbir testi kırmamalı DEĞİL — bileşen içinde bir `if` olarak yaşasalardı tam
// da bu olurdu (projenin yazılı deseni: `canQuickShip`, `resolveRollTabs`,
// `orders-regime.ts`). Bekçi: `qty.test.ts`.
//
// ⚠️ NEDEN `money()` KULLANILMIYOR: `money()` PARA biçimlendiricisidir ve sonuna
// para birimi simgesi koyar. Kg bir para birimi değildir; "1.250,00 ₺" basmak
// depo ekranında düpedüz yanlış bilgidir. Ama `money()`in 2026-08-14'te ölçülen
// DERSİ buraya birebir taşındı: Prisma `Decimal` kolonları JSON'a **STRING**
// düşer ve `String.prototype.toLocaleString` seçenekleri SESSİZCE yok sayar
// ("3324" → "3324", olması gereken "3.324,00"). Bu yüzden `kg()` de
// `number | string` alır ve İÇERİDE `Number()` ile çevirir.
// =============================================================================

/** Decimal kolonun JSON karşılığı — number DA string DE gelebilir. */
type Numeric = number | string | null | undefined;

/**
 * Kg biçimlendirici — "1.250,00 kg" / "−12,50 kg" / "—".
 *
 * ⚠️ ONDALIK TABANI 2 HANEDİR ve bu bilinçli: tr-TR'de binlik ayracı NOKTA,
 * ondalık ayracı VİRGÜLdür. `minimumFractionDigits: 0` verilseydi 1250 kg
 * "1.250" olarak basılırdı ve bu, aynı ekranda "12,5" da gören bir operatör
 * tarafından "1,250" (bir buçuk kilo) diye okunabilirdi. Sabit iki hane
 * belirsizliği tamamen kaldırır. Tavan 3 hanedir çünkü kolon `Decimal(14,3)` —
 * daha azını basmak defterdeki gerçek rakamı ekranda YUVARLARDI.
 *
 * ⚠️ Sayıya çevrilemeyen değerde `—` basılır, "0,00 kg" DEĞİL: sıfır bir
 * BAKİYEDİR ve "bilinmiyor" ile karıştırılamaz (`money()` ile aynı kural).
 */
export function kg(value: Numeric): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;
}

/**
 * Bakiye EKSİ mi?
 *
 * ⚠️ EKSİ BAKİYE HATA DEĞİLDİR ve MEŞRUDUR: açılış/sayım girilmeden çıkış
 * yazıldıysa defter gerçekten eksidir. Sıfıra kırpmak eksiği gizleyip envanteri
 * sessizce yanlışlar, "hata" diye kırmızıya boyamak ise operatörü olmayan bir
 * arıza aramaya gönderir. Doğru cevap: GÖRÜNÜR yap, nötr uyar.
 */
export function isNegative(value: Numeric): boolean {
  if (value === null || value === undefined || value === "") return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n < 0;
}

export type QtyProblem = "EMPTY" | "COMMA" | "NEGATIVE" | "NOT_A_NUMBER" | "NOT_POSITIVE";

export type QtyCheck =
  /** Backend'e AYNEN gidecek metin (kırpılmış). Sayıya çevrilmez — bkz. service.ts. */
  | { ok: true; value: string }
  | { ok: false; problem: QtyProblem; hint: string };

/**
 * Miktar kutusunun ÖN kontrolü.
 *
 * ⚠️ VİRGÜL SESSİZCE NOKTAYA ÇEVRİLMEZ — backend de çevirmiyor ve gerekçesi
 * aynı: "1,500" bu ülkede hem "1,5" hem "1500" okunur, tahmin etmek deftere
 * yanlış rakam yazmanın EN SESSİZ yoludur. Doğru davranış reddedip DOĞRU YAZIMI
 * SÖYLEMEKTİR. Burada erken söylemenin tek amacı sunucuya gidip 400 ile dönmeyi
 * beklememektir; backend'in kendi mesajı hâlâ ekranda gösterilir (kural bir
 * yerde değil İKİ yerde de aynıdır, ayrışırsa hangisinin doğru olduğu sorulamaz).
 *
 * ⚠️ EKSİ İŞARET AYRI BİR HATA: "−5" yazan kullanıcı çıkış yapmak istiyordur ve
 * ona "sayı okunamadı" demek yardım etmez. Yönün İŞLEM TÜRÜNDEN geldiği tam
 * burada söylenir.
 */
export function checkQtyInput(raw: string): QtyCheck {
  const v = raw.trim();
  if (!v) {
    return { ok: false, problem: "EMPTY", hint: "Miktar girin." };
  }
  if (v.includes(",")) {
    return {
      ok: false,
      problem: "COMMA",
      hint: 'Ondalık ayırıcı NOKTA\'dır: "12,5" değil "12.5" yazın. Virgül otomatik çevrilmez — "1,500" hem 1,5 hem 1500 okunabilirdi.',
    };
  }
  if (v.startsWith("-") || v.startsWith("−")) {
    return {
      ok: false,
      problem: "NEGATIVE",
      hint: "Miktarı eksi yazmayın. Yönü işlem türü belirler — çıkış için türü “Çıkış (−)” seçin.",
    };
  }
  if (!/^\d+(\.\d+)?$/.test(v)) {
    return {
      ok: false,
      problem: "NOT_A_NUMBER",
      hint: 'Yalnız rakam ve nokta yazın (örn. "250" veya "12.5").',
    };
  }
  if (Number(v) <= 0) {
    return { ok: false, problem: "NOT_POSITIVE", hint: "Miktar sıfırdan büyük olmalı." };
  }
  return { ok: true, value: v };
}

// -----------------------------------------------------------------------------
// GÜN SINIRI
// -----------------------------------------------------------------------------
// ⚠️ `toISOString().slice(0,10)` KULLANMA — UTC'ye çevirir ve TR'de gece
// yarısından önceki saatlerde günü BİR GERİ kaydırır. Gün sınırı İSTEMCİNİNDİR:
// backend `dateFrom`/`dateTo`'yu mutlak an olarak alır ve ekstra yuvarlama
// YAPMAZ (`useReportDateRange` sözleşmesi). Boş/bozuk değerde `undefined` döner
// ki parametre hiç gitmesin — "bir tarih" uydurmak, filtreyi sessizce yanlış
// pencereye kilitlerdi.

function parseYmdLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  // `new Date(2026, 1, 31)` hata vermez, 3 Mart'a TAŞAR — geri okuyup doğrula.
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function dayStartIso(value: string): string | undefined {
  const d = parseYmdLocal(value);
  if (!d) return undefined;
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function dayEndIso(value: string): string | undefined {
  const d = parseYmdLocal(value);
  if (!d) return undefined;
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
