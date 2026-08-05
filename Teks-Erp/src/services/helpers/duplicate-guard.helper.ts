// =============================================================================
// Ham giriş mükerrer tuzağı — saf yardımcılar (kilit anahtarı + giriş damgası)
// =============================================================================
// Burası DB'ye dokunmaz; birim testlenebilir olsun diye ayrıldı
// (`scripts/test_kk1_duplicate_guard.ts` case 15).
// =============================================================================

import { Prisma } from "@prisma/client";

/**
 * Mükerrer ham giriş tuzağının penceresi — iki girişin "aynı an" sayıldığı azami
 * fark. 90 sn: bir operatörün "kaydolmadı" sanıp tekrar basma refleksi saniyeler
 * içindedir; gerçek iki ayrı topun ölçülüp girilmesi ise pratikte daha uzun sürer.
 * Pencereyi büyütmek yanlış pozitifi (meşru arka arkaya aynı top) artırır.
 */
export const DUPLICATE_ENTRY_WINDOW_MS = 90_000;

/**
 * `pg_advisory_xact_lock` NAMESPACE'i (2 argümanlı form).
 *
 * 1-argümanlı `pg_advisory_xact_lock(bigint)` ile 2-argümanlı `(int,int)` formu
 * PostgreSQL'de **ayrı anahtar uzaylarıdır**. Repodaki diğer iki advisory kullanıcısı
 * (`session-registry`, `permission-management`) 1-arg formunu kullanıyor; KK1 anahtarı
 * binlerce farklı değer ürettiği için aynı uzayda `hashtext` çakışması olasıdır ve
 * sonucu "sessiz cross-subsystem serileşme" olurdu — yanlış sonuç değil, teşhisi
 * imkânsız bir gecikme. Ayrı uzay bunu sıfırlar, maliyeti yok.
 */
export const DUPLICATE_GUARD_LOCK_NS = 8021;

/**
 * Damganın MAKUL kabul edildiği geçmiş sınırı.
 * Mobil offline kuyruğu `PERSIST_MAX_AGE_MS = 24 saat` ile sınırlı (eski snapshot
 * hydrate'te atılır) → 36 saat rahat bir tampon; bundan eskisi neredeyse kesin
 * bozuk cihaz saatidir.
 */
export const ENTRY_STAMP_MAX_PAST_MS = 36 * 60 * 60 * 1000;

/**
 * Damganın MAKUL kabul edildiği gelecek sınırı. Meşru "gelecekte girilmiş" top
 * YOKTUR; bu yalnız mütevazı saat ilerisini tolere eder.
 */
export const ENTRY_STAMP_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Tuzağın EŞİTLİK DEMETİ'nden kilit anahtarı üretir.
 *
 * ⚠️ Anahtar, guard sorgusunun `WHERE`'iyle **birebir aynı alanları** taşımalı:
 * daha dar olursa yarış açık kalır (iki eşzamanlı ikiz farklı kilit alır), daha
 * geniş olursa ilgisiz girişler boşuna serileşir.
 *
 * ⚠️ Decimal alanlar DB HASSASİYETİNE yuvarlanır (`toFixed(3)` — kolonlar
 * `Decimal(12,3)`). `String(700)` ile `String(700.0)` JS'te zaten aynıdır; asıl
 * risk ONDALIK GÜRÜLTÜSÜDÜR: `700.0001` ile `700.0004` DB'de **aynı satır
 * değerine** (700.000) iner ama ham string'lenirse İKİ FARKLI kilit alır → iki
 * eşzamanlı ikiz birbirini beklemez, yarış tam da düzeltmeye çalıştığımız yerde
 * açık kalır. Yuvarlama GÜVENLİ yöndedir: fazladan serileşme zararsız, eksik
 * serileşme deliktir. Bekçi: `test_kk1_duplicate_guard` case 15.
 */
export function duplicateGuardLockKey(p: {
  entrySource: string;
  itemId: string;
  colorId: string | null;
  initialQty: number;
  width: number | null;
  userId: string | null;
  machineId: string | null;
}): string {
  const dec = (v: number | null) =>
    v == null ? "-" : new Prisma.Decimal(v).toFixed(3);
  return [
    "kk1dup",
    p.entrySource,
    p.itemId,
    p.colorId ?? "-",
    dec(p.initialQty),
    dec(p.width),
    p.userId ?? "-",
    p.machineId ?? "-",
  ].join("|");
}

export interface EntryStampResolution {
  /** Kolona YAZILACAK değer — güvenilmezse `null`. */
  storedEnteredAt: Date | null;
  /** Pencerenin ÇAPASI (ms) — damga güvenilmezse sunucu saati. */
  anchorMs: number;
}

/**
 * İstemcinin beyan ettiği giriş anını değerlendirir.
 *
 * NEDEN GEREKLİ: offline kuyruk tek flush'ta boşalır → yazılan her kaydın sunucu
 * `createdAt`'i milisaniyelerle ayrılır, yani **sunucu saatiyle ölçülen 90 sn
 * penceresi her flush'ta DAİMA doludur**. Çevrimdışıyken 3 dakika arayla bilerek
 * girilmiş meşru toplar (aynı partiden eşit metrajlı toplar — tekstilde olağan)
 * bu yüzden 409 fırtınası üretirdi. Damga operatörün GERÇEK ritmini taşır.
 *
 * NEDEN GÜVENİLEBİLİR: tuzak zaten `createdById` **VE** `createdMachineId`
 * eşitliği arar → karşılaştırılan iki damga **aynı fiziksel cihazın aynı
 * saatinden** gelir. Sabit ofset FARKTA sadeleşir; guard'ın ihtiyacı olan tek
 * şey farktır.
 *
 * NEDEN 400 DEĞİL: bozuk RTC'li bir tablet üretimi DURDURMAMALI. Aralık dışı
 * damga sessizce düşer ve davranış bugünküne (sunucu saati) iner — en kötü
 * ihtimalle eskisi kadar iyi.
 *
 * NEDEN AYNI ANDA "SAKLAMA": saklanan değer ile kullanılan çapa **hep aynı
 * kaynaktan** gelsin diye. Kolon doluysa "bu damgaya güvenildi", boşsa "sunucu
 * saati kullanıldı" demektir — bu satır ileride ikiz olarak sorgulandığında da
 * tutarlı cevap verir. Bozuk değeri saklayıp yok saymak, gelecekteki sorguyu tam
 * da güvenilmez değerle karşılaştırmaya zorlardı.
 */
export function resolveEntryStamp(
  declared: Date | null | undefined,
  now: Date,
): EntryStampResolution {
  const nowMs = now.getTime();
  if (!declared || Number.isNaN(declared.getTime())) {
    return { storedEnteredAt: null, anchorMs: nowMs };
  }
  const d = declared.getTime();
  const plausible =
    d >= nowMs - ENTRY_STAMP_MAX_PAST_MS && d <= nowMs + ENTRY_STAMP_MAX_FUTURE_MS;
  return plausible
    ? { storedEnteredAt: declared, anchorMs: d }
    : { storedEnteredAt: null, anchorMs: nowMs };
}

/**
 * Guard sorgusunun `createdAt` TABANI — **doğruluk için değil, INDEX için**.
 *
 * `clientEnteredAt` üstündeki `OR` bloğu tek başına konulursa
 * `@@index([entrySource, createdAt])`'in range parçası kullanılamaz ve planlayıcı
 * yalnız `entrySource` eşitliğine tutunur → tüm `SUPPLIER_RECEIPT` satırları
 * taranır. Bu sorgu artık tx İÇİNDE koştuğu için o tarama fabrikadaki tüm top
 * yaratımını serileştirirdi.
 *
 * SAĞLAMLIK (hiçbir gerçek ikiz elenmez):
 *  • Damgalı dal: ikizin damgası ≥ `anchor − pencere`. Damga yalnız kendi
 *    `createdAt`'inin +5 dk ilerisini geçmiyorsa saklandığı için ikizin
 *    `createdAt`'i ≥ damgası − 5 dk ⇒ ≥ `anchor − pencere − 5 dk`.
 *  • Damgasız dal: kendi predicate'i zaten `createdAt ≥ anchor − pencere`.
 *  • Gelecek damga: `min(anchor, now)` tabanı `now`'a çeker; gereken alt sınır
 *    daha da yukarıdadır.
 * Taban bunların en küçüğünü 60 sn payla kapsar.
 */
export function duplicateGuardCreatedAtFloor(anchorMs: number, nowMs: number): Date {
  return new Date(
    Math.min(anchorMs, nowMs) -
      DUPLICATE_ENTRY_WINDOW_MS -
      ENTRY_STAMP_MAX_FUTURE_MS -
      60_000,
  );
}
