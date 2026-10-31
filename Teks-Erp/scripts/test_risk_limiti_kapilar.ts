// =============================================================================
// BEKÇİ — RİSK LİMİTİ İŞ KABULÜ / SEVK KAPILARI (D4-I2; tasarım DALGA4 §10.5 md. 5, §12.1, §13 D4-I2, K24)
// =============================================================================
//   §0 statik — `riskExposureTx` TEK tanım; riskLimit'i okuyup karşılaştıran İKİNCİ hesap yok (AST); çekirdek
//      `cari_balances` FOR UPDATE; fatura onayı çekirdeği çağırır (dönem guard'ından SONRA); kapı beş boğazda
//      (gelen belge precheck · sipariş yaratma + müşteri değişimi · createShipmentCoreTx · performDispatchTx claim'den
//      ÖNCE), helper'ı import eden küme SABİT
//   §1 ayarlar KAPALI (varsayılan) — kapı tek ayar okuması, başka sorgu YOK; aşımlı caride sipariş/gelen belge/sevk geçer
//   §2 iş kabulü AÇIK — sipariş + müşteri taşıma + gelen belge onayı 409 RISK_LIMIT_EXCEEDED (Türkçe), yazım yok;
//      limit altı / limitsiz cari geçer; para birimleri AYRI ölçülür
//   §3 sevk AÇIK — karışık sevk 409; tamamı emanet sevk GEÇER (K22); PLANNED dispatch 409, PLANNED kalır
//   §4 fatura onayı — 409 metni bayt-aynı + details.code RISK_LIMIT_EXCEEDED (K24)
//   §5 bilinmeyen ayar değeri 400
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-30): ① shipping.service'e `cariAccount.riskLimit` okuyup `bal.plus(0).gt(limit)`
//    yapan ikinci hesap eklendi → §0b ❌ (adıyla: shipping.service.ts:probeSecondExposure); ② performDispatchTx'ten
//    risk kapısı silindi → §0i + §3c ❌ (PLANNED sevkiyat DISPATCHED oldu). Geri alındı → 30/0.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { orderService } from "../src/routes/order.routes";
import { shippingService } from "../src/services/shipping.service";
import { invoiceService } from "../src/services/invoice.service";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { assertCustomerRiskLimitTx } from "../src/services/helpers/risk-exposure.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const kod = (e: unknown): string => {
  if (!e) return "geçti";
  const d = (e as { details?: { code?: string } }).details;
  return String(d?.code ?? (e as Error).message ?? e);
};
async function hataNesnesi(fn: () => Promise<unknown>): Promise<{ kod: string; mesaj: string }> {
  try {
    await fn();
    return { kod: "geçti", mesaj: "" };
  } catch (e) {
    return { kod: kod(e), mesaj: (e as Error).message ?? "" };
  }
}
const hata = async (fn: () => Promise<unknown>) => (await hataNesnesi(fn)).kod;
class Rollback extends Error {}
async function geriSarilan(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<string> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }, { timeout: 60_000 });
    return "yazdı?!";
  } catch (e) {
    return e instanceof Rollback ? "GEÇTİ" : kod(e);
  }
}

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const TAG = `TEST-RLK-${process.pid}`;
const AYARLAR = [
  SETTING_KEYS.FINANCE_ENABLED,
  SETTING_KEYS.EMANET_ENABLED,
  SETTING_KEYS.GELEN_BELGE_ENABLED,
  SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED,
  SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE,
  SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_SHIPMENT,
];
const CMP = new Set(["gt", "gte", "lt", "lte", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo", "comparedTo", "cmp"]);

function tumTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? tumTs(p) : p.endsWith(".ts") ? [p] : [];
  });
}
function govde(src: string, baslik: string, n = 9000): string {
  const i = src.indexOf(baslik);
  return i < 0 ? "" : src.slice(i, i + n);
}

/** `riskLimit` değerini okuyup (x.riskLimit / select { riskLimit }) Decimal karşılaştıran fonksiyonlar — "exposure hesabı". */
function exposureHesaplari(): string[] {
  const out: string[] = [];
  for (const f of tumTs(SRC)) {
    const text = readFileSync(f, "utf8");
    if (!text.includes("riskLimit")) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const olcFn = (fn: ts.Node, ad: string): void => {
      let okur = false;
      let karsilastirir = false;
      const gez = (n: ts.Node): void => {
        // İç ADLI fonksiyon kendi ölçülür; ok/anonim fonksiyon (ör. `.map((r) => …)`) gövdeye sayılır.
        if (n !== fn && (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n))) return;
        if (ts.isPropertyAccessExpression(n) && n.name.text === "riskLimit") okur = true;
        if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && ts.isIdentifier(n.name) && n.name.text === "riskLimit") okur = true;
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && CMP.has(n.expression.name.text)) karsilastirir = true;
        ts.forEachChild(n, gez);
      };
      ts.forEachChild(fn, gez);
      if (okur && karsilastirir) out.push(`${path.relative(SRC, f)}:${ad}`);
    };
    const tara = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && !ts.isCallExpression(n.parent))) {
        const nm = (n as ts.FunctionLikeDeclaration).name;
        olcFn(n, nm && ts.isIdentifier(nm) ? nm.text : `<anonim@${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}>`);
      }
      ts.forEachChild(n, tara);
    };
    tara(sf);
  }
  return out.sort();
}

function statik(): void {
  console.log("── §0 Statik ──");
  const oku = (p: string) => readFileSync(path.join(SRC, p), "utf8");
  const tanimlar = tumTs(SRC).filter((f) => /export async function riskExposureTx\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
  check("§0a `riskExposureTx` TEK tanım (risk-exposure.helper)", JSON.stringify(tanimlar) === JSON.stringify(["services/helpers/risk-exposure.helper.ts"]), tanimlar.join(", "));
  const hesaplar = exposureHesaplari();
  check("§0b ⭐ riskLimit okuyup karşılaştıran İKİNCİ exposure hesabı YOK (AST)", JSON.stringify(hesaplar) === JSON.stringify(["services/helpers/risk-exposure.helper.ts:riskExposureTx"]), hesaplar.join(", "));
  const helper = oku("services/helpers/risk-exposure.helper.ts");
  check("§0c çekirdek `cari_balances` satırını FOR UPDATE (belirlenimli sıra) okur", /FROM cari_balances[\s\S]{0,200}ORDER BY currency\s*\n\s*FOR UPDATE/.test(helper));
  const inv = oku("services/invoice.service.ts");
  const conf = govde(inv, "  async confirm(id: string", 12000);
  check("§0d fatura onayı: dönem guard'ı (advisory) → risk guard'ı sırası aynen", conf.indexOf("assertPeriodOpenTx(tx,") > 0 && conf.indexOf("assertPeriodOpenTx(tx,") < conf.indexOf("this.assertRiskLimitTx(tx,"));
  const guard = govde(inv, "private async assertRiskLimitTx(", 1600);
  check("§0e fatura guard'ı çekirdeği çağırır (ek = fatura tutarı) + details.code", /riskExposureTx\(tx, ref\.cariId, ref\.currency, ref\.amount\)/.test(guard) && /code: "RISK_LIMIT_EXCEEDED"/.test(guard));
  const pre = govde(oku("services/gelen-belge-onay.service.ts"), "async function precheck(", 2500);
  check("§0f gelen belge precheck: kilit kapısından SONRA risk kapısı", pre.indexOf('assertCustomerRiskLimitTx(prisma, note.ownerCustomerId, "INTAKE")') > pre.indexOf("assertCariNotHeldTx(prisma"));
  const ord = oku("services/order.service.ts");
  check("§0g sipariş yaratma + müşteri değişimi INTAKE risk kapısı", /assertCustomerRiskLimitTx\(prisma, data\.customerId as string, "INTAKE"\)/.test(ord) && /assertCustomerRiskLimitTx\(prisma, finalCustomerId, "INTAKE"\)/.test(ord));
  const ship = oku("services/shipping.service.ts");
  const core = govde(ship, "private async createShipmentCoreTx(", 4000);
  check("§0h createShipmentCoreTx: risk kapısı yazımdan ÖNCE, emanet yüklemiyle", /assertCustomerRiskLimitTx\(tx, p\.customerId, "SHIPMENT", \(\) => rollsAllOwnedByTx/.test(core) && core.indexOf("assertCustomerRiskLimitTx(") < core.indexOf("tx.shipment.create("));
  const disp = govde(ship, "private async performDispatchTx(", 3000);
  check("§0i ⭐ performDispatchTx: risk kapısı claim'den (updateMany) ÖNCE", disp.includes('assertCustomerRiskLimitTx(tx, holdHeader.customerId, "SHIPMENT", ownEmanetOnly)') && disp.indexOf("assertCustomerRiskLimitTx(") < disp.indexOf("tx.shipment.updateMany("));
  const importers = tumTs(SRC).filter((f) => /from "[^"]*risk-exposure\.helper"/.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f)).sort();
  // D4-I5: bildirim koşul kaynağı çekirdeği OKUR (yazmaz, kapı değil) — `cari.risk-limiti-asildi`.
  const BEKLENEN = ["services/gelen-belge-onay.service.ts", "services/invoice.service.ts", "services/notification-sources/cari.ts", "services/order.service.ts", "services/shipping.service.ts"];
  check("§0j helper'ı import eden küme SABİT (taslak/iade/storno/tahsilat yolları çağırmaz)", JSON.stringify(importers) === JSON.stringify(BEKLENEN), importers.join(", "));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== RİSK LİMİTİ KAPILARI BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const ayar = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], items: [] as string[], rolls: [] as string[], sacks: [] as string[], shipments: [] as string[], notes: [] as string[], invoices: [] as string[], orders: [] as string[] };
  try {
    await ayar(SETTING_KEYS.FINANCE_ENABLED, true);
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED, false);
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE, false);
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_SHIPMENT, false);
    const kart = async (ek: string, limit: number | null) => {
      const r = (await customerService.create({ name: `${TAG} ${ek}`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
      ids.customers.push(r.data.id);
      const acc = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } });
      await prisma.cariAccount.update({ where: { id: acc.id }, data: { riskLimit: limit } });
      return { customerId: r.data.id, cariId: acc.id };
    };
    const bakiye = (cariId: string, currency: "TRY" | "USD", balance: number) =>
      prisma.cariBalance.upsert({ where: { cariId_currency: { cariId, currency } }, create: { cariId, currency, balance }, update: { balance } });
    const A = await kart("A", 100); // aşımlı
    await bakiye(A.cariId, "TRY", 500);
    const item = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    ids.items.push(item.id);
    const govdeS = (customerId: string) => ({ customerId, lines: [{ itemId: item.id, quantity: 10 }] });
    const not = async (customerId: string, n: number) => {
      const lines = Array.from({ length: n }, (_, i) => ({ senderRollNo: `${TAG}-R${ids.notes.length}-${i}`, meters: 100 + i, weightKg: 20, itemText: "Perde", itemId: item.id }));
      const r = (await createDeliveryNote({ sourceKind: "MANUAL", ownerCustomerId: customerId, senderText: `${TAG} gönderen`, lines } as never, admin.id)) as { id: string };
      ids.notes.push(r.id);
      return r.id;
    };
    const topSay = (noteId: string) => prisma.customerDeliveryNoteLine.count({ where: { noteId, rollId: { not: null } } });
    const wh = await fixtureWarehouseId();
    const grade = await firstGrade();
    const top = async (owner: string | null) => {
      const r = await prisma.roll.create({ data: { barcode: `${TAG}-T${ids.rolls.length}`, itemId: item.id, initialQty: 50, currentQty: 50, qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, status: RollStatus.WAREHOUSE, entrySource: "SUPPLIER_RECEIPT", warehouseId: wh, ownerCustomerId: owner }, select: { id: true } });
      ids.rolls.push(r.id);
      return r.id;
    };
    const cuval = async (rolls: string[]) => {
      const s = await prisma.sack.create({ data: { sackNo: `${TAG}-S${ids.sacks.length}`, seq: 1 }, select: { id: true } });
      ids.sacks.push(s.id);
      await prisma.roll.updateMany({ where: { id: { in: rolls } }, data: { sackId: s.id } });
      return s.id;
    };
    const svc = shippingService as unknown as {
      createShipmentCoreTx(tx: Prisma.TransactionClient, p: Record<string, unknown>): Promise<{ id: string }>;
      performDispatchTx(tx: Prisma.TransactionClient, id: string, d: Record<string, unknown>, u?: string): Promise<unknown>;
    };
    const core = (tx: Prisma.TransactionClient, customerId: string, sackId: string, anindaSevk: boolean) =>
      svc.createShipmentCoreTx(tx, { sackIds: [sackId], customerId, branchId: null, orderIds: [], orderless: true, assertDestination: () => undefined, confirmationEnabled: !anindaSevk, userId: admin.id });
    const karisik = await cuval([await top(A.customerId), await top(null)]);
    const emanet = await cuval([await top(A.customerId), await top(A.customerId)]);

    // ── §1 Ayarlar KAPALI ──
    console.log("\n── §1 Ayarlar kapalı (varsayılan = bugünkü davranış) ──");
    const sorgular: string[] = [];
    const casus = new Proxy({} as Prisma.TransactionClient, {
      get: (_t, model: string) => {
        if (model === "$queryRaw") return () => { sorgular.push("$queryRaw"); return Promise.resolve([]); };
        return new Proxy({}, { get: (_m, op: string) => () => { sorgular.push(`${model}.${op}`); return Promise.resolve(model === "systemSetting" ? null : []); } });
      },
    });
    await assertCustomerRiskLimitTx(casus, A.customerId, "INTAKE");
    await assertCustomerRiskLimitTx(casus, A.customerId, "SHIPMENT", async () => { sorgular.push("emanet"); return false; });
    check("§1a ⭐ kapalı kapı yalnız ayar okur (cari/bakiye/emanet sorgusu yok)", sorgular.length > 0 && sorgular.every((q) => q === "systemSetting.findUnique"), sorgular.join(", "));
    check("§1b aşımlı caride sipariş ön kapısı geçer", (await hata(() => orderService.prepareOrderCreate(govdeS(A.customerId), null, { userId: admin.id } as never))) === "geçti");
    const n1 = await not(A.customerId, 1);
    const a1 = await hata(() => approveDeliveryNote(n1, {}, admin.id));
    check("§1c aşımlı caride gelen belge onayı geçer (1 top)", a1 === "geçti" && (await topSay(n1)) === 1, a1);
    const k1 = await geriSarilan((tx) => core(tx, A.customerId, karisik, true));
    check("§1d aşımlı caride karışık sevk (kurulum + anında dispatch) geçer", k1 === "GEÇTİ", k1);

    // ── §2 İş kabulü AÇIK ──
    console.log("\n── §2 finance.riskLimitBlock.intake açık ──");
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE, true);
    const s2 = await hataNesnesi(() => orderService.create({ ...govdeS(A.customerId), clientToken: randomUUID() }, admin.id));
    check("§2a ⭐ aşım → sipariş 409 RISK_LIMIT_EXCEEDED (Türkçe), sipariş doğmaz", s2.kod === "RISK_LIMIT_EXCEEDED" && /risk limitini aştı .*yeni iş kabulü durduruldu/.test(s2.mesaj) && (await prisma.order.count({ where: { customerId: A.customerId } })) === 0, s2.mesaj);
    check("§2a' mesaj tutar taşımaz", !/500|100/.test(s2.mesaj.replace(TAG, "")), s2.mesaj);
    const B = await kart("B", 1000); // limit altı
    await bakiye(B.cariId, "TRY", 500);
    const ob = (await orderService.create({ ...govdeS(B.customerId), clientToken: randomUUID() }, admin.id)) as { data: { id: string } };
    ids.orders.push(ob.data.id);
    check("§2b limit altı cari sipariş geçer", !!ob.data.id);
    const s2c = await hata(() => orderService.update(ob.data.id, { customerId: A.customerId }, admin.id));
    const ob2 = await prisma.order.findUniqueOrThrow({ where: { id: ob.data.id }, select: { customerId: true } });
    check("§2c ⭐ siparişi aşımlı müşteriye taşıma 409 RISK_LIMIT_EXCEEDED, müşteri değişmez", s2c === "RISK_LIMIT_EXCEEDED" && ob2.customerId === B.customerId, s2c);
    const n2 = await not(A.customerId, 2);
    const a2 = await hata(() => approveDeliveryNote(n2, {}, admin.id));
    const st2 = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: n2 }, select: { status: true } });
    check("§2d ⭐ gelen belge onayı 409 RISK_LIMIT_EXCEEDED, SIFIR top, taslak DRAFT", a2 === "RISK_LIMIT_EXCEEDED" && (await topSay(n2)) === 0 && st2.status === "DRAFT", `${a2} ${st2.status}`);
    const C = await kart("C", null); // limitsiz
    await bakiye(C.cariId, "TRY", 99999);
    check("§2e limitsiz (riskLimit NULL) cari geçer", (await hata(() => orderService.prepareOrderCreate(govdeS(C.customerId), null, { userId: admin.id } as never))) === "geçti");
    await bakiye(B.cariId, "USD", 1500);
    check("§2f para birimleri AYRI ölçülür: TRY limit altı + USD aşım → 409", (await hata(() => orderService.prepareOrderCreate(govdeS(B.customerId), null, { userId: admin.id } as never))) === "RISK_LIMIT_EXCEEDED");
    await bakiye(B.cariId, "USD", 0);
    check("§2g sevk ayarı kapalıyken sevk geçer (kapsamlar bağımsız)", (await geriSarilan((tx) => core(tx, A.customerId, karisik, true))) === "GEÇTİ");
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_INTAKE, false);

    // ── §3 Sevk AÇIK ──
    console.log("\n── §3 finance.riskLimitBlock.shipment açık ──");
    const sKar = await prisma.$transaction((tx) => core(tx, A.customerId, karisik, false), { timeout: 60_000 });
    const sEm = await prisma.$transaction((tx) => core(tx, A.customerId, emanet, false), { timeout: 60_000 });
    ids.shipments.push(sKar.id, sEm.id);
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_SHIPMENT, true);
    const sevkSack = await cuval([await top(A.customerId), await top(null)]);
    const k3a = await geriSarilan((tx) => core(tx, A.customerId, sevkSack, true));
    check("§3a ⭐ aşım + karışık sevk → createShipmentCoreTx 409 RISK_LIMIT_EXCEEDED", k3a === "RISK_LIMIT_EXCEEDED", k3a);
    const emanet2 = await cuval([await top(A.customerId)]);
    const k3b = await geriSarilan((tx) => core(tx, A.customerId, emanet2, true));
    check("§3b ⭐ K22: tamamı sahibinin emaneti → aşımlı caride sevk GEÇER", k3b === "GEÇTİ", k3b);
    const d3c = await hata(() => shippingService.dispatchShipment(sKar.id, {}, admin.id));
    const st3 = await prisma.shipment.findUniqueOrThrow({ where: { id: sKar.id }, select: { status: true } });
    check("§3c ⭐ PLANNED karışık sevkiyat dispatch → 409, PLANNED kalır", d3c === "RISK_LIMIT_EXCEEDED" && st3.status === "PLANNED", `${d3c} ${st3.status}`);
    const d3d = await geriSarilan((tx) => svc.performDispatchTx(tx, sEm.id, {}, admin.id));
    check("§3d K22: emanet PLANNED dispatch GEÇER", d3d === "GEÇTİ", d3d);
    check("§3e iş kabulü ayarı kapalıyken sipariş geçer", (await hata(() => orderService.prepareOrderCreate(govdeS(A.customerId), null, { userId: admin.id } as never))) === "geçti");
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_SHIPMENT, false);

    // ── §4 Fatura onayı ──
    console.log("\n── §4 Fatura onayı (K24) ──");
    await ayar(SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED, true);
    await bakiye(B.cariId, "TRY", 900);
    const satir = [{ description: `${TAG} hizmet`, qty: 10, unit: "m", unitPrice: 50, vatRate: 0 }];
    const f1 = (await invoiceService.createDraft({ type: "SALES", customerId: B.customerId, currency: "TRY", lines: satir }, admin.id)).data!;
    ids.invoices.push(f1.id);
    const c4 = await hataNesnesi(() => invoiceService.confirm(f1.id, admin.id));
    const beklenen =
      `"${TAG} B" risk limiti aşılıyor: limit 1000.00 TRY, mevcut bakiye 900.00, bu fatura 500.00 → toplam 1400.00. ` +
      `Risk limiti engeli açık — limiti Cari Kartından güncelleyebilir, tahsilat girip tekrar deneyebilir ` +
      `ya da Sistem`;
    check("§4a ⭐ fatura onayı 409 metni aynı + details.code RISK_LIMIT_EXCEEDED", c4.kod === "RISK_LIMIT_EXCEEDED" && c4.mesaj.startsWith(beklenen) && c4.mesaj.endsWith("ayarını kapatabilirsiniz."), c4.mesaj);
    await bakiye(B.cariId, "TRY", 0);
    check("§4b limit altında onay geçer", (await hata(() => invoiceService.confirm(f1.id, admin.id))) === "geçti");

    // ── §5 Bilinmeyen değer ──
    console.log("\n── §5 Ayar doğrulama ──");
    const v1 = await hataNesnesi(() => systemSettingService.setFeatureFlags({ financeRiskLimitBlockIntake: "evet" } as never, admin.id));
    const v2 = await hataNesnesi(() => systemSettingService.setFeatureFlags({ financeRiskLimitBlockShipment: 1 } as never, admin.id));
    check("§5a bilinmeyen ayar değeri 400 (iki ayar)", /boolean olmalı/.test(v1.mesaj) && /boolean olmalı/.test(v2.mesaj), `${v1.mesaj} | ${v2.mesaj}`);
  } finally {
    await temizle(ids).catch((e) => {
      fail++;
      console.log(`❌ temizlik — ${String(e).slice(0, 300)}`);
    });
    for (const key of AYARLAR) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(ids: { customers: string[]; items: string[]; rolls: string[]; sacks: string[]; shipments: string[]; notes: string[]; invoices: string[]; orders: string[] }): Promise<void> {
  const noteRolls = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: ids.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const rollIds = [...ids.rolls, ...noteRolls];
  const accIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } })).map((a) => a.id);
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.notes, ...rollIds, ...ids.shipments, ...ids.sacks, ...ids.invoices, ...ids.customers, ...accIds, ...ids.orders] } } });
  const allOrders = (await prisma.order.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } })).map((o) => o.id);
  await prisma.orderLine.deleteMany({ where: { orderId: { in: allOrders } } });
  await prisma.order.deleteMany({ where: { id: { in: allOrders } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { shipmentId: null, sackId: null } });
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } });
  await prisma.sack.updateMany({ where: { id: { in: ids.sacks } }, data: { shipmentId: null } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: ids.shipments } } });
  await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: ids.shipments } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: ids.notes } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...ids.items, ...ids.customers] } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
