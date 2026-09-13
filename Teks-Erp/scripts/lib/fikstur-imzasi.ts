// =============================================================================
// FİKSTÜR İMZASI — "bu satırı test paketi mi üretti" sorusunun TEK kaynağı
// =============================================================================
// NEDEN TEK KAYNAK: aynı soruyu iki bekçi ayrı ayrı cevaplıyordu
// (`test_consistency` §29 SQL ile, `test_roll_warehouse_stamp` Prisma ile) ve
// ikisi de YALNIZ BARKODA bakıyordu. Ön ek listesi iki yerde yaşarsa biri
// güncellenir öteki kalır — "türetilmiş alan / ayrışan yüzey" sınıfı.
//
// ⚠️ BARKOD ÖN EKİ TEK BAŞINA YETMEZ (ölçüldü 2026-09-13): fikstürünü GERÇEK
// servisten kuran bekçi (`inventory.createInitialEntry`) topa ÜRETİM FORMATINDA
// barkod verir — `T130926F2770`. O barkod `TEST-`/`TST-` ön eki TAŞIMAZ, yani
// ön eke bakan süzgeç test artığını CANLI VERİ sanar. `test_consistency` §29
// dört satırı tam böyle "üretim driftı" diye raporladı; kimlikleri KALEM
// kodundan çözüldü (`TEST-SSTR-…-KM`).
//
// ⇒ Kural: topun imzası İKİ kolondadır — kendi barkodu VEYA kaleminin kodu.
// Kalem kodu fikstürün elinde kalan tek güvenilir imzadır, çünkü barkodu
// SERVİS üretir. Fabrikada `TEST-`/`TST-`/`DEMO-` kodlu kalem yok, yani bu
// genişlemenin ölçüm kaybı bilinen ve sıfırdır.
//
// ⚠️ SÜZGEÇ YALNIZ KANITLA EKLENİR: "bu satırları test paketi üretti" ölçülmeden
// hiçbir bölüme gürültü süzgeci konmaz, yoksa kapı kendi kusurunu eler.
// =============================================================================
import type { Prisma } from "@prisma/client";

/**
 * Fixture/demo verisinin ön ekleri — ön ek eklemek için TEK yer burasıdır.
 *
 * ⚠️ TİRE LOAD-BEARING ve bu bir DARALTMADIR (beyan, 2026-09-13):
 * `test_roll_warehouse_stamp` eskiden TİRESİZ süzüyordu (`startsWith: "TEST"` /
 * `"TST"`), yani `TESTX…` gibi bir barkodu da fikstür sayardı. Tireli hâl SQL
 * yüzüyle ve belgeli konvansiyonla (`TEST-`/`TST-` ön ekli benzersiz iş anahtarı)
 * tutarlı. Daraltma bilinçli ve ölçüldü: bu DB'de hiçbir sayıyı değiştirmedi.
 * Daraltmanın yönü önemli — fikstür kümesi DARALIRSA kapı GENİŞLER (daha çok
 * satır "üretim" sayılır), yani hata tarafı güvenli taraftır.
 */
export const FIXTURE_PREFIXES = ["TEST-", "TST-", "DEMO-"] as const;

/** `<kolon>` fixture ön eki taşımıyor mu? (NULL = üretim sayılır, elenmez) */
export function notFixtureSql(column: string): string {
  const conds = FIXTURE_PREFIXES.map((p) => `${column} NOT LIKE '${p}%'`).join(" AND ");
  return `(${column} IS NULL OR (${conds}))`;
}

/**
 * Topun KALEMİ fixture ön eki taşımıyor mu — `<kolon>` topun id'sini (text) verir.
 *
 * Korele ALT SORGU kullanılır ki süzgeç DIŞARIDAN uygulanabilsin:
 * `consistency-check.sql`den AYNEN kopyalanan sorgunun metni değişmez (kopya
 * kayması o dosyanın en pahalı hatası olurdu).
 */
export function notFixtureItemOfRollSql(rollIdColumn: string): string {
  const conds = FIXTURE_PREFIXES.map((p) => `i2.code LIKE '${p}%'`).join(" OR ");
  return `NOT EXISTS (
    SELECT 1 FROM rolls r2 JOIN items i2 ON i2.id = r2."itemId"
    WHERE r2.id = ${rollIdColumn}::uuid AND (${conds})
  )`;
}

/**
 * Prisma ikizi — SQL yüklemiyle AYNI soruyu sorar ve onunla BİRLİKTE değişir
 * (boğaz-ikiz kuralı). "Fikstür değil" = ne barkodu ne kaleminin kodu ön ek
 * taşıyor.
 */
export function fikstursuzTopWhere(): Prisma.RollWhereInput {
  return {
    NOT: [
      ...FIXTURE_PREFIXES.map((p) => ({ barcode: { startsWith: p } })),
      ...FIXTURE_PREFIXES.map((p) => ({ item: { code: { startsWith: p } } })),
    ],
  };
}
