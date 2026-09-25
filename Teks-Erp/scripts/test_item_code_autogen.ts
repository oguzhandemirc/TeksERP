// =============================================================================
// Test: Stok kodu otomatik üretimi — Item create hibrit kod (STK-NNNNNN)
// Çalıştır: npx tsx scripts/test_item_code_autogen.ts
// Doğrulananlar:
//   A. Kod verilmez / boş string → backend STK- + 6 hane global sıra üretir; ardışık
//      create'lerde sıra +1 ilerler.
//   B. `STK-` ile başlayan ama sayısal parse edilemeyen manuel kod sayacı bozmaz.
//   C. Manuel kod aynen kabul edilir; aktif duplicate anlamlı hata; geçersiz karakter
//      ve 32+ karakter reddedilir (DB VarChar(32) hizası).
//   D. Eşzamanlı iki otomatik create çakışmadan farklı kod alır (withBarcodeRetry).
//   E. Manuel kodla reactivate (pasif kaydı diriltme) davranışı korunur.
// =============================================================================
import prisma from "../src/lib/prisma";
import { ItemService } from "../src/services/item.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const service = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
});

const stkSeq = (code: string): number => parseInt(code.slice("STK-".length), 10);

async function main(): Promise<void> {
  const ts = Date.now();
  const createdIds: string[] = [];
  const track = (r: { data: unknown }): { id: string; code: string } => {
    const item = r.data as { id: string; code: string };
    createdIds.push(item.id);
    return item;
  };

  try {
    // A1: code alanı hiç verilmedi → otomatik
    const a1 = track(await service.create({ name: `TEST STKAUTO A1 ${ts}`, itemType: "FABRIC" }));
    check("kod verilmedi → STK-NNNNNN formatı", /^STK-\d{6,}$/.test(a1.code), a1.code);

    // A2: code boş string → otomatik, sıra +1
    const a2 = track(await service.create({ name: `TEST STKAUTO A2 ${ts}`, itemType: "FABRIC", code: "" }));
    check("boş string kod → otomatik", /^STK-\d{6,}$/.test(a2.code), a2.code);
    check("sıra +1 ilerledi", stkSeq(a2.code) === stkSeq(a1.code) + 1, `${a1.code} → ${a2.code}`);

    // B1-B2: STK- önekli manuel kod reddedilir (önek otomatik sayaca rezerve)
    let b1msg = "";
    try {
      track(await service.create({ name: `TEST STKAUTO B1 ${ts}`, itemType: "FABRIC", code: `STK-TSTX${ts}` }));
    } catch (e) { b1msg = (e as Error).message; }
    check("manuel STK- kodu reddedildi", b1msg.includes("STK- ile başlayamaz"), b1msg);
    let b2msg = "";
    try {
      track(await service.create({ name: `TEST STKAUTO B2 ${ts}`, itemType: "FABRIC", code: "stk-1" }));
    } catch (e) { b2msg = (e as Error).message; }
    check("küçük harf stk- kodu da reddedildi", b2msg.includes("STK- ile başlayamaz"), b2msg);

    // B3: legacy dev-sayılı STK- kaydı (servis dışı, doğrudan DB'ye girmiş say)
    // sayacı kilitlemez — 12+ hane scan regex'ine takılır, max hesabına girmez.
    const legacy = await prisma.item.create({
      data: { code: `STK-99999${ts}`, name: `TEST STKAUTO LEGACY ${ts}`, itemType: "FABRIC", unit: "MT" }, // 18 hane: 12+ hane regex'ine takılır, koşum başına benzersiz
      select: { id: true },
    });
    createdIds.push(legacy.id);
    const b3 = track(await service.create({ name: `TEST STKAUTO B3 ${ts}`, itemType: "FABRIC" }));
    check("dev sayılı legacy STK- kaydı sayacı kilitlemedi", stkSeq(b3.code) === stkSeq(a2.code) + 1, b3.code);

    // C1: manuel kod aynen kabul (trim dahil)
    const manualCode = `TST-STKAUTO-${ts}`;
    const c1 = track(await service.create({ name: `TEST STKAUTO C1 ${ts}`, itemType: "FABRIC", code: `  ${manualCode}  ` }));
    check("manuel kod aynen kabul (trim'li)", c1.code === manualCode, c1.code);

    // C2: aktif duplicate → anlamlı hata
    let c2msg = "";
    try {
      track(await service.create({ name: `TEST STKAUTO C2 ${ts}`, itemType: "FABRIC", code: manualCode }));
    } catch (e) { c2msg = (e as Error).message; }
    check("aktif duplicate reddedildi", c2msg.includes("aktif ürün zaten var"), c2msg);

    // C3: geçersiz karakter (boşluk/Türkçe) → validator hatası
    let c3msg = "";
    try {
      track(await service.create({ name: `TEST STKAUTO C3 ${ts}`, itemType: "FABRIC", code: "STK ÜRÜN" }));
    } catch (e) { c3msg = (e as Error).message; }
    check("boşluk/Türkçe karakterli kod reddedildi", c3msg.includes("harf, rakam"), c3msg);

    // C4: 33 karakter → max 32 hatası (DB VarChar(32) hizası)
    let c4msg = "";
    try {
      track(await service.create({ name: `TEST STKAUTO C4 ${ts}`, itemType: "FABRIC", code: "A".repeat(33) }));
    } catch (e) { c4msg = (e as Error).message; }
    check("33 karakterlik kod reddedildi", c4msg.includes("en fazla 32"), c4msg);

    // D: eşzamanlı iki otomatik create → farklı kodlar, ikisi de başarılı
    const [d1r, d2r] = await Promise.all([
      service.create({ name: `TEST STKAUTO D1 ${ts}`, itemType: "FABRIC" }),
      service.create({ name: `TEST STKAUTO D2 ${ts}`, itemType: "FABRIC" }),
    ]);
    const d1 = track(d1r);
    const d2 = track(d2r);
    check("eşzamanlı create'ler STK- formatında", /^STK-\d{6,}$/.test(d1.code) && /^STK-\d{6,}$/.test(d2.code), `${d1.code}, ${d2.code}`);
    check("eşzamanlı create'ler farklı kod aldı", d1.code !== d2.code);

    // E: manuel kodla reactivate korunur
    await prisma.item.update({ where: { id: c1.id }, data: { isActive: false, lifecycleStatus: "ARCHIVED" } });
    const e1res = await service.create({ name: `TEST STKAUTO E1 ${ts}`, itemType: "FABRIC", code: manualCode });
    const e1 = e1res.data as { id: string; code: string };
    check("pasif kayıt aynı manuel kodla dirildi", e1.id === c1.id, e1.code);
    check("reactivate mesajı doğru", (e1res.message ?? "").includes("yeniden aktive"));
  } finally {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: createdIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
