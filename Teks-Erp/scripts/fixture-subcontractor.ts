// =============================================================================
// Paylaşılan test fixture'ı — FASON FİRMA (Subcontractor).
// `test_` öneki YOK → run-all-tests koşucusu bunu bir test dosyası saymaz.
// =============================================================================
//
// NEDEN VAR (2026-08-02 saha bulgusu):
// 29 fason testi firmasını `subcontractor.findFirst({ code: "BOYER" })` ile
// seed master-verisinden çözüyordu. Bu CLAUDE.md "Test Scriptleri" kuralına
// (seed master-data'sı business-key ile çözülür, hardcoded UUID yazma) uygun —
// ama kural sessiz bir VARSAYIMA dayanıyor: seed kaydı yerinde ve KULLANILABİLİR.
// Varsayım çöktü: panelden aynı adla ikinci bir firma açıldığı için seed'in
// `BOYER` (ve `KESTEL`) kayıtları mükerrerliği gidermek adına PASİFE alındı.
// `findFirst` kaydı buldu (silinmiş değil), test kurulumu geçti, ama ilk
// `dispatch()` çağrısı "Fason firma pasif durumda" ile patladı → 29 dosya /
// 472 `check()` topluca SUSTU. Gerçek bir fason regresyonu çıksa aynı kırmızıya
// karışırdı; kimse ayırt edemezdi.
//
// ÇÖZÜM: test ihtiyaç duyduğu firmayı KENDİ üretir. Fabrikanın master verisi ne
// olursa olsun, kim neyi pasife çekerse çeksin testler konuşmaya devam eder.
//
// "Herhangi bir aktif fason bul" BİLİNÇLİ OLARAK YAPILMADI: belirsizlik açık
// kırmızıdan tehlikelidir. Yanlış kategorideki bir firma seçilirse test yanlış
// şeyi doğrulayarak GEÇER (örn. `appliesColor=false` bir firmayla boyahane
// senaryosu kurulur, renk kalıtımı hiç sınanmaz). Bu yüzden fixture SABİT kodlu
// ve kategorisi AÇIKÇA doğrulanır.
//
// -----------------------------------------------------------------------------
// KALICI FIXTURE — CLAUDE.md "test kendi yarattığını siler" kuralından BİLİNÇLİ
// SAPMA. Gerekçe:
//   1) PAYLAŞILAN: 29 dosya çağırıyor. Her dosyada yarat/sil yapmak, aynı anda
//      koşan iki testin birbirinin firmasını silmesi demek (koşucu sıralı
//      koşuyor ama tek tek elle koşturma paraleldir) → yeni bir flake sınıfı.
//      Üstelik firmaya bağlı `SubcontractorDispatch`/`Receipt` satırları FK ile
//      duruyor; silme zaten çoğu testte P2003 verirdi.
//   2) IDEMPOTENT: `upsert` — 29 kez çağrılsa da tek satır kalır, yan etki yok.
//   3) TEST- ÖNEKLİ + ZARARSIZ: kod `TEST-FASON-*`, ad "TEST ..." ile başlar;
//      fabrikanın gerçek firma listesinde ne kimliği ne adı bir gerçek firmayla
//      karışır. Master-data satırıdır, operasyonel veri değil.
//   4) `isActive: true` GARANTİSİ upsert'in `update` dalındadır: biri bu TEST-
//      kaydını pasife çekerse fixture onu geri açar. Bu, kullanıcının kendi
//      verisine dokunmak DEĞİLDİR — `BOYER`/`KESTEL` kayıtlarına bu dosya asla
//      yazmaz, onlar pasif kalır (kullanıcının bilinçli veri düzeni).
//
// AD ÇAKIŞMASI: `test_consistency.ts` "Master-data ad mükerrer (aktif,
// case/boşluk-duyarsız)" bekçisi aktif firmalarda `lower(trim(name))` tekrarını
// yakalar. Fixture adları o bekçiyi düşürmemek için gerçek firma adlarıyla
// çakışmayacak biçimde seçildi ("TEST " ön eki).
// =============================================================================
import prisma from "../src/lib/prisma";

export interface TestSubcontractorSpec {
  /** `Subcontractor.code` (@unique) — SABİT, `TEST-` önekli. */
  code: string;
  /** Aktif firmalarla çakışmayan ad (mükerrer-ad bekçisi). */
  name: string;
  /**
   * Firmanın bağlanacağı hizmet kategorisi — `SubcontractorCategory.code`.
   * Kategori linki ŞART: `dispatch()` adımın `requiredCategoryId`'si doluysa
   * `SubcontractorToCategory` eşleşmesi arar ("Bu fason firma bu kategoride
   * hizmet vermiyor" 400).
   */
  categoryCode: string;
  /**
   * Kategoriyi ÖNCE bu istasyonun `defaultCategoryId`'sinden çöz. Testler adımın
   * `requiredCategoryId`'sini tam da buradan alıyor (`station.defaultCategory`)
   * — aynı kaynaktan çözmek "firma kategoride değil" sapmasını imkânsız kılar.
   * Bulunamazsa `categoryCode`'a düşülür.
   */
  stationCode?: string;
  /**
   * Beklenen kategori bayrağı. Çözülen kategori bunu taşımıyorsa fixture HATA
   * fırlatır — testin "yanlış özellikli firmayla sessizce geçmesi" engellenir.
   */
  expectAppliesColor: boolean;
}

/**
 * Seed `BOYER`'in yerine geçen boyahane fasonu.
 * Seed karşılığı: kategori `BOYA` (appliesColor=true, appliesProperty=true).
 */
export const TEST_DYE_HOUSE: TestSubcontractorSpec = {
  code: "TEST-FASON-BOYA",
  name: "TEST Fason Boyahane",
  categoryCode: "BOYA",
  stationCode: "BOYA_FASON",
  expectAppliesColor: true,
};

/**
 * Seed `KESTEL`'in yerine geçen zımpara fasonu — "renk vermeyen ikinci firma".
 * Seed karşılığı: kategori `ZIMPARA` (appliesColor=false, appliesProperty=true).
 * Ardışık fason senaryolarında boyahaneden AYRI bir firma olması gerekir.
 */
export const TEST_SANDING: TestSubcontractorSpec = {
  code: "TEST-FASON-ZIMPARA",
  name: "TEST Fason Zımpara",
  categoryCode: "ZIMPARA",
  stationCode: "ZIMPARA_FASON",
  expectAppliesColor: false,
};

/**
 * Seed `KARTELAAS`'ın yerine geçen kartela fasonu.
 * Seed karşılığı: kategori `KARTELA` (appliesColor=false).
 * `KartelaService.dispatch` kategori BAKMAZ, yalnız `isActive` ister — kategori
 * bağı yine de kuruluyor ki firma panelde "kartelacı" olarak doğru görünsün ve
 * ileride bir kategori guard'ı eklenirse fixture sessizce düşmesin.
 */
export const TEST_KARTELA: TestSubcontractorSpec = {
  code: "TEST-FASON-KARTELA",
  name: "TEST Fason Kartela",
  categoryCode: "KARTELA",
  expectAppliesColor: false,
};

export interface TestSubcontractor {
  id: string;
  code: string;
  name: string;
  /** Bağlandığı kategori — testler istersen adımın `requiredCategoryId`'sine yazar. */
  categoryId: string;
}

async function resolveCategoryId(spec: TestSubcontractorSpec): Promise<string> {
  // 1) İstasyonun defaultCategory'si — testlerin `requiredCategoryId` kaynağı.
  if (spec.stationCode) {
    const station = await prisma.station.findFirst({
      where: { code: spec.stationCode },
      select: { defaultCategoryId: true },
    });
    if (station?.defaultCategoryId) return station.defaultCategoryId;
  }
  // 2) Kategori business-key.
  const cat = await prisma.subcontractorCategory.findUnique({
    where: { code: spec.categoryCode },
    select: { id: true },
  });
  if (cat) return cat.id;
  throw new Error(
    `Fason kategorisi çözülemedi: ${spec.categoryCode}` +
      (spec.stationCode ? ` (istasyon ${spec.stationCode}.defaultCategory da boş)` : "") +
      " — önce 'npm run seed'.",
  );
}

/**
 * İstenen fason firmasını GARANTİ eder: yoksa yaratır, varsa yeniden kullanır ve
 * `isActive: true` + kategori bağını tazeler. Idempotent — pakette 29 kez
 * çağrılır. Firma SİLİNMEZ (bkz. dosya başı "KALICI FIXTURE" gerekçesi).
 */
export async function ensureTestSubcontractor(
  spec: TestSubcontractorSpec,
): Promise<TestSubcontractor> {
  const categoryId = await resolveCategoryId(spec);

  // Kategori gerçekten beklenen özellikte mi? (yanlış firmayla sessiz GEÇME kapısı)
  const cat = await prisma.subcontractorCategory.findUnique({
    where: { id: categoryId },
    select: { code: true, appliesColor: true, isActive: true },
  });
  if (!cat) throw new Error(`Fason kategorisi bulunamadı: ${categoryId}`);
  if (!cat.isActive) {
    throw new Error(
      `Fason kategorisi pasif: ${cat.code} — test fixture'ı aktif kategori bekliyor.`,
    );
  }
  if (cat.appliesColor !== spec.expectAppliesColor) {
    throw new Error(
      `Fason kategorisi beklenen özellikte değil: ${cat.code} appliesColor=${cat.appliesColor}, ` +
        `beklenen ${spec.expectAppliesColor} (fixture: ${spec.code}).`,
    );
  }

  const sub = await prisma.subcontractor.upsert({
    where: { code: spec.code },
    create: {
      code: spec.code,
      name: spec.name,
      address: "Test fixture — scripts/fixture-subcontractor.ts",
      isActive: true,
    },
    // Biri pasife çekerse geri aç; ad da sabit kalsın (mükerrer-ad bekçisi).
    update: { name: spec.name, isActive: true },
    select: { id: true, code: true, name: true },
  });

  await prisma.subcontractorToCategory.upsert({
    where: { subcontractorId_categoryId: { subcontractorId: sub.id, categoryId } },
    create: { subcontractorId: sub.id, categoryId },
    update: {},
  });

  return { ...sub, categoryId };
}

/** Kısayol: boyahane fasonu (eski `BOYER`). */
export function ensureTestDyeHouse(): Promise<TestSubcontractor> {
  return ensureTestSubcontractor(TEST_DYE_HOUSE);
}

/** Kısayol: zımpara fasonu (eski `KESTEL`). */
export function ensureTestSander(): Promise<TestSubcontractor> {
  return ensureTestSubcontractor(TEST_SANDING);
}

/** Kısayol: kartela fasonu (eski `KARTELAAS`). */
export function ensureTestKartela(): Promise<TestSubcontractor> {
  return ensureTestSubcontractor(TEST_KARTELA);
}
