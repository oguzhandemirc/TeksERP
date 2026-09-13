// =============================================================================
// Test: KAT KATALOĞU — değer listesi veriden gelir, koddan değil (2026-08-10)
// Çalıştır: npx tsx scripts/test_fold_catalog.ts
// =============================================================================
// Korunan invariant: fabrika "6-KAT"ı PANELDEN ekleyebilmeli ve o değer
// uçtan uca çalışmalı — sürüm/APK gerekmeden. Eskiden izin verilen değerler
// 9 ayrı yerde literal diziydi ve `tambur.controller` z.enum ile 2/4-KAT'a
// kilitliydi.
//
// Doğrulananlar:
//   1. Katalog okuması — configured bayrağı + değer listesi
//   2. Katalogdaki değer KABUL edilir; biçim farkı kanonikleştirilir
//   3. Katalogda OLMAYAN değer REDDEDİLİR ve mesaj tanımlı değerleri sayar
//   4. YENİ değer eklenince (6-KAT) aynı çağrı artık KABUL eder  ← asıl vaat
//   5. Pasif değer yazmada kabul edilir (eski kayıt düzenlenebilsin) ama
//      hata mesajındaki "tanımlı değerler" listesinde GÖRÜNMEZ
//   6. FAIL-OPEN: katalog yoksa değer olduğu gibi geçer (üretim durmasın)
//   7. undefined → undefined (update no-op), null/boş → null
//   8. Kod karşılaştırması TÜRKÇE-BAĞIMSIZ upper ile yapılır
//   9. applyFoldTypeForWriteInPlace: alan yoksa dokunmaz, varsa kanonikleştirir
//  10. SEÇİM tipli özellik hedef-özellik seçicisine SIZMAZ (valueType ayrımı)
// =============================================================================
import prisma from "../src/lib/prisma";
import { FabricPropertyService } from "../src/services/fabric-property.service";
import {
  FOLD_PROPERTY_CODE,
  loadFoldTypeCatalog,
  resolveFoldTypeForWrite,
  applyFoldTypeForWriteInPlace,
} from "../src/services/helpers/fold-type";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
/**
 * Hata mesajındaki "Tanımlı değerler: A, B, C." listesini TOKEN olarak okur.
 *
 * ⛔ NEDEN `m.includes("9-KAT")` DEĞİL (2026-09-13, CI'da iki kez kırmızı):
 * sonda değeri `TEST-KAT-${Date.now()}-KAT` ve zaman damgası `9` ile bittiğinde
 * dizgi `…5549-KAT` oluyor ⇒ **`"9-KAT"` alt dizgisini İÇERİYOR**. Yüklem
 * sınırsız olduğu için ALAKASIZ bir değerle eşleşti ve bekçi 10 koşumun
 * 1'inde kırmızı verdi (ölçüldü: yerel 15 koşumda 1, CI'da iki kırmızının
 * ikisinde de damga `9` ile bitiyor). Sınırı beyan etmeyen yüklem alakasızla
 * eşleşir — panzehir: VİRGÜLLE ayrılmış listeyi TOKEN olarak oku.
 */
export function tanimliDegerler(mesaj: string): string[] {
  const m = mesaj.match(/Tanımlı değerler:\s*(.*?)\.\s/);
  if (!m) return [];
  return m[1].split(",").map((x) => x.trim()).filter(Boolean);
}

async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

// Panelin kullandığı gerçek config (fabric-property.routes.ts aynası) — yanıt
// tazeliği ancak `defaultInclude` ile ölçülebilir.
const propSvc = new FabricPropertyService({
  modelName: "fabricProperty",
  tableName: "FABRIC_PROPERTY",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  nestedCreateFields: ["stationCapabilities", "values"],
  defaultInclude: {
    stationCapabilities: { select: { stationId: true } },
    values: {
      select: { id: true, code: true, name: true, sortOrder: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    },
  },
  duplicateNameField: "name",
  entityLabel: "özellik",
});

async function main() {
  // ── §0 YÜKLEM SONDALARI (DB'siz) — sınırsız eşleşme geri gelmesin ───────
  const SAHTE = "'X' geçerli bir kat değeri değil. Tanımlı değerler: 2-KAT, TEST-KAT-1789324255549-KAT, 7-KAT. Yeni bir kat…";
  check("§0a ⭐ token okuma: '…5549-KAT' 9-KAT SAYILMAZ", !tanimliDegerler(SAHTE).includes("9-KAT"));
  check("§0b ⭐ gerçek 9-KAT listede ise SAYILIR",
    tanimliDegerler("'X' geçerli bir kat değeri değil. Tanımlı değerler: 2-KAT, 9-KAT. Yeni…").includes("9-KAT"));
  check("§0c ⭐ eski sınırsız yüklem YANILIYORDU", SAHTE.includes("9-KAT"));
  check("§0d liste okunamazsa boş döner", tanimliDegerler("alakasız metin").length === 0);

  const ts = Date.now();
  // Kataloğu TESTİN KENDİSİ kurar — ortamdaki veriye bağımlı olma kuralı.
  // Gerçek "KAT" satırına DOKUNULMAZ; ayrı bir sonda özelliği kullanılır ve
  // sonunda silinir. Ama `resolveFoldTypeForWrite` sabit FOLD_PROPERTY_CODE'a
  // baktığı için gerçek satır varsa onu kullanmak zorundayız → satırı yoksa
  // kurar, varsa mevcut değerlere DOKUNMADAN yalnız sonda değeri ekler.
  const PROBE = `TEST-KAT-${ts}`;
  let createdProperty = false;

  let prop = await prisma.fabricProperty.findUnique({
    where: { code: FOLD_PROPERTY_CODE },
    select: { id: true },
  });
  if (!prop) {
    prop = await prisma.fabricProperty.create({
      data: { code: FOLD_PROPERTY_CODE, name: "Kat", valueType: "CHOICE" },
      select: { id: true },
    });
    createdProperty = true;
    await prisma.fabricPropertyValue.createMany({
      data: [
        { propertyId: prop.id, code: "2-KAT", name: "2 Kat", sortOrder: 10 },
        { propertyId: prop.id, code: "4-KAT", name: "4 Kat", sortOrder: 20 },
      ],
    });
  }
  const propertyId = prop.id;
  const probeValueIds: string[] = [];

  try {
    // ── 1) Katalog okuması ──────────────────────────────────────────────────
    const cat = await loadFoldTypeCatalog();
    check("katalog configured=true", cat.configured);
    check("2-KAT ve 4-KAT katalogda", cat.values.some((v) => v.code === "2-KAT") && cat.values.some((v) => v.code === "4-KAT"),
      cat.values.map((v) => v.code).join(","));

    // ── 2) Katalogdaki değer kabul + biçim kanonikleştirmesi ────────────────
    check('resolve("4-KAT") → "4-KAT"', (await resolveFoldTypeForWrite("4-KAT")) === "4-KAT");
    check('resolve("4 kat") → "4-KAT" (biçim)', (await resolveFoldTypeForWrite("4 kat")) === "4-KAT");
    check('resolve("2_KAT") → "2-KAT"', (await resolveFoldTypeForWrite("2_KAT")) === "2-KAT");

    // ── 3) Katalogda olmayan değer reddedilir ───────────────────────────────
    // ⚠️ SONDA KODU KOŞUM-BAŞINA BENZERSİZ (2026-08-13). Eskiden sabit "6-KAT"
    // idi ve fabrika kataloğuna gerçekten 6-KAT eklendiği gün test "katalog dışı"
    // varsayımını kaybedip P2002 ile ÇÖKTÜ — ölçtüğü kural (yeni değer eklenince
    // kabul edilir) doğru çalışırken. Kural: "bu değer katalogda YOK" diyen bir
    // sonda, kataloğa eklenebilecek gerçek bir kodu KULLANAMAZ.
    const NEW_FOLD = `${PROBE}-KAT`;
    await expectErr(`katalog dışı '${NEW_FOLD}' reddedilir`, "geçerli bir kat değeri değil", () =>
      resolveFoldTypeForWrite(NEW_FOLD),
    );
    await expectErr("red mesajı tanımlı değerleri sayar", "4-KAT", () =>
      resolveFoldTypeForWrite(NEW_FOLD),
    );

    // ── 4) ASIL VAAT: panelden değer eklenince aynı çağrı kabul eder ────────
    const v6 = await prisma.fabricPropertyValue.create({
      data: { propertyId, code: NEW_FOLD, name: `Sonda Kat ${PROBE}`, sortOrder: 90 },
      select: { id: true },
    });
    probeValueIds.push(v6.id);
    // ⚠️ `safe` ile sarılı: sonda koşarken (regex `[24]`e geri alınınca) bu
    // çağrı FIRLATIR. Sarmazsak test çöker ve hangi kontrolün düştüğü
    // görünmez — bekçi kırmızı verir ama NEDENİNİ söylemez.
    // ⚠️ HATA METNİ YUTULMAZ (2026-09-05): sabit `__THROWN__` döndürmek, geçici
    // bir altyapı arızasını ("too many clients" / bağlantı zaman aşımı) sıradan
    // bir assertion kırmızısına çeviriyordu. Koşucunun ALTYAPI YENİDEN DENEMESİ
    // çıktıdaki imzaya bakar (`looksInfrastructural`) — imza yutulunca hiç
    // tetiklenmez ve kırmızı teşhissiz kalır (ölçüldü: tam pakette 24/1, aynı
    // sırayla tekrarında 25/0; §12-25 çıktısı yeşil koşumla BİREBİR aynıydı).
    // Ayrıca sonuç TEK KEZ okunur: iki ayrı çağrı iki farklı cevap verebilir ve
    // kontrolün düştüğü değer ile basılan değer ayrışırdı.
    const safe = async (v: string) => {
      try { return await resolveFoldTypeForWrite(v); }
      catch (e) { return `__THROWN__: ${e instanceof Error ? e.message : String(e)}`; }
    };
    const alinan6 = await safe(NEW_FOLD);
    check("değer eklendikten SONRA aynı kod KABUL edilir", alinan6 === NEW_FOLD, String(alinan6));
    // Biçim + katalog BİRLİKTE: rakamlı yazım normalleşip katalogla eşleşmeli.
    // (Bu kontrol gerçek bir rakam kodu ister → kataloğa geçici "7-KAT" eklenir.)
    const v7 = await prisma.fabricPropertyValue.create({
      data: { propertyId, code: "7-KAT", name: `7 Kat ${PROBE}`, sortOrder: 91 },
      select: { id: true },
    });
    probeValueIds.push(v7.id);
    const alinan7 = await safe("7 kat");
    check('"7 kat" yazımı da kabul (biçim + katalog birlikte)', alinan7 === "7-KAT", String(alinan7));

    // ── 5) Pasif değer: yazmada kabul, listede görünmez ─────────────────────
    const vOld = await prisma.fabricPropertyValue.create({
      data: { propertyId, code: "9-KAT", name: `9 Kat ${PROBE}`, sortOrder: 95, isActive: false },
      select: { id: true },
    });
    probeValueIds.push(vOld.id);
    check("pasif değer YAZMADA kabul (eski kayıt düzenlenebilsin)",
      (await resolveFoldTypeForWrite("9-KAT")) === "9-KAT");
    try {
      await resolveFoldTypeForWrite("ZZZ-YOK");
      check("pasif değer hata listesinde görünmez", false, "hata bekleniyordu");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      check("pasif değer hata listesinde GÖRÜNMEZ", !tanimliDegerler(m).includes("9-KAT"), m);
    }

    // ── 6) FAIL-OPEN: katalog yoksa değer geçer ─────────────────────────────
    // Sahte reader ile ölçülür — gerçek satırı silip geri koymak, paralel
    // oturumların kullandığı dev DB'sinde tehlikeli.
    const emptyReader = {
      fabricProperty: { findUnique: async () => null },
    } as unknown as Parameters<typeof resolveFoldTypeForWrite>[1];
    check("katalog YOKken 'ÖZEL' değer geçer (fail-open)",
      (await resolveFoldTypeForWrite("ÖZEL", emptyReader)) === "ÖZEL");
    check("katalog YOKken biçim yine uygulanır",
      (await resolveFoldTypeForWrite("6 kat", emptyReader)) === "6-KAT");

    // ── 7) undefined / null sözleşmesi ──────────────────────────────────────
    check("undefined → undefined (update no-op)", (await resolveFoldTypeForWrite(undefined)) === undefined);
    check("null → null (temizle)", (await resolveFoldTypeForWrite(null)) === null);
    check("boş string → null", (await resolveFoldTypeForWrite("   ")) === null);

    // ── 8) TÜRKÇE-BAĞIMSIZ upper — asıl tuzak i/İ/ı sınıfı ──────────────────
    // `toLocaleUpperCase("tr")` "tip"i "TİP" yapar ve "TIP" koduyla eşleşmez.
    // Bu sonda tam o gerilemeyi ölçer: kod içinde 'i' geçen bir değer, küçük
    // harfli yazımla gönderildiğinde eşleşmeli.
    const vTip = await prisma.fabricPropertyValue.create({
      data: { propertyId, code: "TIP-KATI", name: `Tip Katı ${PROBE}`, sortOrder: 96 },
      select: { id: true },
    });
    probeValueIds.push(vTip.id);
    check('resolve("tip-kati") → "TIP-KATI" (locale-bağımsız upper)',
      (await resolveFoldTypeForWrite("tip-kati")) === "TIP-KATI",
      String(await resolveFoldTypeForWrite("tip-kati").catch((e) => `THROWN: ${e.message}`)));

    // Katalog kodları ASCII olmalı — Türkçe karakterli kod, ASCII yazan her
    // istemciyi ("TUP" ↔ "TÜP") sessizce reddettirir. Seed bu yüzden "TUP" yazar.
    const nonAscii = (await loadFoldTypeCatalog()).values.filter((v) => /[^\x20-\x7E]/.test(v.code));
    check("katalog kodlarında Türkçe/ASCII-dışı karakter YOK",
      nonAscii.length === 0, nonAscii.map((v) => v.code).join(",") || "(temiz)");

    // ── 9) applyFoldTypeForWriteInPlace ─────────────────────────────────────
    const d1: Record<string, unknown> = { foldType: "4 kat", other: 1 };
    await applyFoldTypeForWriteInPlace(d1);
    check("in-place: '4 kat' → '4-KAT', diğer alan korunur", d1.foldType === "4-KAT" && d1.other === 1);

    const d2: Record<string, unknown> = { name: "x" };
    await applyFoldTypeForWriteInPlace(d2);
    check("in-place: alan yoksa DOKUNMAZ", !("foldType" in d2));

    const d3: Record<string, unknown> = { foldType: null };
    await applyFoldTypeForWriteInPlace(d3);
    check("in-place: null korunur", d3.foldType === null);

    await expectErr("in-place: katalog dışı değer reddedilir", "geçerli bir kat değeri değil", () =>
      applyFoldTypeForWriteInPlace({ foldType: "77-KAT" }),
    );

    // ── 9b) MUTASYON YANITI TAZE OLMALI (2026-08-10 HTTP sondasında bulundu) ──
    // `super.update` değer yazımından ÖNCE koşuyor; yanıt tazelenmezse panele
    // BAYAT liste döner. Saha okuması: "6-KAT'ı ekledim, kaydettim, görünmedi"
    // (oysa DB'ye yazılmıştı). Bu kontrol o sessiz yanlışı kilitler.
    const svcRes = (await propSvc.update(propertyId, {
      values: [
        ...(await prisma.fabricPropertyValue.findMany({
          where: { propertyId },
          select: { code: true, name: true, isActive: true },
          orderBy: { sortOrder: "asc" },
        })),
        { code: "7-KAT", name: `7 Kat ${PROBE}`, isActive: true },
      ],
    })) as { data?: { values?: { code: string }[] } };
    const respCodes = (svcRes.data?.values ?? []).map((v) => v.code);
    check("update YANITI yeni değeri İÇERİR (bayat liste dönmez)",
      respCodes.includes("7-KAT"), respCodes.join(",") || "(values yok)");
    await prisma.fabricPropertyValue.deleteMany({ where: { propertyId, code: "7-KAT" } });

    // ── 10) SEÇİM tipli özellik hedef-özellik seçicisine SIZMAZ ─────────────
    // Sızsaydı planlamacı "KAT"ı hedef özellik olarak işaretler (hangi kat?) ve
    // workorder.service'in "verebilen adım var mı" guard'ı iş emrini reddederdi.
    const katProp = await prisma.fabricProperty.findUnique({
      where: { code: FOLD_PROPERTY_CODE },
      select: { valueType: true },
    });
    check("KAT özelliği CHOICE tipinde", katProp?.valueType === "CHOICE", String(katProp?.valueType));
    const flagOnly = await prisma.fabricProperty.findMany({
      where: { isActive: true, valueType: "FLAG" },
      select: { code: true },
    });
    check("FLAG süzgeci KAT'ı DIŞARIDA bırakır",
      !flagOnly.some((p) => p.code === FOLD_PROPERTY_CODE),
      `flag sayısı=${flagOnly.length}`);
  } finally {
    await prisma.fabricPropertyValue.deleteMany({ where: { id: { in: probeValueIds } } }).catch(() => {});
    if (createdProperty) {
      await prisma.stationProperty.deleteMany({ where: { propertyId } }).catch(() => {});
      await prisma.fabricPropertyValue.deleteMany({ where: { propertyId } }).catch(() => {});
      await prisma.fabricProperty.delete({ where: { id: propertyId } }).catch(() => {});
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
