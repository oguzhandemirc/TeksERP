// =============================================================================
// BEKÇİ — DESEN DEĞERİ FATURAYA + DIŞ BRODE KABULÜNDE HEDEF DESEN (Gülkesim dalga 4 · D4-D3)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_desen_fatura_kalemi.ts
//
// NEDEN: brode ücreti desen başına farklı kaleme kesilebilir (S7 cevapsız; model iki yolu veriyle
// taşır). Kalem sırası ters dönerse (bayrak kalemi önce) desen kalemi hiç seçilmez; dış brodeden
// dönen top deseni taşımazsa desen kalemi dış işte hiç devreye girmez (DALGA4 §5.5/6 ve /8, K8).
//
// ÖLÇÜLENLER:
//   §1 Kalem sırası: desen değerinde kalem varsa o, yoksa bayrak kalemi; bayrak kalemsiz + desen
//      kalemli ⇒ desen kalemi; ikisi de yoksa iş YOK (bugünkü gibi)
//   §2 Eşlemesiz desen bayt-aynı: aynı topa eşlemesiz desen eklenince taslak JSON'u değişmez
//   §3 Ayar KAPALI: fason kabulünde doğan top yalnız bayrağı taşır (özellik satırları bayt-aynı)
//   §4 Ayar AÇIK: doğan top İE hedef desenini taşır (aynı tx), fatura desen kalemiyle; makbuz
//      iptali desen satırını DAMGALAR (silmez)
//   §5 Ayar dört kapı: bilinmeyen değer servis 400 + Zod reddi; okuma varsayılanı false
//   §6 AST: kalem zinciri (`.serviceItemId ?? ifade`) yalnız `service-item-pick.helper`de; tek tanım
// Negatif sondalar: pickServiceItemId sırası ters çevrilince (bayrak önce) §1/§4 kırmızı · ikinci
// çözücü (`a.serviceItemId ?? b.serviceItemId`) yazılınca §6 kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { Currency, ItemType, PriceKind, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS, loadServiceBillingSettings, readFasonReceiptApplyTargetVariant, systemSettingService } from "../src/services/system-setting.service";
import { collectServiceBillingDraft } from "../src/services/helpers/service-billing.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { testActorId } from "./fixture-test-user";
import { updateSchema } from "../src/routes/feature-flag.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-DSN-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], woIds: [] as string[], rollIds: [] as string[],
  stationIds: [] as string[], customerId: null as string | null,
};
const KEYS = [SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, SETTING_KEYS.FASON_RECEIPT_APPLY_TARGET_VARIANT];
const prior = new Map<string, { existed: boolean; value: unknown }>();
async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function main(): Promise<void> {
  console.log("=== Desen değeri faturaya + dış brode kabulünde hedef desen (D4-D3) ===");
  for (const k of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    prior.set(k, { existed: row !== null, value: row?.value ?? null });
  }
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, true);
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FASON_RECEIPT_APPLY_TARGET_VARIANT } });
  const actor = await testActorId();
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok");

  const mkItem = async (suffix: string, itemType: ItemType, price?: string) => {
    const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST DSN ${suffix} ${STAMP}`, itemType, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    if (price) await prisma.itemPrice.create({ data: { itemId: it.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price } });
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const BRODE = await mkItem("BRODE", ItemType.SERVICE, "5.0000");
  const DESEN_A = await mkItem("DSNA", ItemType.SERVICE, "7.0000");
  const mkProp = async (suffix: string, data: { valueType: "FLAG" | "CHOICE"; serviceItemId?: string | null; variantOfPropertyId?: string }) => {
    const p = await prisma.fabricProperty.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST DSN ${suffix}`, ...data }, select: { id: true } });
    fx.propIds.push(p.id);
    return p.id;
  };
  const mkValue = async (propertyId: string, code: string, serviceItemId: string | null) =>
    (await prisma.fabricPropertyValue.create({ data: { propertyId, code: `${code}-${STAMP}`, name: `Desen ${code}`, serviceItemId }, select: { id: true } })).id;
  // BR: kalemli brode bayrağı + desen çeşidi; BX: kalemsiz bayrak + desen çeşidi (müşteri başına desen kalemi yolu).
  const BR = await mkProp("BR", { valueType: "FLAG", serviceItemId: BRODE });
  const BRD = await mkProp("BRD", { valueType: "CHOICE", variantOfPropertyId: BR });
  const vA = await mkValue(BRD, "A", DESEN_A);
  const vB = await mkValue(BRD, "B", null);
  const BX = await mkProp("BX", { valueType: "FLAG", serviceItemId: null });
  const BXD = await mkProp("BXD", { valueType: "CHOICE", variantOfPropertyId: BX });
  const xA = await mkValue(BXD, "XA", DESEN_A);
  const xB = await mkValue(BXD, "XB", null);
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST DSN müşteri ${STAMP}` }, select: { id: true } });
  fx.customerId = cust.id;

  const inventory = new InventoryService();
  const mkRoll = async (qty: number, props: Array<{ propertyId: string; valueId?: string }>): Promise<string> => {
    const res = await inventory.createInitialEntry({ itemId: fabric, initialQty: qty }, undefined, undefined, false, { forcedStatus: RollStatus.WAREHOUSE, warehouseId: wh.id });
    const id = (res.data as { id: string }).id;
    fx.rollIds.push(id);
    await prisma.roll.update({ where: { id }, data: { ownerCustomerId: cust.id } });
    if (props.length) await prisma.rollProperty.createMany({ data: props.map((p) => ({ rollId: id, propertyId: p.propertyId, valueId: p.valueId ?? null })) });
    return id;
  };
  const settings = await loadServiceBillingSettings();
  const draft = (rollIds: string[]) => collectServiceBillingDraft({ rollIds, customerId: cust.id, currency: Currency.TRY, settings, dispatchedAt: null });
  const itemsOf = async (rollId: string) => (await draft([rollId])).links.filter((l) => l.rollId === rollId).map((l) => l.serviceItemId);

  // ── §1 ───────────────────────────────────────────────────────────────────
  section("§1 kalem sırası: desen değeri → bayrak kalemi");
  const r1 = await mkRoll(40, [{ propertyId: BR }, { propertyId: BRD, valueId: vA }]);
  const i1 = await itemsOf(r1);
  check("desen değerinde kalem var ⇒ kalem DESEN_A (bayrak kalemi değil)", i1.length === 1 && i1[0] === DESEN_A, JSON.stringify(i1));
  const r2 = await mkRoll(40, [{ propertyId: BR }, { propertyId: BRD, valueId: vB }]);
  const i2 = await itemsOf(r2);
  check("desen değeri eşlemesiz ⇒ bayrak kalemi BRODE", i2.length === 1 && i2[0] === BRODE, JSON.stringify(i2));
  const r3 = await mkRoll(40, [{ propertyId: BX }, { propertyId: BXD, valueId: xA }]);
  const i3 = await itemsOf(r3);
  check("bayrak kalemsiz + desen kalemli ⇒ DESEN_A", i3.length === 1 && i3[0] === DESEN_A, JSON.stringify(i3));
  const r4 = await mkRoll(40, [{ propertyId: BX }, { propertyId: BXD, valueId: xB }]);
  const d4 = await draft([r4]);
  check("bayrak kalemsiz + desen eşlemesiz ⇒ iş YOK, satır YOK (bugünkü gibi)", d4.links.length === 0 && d4.lines.length === 0, JSON.stringify(d4.links));

  // ── §2 ───────────────────────────────────────────────────────────────────
  section("§2 eşlemesiz desen eklenince taslak bayt-aynı (snapshot)");
  const r5 = await mkRoll(55, [{ propertyId: BR }]);
  const before = JSON.stringify(await draft([r5]));
  await prisma.rollProperty.create({ data: { rollId: r5, propertyId: BRD, valueId: vB } });
  const after = JSON.stringify(await draft([r5]));
  check("taslak JSON'u eşlemesiz desenle birebir aynı", before === after && before.includes(BRODE), `${before.length} ↔ ${after.length}`);

  // ── §3 / §4 fason kabulü ─────────────────────────────────────────────────
  const sub = await ensureTestDyeHouse();
  const subSvc = new SubcontractorService();
  const stFason = await prisma.station.create({ data: { code: `${P}-FSN`.slice(0, 32), name: `TEST DSN FSN ${STAMP}`, type: "EXTERNAL", kind: "SUBCONTRACTOR", appliesProperty: true }, select: { id: true } });
  fx.stationIds.push(stFason.id);
  await prisma.stationProperty.createMany({ data: [{ stationId: stFason.id, propertyId: BR }] });
  // İkinci adım: kabul sonrası İE açık kalsın (tamamlanmış İE'nin kabulü iptal edilemez).
  const stNext = await prisma.station.create({ data: { code: `${P}-NXT`.slice(0, 32), name: `TEST DSN NXT ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC" }, select: { id: true } });
  fx.stationIds.push(stNext.id);
  const fasonCycle = async (tag: string) => {
    const w = await prisma.workOrder.create({
      data: { workOrderNumber: `${P}-${tag}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: stFason.id, stepSequence: 1, status: "PENDING" as const }, { stationId: stNext.id, stepSequence: 2, status: "PENDING" as const }] } },
      select: { id: true, steps: { select: { id: true }, orderBy: { stepSequence: "asc" } } },
    });
    fx.woIds.push(w.id);
    await prisma.workOrderTargetValue.create({ data: { workOrderId: w.id, propertyId: BRD, valueId: vA } });
    await prisma.$transaction((tx) => new TravelerCardService().createForWorkOrder(tx, w.id, actor));
    const src = await mkRoll(120, []);
    await prisma.roll.update({ where: { id: src }, data: { status: RollStatus.STOCK } });
    await subSvc.dispatch({ workOrderId: w.id, stepId: w.steps[0]!.id, subcontractorId: sub.id, rollIds: [src] }, actor);
    const r = await subSvc.receive({ workOrderId: w.id, stepId: w.steps[0]!.id, subcontractorId: sub.id, clientToken: randomUUID(), returns: [{ rollId: src, receivedQty: 120 }], newRolls: [{ qty: 118 }], appliedPropertyIds: [BR] }, actor);
    const receiptId = (r.data as { id: string }).id;
    const born = await prisma.roll.findMany({ where: { parentReceiptId: receiptId }, select: { id: true } });
    fx.rollIds.push(...born.map((b) => b.id));
    const props = born.length === 0 ? [] : await prisma.rollProperty.findMany({ where: { rollId: born[0]!.id }, select: { propertyId: true, valueId: true, revokedAt: true }, orderBy: { propertyId: "asc" } });
    return { receiptId, bornId: born[0]?.id ?? null, props };
  };

  section("§3 ayar KAPALI: doğan top yalnız bayrağı taşır");
  check("okuma varsayılanı false (kayıt yok)", (await readFasonReceiptApplyTargetVariant()) === false);
  const off = await fasonCycle("WOFF");
  check("doğan top özellikleri = [BR, değersiz] (bugünkü kabul)", JSON.stringify(off.props) === JSON.stringify([{ propertyId: BR, valueId: null, revokedAt: null }]), JSON.stringify(off.props));
  const offItems = off.bornId ? await itemsOf(off.bornId) : [];
  check("kapalıda fatura bayrak kalemi BRODE", offItems.length === 1 && offItems[0] === BRODE, JSON.stringify(offItems));

  section("§4 ayar AÇIK: doğan top hedef deseni taşır; iptal damgalar");
  await systemSettingService.setFeatureFlags({ fasonReceiptApplyTargetVariant: true }, actor);
  check("okuma true", (await readFasonReceiptApplyTargetVariant()) === true);
  const on = await fasonCycle("WON");
  const desen = on.props.find((p) => p.propertyId === BRD);
  check("doğan topta desen satırı: BRD = A (İE hedefi), bayrak da duruyor", desen?.valueId === vA && on.props.some((p) => p.propertyId === BR && p.valueId === null) && on.props.length === 2, JSON.stringify(on.props));
  const onItems = on.bornId ? await itemsOf(on.bornId) : [];
  check("açıkta fatura desen kalemi DESEN_A", onItems.length === 1 && onItems[0] === DESEN_A, JSON.stringify(onItems));
  await subSvc.cancelReceipt(on.receiptId, "D4-D3 bekçi iptali", actor, on.bornId ? [on.bornId] : []);
  const afterCancel = on.bornId ? await prisma.rollProperty.findMany({ where: { rollId: on.bornId, propertyId: BRD }, select: { revokedAt: true, revokeReason: true } }) : [];
  check("makbuz iptali: desen satırı SİLİNMEDİ, damgalandı", afterCancel.length === 1 && afterCancel[0]!.revokedAt !== null && !!afterCancel[0]!.revokeReason, JSON.stringify(afterCancel));

  // ── §5 ───────────────────────────────────────────────────────────────────
  section("§5 ayar kapıları: bilinmeyen değer reddi");
  const bad = await systemSettingService.setFeatureFlags({ fasonReceiptApplyTargetVariant: "ON" as unknown as boolean }, actor)
    .then(() => 200, (e: { statusCode?: number }) => e.statusCode ?? 500);
  check("servis: 'ON' (boolean değil) ⇒ 400", bad === 400, String(bad));
  check("Zod: 'ON' reddedilir, true kabul edilir",
    !updateSchema.safeParse({ fasonReceiptApplyTargetVariant: "ON" }).success && updateSchema.safeParse({ fasonReceiptApplyTargetVariant: true }).success);
  const flags = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
  check("feature-flag yükünde alan var", typeof flags.fasonReceiptApplyTargetVariant === "boolean", JSON.stringify(flags.fasonReceiptApplyTargetVariant));

  astChecks();
}

// ── §6 AST ────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");
const PICK_FILE = "services/helpers/service-item-pick.helper.ts";
function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const isServiceItemAccess = (n: ts.Node): boolean =>
  ts.isPropertyAccessExpression(n) && n.name.text === "serviceItemId";
const isLiteralFallback = (n: ts.Node): boolean =>
  n.kind === ts.SyntaxKind.NullKeyword || ts.isStringLiteral(n) || (ts.isIdentifier(n) && n.text === "undefined");
function astChecks(): void {
  section("§6 AST: kalem zinciri tek yerde");
  const files = walkTs(SRC);
  check("körlük zemini: src altında ≥ 300 .ts dosyası", files.length >= 300, String(files.length));
  const chains: string[] = [];
  const defs: string[] = [];
  for (const f of files) {
    const rel = relative(SRC, f).split("\\").join("/");
    const text = readFileSync(f, "utf8");
    if (!text.includes("serviceItemId") && !text.includes("pickServiceItemId")) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n)
        && (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        && (isServiceItemAccess(n.left) || isServiceItemAccess(n.right))
        && !isLiteralFallback(n.right)) {
        chains.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      if (ts.isFunctionDeclaration(n) && n.name?.text === "pickServiceItemId") defs.push(rel);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "pickServiceItemId") defs.push(rel);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  check("`.serviceItemId ?? ifade` zinciri src'de YOK (ikinci kalem çözücü)", chains.length === 0, JSON.stringify(chains));
  check("pickServiceItemId TEK tanım (service-item-pick.helper)", defs.length === 1 && defs[0] === PICK_FILE, JSON.stringify(defs));
  const pick = readFileSync(join(SRC, PICK_FILE), "utf8");
  check("sıra: değer → özellik → ana bayrak", /src\.value \?\? src\.property \?\? src\.parentFlag/.test(pick));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  for (const [key, prev] of prior) {
    await del(`ayar ${key}`, () => prev.existed
      ? prisma.systemSetting.upsert({ where: { key }, create: { key, value: prev.value as never }, update: { value: prev.value as never } })
      : prisma.systemSetting.deleteMany({ where: { key } }));
  }
  const ids = fx.rollIds;
  const recIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((r) => r.id);
  const dispIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((d) => d.id);
  await del("link", () => prisma.serviceBillingLink.deleteMany({ where: { rollId: { in: ids } } }));
  await del("whMove", () => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("receiptItem", () => prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: recIds } } }));
  await del("receiptProperty", () => prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: recIds } } }));
  await del("dispatchItem", () => prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispIds } } }));
  await del("born roll", () => prisma.roll.deleteMany({ where: { id: { in: ids }, parentReceiptId: { not: null } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("receipt", () => prisma.subcontractorReceipt.deleteMany({ where: { id: { in: recIds } } }));
  await del("dispatch", () => prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: fx.propIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  if (fx.customerId) { const cid = fx.customerId; await del("customer", () => prisma.customer.deleteMany({ where: { id: cid } })); }
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids, ...recIds, ...dispIds, ...fx.woIds] } } }));
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: TEST-DSN top kalıntısı yok", left === 0, String(left));
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
