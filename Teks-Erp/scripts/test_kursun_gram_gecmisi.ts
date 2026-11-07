// =============================================================================
// BEKÇİ — KURŞUN GRAM FİYATI GEÇMİŞİ: işin anındaki fiyat (K14, kullanıcı kararı 2026-11-02)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_kursun_gram_gecmisi.ts
//
// NEDEN: gram fiyatı değişince eski işin faturası YENİ fiyattan kesiliyordu (tarihsiz kolon). Varsayılan artık
// işin anındaki SÜRÜM (`SERVICE_DATE`); `INVOICE_DATE` bugünkü davranıştır. Sürüm satırı append-only.
//
// ÖLÇÜLENLER:
//   §1 0,05 → iş (500 m × 40 gr/m) → 0,06 → fatura: SERVICE_DATE = 1000 · INVOICE_DATE = 1200 (+ uyarı farkı)
//   §2 müşteri sürümü kaldırılınca (null) sonraki iş istasyon sürümüne düşer; önceki iş müşteri fiyatında
//   §3 fiyat işten SONRA ilk kez girildi → en eski sürüm + "iş tarihinden SONRA" uyarısı
//   §4 sürüm para birimi fatura para birimi değil → kalem fiyatı
//   §5 aynı değer tekrar yazılınca sürüm yok (istasyon + cari); gövdesiz alan sürüm yazmaz
//   §6 STATİK: src'de sürüm satırına update/delete/upsert/ham SQL yok; create yalnız helper'da;
//      gram fiyatı kolonunu yazan servis dosyaları sürüm yazıcısını çağırır
//   §7 ayar: bilinmeyen değer 400; varsayılan SERVICE_DATE
//   §8 geçmiş listesi: en yeni önce, kim, cursor; bozuk cursor 400
// Negatif sonda (PR gövdesinde): `pickKursunGramVersionPrice` `at` yerine `Date.now()` okuyunca §1 SERVICE_DATE kırmızı.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { kartAc, kartlariSil, fiyatKonusuWhere } from "./lib/kart-fikstur";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { ItemType, PriceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { itemPriceService } from "../src/services/item-price.service";
import { resolveServiceItemsForRolls, type ServiceResolution } from "../src/services/helpers/service-pricing.helper";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { getKursunStationPriceHistory, setKursunStation } from "../src/services/kursun-station.service";
import { cariService } from "../src/services/cari.service";
import { DEFAULT_KURSUN_GRAM_PRICE_BASIS, SETTING_KEYS, readFinanceKursunGramPriceBasis, systemSettingService } from "../src/services/system-setting.service";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null }> {
  try { await fn(); return { status: 200, code: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null };
  }
}
// Sürüm anı uygulama saatinden, iş anı DB saatinden gelir — sıra payı (aynı makinede ms farkı).
const tick = () => new Promise((r) => setTimeout(r, 400));
const total = (r: ServiceResolution) => r.lines.reduce((s, l) => s + Number(l.unitPrice ?? 0) * Number(l.quantity), 0);
const SVC = { gramPriceBasis: "SERVICE_DATE" as const };
const INV = { gramPriceBasis: "INVOICE_DATE" as const };
const LATE = "iş tarihinden SONRA girilen ilk gram fiyatıyla";
const CUSTOMER_LATER = "müşteriye özel gram fiyatı iş tarihinden SONRA girildi";
const CURRENT = "gram fiyatının BUGÜNKÜ değeriyle";

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-KGG-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], woIds: [] as string[], rollIds: [] as string[],
  stationIds: [] as string[], machineIds: [] as string[], customerIds: [] as string[], cariIds: [] as string[],
  basisRow: undefined as undefined | null | { value: unknown },
  kursunCreated: null as string | null, variantRestore: null as { id: string; serviceItemId: string | null } | null,
};

async function main(): Promise<void> {
  console.log("=== Kurşun gram fiyatı geçmişi — iş anındaki sürüm · fatura anı seçeneği · append-only ===");
  const actor = await testActorId();

  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true, serviceItemId: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({
      data: { code: `${P}-GR`.slice(0, 32), name: `TEST KGG gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
      select: { id: true, serviceItemId: true },
    });
    fx.propIds.push(variant.id);
  } else {
    fx.variantRestore = { id: variant.id, serviceItemId: variant.serviceItemId };
  }
  const variantId = variant.id;
  const fabric = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST KGG kumaş ${STAMP}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } })).id;
  const svc = (await kartAc({ code: `${P}-SVC`.slice(0, 32), name: `TEST KGG Kurşun ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" })).id;
  fx.itemIds.push(fabric, svc);
  await itemPriceService.upsert({ itemId: svc, kind: PriceKind.SALE, currency: "TRY", price: 3 });
  await prisma.fabricProperty.update({ where: { id: variantId }, data: { serviceItemId: svc } });
  const v40 = await prisma.fabricPropertyValue.create({ data: { propertyId: variantId, code: `KGG40-${STAMP}`.toUpperCase(), name: "40 gr", sortOrder: 10, amount: "40" }, select: { id: true } });
  fx.valueIds.push(v40.id);

  const mkStation = async (n: string) => {
    const st = await prisma.station.create({ data: { code: `${P}-K${n}`.slice(0, 32), name: `TEST KGG kurşun ${n} ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true }, select: { id: true } });
    fx.stationIds.push(st.id);
    const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M${n}`.slice(0, 32), name: `TEST KGG makine ${n} ${STAMP}` }, select: { id: true } });
    fx.machineIds.push(m.id);
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${P}-WO${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "ACTIVE" as const }] } },
      select: { id: true, steps: { select: { id: true } } },
    });
    fx.woIds.push(wo.id);
    return { id: st.id, machineId: m.id, stepId: wo.steps[0]!.id };
  };
  let seq = 0;
  const job = async (st: { machineId: string; stepId: string }, meters = 500) => {
    seq++;
    const roll = await prisma.roll.create({ data: { itemId: fabric, barcode: `${P}-R${seq}`, initialQty: meters, currentQty: meters, status: "IN_PRODUCTION", currentStepId: st.stepId }, select: { id: true } });
    fx.rollIds.push(roll.id);
    await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: st.stepId, qtyIn: meters, qtyOut: meters } });
    await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: roll.id, stepId: st.stepId, valueId: v40.id, userId: actor, machineId: st.machineId }));
    return roll.id;
  };
  const versions = (where: { stationId?: string; cariAccountId?: string }) => prisma.kursunGramPriceVersion.count({ where });

  // ── §1 ────────────────────────────────────────────────────────────────────
  section("§1 gün1 0,05 → gün2 iş → gün3 0,06 → gün4 fatura");
  const A = await mkStation("A");
  await setKursunStation(A.id, { gramPrice: "0.05", gramCurrency: "TRY" }, actor);
  await tick();
  const r1 = await job(A);
  await tick();
  await setKursunStation(A.id, { gramPrice: "0.06", gramCurrency: "TRY" }, actor);
  await tick();
  const s1 = await resolveServiceItemsForRolls({ rollIds: [r1], customerId: null, currency: "TRY", options: SVC });
  check("SERVICE_DATE: iş anındaki 0,05 → tutar 1000", total(s1) === 1000, JSON.stringify(s1.lines.map((l) => [l.unitPrice, l.quantity])));
  check("SERVICE_DATE: 'BUGÜNKÜ değeriyle' uyarısı YOK, geç-fiyat uyarısı yok", !s1.warnings.some((w) => w.includes(CURRENT) || w.includes(LATE)), JSON.stringify(s1.warnings));
  const i1 = await resolveServiceItemsForRolls({ rollIds: [r1], customerId: null, currency: "TRY", options: INV });
  check("INVOICE_DATE: güncel 0,06 → tutar 1200", total(i1) === 1200, JSON.stringify(i1.lines.map((l) => [l.unitPrice, l.quantity])));
  check("INVOICE_DATE: 'BUGÜNKÜ değeriyle' uyarısı aynen", i1.warnings.some((w) => w.includes(CURRENT)), JSON.stringify(i1.warnings));
  check("istasyon kolonu 'şu an ne' = 0,06 (ekranlar ve INVOICE_DATE okur)", (await prisma.station.findUnique({ where: { id: A.id }, select: { kursunGramPrice: true } }))?.kursunGramPrice?.toString() === "0.06");

  // ── §2 ────────────────────────────────────────────────────────────────────
  section("§2 müşteri sürümü kaldırılınca sonraki işler istasyon sürümüne düşer");
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST KGG müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);
  const cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } });
  fx.cariIds.push(cari.id);
  await cariService.update(cari.id, { kursunGramPrice: "0.04", kursunGramCurrency: "TRY" }, actor);
  await tick();
  const rA = await job(A);
  await tick();
  await cariService.update(cari.id, { kursunGramPrice: null, kursunGramCurrency: null }, actor);
  await tick();
  const rB = await job(A);
  await tick();
  const sA = await resolveServiceItemsForRolls({ rollIds: [rA], customerId: cust.id, currency: "TRY", options: SVC });
  check("müşteri fiyatı geçerliyken yapılan iş 0,04 → 800", total(sA) === 800, JSON.stringify(sA.lines.map((l) => l.unitPrice)));
  const sB = await resolveServiceItemsForRolls({ rollIds: [rB], customerId: cust.id, currency: "TRY", options: SVC });
  check("kaldırmadan sonraki iş istasyonun o anki 0,06 → 1200", total(sB) === 1200, JSON.stringify(sB.lines.map((l) => l.unitPrice)));
  const s1c = await resolveServiceItemsForRolls({ rollIds: [r1], customerId: cust.id, currency: "TRY", options: SVC });
  check("müşteri fiyatından ÖNCEKİ iş: o anda geçerli istasyon 0,05 (geriye dönük müşteri fiyatı değil) → 1000, geç-fiyat uyarısı yok", total(s1c) === 1000 && !s1c.warnings.some((w) => w.includes(LATE)), JSON.stringify([s1c.lines.map((l) => l.unitPrice), s1c.warnings]));
  // K14-a (S3): müşteri fiyatı işten SONRA ilk kez girildi, istasyon fiyatı kullanıldı → sessiz kalınmaz.
  check("müşteri fiyatından ÖNCEKİ iş: 'müşteriye özel gram fiyatı iş tarihinden SONRA girildi' uyarısı (1 iş)", s1c.warnings.some((w) => w.startsWith("1 ") && w.includes(CUSTOMER_LATER)), JSON.stringify(s1c.warnings));
  check("müşteri fiyatı kaldırıldıktan sonraki iş: müşteri-sonra uyarısı YOK (o anda müşteri sürümü vardı)", !sB.warnings.some((w) => w.includes(CUSTOMER_LATER)), JSON.stringify(sB.warnings));
  check("müşteri fiyatı geçerliyken yapılan iş: müşteri-sonra uyarısı YOK", !sA.warnings.some((w) => w.includes(CUSTOMER_LATER)), JSON.stringify(sA.warnings));
  check("kaldırma sürümü fiyatsız satırdır (silme değil)", (await prisma.kursunGramPriceVersion.findMany({ where: { cariAccountId: cari.id }, orderBy: { createdAt: "asc" }, select: { price: true, currency: true } }))
    .map((v) => `${v.price?.toString() ?? "-"}/${v.currency ?? "-"}`).join(",") === "0.04/TRY,-/-");

  // ── §3 ────────────────────────────────────────────────────────────────────
  section("§3 fiyat işten SONRA ilk kez girildi → en eski sürüm + uyarı");
  const B = await mkStation("B");
  const rL = await job(B);
  await tick();
  await setKursunStation(B.id, { gramPrice: "0.05", gramCurrency: "TRY" }, actor);
  await tick();
  const sL = await resolveServiceItemsForRolls({ rollIds: [rL], customerId: null, currency: "TRY", options: SVC });
  check("en eski sürüm (0,05) uygulanır → 1000", total(sL) === 1000, JSON.stringify(sL.lines.map((l) => l.unitPrice)));
  check("uyarı: '1 kurşun işinin tarihinde … iş tarihinden SONRA'", sL.warnings.some((w) => w.startsWith("1 ") && w.includes(LATE)), JSON.stringify(sL.warnings));

  // ── §4 ────────────────────────────────────────────────────────────────────
  section("§4 para birimi uymazsa kalem fiyatı");
  await setKursunStation(B.id, { gramPrice: "0.05", gramCurrency: "USD" }, actor);
  await tick();
  const rM = await job(B);
  await tick();
  const sM = await resolveServiceItemsForRolls({ rollIds: [rM], customerId: null, currency: "TRY", options: SVC });
  check("o anki sürüm USD, fatura TRY → kalem fiyatı 3 (açıklamasız)", Number(sM.lines[0]?.unitPrice) === 3 && sM.lines[0]?.label === undefined, JSON.stringify(sM.lines.map((l) => [l.unitPrice, l.label])));
  const sLb = await resolveServiceItemsForRolls({ rollIds: [rL], customerId: null, currency: "TRY", options: SVC });
  check("USD sürümünden ÖNCEKİ iş yine TRY sürümünden (geçmiş değişmez) → 1000", total(sLb) === 1000, JSON.stringify(sLb.lines.map((l) => l.unitPrice)));

  // ── §5 ────────────────────────────────────────────────────────────────────
  section("§5 aynı değer tekrar yazılınca sürüm yok");
  const nA = await versions({ stationId: A.id });
  await setKursunStation(A.id, { gramPrice: "0.0600", gramCurrency: "TRY" }, actor);
  await setKursunStation(A.id, { enabled: false }, actor);
  check("istasyon: 0,06 → '0.0600' tekrar + gram alanı olmayan gövde → sürüm sayısı aynı", (await versions({ stationId: A.id })) === nA && nA === 2, `${nA}`);
  const nC = await versions({ cariAccountId: cari.id });
  await cariService.update(cari.id, { kursunGramPrice: null, kursunGramCurrency: null }, actor);
  await cariService.update(cari.id, { notes: `TEST ${STAMP}` }, actor);
  check("cari: null tekrar + gram alanı olmayan güncelleme → sürüm sayısı aynı", (await versions({ cariAccountId: cari.id })) === nC && nC === 2, `${nC}`);
  const C = await mkStation("C");
  await setKursunStation(C.id, { gramPrice: null }, actor);
  check("hiç fiyatı olmamış istasyona 'kaldır' → sürüm yazılmaz", (await versions({ stationId: C.id })) === 0);

  // ── §6 ────────────────────────────────────────────────────────────────────
  section("§6 STATİK — sürüm satırı güncellenmez/silinmez, tek yazıcı");
  const SRC = join(__dirname, "..", "src");
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
  walk(SRC);
  const mutate = /kursunGramPriceVersion\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b|(UPDATE|DELETE\s+FROM)\s+"?kursun_gram_price_versions/i;
  const mutators = files.filter((f) => mutate.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
  check("src'de sürüm satırına update/delete/upsert/ham SQL yok", mutators.length === 0, mutators.join(", ") || `${files.length} dosya tarandı`);
  const creators = files.filter((f) => /kursunGramPriceVersion\s*\.\s*(create|createMany)\b/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
  check("sürüm yalnız helper'da doğar", creators.length === 1 && creators[0] === "services/helpers/kursun-gram-price-version.helper.ts", creators.join(", "));
  // Kolonu yazan servis dosyası (gram kolonunu anan + update çağıran, route/okuyucu hariç) sürüm yazıcısını çağırır.
  const READERS = new Set(["services/helpers/kursun-gram-price.helper.ts", "constants/write-guard.ts"]);
  const colWriters = files.map((f) => ({ rel: relative(SRC, f), t: readFileSync(f, "utf8") }))
    .filter(({ rel, t }) => !rel.startsWith("routes/") && !READERS.has(rel) && /kursunGramPrice\b/.test(t) && /\.(update|updateMany|upsert)\(/.test(t));
  const missing = colWriters.filter(({ t }) => !t.includes("recordKursunGramPriceVersionTx(")).map((x) => x.rel);
  check("gram kolonunu yazan her servis sürüm yazıcısını çağırır", missing.length === 0 && colWriters.length >= 3, missing.join(", ") || colWriters.map((x) => x.rel).join(", "));

  // ── §7 ────────────────────────────────────────────────────────────────────
  section("§7 ayar");
  // Ayar satırı yazılmadan önce kaydedilir; cleanup (finally) birebir geri yükler.
  fx.basisRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_KURSUN_GRAM_PRICE_BASIS }, select: { value: true } });
  const bad = await errOf(() => systemSettingService.setFeatureFlags({ financeKursunGramPriceBasis: "ISTEDIGIM" as never }, actor));
  check("bilinmeyen değer 400 (fail-closed)", bad.status === 400, JSON.stringify(bad));
  check("varsayılan SERVICE_DATE (K14 kullanıcı kararı)", DEFAULT_KURSUN_GRAM_PRICE_BASIS === "SERVICE_DATE");
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_KURSUN_GRAM_PRICE_BASIS }, select: { value: true } });
  if (!row) {
    check("ayar satırı yokken okuma SERVICE_DATE", (await readFinanceKursunGramPriceBasis()) === "SERVICE_DATE");
    const def = await resolveServiceItemsForRolls({ rollIds: [r1], customerId: null, currency: "TRY" });
    check("seçeneksiz çağrı ayardan okur → 1000", total(def) === 1000, String(total(def)));
  } else {
    console.log(`   ⓘ ayar satırı bu DB'de dolu (${JSON.stringify(row.value)}) — varsayılan okuma kontrolü atlandı`);
  }

  // ── §8 ────────────────────────────────────────────────────────────────────
  section("§8 fiyat geçmişi listesi");
  const h1 = await getKursunStationPriceHistory(A.id, { limit: 1 });
  check("en yeni önce: 0.06, kim dolu, nextCursor var", h1.items.length === 1 && h1.items[0]!.price === "0.06" && h1.items[0]!.createdById === actor && h1.items[0]!.createdByName !== null && h1.nextCursor !== null, JSON.stringify(h1));
  const h2 = await getKursunStationPriceHistory(A.id, { limit: 1, cursor: h1.nextCursor! });
  check("ikinci sayfa 0.05, son sayfa", h2.items.length === 1 && h2.items[0]!.price === "0.05" && h2.nextCursor === null, JSON.stringify(h2));
  const cur = await errOf(() => getKursunStationPriceHistory(A.id, { cursor: "bozuk" }));
  check("bozuk cursor 400 INVALID_CURSOR", cur.status === 400 && cur.code === "INVALID_CURSOR", JSON.stringify(cur));
  const ch = await cariService.kursunGramHistory(cari.id, {});
  check("cari geçmişi: kaldırma sürümü (null) en üstte", ch.data.items.length === 2 && ch.data.items[0]!.price === null && ch.data.items[1]!.price === "0.04", JSON.stringify(ch.data.items.map((i) => i.price)));
  const nf = await errOf(() => getKursunStationPriceHistory(randomUUID(), {}));
  check("olmayan istasyon 404", nf.status === 404, JSON.stringify(nf));
}

/** Gram fiyatı dayanağı ayarını §7 öncesi hâline döndürür (yalnız finally'deki cleanup'tan çağrılır). */
async function restoreBasisSetting(): Promise<void> {
  const before = fx.basisRow;
  if (before === undefined) return;
  const key = SETTING_KEYS.FINANCE_KURSUN_GRAM_PRICE_BASIS;
  if (before === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.update({ where: { key }, data: { value: before.value as never } });
  const after = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  check("ayar geri alındı", JSON.stringify(after?.value ?? null) === JSON.stringify(before?.value ?? null));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await restoreBasisSetting();
  const ids = fx.rollIds;
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  // Bekçi kendi fikstür sürümlerini kaldırır (src'de sürüm silinmez — §6, defter-beyan §10).
  await del("gramSürüm", () => prisma.kursunGramPriceVersion.deleteMany({ where: { OR: [{ stationId: { in: fx.stationIds } }, { cariAccountId: { in: fx.cariIds } }] } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { OR: [{ id: { in: fx.valueIds } }, { propertyId: { in: fx.propIds } }] } }));
  if (fx.variantRestore) { const r = fx.variantRestore; await del("variant geri", () => prisma.fabricProperty.update({ where: { id: r.id }, data: { serviceItemId: r.serviceItemId } })); }
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: fiyatKonusuWhere(fx.itemIds) }));
  await del("item", () => kartlariSil(fx.itemIds));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: fx.cariIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-KGG top kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
