// =============================================================================
// Test: BENZER AD ARAMA — mükerrer kayıt OLUŞMADAN önce uyar (2026-08-22)
// Çalıştır: npx tsx scripts/test_similar_names.ts
// =============================================================================
// Kullanıcı isteği: "bayro" yazarken "BAYROFLAM" görünsün. Bu bekçi o davranışı
// ve onu güvenli kılan dört sınırı kilitler:
//   §1 ALT-METİN eşleşmesi (bayro ⊂ bayroflam) — bulanık motor bu çifti %50
//      verir (fazladan anlamlı kelime kuralı), yani tek başına YETMEZ
//   §2 Türkçe katlama — "sahin" → "ŞAHİN", "TEKSTIL" → "TEKSTİL"
//   §3 EXACT = kaydetme REDDEDİLİR (`exactBlocked`) — form bunu kırmızı basar
//   §4 excludeId: kayıt DÜZENLENİRKEN kendi ikizine çarpmaz
//   §5 kapsam (makine → istasyon) + tombstone dışlaması
//   §6 kısa metin susar · bilinmeyen varlık 400 · nameGuard'sız varlık 400
//   §7 liste ucu: arama · şüpheli süzgeci · sayfalama · toplu referans sayımı
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { findSimilarNames } from "../src/services/similar-name.service";
import { DuplicateDetectionService } from "../src/services/duplicate-detection.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const names = (r: { rows: Array<{ name: string }> }): string[] => r.rows.map((x) => x.name);

const ts = Date.now();
const customerIds: string[] = [];
let stationA = "", stationB = "", machineA = "", machineB = "";

async function main(): Promise<void> {
  try {
    // ── Fixture: kullanıcının örneğinin birebir kopyası ────────────────────
    const mk = async (name: string, code: string): Promise<string> => {
      const c = await prisma.customer.create({ data: { code, name }, select: { id: true } });
      customerIds.push(c.id);
      return c.id;
    };
    const flamId = await mk(`BAYROFLAM ${ts}`, `TEST-SIM-A-${ts}`);
    await mk(`BAYROTEKS ${ts}`, `TEST-SIM-B-${ts}`);
    await mk(`ŞAHİN TEKSTİL ${ts}`, `TEST-SIM-C-${ts}`);

    console.log("\n── §1 Alt-metin: 'bayro' yazınca BAYROFLAM görünür ──");
    const s1 = await findSimilarNames("customer", "bayro");
    check(
      "⭐ 'bayro' → BAYROFLAM ve BAYROTEKS geldi (kullanıcının istediği davranış)",
      names(s1).some((n) => n.startsWith(`BAYROFLAM ${ts}`)) &&
        names(s1).some((n) => n.startsWith(`BAYROTEKS ${ts}`)),
      names(s1).join(" · ") || "boş",
    );
    check(
      "eşleşme türü PREFIX (birebir değil → kaydetme engellenmez)",
      s1.rows.filter((r) => r.name.includes(String(ts))).every((r) => r.match === "PREFIX") &&
        !s1.exactBlocked,
    );
    // Bu satır, alt-metin kuralının NEDEN gerekli olduğunun kanıtı: aynı çifti
    // bulanık motora sorarsan eşiğin çok altında kalır (BOYER EMRE ≠ BOYER).
    const { firmNameSimilarity } = await import("../src/utils/string-similarity");
    const { FUZZY_NOISE_WORDS } = await import("../src/constants/duplicate-rules");
    const fz = firmNameSimilarity("bayro", "bayroflam", FUZZY_NOISE_WORDS);
    check(
      "⭐ bulanık motor bu çifti TEK BAŞINA bulamaz (alt-metin kuralı load-bearing)",
      fz < 0.8,
      `benzerlik %${Math.round(fz * 100)}`,
    );

    console.log("\n── §2 Türkçe katlama ──");
    const s2 = await findSimilarNames("customer", "sahin tekstil");
    check(
      "'sahin tekstil' → ŞAHİN TEKSTİL (ş/s ve i/İ farkı sayılmaz)",
      names(s2).some((n) => n.startsWith(`ŞAHİN TEKSTİL ${ts}`)),
      names(s2).join(" · ") || "boş",
    );

    console.log("\n── §3 Birebir ad = kaydetme reddedilir ──");
    const s3 = await findSimilarNames("customer", `bayroflam ${ts}`);
    check("birebir eşleşmede exactBlocked=true", s3.exactBlocked);
    check(
      "birebir satırın türü EXACT",
      s3.rows.some((r) => r.match === "EXACT" && r.name === `BAYROFLAM ${ts}`),
    );

    console.log("\n── §4 Düzenlemede kayıt kendi ikizine çarpmaz ──");
    const s4 = await findSimilarNames("customer", `BAYROFLAM ${ts}`, { excludeId: flamId });
    check(
      "⭐ excludeId verilince kendi kaydı listede YOK ve exactBlocked=false",
      !s4.rows.some((r) => r.id === flamId) && !s4.exactBlocked,
    );

    console.log("\n── §5 Kapsam (makine → istasyon) + tombstone ──");
    const sA = await prisma.station.create({
      data: { code: `TEST-SIM-ST-A-${ts}`, name: `TEST Sim İstasyon A ${ts}`, type: "INTERNAL", kind: "OTHER" },
      select: { id: true },
    });
    stationA = sA.id;
    const sB = await prisma.station.create({
      data: { code: `TEST-SIM-ST-B-${ts}`, name: `TEST Sim İstasyon B ${ts}`, type: "INTERNAL", kind: "OTHER" },
      select: { id: true },
    });
    stationB = sB.id;
    machineA = (await prisma.machine.create({
      data: { code: `TEST-SIM-M-A-${ts}`, name: `RAM ${ts}`, stationId: stationA }, select: { id: true },
    })).id;
    machineB = (await prisma.machine.create({
      data: { code: `TEST-SIM-M-B-${ts}`, name: `RAM ${ts}`, stationId: stationB }, select: { id: true },
    })).id;

    const s5a = await findSimilarNames("machine", `RAM ${ts}`, { scopeId: stationA });
    check(
      "kapsam verilince yalnız O istasyonun makinesi döner",
      s5a.rows.filter((r) => r.name === `RAM ${ts}`).length === 1,
      `${s5a.rows.length} satır`,
    );
    const s5b = await findSimilarNames("machine", `RAM ${ts}`);
    check(
      "⭐ kapsam VERİLMEZSE tüm tabloda aranır (uyarıyı susturmak mükerrer doğurur)",
      s5b.rows.filter((r) => r.name === `RAM ${ts}`).length === 2,
      `${s5b.rows.filter((r) => r.name === `RAM ${ts}`).length} satır`,
    );

    // Tombstone: birleştirilmiş kayıt aday DEĞİL (DB seddi de onu dışlar).
    await prisma.customer.update({
      where: { id: customerIds[1]! },
      data: { mergedIntoId: flamId, isActive: false },
    });
    const s5c = await findSimilarNames("customer", "bayro");
    check(
      "⭐ birleştirilmiş (tombstone) kayıt uyarıda GÖRÜNMEZ",
      !names(s5c).some((n) => n.startsWith(`BAYROTEKS ${ts}`)),
      names(s5c).join(" · ") || "boş",
    );
    await prisma.customer.update({ where: { id: customerIds[1]! }, data: { mergedIntoId: null } });

    console.log("\n── §6 Sınırlar ──");
    const s6 = await findSimilarNames("customer", "a");
    check("tek harflik arama SUSAR (gürültü)", s6.rows.length === 0 && s6.scanned === 0);
    let threw = "";
    try { await findSimilarNames("bilinmeyen-varlik", "abc"); } catch (e) { threw = (e as Error).message; }
    check("bilinmeyen varlık hata verir", threw.length > 0, threw.slice(0, 60));
    let threw2 = "";
    try { await findSimilarNames("order", "abc"); } catch (e) { threw2 = (e as Error).message; }
    check(
      "⭐ ad kontrolü TANIMSIZ varlıkta 400 — sessizce BOŞ liste dönmez",
      threw2.length > 0,
      threw2.slice(0, 70) || "hata atmadı (boş liste 'benzer yok' diye okunur)",
    );

    console.log("\n── §7 Liste ucu (panelin ana ekranı) ──");
    const l1 = await DuplicateDetectionService.listRecords("customer", { search: `bayro`, limit: 50 });
    check(
      "arama katlanmış metinde koşuyor",
      l1.rows.some((r) => r.name.startsWith(`BAYROFLAM ${ts}`)),
      `${l1.total} sonuç`,
    );
    check(
      "⭐ referans sayımı TOPLU geldi (satır başına sorgu yok)",
      l1.rows.every((r) => r.refCount !== null),
    );
    const l2 = await DuplicateDetectionService.listRecords("customer", { onlySuspect: true, limit: 200 });
    check(
      "şüpheli süzgeci yalnız işaretlileri döner",
      l2.rows.every((r) => r.suspect !== null),
      `${l2.total} şüpheli satır`,
    );
    const l3 = await DuplicateDetectionService.listRecords("customer", { limit: 2, page: 1 });
    const l4 = await DuplicateDetectionService.listRecords("customer", { limit: 2, page: 2 });
    check(
      "sayfalama çalışıyor (2. sayfa 1. sayfadan farklı)",
      l3.rows.length === 2 && l4.rows.length > 0 && l3.rows[0]!.id !== l4.rows[0]!.id,
    );
    check("toplam sayı sayfadan bağımsız", l3.total === l4.total && l3.total > 2, `total=${l3.total}`);
  } finally {
    await prisma.customer.updateMany({ where: { id: { in: customerIds } }, data: { mergedIntoId: null } });
    if (machineA) await prisma.machine.deleteMany({ where: { id: { in: [machineA, machineB] } } });
    if (stationA) await prisma.station.deleteMany({ where: { id: { in: [stationA, stationB] } } });
    if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => { console.error(e); process.exit(1); },
);
