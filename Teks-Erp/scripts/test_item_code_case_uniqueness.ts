// =============================================================================
// Test: KOD TEKİLLİĞİ büyük/küçük harf farkına bakmaz (§18) — ve tarihsel
//       mükerrer kayıtlar düzenlenebilir kalır.
// Çalıştır: npx tsx scripts/test_item_code_case_uniqueness.ts
// =============================================================================
// SAHA VAKASI (2026-08-15, canlı fabrika-sim DB'si): 218 ürün kodunda 8 çakışma
// grubu / 9 fazla satır. Üçünde İKİ TARAF DA AKTİF ve ikisinde ADLAR FARKLI:
//   • SANTUK (BORANCIK)      ↔ santuk (ŞANTUK)        — İKİ FARKLI ÜRÜN, AYNI KOD
//   • SEFA   (MIKROCANVAS)   ↔ sefa   (MİKRO CANVAS)
//   • BGR150SEFFAF           ↔ bgr150seffaf           (aynı ad)
// Ad-mükerrer guard'ı (`assertNameNotDuplicate`) ilk ikisini YAKALAYAMAZ, çünkü
// adlar gerçekten farklı. Kod bu sistemde KİMLİKTİR (etikete basılır, belgede
// görünür, dış eşleşmede kullanılır) — iki kayıt aynı kimliği taşıyamaz.
//
// KÖK NEDEN: kod tekilliği TAM EŞLEŞME ile aranıyordu —
//   item.service.ts  `prisma.item.findFirst({ where: { code: manualCode } })`
//   base.service.ts  `this.delegate.findFirst({ where: { [key]: incomingValue } })`
//   subcontractor-management.service.ts  (iki ayrı kopya daha)
// ve kod, adın aksine, karşılaştırma öncesi hiç katlanmıyordu.
//
// Doğrulananlar:
//   1. KATLAMA DOĞRU (körlük zemini): `foldCodeForCompare` ASCII harf farkını
//      YAKALAR, Türkçe i-ailesini (`i ı İ I`) tek kimliğe indirger, iç boşluğu
//      tekler ve GERÇEKTEN farklı kodları (SEFA/SEFA2) birleştirmez.
//      ⚠️ İKİ YÖNLÜ sonda: `foldNameForCompare` (tr-TR) kodda kullanılsaydı
//      "sip"/"SIP" kaçardı; düz `toUpperCase()` kullanılsaydı "İSTANBUL"/"istanbul"
//      kaçardı. Her iki yanlış katlama da bu bölümde kırmızı verir.
//   2. Item create: harf farkıyla aynı kod → 409 (somut mesaj); gerçekten farklı
//      kod → geçer.
//   3. Türkçe i/I sondası: tr-TR katlamasına dönülürse KIRMIZI verir.
//   4. REACTIVATE YALNIZ TAM EŞLEŞMEDE. Pasif kayıt kodu BİREBİR yazılınca dirilir
//      (eski davranış birebir korunur); yalnız HARF FARKIYLA eşleşme 409'dur —
//      diriltme yolu diriltilen kaydın adını/birimini EZER, M:N listelerini SİLER
//      ve `Item.itemType`'ı yazmaz (update'te FORBIDDEN) → kullanıcının hiç
//      yazmadığı bir kodu taşıyan kaydı canlandırmak sessizce yanlış ürün üretir.
//   4b. AKTİF harf-ikizi VARKEN de tam eşleşmeli PASİF kayıt diriltilebilir
//      (canlı `ACTIVO`/`activo`, `BAYROFLAM`/`bayroflam`, `OSLO`/`oslo` emsali) —
//      aksi halde §18 düzeltmesi canlı veride ÇALIŞAN bir yolu öldürürdü.
//   5. Harf farkıyla eşleşen PASİF kayıt(lar) → 409 ve mesaj çıkış yolunu söyler
//      (canlı `MC155`/`Mc155`/`mc155` grubu üç FARKLI ad taşıyor).
//   6. TARİHSEL MÜKERRER KAYIT DÜZENLENEBİLİR: yan yana duran iki case-ikizi
//      ad/birim güncellemesinde 409 vermez (ad guard'ının emsali).
//   7. Otomatik kod (`STK-`) yolu etkilenmedi — kapsam dar.
//   8. BaseService yolu (QualityGrade): create harf farkıyla 409; update YALNIZ
//      kod gerçekten değişirken kontrol eder.
//   9. Eşzamanlılık: aynı katlanmış kodla N paralel create → 1 geçer + N-1 × 409
//      (advisory kilit; DB'de katlanmış unique sed BİLİNÇLİ olarak YOK).
//  10. CustomerBranch ihracat kodu: aynı müşteride harf farkıyla aynı kod → 409.
//      Bu bölüm bir REGRESYON bekçisidir — orada koruma §18'den ÖNCE de vardı
//      (tr-TR katlamasıyla) ve düz `toUpperCase()`'e geçiş onu sessizce
//      kaybettirmişti.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-15; her sondadan
// sonra dosyalar md5 ile birebir geri yüklendi). Bu dosyayı değiştiren kişi
// AYNI SONDALARI TEKRARLAR:
//   S1  `foldCodeForCompare` → `toLocaleUpperCase("tr-TR")` (yanlış katlama)
//         → 4 kontrol KIRMIZI (2026-08-15, ilk turda ölçüldü)
//   S1b `foldCodeForCompare` → düz `trim().toUpperCase()` (i-ailesi indirgemesi +
//        boşluk teklemesi YOK)  → **5 kontrol KIRMIZI**: §1 "Türkçe İ indirgeniyor",
//        §1 "1.KALİTE ≡ 1.KALITE", §1 "iç boşluk tekleniyor", §10 "istanbul ↔
//        İSTANBUL 409", §10 "reddedilen şubeler yazılmadı" (3 satır doğdu)
//   S2  `matchesOf` süzgeci katlamadan TAM EŞLEŞMEYE çevrildi (§18 öncesi davranış)
//         → **13 kontrol KIRMIZI** (§2 dört · §4 üç · §5 iki · §8 bir · §9 üç)
//   S3  base.service update kod guard'ı devre dışı → 1 kontrol KIRMIZI (§8)
//         (2026-08-15, ilk turda ölçüldü)
//   S4  `decideCodeUniqueness`'te TAM EŞLEŞMELİ pasif diriltme, aktif harf-ikizi
//        varsa 409'a çevrildi → **1 kontrol KIRMIZI** (§4b) — canlı veride ÇALIŞAN
//        diriltme yolunun ölmesi. ⚠️ §4b çağrısı bilerek try/catch ile sarılıdır;
//        sarılmasaydı test kırmızı kontrol yerine ÇÖKER ve sonda sayılamazdı.
// =============================================================================

import { randomUUID } from "crypto";
import prisma, { pool } from "../src/lib/prisma";
import { ItemService } from "../src/services/item.service";
import { BaseService } from "../src/services/base.service";
import { foldCodeForCompare } from "../src/utils/code-format";
import { foldNameForCompare } from "../src/services/helpers/name-normalize.helper";
import { CustomerBranchService } from "../src/services/customer-branch.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/**
 * Hata gövdesini TİPLİ oku.
 * ⚠️ `catch (e) { err = e as typeof err }` YAZMA — akış daraltmasıyla `never`'a
 * iner ve tüm hata kontrolleri sessizce hiçbir şey doğrulamaz.
 */
function errInfo(e: unknown): { status?: number; message: string } {
  const err = e as { statusCode?: number; message?: string } | null;
  return { status: err?.statusCode, message: err?.message ?? String(e) };
}

/** Reddetmeyi mesaj-parçasıyla birlikte doğrula (status da kontrol edilir). */
async function expectConflict(
  label: string,
  part: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    check(label, false, "409 bekleniyordu, istek GEÇTİ");
  } catch (e) {
    const info = errInfo(e);
    check(
      label,
      info.status === 409 && info.message.includes(part),
      `${info.status} · ${info.message}`,
    );
  }
}

const itemService = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  duplicateNameField: "name",
  entityLabel: "ürün",
});

const gradeService = new BaseService({
  modelName: "qualityGrade",
  tableName: "QUALITY_GRADE",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  uniqueField: "code",
  duplicateNameField: "name",
  entityLabel: "kalite sınıfı",
});

const branchService = new CustomerBranchService();

const TS = `${process.pid}${randomUUID().slice(0, 6)}`.toUpperCase();
const itemIds: string[] = [];
const gradeIds: string[] = [];
const customerIds: string[] = [];

function trackItem(res: { data: unknown }): { id: string; code: string } {
  const item = res.data as { id: string; code: string };
  itemIds.push(item.id);
  return item;
}

/**
 * ⚠️ ÇIPLAK `catch` YASAK (2026-09-13): bir yokluğa mekanizma atfetmek, o mekanizmayı
 * ÖLÇMEK değildir. Bu dosyada İKİ mekanizma var ve **etiket onları ayırmak zorundadır**:
 *   · **SED**   → DB katmanı, `P2002` + kısıt `upper(code::text)` / `items_code_fold`
 *   · **GUARD** → uygulama katmanı, `assertNameNotDuplicate` → **409**
 * Kural kitabı ikisini bilerek ayırıyor (*"uygulama bekçisi anlaşılır 409'u verir; DB seddi
 * yalnız yarış/config/import/elle SQL yollarını kapatan SESSİZ SON HATTIR"*), o yüzden
 * ikisini tek etikette "sed" diye anmak kural kitabını da yalanlar.
 */
function sedMi(e: unknown): boolean {
  const p = e as { code?: string; message?: string };
  return p?.code === "P2002" && /upper\(code|items_code_fold/.test(p.message ?? "");
}
function guardMi(e: unknown): boolean {
  const p = e as { statusCode?: number; status?: number; message?: string };
  return (p?.statusCode ?? p?.status) === 409;
}

async function main(): Promise<void> {
  try {
    // ── [1] KÖRLÜK ZEMİNİ: doğru katlama fonksiyonu kullanılıyor mu ───────────
    console.log("\n[1] Katlama fonksiyonu + fixture zemini");
    check(
      "foldCodeForCompare yerel-BAĞIMSIZ ('sip' ≡ 'SIP')",
      foldCodeForCompare("sip") === foldCodeForCompare("SIP"),
      `${foldCodeForCompare("sip")} / ${foldCodeForCompare("SIP")}`,
    );
    check(
      "tr-TR katlaması KOD için YANLIŞ olurdu ('sip' → 'SİP')",
      foldNameForCompare("sip") !== foldCodeForCompare("sip"),
      `${foldNameForCompare("sip")} ≠ ${foldCodeForCompare("sip")}`,
    );
    check(
      "boşluk/harf düzeni normalize ('  Mc155 ' ≡ 'MC155')",
      foldCodeForCompare("  Mc155 ") === foldCodeForCompare("MC155"),
    );
    // ── i-AİLESİ: düz `toUpperCase()` kullanılsaydı bu üçü KIRMIZI olurdu ────
    check(
      "Türkçe İ indirgeniyor ('istanbul' ≡ 'İSTANBUL')",
      foldCodeForCompare("istanbul") === foldCodeForCompare("İSTANBUL"),
      `${foldCodeForCompare("istanbul")} / ${foldCodeForCompare("İSTANBUL")}`,
    );
    check(
      "Türkçe ı indirgeniyor ('AKıN' ≡ 'AKIN' — fail-closed yön)",
      foldCodeForCompare("AKıN") === foldCodeForCompare("AKIN"),
    );
    check(
      "ASCII olmayan kod alanı ('1.KALİTE' ≡ '1.KALITE')",
      foldCodeForCompare("1.KALİTE") === foldCodeForCompare("1.KALITE"),
    );
    check(
      "iç boşluk tekleniyor ('TR 34' ≡ 'TR  34')",
      foldCodeForCompare("TR 34") === foldCodeForCompare("TR  34"),
    );
    // ── AŞIRI KATLAMA SONDASI: guard kapsamı genişlemesin ───────────────────
    check(
      "gerçekten farklı kodlar BİRLEŞMİYOR ('SEFA' ≠ 'SEFA2')",
      foldCodeForCompare("SEFA") !== foldCodeForCompare("SEFA2"),
    );
    check(
      "diğer Türkçe harfler bozulmuyor ('şantuk' ≡ 'ŞANTUK', ≠ 'SANTUK')",
      foldCodeForCompare("şantuk") === foldCodeForCompare("ŞANTUK") &&
        foldCodeForCompare("ŞANTUK") !== foldCodeForCompare("SANTUK"),
    );

    // Tarihsel mükerrer (§6) zemini: SERVİSİ ATLAYARAK doğrudan DB'ye yazılır —
    // canlıdaki SANTUK/santuk çiftinin birebir simülasyonu. Guard bunları
    // yaratamaz (yaratabilseydi düzeltme çalışmıyor demekti, §2 onu ölçüyor).
    const histCode = `TEST-HIST-${TS}`;
    const histA = await prisma.item.create({
      data: { code: histCode, name: `TEST HIST BORANCIK ${TS}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true, code: true },
    });
    itemIds.push(histA.id);
    // ⚠️ 2026-08-30: DB SEDDİ (`items_code_fold_key`) KURULDUYSA bu zemin ARTIK
    // KURULAMAZ — ve bu, testin ölçtüğü şeyden DAHA GÜÇLÜ bir garantidir:
    // tarihsel mükerrer senaryosu yeni kayıtlarda hiç doğamaz. Sed kurulu
    // olmayan bir DB'de (sed temizlik bekleyen prod) eski senaryo aynen koşar.
    // Sabit varsayım yazmak testi ortama göre yanlış yerden kırmızıya düşürürdü.
    let histB: { id: string; code: string } | null = null;
    try {
      histB = await prisma.item.create({
        data: {
          code: histCode.toLowerCase(),
          name: `TEST HIST SANTUK ${TS}`,
          itemType: "FABRIC",
          unit: "MT",
        },
        select: { id: true, code: true },
      });
      itemIds.push(histB.id);
      check(
        "zemin: yan yana iki case-ikizi kayıt DB'de duruyor",
        histA.code !== histB.code && foldCodeForCompare(histA.code) === foldCodeForCompare(histB.code),
        `${histA.code} ↔ ${histB.code}`,
      );
    } catch (e) {
      if (!sedMi(e)) throw e;   // beklenmedik hata SESSİZ KALMAZ
      check(
        "DB seddi case-ikizini ÜRETİLEMEZ kıldı (uygulama guard'ından güçlü garanti) — P2002 · upper(code)",
        true,
        "items_code_fold_key kurulu",
      );
    }

    // ── [2] Item create: harf farkı = aynı kimlik ────────────────────────────
    console.log("\n[2] Item create — harf farkıyla aynı kod reddedilir");
    const baseCode = `TEST-CASE-${TS}`;
    const a1 = trackItem(
      await itemService.create({ name: `TEST CASE A1 ${TS}`, itemType: "FABRIC", code: baseCode }),
    );
    check("düz create geçti (kod aynen saklandı)", a1.code === baseCode, a1.code);

    await expectConflict(
      "aynı kod küçük harfle → 409",
      "büyük/küçük harf",
      () =>
        itemService.create({
          name: `TEST CASE A2 ${TS}`,
          itemType: "FABRIC",
          code: baseCode.toLowerCase(),
        }),
    );
    await expectConflict(
      "karışık harf düzeni de → 409",
      "büyük/küçük harf",
      () =>
        itemService.create({
          name: `TEST CASE A3 ${TS}`,
          itemType: "FABRIC",
          code: `Test-Case-${TS}`,
        }),
    );
    // Mesaj SOMUT olmalı: operatör hangi kayda çarptığını görmeli.
    let hitMsg = "";
    try {
      await itemService.create({
        name: `TEST CASE A4 ${TS}`,
        itemType: "FABRIC",
        code: baseCode.toLowerCase(),
      });
    } catch (e) {
      hitMsg = errInfo(e).message;
    }
    check(
      "409 mesajı çakışan kaydın GERÇEK kodunu söylüyor",
      hitMsg.includes(baseCode) && hitMsg.includes(`TEST CASE A1 ${TS}`),
      hitMsg,
    );

    // Gerçekten farklı kod serbest — guard kapsamı genişlemedi.
    const other = trackItem(
      await itemService.create({
        name: `TEST CASE B1 ${TS}`,
        itemType: "FABRIC",
        code: `TEST-CASE-${TS}-X`,
      }),
    );
    check("gerçekten farklı kod GEÇTİ", other.code === `TEST-CASE-${TS}-X`, other.code);

    // ── [3] Türkçe i/I sondası — yanlış katlamaya dönülürse burası kırmızı ───
    console.log("\n[3] Türkçe i/I tuzağı");
    const iCode = `TEST-SIP-${TS}`; // büyük I
    trackItem(
      await itemService.create({ name: `TEST SIP ${TS}`, itemType: "FABRIC", code: iCode }),
    );
    await expectConflict(
      "'...SIP...' ↔ '...sip...' çakışması yakalandı (tr-TR katlamasında KAÇARDI)",
      "büyük/küçük harf",
      () =>
        itemService.create({
          name: `TEST SIP LOWER ${TS}`,
          itemType: "FABRIC",
          code: iCode.toLowerCase(),
        }),
    );

    // ── [4] Reactivate YALNIZ TAM EŞLEŞMEDE ─────────────────────────────────
    console.log("\n[4] Reactivate — tam eşleşme dirilir, harf farkı 409");
    await prisma.item.update({ where: { id: a1.id }, data: { isActive: false } });

    // 4a) HARF FARKI → diriltme YOK. Diriltme yolu adı/birimi ezer, M:N'leri
    //     siler ve `itemType`'ı yazmaz → yanlış kaydı canlandırmak sessizce
    //     düzeltilemez bir ürün üretirdi (update'te `itemType` FORBIDDEN).
    await expectConflict(
      "pasif eşe HARF FARKIYLA çarpmak → 409 (sessiz diriltme YOK)",
      "aktifleştirin",
      () =>
        itemService.create({
          name: `TEST CASE A1 WRONGCASE ${TS}`,
          itemType: "FABRIC",
          code: baseCode.toLowerCase(),
        }),
    );
    const stillPassive = await prisma.item.findUnique({
      where: { id: a1.id },
      select: { isActive: true, name: true },
    });
    check(
      "reddedilen istek kaydı DİRİLTMEDİ ve adını EZMEDİ",
      stillPassive?.isActive === false && (stillPassive?.name ?? "").includes("TEST CASE A1"),
      `${stillPassive?.isActive} · ${stillPassive?.name}`,
    );
    const noNewRow = await prisma.item.count({ where: { code: baseCode.toLowerCase() } });
    check("reddedilen istek YENİ satır da doğurmadı", noNewRow === 0, String(noNewRow));

    // 4b) TAM EŞLEŞME → dirilir (eski davranış birebir korunur).
    const revivedRes = await itemService.create({
      name: `TEST CASE A1 REVIVED ${TS}`,
      itemType: "FABRIC",
      code: baseCode,
    });
    const revived = revivedRes.data as { id: string; code: string; isActive: boolean };
    check("tam eşleşmeli pasif kayıt DİRİLDİ (yeni satır açılmadı)", revived.id === a1.id, revived.id);
    check("dirilen kayıt AKTİF", revived.isActive === true);
    check("dirilen kayıt kodunu korudu", revived.code === baseCode, revived.code);
    const itemCountAfterRevive = await prisma.item.count({
      where: { code: { in: [baseCode, baseCode.toLowerCase()] } },
    });
    check("diriltme İKİNCİ satır doğurmadı", itemCountAfterRevive === 1, String(itemCountAfterRevive));

    // 4c) AKTİF harf-ikizi VARKEN tam eşleşmeli pasif kayıt yine diriltilebilir.
    //     Canlı emsal: ACTIVO(aktif) + activo(pasif) · BAYROFLAM + bayroflam · OSLO + oslo.
    //     "Aktif eş varsa koşulsuz 409" kuralı bu yolu sessizce öldürürdü ve 409
    //     kullanıcının kastettiğinden BAŞKA bir kaydı gösterirdi.
    // ⚠️ 4b de case-ikizi ÜRETİYOR — sed kurulu bir DB'de kurulamaz (bkz. §1
    // notu). `isActive:false` muaf DEĞİL: kısmi index yalnız mezar taşını
    // dışlıyor. Sed yoksa (temizlik bekleyen prod) senaryo aynen koşar.
    let ikizKuruldu = true;
    let ikizKurulduEngeli = "(engel yok)";
    try {
      console.log("\n[4b] Aktif harf-ikizi varken tam eşleşmeli diriltme");
      const twinCode = `TEST-TWIN-${TS}`;
      const twinActive = await prisma.item.create({
        data: { code: twinCode, name: `TEST TWIN ACTIVE ${TS}`, itemType: "FABRIC", unit: "MT" },
        select: { id: true },
      });
      itemIds.push(twinActive.id);
      const twinPassive = await prisma.item.create({
        data: {
          code: twinCode.toLowerCase(),
          name: `TEST TWIN PASSIVE ${TS}`,
          itemType: "FABRIC",
          unit: "MT",
          isActive: false,
        },
        select: { id: true },
      });
      itemIds.push(twinPassive.id);
      // ⚠️ try/catch ZORUNLU: "aktif eş varsa koşulsuz 409" sondasında bu çağrı
      // FIRLATIR; sarmalanmasaydı test kırmızı kontrol yerine ÇÖKERDİ ve hangi
      // kontrolün ne tuttuğu ölçülemezdi (negatif sonda kültürü, adım 3).
      let twinRevived: { id: string; isActive: boolean } | null = null;
      let twinErr = "";
      try {
        const twinRes = await itemService.create({
          name: `TEST TWIN PASSIVE ${TS}`,
          itemType: "FABRIC",
          code: twinCode.toLowerCase(),
        });
        twinRevived = twinRes.data as { id: string; isActive: boolean };
      } catch (e) {
        twinErr = errInfo(e).message;
      }
      check(
        "aktif ikiz varken de TAM EŞLEŞMELİ pasif kayıt dirildi",
        twinRevived?.id === twinPassive.id && twinRevived?.isActive === true,
        twinErr || (twinRevived?.id ?? "-"),
      );
      // Ama aktif kaydın KENDİ koduna tam eşleşme → yine 409 (eski sözleşme).
      await expectConflict(
        "aktif kaydın tam kodu → 409 (eski mesaj korunuyor)",
        "aktif ürün zaten var",
        () =>
          itemService.create({ name: `TEST TWIN X ${TS}`, itemType: "FABRIC", code: twinCode }),
      );

      // ── [5] Harf farkıyla eşleşen PASİF kayıt(lar) → 409, çıkış yolu söylenir ─
    } catch (e) {
      // İki mekanizma da meşru ön koşul engelidir; AMA hangisi olduğu BASILIR ve
      // üçüncü bir şey olursa SESSİZ KALMAZ (etiket "sed" diyorsa guard'ı sed sanmayalım).
      if (!sedMi(e) && !guardMi(e)) throw e;
      ikizKurulduEngeli = sedMi(e) ? "SED (P2002 · upper(code))" : "GUARD (409 · assertNameNotDuplicate)";
      ikizKuruldu = false;
    }
    if (!ikizKuruldu) {
      check("[4b] harf-ikizi senaryosu ATLANDI — ön koşulu engelleyen: " + ikizKurulduEngeli, true);
    }
    // ⚠️ [5] de case-ikizi üretiyor (canlı MC155/Mc155/mc155 emsali) — sed
    // kurulu DB'de kurulamaz. Aynı uyarlama.
    let ikiz5 = true;
    let ikiz5Engeli = "(engel yok)";
    try {
      console.log("\n[5] Harf farkıyla pasif eş (canlı MC155/Mc155/mc155 emsali)");
      const ambCode = `TEST-AMB-${TS}`;
      for (const [i, variant] of [ambCode, ambCode.toLowerCase()].entries()) {
        const row = await prisma.item.create({
          data: {
            code: variant,
            name: `TEST AMB ${i} ${TS}`,
            itemType: "FABRIC",
            unit: "MT",
            isActive: false,
          },
          select: { id: true },
        });
        itemIds.push(row.id);
      }
      let ambMsg = "";
      try {
        await itemService.create({
          name: `TEST AMB PICK ${TS}`,
          itemType: "FABRIC",
          code: `Test-Amb-${TS}`,
        });
      } catch (e) {
        ambMsg = errInfo(e).message;
      }
      check(
        "pasif eşler → 409 (yanlış kayıt sessizce canlandırılmaz)",
        ambMsg.includes("aktifleştirin"),
        ambMsg,
      );
      check(
        "409 mesajı EŞLEŞEN HER pasif kaydı listeliyor (deterministik)",
        ambMsg.includes(ambCode) && ambMsg.includes(ambCode.toLowerCase()),
        ambMsg,
      );

    } catch (e) {
      // İki mekanizma da meşru ön koşul engelidir; AMA hangisi olduğu BASILIR ve
      // üçüncü bir şey olursa SESSİZ KALMAZ (etiket "sed" diyorsa guard'ı sed sanmayalım).
      if (!sedMi(e) && !guardMi(e)) throw e;
      ikiz5Engeli = sedMi(e) ? "SED (P2002 · upper(code))" : "GUARD (409 · assertNameNotDuplicate)";
      ikiz5 = false;
    }
    if (!ikiz5) {
      check("[5] pasif harf-eşi senaryosu ATLANDI — ön koşulu engelleyen: " + ikiz5Engeli, true);
    }

    // §6 yalnız tarihsel ikiz GERÇEKTEN varsa ölçülebilir. Sed kurulu bir DB'de
    // o kayıt üretilemez (yukarıda ölçüldü) — durumu sessizce atlamıyoruz,
    // bir kontrol olarak raporluyoruz ki "atlandı" ile "yeşil" karışmasın.
    if (!histB) {
      check("[6] tarihsel ikiz senaryosu ATLANDI — sed onu üretilemez kıldı", true);
    } else {
      // ── [6] TARİHSEL MÜKERRER KAYIT DÜZENLENEBİLİR KALIR ────────────────────
    console.log("\n[6] Tarihsel case-ikizi düzenlenebilir (ad guard'ı emsali)");
      let editErr = "";
      try {
        await itemService.update(histB.id, { name: `TEST HIST SANTUK DUZENLENDI ${TS}` });
      } catch (e) {
        editErr = errInfo(e).message;
      }
      check("case-ikizi kaydın adı güncellenebildi (409 YOK)", editErr === "", editErr);
      const histAfter = await prisma.item.findUnique({
        where: { id: histB.id },
        select: { code: true, name: true },
      });
      check(
        "güncelleme kodu DEĞİŞTİRMEDİ (kod update'te zaten yasak)",
        histAfter?.code === histCode.toLowerCase(),
        histAfter?.code ?? "-",
      );
      check(
        "ad gerçekten yazıldı",
        (histAfter?.name ?? "").includes("DUZENLENDI"),
        histAfter?.name ?? "-",
      );
    }

    // ── [7] Otomatik kod yolu etkilenmedi (kapsam dar) ──────────────────────
    console.log("\n[7] Otomatik STK- yolu");
    const auto = trackItem(await itemService.create({ name: `TEST AUTO ${TS}`, itemType: "FABRIC" }));
    check("kod verilmeyince STK- üretildi", /^STK-\d{6,}$/.test(auto.code), auto.code);

    // ── [8] BaseService yolu (QualityGrade) — create + update ───────────────
    console.log("\n[8] BaseService uniqueField yolu (QualityGrade)");
    const gCode = `TEST-QG-${TS}`;
    const g1res = await gradeService.create({
      code: gCode,
      name: `TEST QG A ${TS}`,
      targetStatus: "WAREHOUSE",
    });
    const g1 = g1res.data as { id: string; code: string };
    gradeIds.push(g1.id);
    check("BaseService create geçti", g1.code === gCode, g1.code);

    await expectConflict(
      "BaseService create — harf farkıyla aynı kod → 409",
      "büyük/küçük harf",
      () =>
        gradeService.create({
          code: gCode.toLowerCase(),
          name: `TEST QG B ${TS}`,
          targetStatus: "WAREHOUSE",
        }),
    );

    const g2res = await gradeService.create({
      code: `${gCode}-2`,
      name: `TEST QG C ${TS}`,
      targetStatus: "WAREHOUSE",
    });
    const g2 = g2res.data as { id: string };
    gradeIds.push(g2.id);

    // update: kod GERÇEKTEN değişiyor ve başkasıyla çakışıyor → 409
    await expectConflict(
      "BaseService update — kodu harf farkıyla başkasına çekmek → 409",
      "büyük/küçük harf",
      () => gradeService.update(g2.id, { code: gCode.toLowerCase() }),
    );
    // update: kod gönderilmiyor → guard hiç koşmaz (tarihsel kayıt düzenlenebilir)
    let gEditErr = "";
    try {
      await gradeService.update(g2.id, { name: `TEST QG C2 ${TS}` });
    } catch (e) {
      gEditErr = errInfo(e).message;
    }
    check("BaseService update — kod dokunulmadan ad değişimi serbest", gEditErr === "", gEditErr);
    // update: kaydın KENDİ kodunu harf düzeniyle yazmak kendine çarpmamalı
    let gSelfErr = "";
    try {
      await gradeService.update(g2.id, { code: `${gCode}-2`, name: `TEST QG C3 ${TS}` });
    } catch (e) {
      gSelfErr = errInfo(e).message;
    }
    check("BaseService update — kendi kodunu tekrar yazmak 409 vermez", gSelfErr === "", gSelfErr);

    // ── [9] Eşzamanlılık — advisory kilit ────────────────────────────────────
    console.log("\n[9] Eşzamanlı create yarışı (DB'de katlanmış unique sed YOK)");
    const raceCode = `TEST-RACE-${TS}`;
    // ⚠️ DÖRT AYRI HARF DÜZENİ — hepsinin BİREBİR FARKLI string olduğu aşağıda
    // ölçülür. İlk sürümde dördüncü eleman `raceCode.toUpperCase()` idi ve `TS`
    // zaten büyük harfli olduğu için birinciyle AYNI string'ti: yani yarışın
    // dörtte biri düz tam-eşleşme kopyasıydı ve onu `items_code_key` (P2002)
    // zaten reddederdi. Sayaçlar (1 geçen + 3×409) tuttuğu için eksiklik testin
    // çıktısında hiç görünmüyordu — kapsam olduğundan geniş sanılıyordu.
    const alternating = raceCode
      .split("")
      .map((c, i) => (i % 2 === 1 ? c.toLowerCase() : c.toUpperCase()))
      .join("");
    const variants = [raceCode, raceCode.toLowerCase(), `Test-Race-${TS}`, alternating];
    check(
      "yarış varyantları BİREBİR farklı string (körlük zemini)",
      new Set(variants).size === variants.length,
      variants.join(" | "),
    );
    // ⚠️ `Promise.all` burada MEŞRU: bunlar tx'i PAYLAŞMAYAN, beş ayrı istek
    // (perf kuralı 11 tek `tx` client'ını paylaşmaya ilişkindir). Sıralı hale
    // getirilirse bekçi sessizce ölür.
    const settled = await Promise.allSettled(
      variants.map((code, i) =>
        itemService.create({ name: `TEST RACE ${i} ${TS}`, itemType: "FABRIC", code }),
      ),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") trackItem(r.value);
    }
    const okCount = settled.filter((r) => r.status === "fulfilled").length;
    const conflictCount = settled.filter(
      (r) => r.status === "rejected" && errInfo(r.reason).status === 409,
    ).length;
    check("yarışta yalnız BİR create geçti", okCount === 1, `geçen=${okCount}`);
    check(
      "kalan istekler 409 aldı (sessiz ikiz doğmadı)",
      conflictCount === variants.length - 1,
      `409=${conflictCount}/${variants.length - 1}`,
    );
    const raceRows = await prisma.item.count({
      where: { code: { in: variants } },
    });
    check("DB'de tek satır kaldı", raceRows === 1, String(raceRows));

    // ── [10] CustomerBranch ihracat kodu — REGRESYON bekçisi ────────────────
    // Bu koruma §18'den ÖNCE de vardı (tr-TR katlamasıyla) ve `foldCodeForCompare`
    // düz `toUpperCase()` olsaydı Türkçe İ taşıyan kodlarda SESSİZCE düşerdi.
    // `test_customer_branch.ts` kod tekilliğine dair TEK kontrol içermiyordu.
    console.log("\n[10] CustomerBranch ihracat kodu (harf farkı + Türkçe İ)");
    const cust = await prisma.customer.create({
      data: { code: `TEST-CB-${TS}`, name: `TEST CB MUSTERI ${TS}` },
      select: { id: true },
    });
    customerIds.push(cust.id);
    await branchService.create(cust.id, { name: `TEST CB SUBE A ${TS}`, code: "İSTANBUL" });
    await expectConflict(
      "aynı müşteride 'istanbul' ↔ 'İSTANBUL' → 409 (Türkçe İ)",
      "ihracat kodlu bir şube zaten var",
      () => branchService.create(cust.id, { name: `TEST CB SUBE B ${TS}`, code: "istanbul" }),
    );
    await expectConflict(
      "aynı müşteride 'mrk' ↔ 'MRK' → 409 (ASCII harf farkı)",
      "ihracat kodlu bir şube zaten var",
      async () => {
        await branchService.create(cust.id, { name: `TEST CB SUBE C ${TS}`, code: "MRK" });
        await branchService.create(cust.id, { name: `TEST CB SUBE D ${TS}`, code: "mrk" });
      },
    );
    const branchCount = await prisma.customerBranch.count({ where: { customerId: cust.id } });
    check("reddedilen şubeler yazılmadı (2 satır)", branchCount === 2, String(branchCount));
  } finally {
    // ⚠️ İd listesi TEK BAŞINA YETMEZ: reddedilmesi BEKLENEN bir create, guard
    // bozukken (negatif sonda) GEÇER ve id'si hiçbir yere yazılmaz → dev DB'sinde
    // artık birikir (2026-08-15 sondalarında birebir yaşandı). Bu yüzden ikinci
    // hat, bu koşuma özgü damgayı (`TS`) taşıyan HER satırı siler — ad kalıbı
    // yalnız bu testin fixture'larına ait.
    const strays = await prisma.item.findMany({
      where: { name: { contains: TS } },
      select: { id: true },
    });
    const allItemIds = [...new Set([...itemIds, ...strays.map((s) => s.id)])];
    await prisma.systemLog
      .deleteMany({ where: { recordId: { in: [...allItemIds, ...gradeIds] } } })
      .catch(() => undefined);
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: allItemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: allItemIds } } });
    await prisma.qualityGrade.deleteMany({ where: { id: { in: gradeIds } } });
    // Müşteri/şube: aynı ikinci hat (damgayı taşıyan her satır), FK sırası şube → müşteri.
    const strayCustomers = await prisma.customer.findMany({
      where: { name: { contains: TS } },
      select: { id: true },
    });
    const allCustomerIds = [...new Set([...customerIds, ...strayCustomers.map((c) => c.id)])];
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: allCustomerIds } } });
    await prisma.systemLog
      .deleteMany({ where: { recordId: { in: allCustomerIds } } })
      .catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: { in: allCustomerIds } } });
    console.log(
      `\n(temizlendi — ${allItemIds.length} ürün + ${gradeIds.length} kalite + ${allCustomerIds.length} müşteri fixture'ı silindi)`,
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
