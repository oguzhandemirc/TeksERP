// =============================================================================
// BEKÇİ — CARİ KİLİDİ KAPILARI (D4-I1b, ister 4.7; tasarım DALGA4 §10.5 md. 3, 4, 6; §13 D4-I1)
// =============================================================================
//   §0 statik — beş boğazın her biri kapıyı çağırır (gelen belge precheck + satır doğum tx'i · sipariş ·
//      createShipmentCoreTx · performDispatchTx claim'den ÖNCE · confirm SALES); kapı çağıran dosya kümesi
//      SABİT (taslak / iade / storno / tahsilat yolları helper'ı import etmez)
//   §1 gelen belge — kilitsiz onay geçer; INTAKE kilidi → 409 CARI_HOLD, SIFIR top; taslak açma muaf;
//      ONAY SÜRERKEN kilit → girmiş satır kalır, kalanlar FAILED (kilit metni); detay `cariHold{}`
//   §2 sipariş — kilitsiz geçer; INTAKE kilidi → 409 CARI_HOLD; SHIPMENT-only kilit ısırmaz
//   §3 sevk — kilitsiz core (anında sevk) geçer; SHIPMENT kilidi + karışık sevk → 409; K22 (tüm toplar
//      sahibin emaneti) GEÇER; önizleme warnings[] + cariHold{} (exempt bayrağıyla)
//   §4 PLANNED — kilitten ÖNCE kurulan sevkiyat sonra dispatch → 409, PLANNED kalır; emanet PLANNED geçer
//   §5 fatura — taslak muaf; SALES confirm → 409, DRAFT kalır; SALES_RETURN taslağı muaf; kilit açılınca onay geçer
//
// Olumlu yollar (sevk/dispatch) GERİ SARILAN tx'te koşar: yazım kalmaz, kapı + motorun geri kalanı ölçülür.
// Gülkesim sonucu (K22): sevkin tamamı sahibin emaneti → SHIPMENT kilidi ısırmaz; kilit INTAKE'te ısırır (§1, §3c).
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-30): ① performDispatchTx'teki `assertShipmentNotHeldTx` silindi → §0f + §4a ❌
//    (PLANNED sevkiyat DISPATCHED oldu); ② gelen belge satır doğumundan `cariHoldIntakeGate: true` silindi → §0b + §1d ❌
//    (3 satır da ENTERED, başlık APPROVED). Geri alındı → 31/0.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { orderService } from "../src/routes/order.routes";
import { shippingService } from "../src/services/shipping.service";
import { invoiceService } from "../src/services/invoice.service";
import { InventoryService } from "../src/services/inventory.service";
import { createDeliveryNote, getDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";

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
async function hata(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    return kod(e);
  }
}
class Rollback extends Error {}
/** Olumlu yol: iş tx içinde koşar, sonra bilerek geri sarılır — "GEÇTİ" ya da hata kodu. */
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
const TAG = `TEST-CKK-${process.pid}`;
const AYARLAR = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];

/** Metodun gövdesi (başlıktan sonraki ~N karakter) — statik sıra ölçümü için. */
function govde(src: string, baslik: string, n = 9000): string {
  const i = src.indexOf(baslik);
  return i < 0 ? "" : src.slice(i, i + n);
}

function statik(): void {
  console.log("── §0 Statik ──");
  const oku = (p: string) => readFileSync(path.join(SRC, p), "utf8");
  const onay = oku("services/gelen-belge-onay.service.ts");
  const pre = govde(onay, "async function precheck(", 2500);
  check("§0a gelen belge precheck: emanet kapısından SONRA INTAKE kapısı", pre.indexOf('assertCariNotHeldTx(prisma, note.ownerCustomerId, "INTAKE")') > pre.indexOf("assertEmanetWritableTx(prisma"), "precheck");
  check("§0b gelen belge satır doğumu `cariHoldIntakeGate: true` verir", /cariHoldIntakeGate: true/.test(govde(onay, "export async function approveDeliveryNote(", 6000)));
  const inv = oku("services/inventory.service.ts");
  check("§0c inventory doğum tx'i: emanet kapısının yanında INTAKE kapısı (bayrakla)", /assertEmanetWritableTx\(tx, opts\?\.ownerCustomerId \?\? null, "top"\);\s*\n\s*\/\/[^\n]*\n\s*if \(opts\?\.cariHoldIntakeGate && opts\.ownerCustomerId\) await assertCariNotHeldTx\(tx, opts\.ownerCustomerId, "INTAKE"\)/.test(inv));
  check("§0d sipariş: prepareOrderCreate INTAKE kapısı", /assertCariNotHeldTx\(prisma, data\.customerId as string, "INTAKE"\)/.test(govde(oku("services/order.service.ts"), "async prepareOrderCreate(", 3000)));
  check("§0d' sipariş güncellemesi: müşteri değişiminde INTAKE kapısı", /assertCariNotHeldTx\(prisma, finalCustomerId, "INTAKE"\)/.test(oku("services/order.service.ts")));
  const ship = oku("services/shipping.service.ts");
  const core = govde(ship, "private async createShipmentCoreTx(", 4000);
  check("§0e createShipmentCoreTx: kapı yazımdan (shipment.create) ÖNCE", core.includes("assertShipmentNotHeldTx(tx, p.customerId") && core.indexOf("assertShipmentNotHeldTx(") < core.indexOf("tx.shipment.create("));
  const disp = govde(ship, "private async performDispatchTx(", 3000);
  check("§0f ⭐ performDispatchTx: kapı claim'den (shipment.updateMany) ÖNCE", disp.includes("assertShipmentNotHeldTx(tx,") && disp.indexOf("assertShipmentNotHeldTx(") < disp.indexOf("tx.shipment.updateMany("));
  const conf = govde(oku("services/invoice.service.ts"), "  async confirm(id: string", 12000);
  check("§0g confirm: SALES'te INVOICE kapısı risk guard'ının yanında", /assertRiskLimitTx\(tx,[\s\S]{0,700}if \(inv\.type === InvoiceType\.SALES\)[\s\S]{0,300}assertCariNotHeldTx\(tx, card, "INVOICE"\)/.test(conf));
  // Kapı çağıran küme SABİT: taslak/iade/storno/tahsilat yolları (payment, returns, undoDispatch, service-billing…) çağırmaz.
  const BEKLENEN = [
    "cloud-sync/derived-cari-hold.ts", // D4-I6: yalnız `holdScopes` (bulut görünümü), kapı çağırmaz
    "routes/finance-cari-hold.routes.ts",
    "services/cari-hold.service.ts",
    "services/cari.service.ts", // D4-I3: yalnız liste süzgeci/rozet parçaları (`HELD_CARI_ACCOUNT_WHERE`, `ACTIVE_HOLD_INCLUDE`), kapı çağırmaz
    "services/gelen-belge-note.service.ts",
    "services/gelen-belge-onay.service.ts",
    "services/helpers/cari-hold-badge.helper.ts", // D4-I3: yalnız liste lateral'i (panel rozetleri), kapı çağırmaz
    "services/helpers/cari-hold-notify.helper.ts", // D4-I5: yalnız `holdScopeText`/`reasonLabel` (bildirim yükü), kapı çağırmaz
    "services/helpers/cari-merge.helper.ts", // D4-K3d: yalnız `activeHoldByCari` (birleştirme ENGELİ), kapı çağırmaz
    "services/helpers/sack-store-board.helper.ts", // D4-I4: yalnız liste lateral'i (`activeHoldFlagsLateralSql`/`listHoldView`), kapı çağırmaz
    "services/inventory.service.ts",
    "services/invoice.service.ts",
    "services/order.service.ts",
    "services/sack-search.service.ts", // D4-I4: yalnız liste lateral'i (Sevk kapısı müşteri listesi çipi), kapı çağırmaz
    "services/shipping.service.ts",
  ];
  const bul = (dir: string): string[] =>
    require("node:fs").readdirSync(dir, { withFileTypes: true }).flatMap((d: { name: string; isDirectory(): boolean }) => {
      const p = path.join(dir, d.name);
      return d.isDirectory() ? bul(p) : p.endsWith(".ts") ? [p] : [];
    });
  const importers = bul(SRC)
    .filter((f) => /from "[^"]*cari-hold\.helper"/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f))
    .sort();
  check("§0h kapı helper'ını import eden küme SABİT (muaf yollar çağırmaz)", JSON.stringify(importers) === JSON.stringify(BEKLENEN), importers.join(", "));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== CARİ KİLİDİ KAPILARI BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const ayar = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], items: [] as string[], rolls: [] as string[], sacks: [] as string[], shipments: [] as string[], notes: [] as string[], invoices: [] as string[], orders: [] as string[] };
  const origEntry = InventoryService.prototype.createInitialEntry;
  try {
    await ayar(SETTING_KEYS.FINANCE_ENABLED, true);
    await ayar(SETTING_KEYS.EMANET_ENABLED, true);
    await ayar(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
    const kart = async (ek: string) => {
      const r = (await customerService.create({ name: `${TAG} ${ek}`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
      ids.customers.push(r.data.id);
      const acc = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } });
      return { customerId: r.data.id, cariId: acc.id };
    };
    const A = await kart("A");
    const item = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    ids.items.push(item.id);
    const kilitle = async (s: { intake?: boolean; shipment?: boolean; invoice?: boolean }) =>
      (await prisma.cariHold.create({ data: { cariId: A.cariId, blocksIntake: !!s.intake, blocksShipment: !!s.shipment, blocksInvoice: !!s.invoice, reasonCode: "BORC", reasonText: `${TAG}`, placedById: admin.id, clientToken: randomUUID() }, select: { id: true } })).id;
    const ac = async () => prisma.cariHold.updateMany({ where: { cariId: A.cariId, releasedAt: null }, data: { releasedAt: new Date(), releasedById: admin.id, releaseReason: "test" } });

    // ── §1 Gelen belge ──
    console.log("\n── §1 Gelen belge ──");
    const not = async (n: number) => {
      const lines = Array.from({ length: n }, (_, i) => ({ senderRollNo: `${TAG}-R${ids.notes.length}-${i}`, meters: 100 + i, weightKg: 20, itemText: "Perde", itemId: item.id }));
      const r = (await createDeliveryNote({ sourceKind: "MANUAL", ownerCustomerId: A.customerId, senderText: `${TAG} gönderen`, lines } as never, admin.id)) as { id: string };
      ids.notes.push(r.id);
      return r.id;
    };
    const topSay = (noteId: string) => prisma.customerDeliveryNoteLine.count({ where: { noteId, rollId: { not: null } } });
    const n1 = await not(2);
    const a1 = await hata(() => approveDeliveryNote(n1, {}, admin.id));
    check("§1a kilit satırı yokken onay geçer (2 top)", a1 === "geçti" && (await topSay(n1)) === 2, `${a1} top=${await topSay(n1)}`);
    const h1 = await kilitle({ intake: true });
    const n2 = await not(2);
    check("§1b taslak açma kilitli caride MUAF", !!n2);
    const d2 = (await getDeliveryNote(n2)) as { cariHold: { holdId: string; scope: string } | null };
    check("§1c önizleme: detay `cariHold{}` aynı helper'dan (holdId, INTAKE)", d2.cariHold?.holdId === h1 && d2.cariHold.scope === "INTAKE", JSON.stringify(d2.cariHold));
    const a2 = await hata(() => approveDeliveryNote(n2, {}, admin.id));
    const st2 = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: n2 }, select: { status: true } });
    check("§1d' ⭐ INTAKE kilidi → precheck 409 CARI_HOLD, SIFIR top, taslak DRAFT", a2 === "CARI_HOLD" && (await topSay(n2)) === 0 && st2.status === "DRAFT", `${a2} ${st2.status}`);
    await ac();
    check("§1e kilit açılınca detay cariHold=null", ((await getDeliveryNote(n2)) as { cariHold: unknown }).cariHold === null);
    // ONAY SÜRERKEN KİLİT: ilk satır doğduktan hemen sonra kilit konur (precheck geçti) → kalan satırlar doğum tx'inde kesilir.
    const n3 = await not(3);
    let konan = "";
    InventoryService.prototype.createInitialEntry = async function (this: InventoryService, ...args: Parameters<typeof origEntry>) {
      const r = await origEntry.apply(this, args);
      if (!konan && args[4]?.cariHoldIntakeGate) konan = await kilitle({ intake: true });
      return r;
    } as typeof origEntry;
    const a3 = await approveDeliveryNote(n3, {}, admin.id).catch((e) => ({ hata: kod(e) }));
    InventoryService.prototype.createInitialEntry = origEntry;
    const l3 = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n3 }, select: { status: true, failReason: true, rollId: true }, orderBy: { lineNo: "asc" } });
    const st3 = await prisma.customerDeliveryNote.findUniqueOrThrow({ where: { id: n3 }, select: { status: true } });
    check(
      "§1d ⭐ onay sürerken kilit → girmiş satır kalır (1 ENTERED), kalan 2 satır FAILED + kilit sebebi; başlık PARTIAL",
      !!konan && l3.filter((l) => l.status === "ENTERED" && l.rollId).length === 1 && l3.filter((l) => l.status === "FAILED" && /kilitli/.test(l.failReason ?? "")).length === 2 && st3.status === "PARTIAL",
      `${JSON.stringify(l3.map((l) => [l.status, (l.failReason ?? "").slice(0, 30)]))} ${st3.status} ${JSON.stringify((a3 as { summary?: unknown }).summary ?? a3)}`,
    );
    await ac();

    // ── §2 Sipariş ──
    console.log("\n── §2 Sipariş ──");
    const govdeS = () => ({ customerId: A.customerId, lines: [{ itemId: item.id, quantity: 10 }] });
    check("§2a kilit satırı yokken sipariş ön kapısı geçer", (await hata(() => orderService.prepareOrderCreate(govdeS(), null, { userId: admin.id } as never))) === "geçti");
    await kilitle({ shipment: true });
    check("§2b SHIPMENT-only kilit siparişi ısırmaz (kapsam dışı)", (await hata(() => orderService.prepareOrderCreate(govdeS(), null, { userId: admin.id } as never))) === "geçti");
    await ac();
    await kilitle({ intake: true });
    const s2 = await hata(() => orderService.create({ ...govdeS(), clientToken: randomUUID() }, admin.id));
    check("§2c ⭐ INTAKE kilidi → sipariş 409 CARI_HOLD, sipariş doğmaz", s2 === "CARI_HOLD" && (await prisma.order.count({ where: { customerId: A.customerId } })) === 0, s2);
    // Yan kapı: kilitsiz B'ye açılan sipariş kilitli A'ya taşınamaz (güncelleme de INTAKE'tir).
    const B = await kart("B");
    const ob = (await orderService.create({ customerId: B.customerId, lines: [{ itemId: item.id, quantity: 10 }], clientToken: randomUUID() }, admin.id)) as { data: { id: string } };
    ids.orders.push(ob.data.id);
    const s2d = await hata(() => orderService.update(ob.data.id, { customerId: A.customerId }, admin.id));
    const ob2 = await prisma.order.findUniqueOrThrow({ where: { id: ob.data.id }, select: { customerId: true } });
    check("§2d ⭐ INTAKE kilidi → siparişi kilitli müşteriye taşıma 409 CARI_HOLD, müşteri değişmez", s2d === "CARI_HOLD" && ob2.customerId === B.customerId, s2d);
    await ac();
    check("§2e kilit açılınca taşıma geçer", (await hata(() => orderService.update(ob.data.id, { customerId: A.customerId }, admin.id))) === "geçti");

    // ── §3 Sevk ──
    console.log("\n── §3 Sevk ──");
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
    const core = (tx: Prisma.TransactionClient, sackId: string, anindaSevk: boolean) =>
      svc.createShipmentCoreTx(tx, { sackIds: [sackId], customerId: A.customerId, branchId: null, orderIds: [], orderless: true, assertDestination: () => undefined, confirmationEnabled: !anindaSevk, userId: admin.id });
    const karisik = await cuval([await top(A.customerId), await top(null)]);
    const emanet = await cuval([await top(A.customerId), await top(A.customerId)]);
    const k3a = await geriSarilan((tx) => core(tx, karisik, true));
    check("§3a kilit satırı yokken sevk (kurulum + anında dispatch) geçer", k3a === "GEÇTİ", k3a);
    type Onizleme = { data: { warnings: string[]; cariHold: { holdId: string; exempt?: boolean } | null } };
    const p0 = (await shippingService.previewCreateShipment({ sackIds: [karisik], customerId: A.customerId })) as Onizleme;
    check("§3b kilitsiz önizleme cariHold=null", p0.data.cariHold === null);
    const h3 = await kilitle({ shipment: true });
    const k3c = await geriSarilan((tx) => core(tx, karisik, false));
    check("§3c ⭐ SHIPMENT kilidi + karışık sevk → createShipmentCoreTx 409 CARI_HOLD", k3c === "CARI_HOLD", k3c);
    const k3d = await geriSarilan((tx) => core(tx, emanet, true));
    check("§3d ⭐ K22: tüm toplar sahibinin emaneti → kilitli caride sevk GEÇER (Gülkesim sonucu: sevk kilidi ısırmaz)", k3d === "GEÇTİ", k3d);
    const p1 = (await shippingService.previewCreateShipment({ sackIds: [karisik], customerId: A.customerId })) as Onizleme;
    const p2 = (await shippingService.previewCreateShipment({ sackIds: [emanet], customerId: A.customerId })) as Onizleme;
    check("§3e önizleme karışık: warnings[] kilit metni + cariHold{holdId, exempt yok}", p1.data.cariHold?.holdId === h3 && !p1.data.cariHold.exempt && p1.data.warnings.some((w) => /kilitli/.test(w)), JSON.stringify(p1.data.cariHold));
    check("§3f önizleme emanet: cariHold.exempt=true + muafiyet uyarısı", p2.data.cariHold?.exempt === true && p2.data.warnings.some((w) => /emaneti olduğu için/.test(w)), JSON.stringify(p2.data.cariHold));
    await ac();
    await kilitle({ intake: true, invoice: true });
    const k3g = await geriSarilan((tx) => core(tx, karisik, true));
    check("§3g INTAKE+INVOICE kilidi sevki ısırmaz (kapsam dışı)", k3g === "GEÇTİ", k3g);
    await ac();

    // ── §4 PLANNED ──
    console.log("\n── §4 PLANNED kalıp sonra kilitlenen sevkiyat ──");
    const sKar = await prisma.$transaction((tx) => core(tx, karisik, false), { timeout: 60_000 });
    const sEm = await prisma.$transaction((tx) => core(tx, emanet, false), { timeout: 60_000 });
    ids.shipments.push(sKar.id, sEm.id);
    await kilitle({ shipment: true });
    const d4a = await hata(() => shippingService.dispatchShipment(sKar.id, {}, admin.id));
    const st4 = await prisma.shipment.findUniqueOrThrow({ where: { id: sKar.id }, select: { status: true } });
    check("§4a ⭐ PLANNED sevkiyat kilitten sonra dispatch → 409 CARI_HOLD, PLANNED kalır", d4a === "CARI_HOLD" && st4.status === "PLANNED", `${d4a} ${st4.status}`);
    const d4b = await geriSarilan((tx) => svc.performDispatchTx(tx, sEm.id, {}, admin.id));
    check("§4b K22: emanet PLANNED sevkiyat kilitli caride dispatch GEÇER", d4b === "GEÇTİ", d4b);
    await ac();
    const d4c = await geriSarilan((tx) => svc.performDispatchTx(tx, sKar.id, {}, admin.id));
    check("§4c kilit açılınca karışık PLANNED dispatch geçer", d4c === "GEÇTİ", d4c);

    // ── §5 Fatura ──
    console.log("\n── §5 Fatura onayı ──");
    await kilitle({ invoice: true });
    const satir = [{ description: `${TAG} hizmet`, qty: 10, unit: "m", unitPrice: 5, vatRate: 20 }];
    const f1 = (await invoiceService.createDraft({ type: "SALES", customerId: A.customerId, currency: "TRY", lines: satir }, admin.id)).data!;
    ids.invoices.push(f1.id);
    check("§5a SALES taslağı kilitli caride MUAF", !!f1.id);
    const c5 = await hata(() => invoiceService.confirm(f1.id, admin.id));
    const st5 = await prisma.invoice.findUniqueOrThrow({ where: { id: f1.id }, select: { status: true } });
    check("§5b ⭐ INVOICE kilidi → confirm SALES 409 CARI_HOLD, DRAFT kalır", c5 === "CARI_HOLD" && st5.status === "DRAFT", `${c5} ${st5.status}`);
    const f2 = await hata(async () => {
      const r = await invoiceService.createDraft({ type: "SALES_RETURN", customerId: A.customerId, currency: "TRY", lines: satir }, admin.id);
      ids.invoices.push(r.data!.id);
    });
    check("§5c iade (SALES_RETURN) taslağı kilitli caride MUAF", f2 === "geçti", f2);
    await ac();
    await kilitle({ intake: true, shipment: true });
    const c5d = await hata(() => invoiceService.confirm(f1.id, admin.id));
    check("§5d INTAKE+SHIPMENT kilidi fatura onayını ısırmaz → onay geçer", c5d === "geçti", c5d);
    await ac();
  } finally {
    InventoryService.prototype.createInitialEntry = origEntry;
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
  const holdIds = (await prisma.cariHold.findMany({ where: { cariId: { in: accIds } }, select: { id: true } })).map((h) => h.id);
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.notes, ...rollIds, ...ids.shipments, ...ids.sacks, ...ids.invoices, ...holdIds, ...ids.customers, ...accIds] } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: ids.orders } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
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
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  InventoryService.prototype.createInitialEntry = InventoryService.prototype.createInitialEntry;
  await pool.end();
  process.exitCode = 1;
});
