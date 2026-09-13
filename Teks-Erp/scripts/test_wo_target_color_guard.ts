// =============================================================================
// Test: Üretim rengi değişikliği — TEK BEKÇİ (2026-08-21)
// Çalıştır: npx tsx scripts/test_wo_target_color_guard.ts
// =============================================================================
// Korunan kararlar (kullanıcı, 2026-08-21):
//   §1 Bitmiş (COMPLETED) iş emrinde renk/en/override KAPALI; uyumlu "Sipariş
//      Bağla" AÇIK. (Eskiden Rengi Değiştir COMPLETED'da çalışıyordu.)
//   §2 "Rengi Değiştir" de boya-bitti KİLİDİNE çarpar (eskiden yalnız Düzenle).
//   §3 "Rengi Değiştir" de ürünün izinli renk listesine bakar.
//   §4 Rotada renk veren adım yoksa REDDETME, UYAR — iki kapıda da `warnings`.
//   §5 Kısmi boya: bir kısım top eski renkte → 409 COLOR_PARTIAL_CONFIRM; onayla
//      geçer, audit'e yazılır; toplar dokunulmaz.
//   §6 Fason kabul: tabletin gördüğü hedef ile taze hedef farklıysa 409
//      TARGET_COLOR_CHANGED; alan yoksa kontrol yok (eski APK).
//   §7 Sipariş kalemi rengi dar uçtan değişir (iş emri bağlıyken de) — sebep +
//      audit; genel update hâlâ kapalı.
//   §8 Kurşun (iç istasyon) bitişi: adım renk verebiliyorsa renksiz top WO
//      hedef rengini alır (fason kabulün iç aynası).
//
// Fixture: seed master-data business-key ile (PATOS, BOYA_FASON, KURSUN_KK2,
// admin) + test kendi renk/kumaş/müşteri/istasyonunu üretir ve siler.
// =============================================================================
import prisma from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { InventoryService } from "../src/services/inventory.service";
import { OrderService } from "../src/services/order.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import {
  COLOR_DYED_BLOCKED_CODE,
  COLOR_PARTIAL_CONFIRM_CODE,
  WO_PLAN_FROZEN_CODE,
} from "../src/services/helpers/workorder-target-color.helper";
import { assertRollMatchesPlan } from "../src/services/helpers/tambur-plan-gate.helper";
import { FASON_RECEIPT_DEVIATION_SOURCE } from "../src/constants/tambur-plan-gate";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { WAREHOUSE_STOCK_STATUSES } from "../src/services/helpers/warehouse-stock.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
interface Caught { statusCode?: number; message: string; code?: string }
async function catchErr(fn: () => Promise<unknown>): Promise<Caught | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; details?: { code?: string } };
    return { statusCode: err.statusCode, message: err.message ?? String(e), code: err.details?.code };
  }
}

const workOrderService = new WorkOrderService();
const sub = new SubcontractorService();
const inventory = new InventoryService();
const orderService = new OrderService({ modelName: "order", tableName: "ORDER", nestedCreateFields: ["lines"] });
const cards = new TravelerCardService();

const ts = Date.now();
const created = {
  wos: [] as string[],
  rolls: [] as string[],
  colors: [] as string[],
  items: [] as string[],
  customers: [] as string[],
  orders: [] as string[],
  stations: [] as string[],
};
let ITEM = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "", CAT_BOYA: string | null = null;
let KIRMIZI = "", MAVI = "", YESIL = "";
let bc = 0;
const barcode = () => `TST-TCG-${ts.toString(36).toUpperCase()}${++bc}`;

async function mkWo(opts: {
  tag: string;
  status?: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  targetColorId?: string | null;
  targetItemId?: string;
  steps: Array<{ stationId: string; status?: "PENDING" | "ACTIVE" | "COMPLETED"; requiredCategoryId?: string | null }>;
  withCard?: boolean;
}): Promise<{ id: string; stepIds: string[] }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TEST-TCG-${opts.tag}-${ts}`.slice(0, 40),
      type: "STOCK_PRODUCTION",
      status: opts.status ?? "IN_PROGRESS",
      targetItemId: opts.targetItemId ?? ITEM,
      targetColorId: opts.targetColorId ?? null,
      steps: {
        create: opts.steps.map((s, i) => ({
          stationId: s.stationId,
          stepSequence: i + 1,
          status: s.status ?? "PENDING",
          requiredCategoryId: s.requiredCategoryId ?? null,
        })),
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
  });
  created.wos.push(wo.id);
  if (opts.withCard) await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  return { id: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

async function mkRoll(data: {
  colorId?: string | null;
  status: RollStatus;
  currentStepId?: string | null;
  qty?: number;
  withBarcode?: boolean;
}): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: data.withBarcode === false ? null : barcode(),
      itemId: ITEM,
      colorId: data.colorId ?? null,
      initialQty: data.qty ?? 100,
      currentQty: data.qty ?? 100,
      status: data.status,
      // Stok kümesindeki top DEPOLU doğar — fason sevki (K6) deposuz topu 409 ile
      // durduruyor ve deposuz bir STOK topu üretimde mümkün değil.
      warehouseId: WAREHOUSE_STOCK_STATUSES.includes(data.status) ? await fixtureWarehouseId() : null,
      currentStepId: data.currentStepId ?? null,
      width: 250,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  created.rolls.push(r.id);
  return r.id;
}

async function lastWoAudit(woId: string): Promise<Record<string, unknown> | null> {
  const row = await prisma.systemLog.findFirst({
    where: { tableName: "WORK_ORDER", recordId: woId },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  return (row?.newData as Record<string, unknown> | null) ?? null;
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  ITEM = item.id; ADMIN = admin.id; ST_BOYA = boya.id; ST_KURSUN = kursun.id; SUB_BOYER = boyer.id;
  // Boyahanenin renk veren kategorisi — fason kabulde rengin FİİLEN uygulanması buna bağlı.
  const cat = await prisma.subcontractorToCategory.findFirst({
    where: { subcontractorId: SUB_BOYER, category: { appliesColor: true } },
    select: { categoryId: true },
  });
  CAT_BOYA = cat?.categoryId ?? null;

  const [kirmizi, mavi, yesil] = await Promise.all([
    prisma.color.create({ data: { code: `TEST-TCG-KRM-${ts}`, name: `TEST KIRMIZI ${ts}` }, select: { id: true } }),
    prisma.color.create({ data: { code: `TEST-TCG-MAV-${ts}`, name: `TEST MAVI ${ts}` }, select: { id: true } }),
    prisma.color.create({ data: { code: `TEST-TCG-YSL-${ts}`, name: `TEST YESIL ${ts}` }, select: { id: true } }),
  ]);
  KIRMIZI = kirmizi.id; MAVI = mavi.id; YESIL = yesil.id;
  created.colors.push(KIRMIZI, MAVI, YESIL);

  const customer = await prisma.customer.create({
    data: { code: `TEST-TCG-CUS-${ts}`, name: `TEST TCG MUSTERI ${ts}` },
    select: { id: true },
  });
  created.customers.push(customer.id);

  // ── §1 COMPLETED: renk/en/override KAPALI, uyumlu bağ AÇIK ───────────────
  console.log("\n=== §1 COMPLETED iş emri ===");
  {
    const wo = await mkWo({
      tag: "S1", status: "COMPLETED", targetColorId: KIRMIZI,
      steps: [{ stationId: ST_BOYA, status: "COMPLETED", requiredCategoryId: CAT_BOYA }],
    });
    const c = await catchErr(() => workOrderLinkService.changeTargetColor(wo.id, MAVI, "müşteri istedi", ADMIN));
    check("COMPLETED: Rengi Değiştir 409", c?.statusCode === 409, c?.message);
    check("COMPLETED: kod WO_PLAN_FROZEN", c?.code === WO_PLAN_FROZEN_CODE, String(c?.code));
    const w = await catchErr(() => workOrderLinkService.changeWidth(wo.id, 280, "ölçüldü", ADMIN));
    check("COMPLETED: Eni Değiştir 409", w?.statusCode === 409, w?.message);
    const u = await catchErr(() => workOrderService.update(wo.id, { targetColorId: MAVI }, ADMIN));
    check("COMPLETED: Düzenle (PATCH) 409", u?.statusCode === 409, u?.message);

    // Uyumlu sipariş bağı — AÇIK kalmalı (stoktan siparişe).
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-TCG-ORD1-${ts}`.slice(0, 40),
        customerId: customer.id,
        lines: { create: [{ itemId: ITEM, colorId: KIRMIZI, quantity: 100 }, { itemId: ITEM, colorId: MAVI, quantity: 50 }] },
      },
      select: { id: true, lines: { select: { id: true, colorId: true } } },
    });
    created.orders.push(order.id);
    const okLine = order.lines.find((l) => l.colorId === KIRMIZI)!;
    const badLine = order.lines.find((l) => l.colorId === MAVI)!;
    const link = await catchErr(() => workOrderLinkService.linkOrderLines(wo.id, [okLine.id], ADMIN));
    check("COMPLETED: uyumlu Sipariş Bağla ÇALIŞIR", link === null, link?.message);
    const ov = await catchErr(() =>
      workOrderLinkService.linkOrderLineWithOverride(wo.id, badLine.id, "süpervizör onayı", ADMIN, ["workorder:write", "roll:manual-adjust"]),
    );
    check("COMPLETED: uyumsuz-bağ override 409", ov?.statusCode === 409, ov?.message);
    const after = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetColorId: true } });
    check("COMPLETED: renk DEĞİŞMEDİ", after?.targetColorId === KIRMIZI);
  }

  // ── §2 MAL–PLAN uyumu: boyanmış top varsa kapalı, düzeltmeyle serbest ─────
  // Kilit ADIMA değil MALA bakar (2026-08-21 kullanıcı kararı): "beyaz diye
  // kaydedilmiş mal aslında ekru — planlamacı iş emrinin TÜM açık kumaşlarını
  // ekruya çevirsin" düzeltmesi boya bitmiş olsa da SERBEST olmalı.
  console.log("\n=== §2 Mal–plan uyumu ===");
  {
    const wo = await mkWo({
      tag: "S2", targetColorId: KIRMIZI,
      steps: [
        { stationId: ST_BOYA, status: "COMPLETED", requiredCategoryId: CAT_BOYA },
        { stationId: ST_KURSUN, status: "ACTIVE" },
      ],
    });
    const [, kursunStep] = wo.stepIds;
    const r1 = await mkRoll({ colorId: KIRMIZI, status: RollStatus.IN_PRODUCTION, currentStepId: kursunStep });
    const r2 = await mkRoll({ colorId: KIRMIZI, status: RollStatus.IN_PRODUCTION, currentStepId: kursunStep });

    const c = await catchErr(() => workOrderLinkService.changeTargetColor(wo.id, MAVI, "müşteri istedi", ADMIN));
    check("mal boyandı, boyanacak yok: Rengi Değiştir 409", c?.statusCode === 409, c?.message);
    check("kod COLOR_DYED_BLOCKED", c?.code === COLOR_DYED_BLOCKED_CODE, String(c?.code));
    const u = await catchErr(() => workOrderService.update(wo.id, { targetColorId: MAVI }, ADMIN));
    check("Düzenle (PATCH) de 409 COLOR_DYED_BLOCKED", u?.statusCode === 409 && u?.code === COLOR_DYED_BLOCKED_CODE, u?.message);
    // Yarısı düzeltilse bile bir top eski renkte kalır → yine kapalı.
    const half = await catchErr(() =>
      workOrderLinkService.changeTargetColor(wo.id, MAVI, "kayıt yanlış", ADMIN, { recolorRollIds: [r1] }),
    );
    check("yarısı düzeltiliyor: yine 409 (1 top eski renkte kalır)", half?.statusCode === 409 && half?.code === COLOR_DYED_BLOCKED_CODE, half?.message);
    // HEPSİ düzeltiliyor → kayıt düzeltmesi, serbest (planlamacı senaryosu).
    const all = await catchErr(() =>
      workOrderLinkService.changeTargetColor(wo.id, MAVI, "kayıt yanlış — aslında mavi", ADMIN, { recolorRollIds: [r1, r2] }),
    );
    check("hepsi düzeltiliyor: SERBEST (kayıt düzeltmesi)", all === null, all?.message);
    const after = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetColorId: true } });
    check("plan MAVİ oldu", after?.targetColorId === MAVI);
    // Renk dışı alan (miktar) hâlâ düzenlenir — bekçi yalnız renk değişiminde koşar.
    const q = await catchErr(() => workOrderService.update(wo.id, { targetQuantity: 777 }, ADMIN));
    check("renk dışı alan serbest (targetQuantity)", q === null, q?.message);

    // Boya adımı BİTMİŞ ama toplar RENKSİZ → kilit YOK (eski adım-kilidi burada yanlıştı).
    const wo2 = await mkWo({
      tag: "S2B", targetColorId: KIRMIZI,
      steps: [
        { stationId: ST_BOYA, status: "COMPLETED", requiredCategoryId: CAT_BOYA },
        { stationId: ST_KURSUN, status: "ACTIVE" },
      ],
    });
    await mkRoll({ colorId: null, status: RollStatus.IN_PRODUCTION, currentStepId: wo2.stepIds[1] });
    const free = await catchErr(() => workOrderLinkService.changeTargetColor(wo2.id, MAVI, "renk", ADMIN));
    check("boya bitmiş ama toplar renksiz: serbest", free === null, free?.message);
  }

  // ── §3 İzinli renk listesi ──────────────────────────────────────────────
  console.log("\n=== §3 İzinli renk listesi ===");
  {
    const limited = await prisma.item.create({
      data: {
        code: `TEST-TCG-ITM-${ts}`, name: `TEST TCG KUMAS ${ts}`, itemType: "FABRIC", unit: "MT",
        allowedColors: { create: [{ colorId: KIRMIZI }] },
      },
      select: { id: true },
    });
    created.items.push(limited.id);
    const wo = await mkWo({
      tag: "S3", targetItemId: limited.id, targetColorId: null,
      steps: [{ stationId: ST_BOYA, status: "PENDING", requiredCategoryId: CAT_BOYA }],
    });
    const bad = await catchErr(() => workOrderLinkService.changeTargetColor(wo.id, MAVI, "yanlış renk", ADMIN));
    check("izinli liste dışı renk 400", bad?.statusCode === 400, bad?.message);
    const ok = await catchErr(() => workOrderLinkService.changeTargetColor(wo.id, KIRMIZI, "doğru renk", ADMIN));
    check("izinli renk geçer", ok === null, ok?.message);
  }

  // ── §4 Rota kapsaması: REDDETME, UYAR ───────────────────────────────────
  console.log("\n=== §4 Rota kapsaması uyarısı ===");
  {
    const noDye = await mkWo({ tag: "S4A", targetColorId: null, steps: [{ stationId: ST_KURSUN }] });
    const res = await workOrderLinkService.changeTargetColor(noDye.id, MAVI, "sonradan renk", ADMIN);
    check("boyasız rota: Rengi Değiştir BAŞARILI", res.success === true);
    check(
      "boyasız rota: uyarı döndü",
      res.data.warnings.some((w) => w.includes("renk veren adım")),
      res.data.warnings.join(" | "),
    );
    const noDye2 = await mkWo({ tag: "S4B", targetColorId: null, steps: [{ stationId: ST_KURSUN }] });
    const upd = await workOrderService.update(noDye2.id, { targetColorId: MAVI }, ADMIN);
    check(
      "boyasız rota: Düzenle (PATCH) de uyarı döndü",
      Array.isArray(upd.warnings) && upd.warnings.some((w) => w.includes("renk veren adım")),
      (upd.warnings ?? []).join(" | "),
    );
    const withDye = await mkWo({
      tag: "S4C", targetColorId: null,
      steps: [{ stationId: ST_BOYA, requiredCategoryId: CAT_BOYA }, { stationId: ST_KURSUN }],
    });
    const res2 = await workOrderLinkService.changeTargetColor(withDye.id, MAVI, "renk", ADMIN);
    check("boyalı rota: uyarı YOK", !res2.data.warnings.some((w) => w.includes("renk veren adım")));
  }

  // ── §5 Kısmi boya — onay ─────────────────────────────────────────────────
  console.log("\n=== §5 Kısmi boya onayı ===");
  {
    const wo = await mkWo({
      tag: "S5", targetColorId: KIRMIZI,
      steps: [
        { stationId: ST_BOYA, status: "ACTIVE", requiredCategoryId: CAT_BOYA },
        { stationId: ST_KURSUN, status: "PENDING" },
      ],
    });
    const [boyaStep, kursunStep] = wo.stepIds;
    const dyed = await mkRoll({ colorId: KIRMIZI, status: RollStatus.IN_PRODUCTION, currentStepId: kursunStep });
    await mkRoll({ colorId: null, status: RollStatus.AT_SUBCONTRACTOR, currentStepId: boyaStep });

    const c = await catchErr(() => workOrderLinkService.changeTargetColor(wo.id, MAVI, "müşteri aradı", ADMIN));
    check("kısmi: onaysız 409", c?.statusCode === 409, c?.message);
    check("kısmi: kod COLOR_PARTIAL_CONFIRM", c?.code === COLOR_PARTIAL_CONFIRM_CODE, String(c?.code));
    check("kısmi: mesaj sayıları söylüyor", /1 top zaten/.test(c?.message ?? "") && /kalan 1 top/.test(c?.message ?? ""), c?.message);
    const still = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetColorId: true } });
    check("kısmi: onaysızda renk DEĞİŞMEDİ", still?.targetColorId === KIRMIZI);

    const ok = await workOrderLinkService.changeTargetColor(wo.id, MAVI, "müşteri aradı", ADMIN, { confirmPartial: true });
    check("kısmi: onaylı geçti", ok.success === true && ok.data.partial?.dyedCount === 1 && ok.data.partial?.pendingCount === 1);
    const audit = await lastWoAudit(wo.id);
    check("kısmi: audit'te partialConfirmed", Boolean((audit?.partialConfirmed as { dyedCount?: number } | undefined)?.dyedCount === 1));
    const dyedAfter = await prisma.roll.findUnique({ where: { id: dyed }, select: { colorId: true } });
    check("kısmi: boyanmış topa DOKUNULMADI", dyedAfter?.colorId === KIRMIZI);

    // Düzenle (PATCH) yolu da aynı onayı ister — şimdi hedef MAVİ, boyanmış top yok (kırmızıydı) → geçer;
    // topu MAVİ yapınca tekrar kısmi olur.
    await prisma.roll.update({ where: { id: dyed }, data: { colorId: MAVI } });
    const u = await catchErr(() => workOrderService.update(wo.id, { targetColorId: YESIL }, ADMIN));
    check("kısmi: Düzenle (PATCH) de 409 COLOR_PARTIAL_CONFIRM", u?.statusCode === 409 && u?.code === COLOR_PARTIAL_CONFIRM_CODE, u?.message);
    const u2 = await catchErr(() => workOrderService.update(wo.id, { targetColorId: YESIL }, ADMIN, { confirmPartial: true }));
    check("kısmi: Düzenle onaylı geçer", u2 === null, u2?.message);

    // Ölü top (iptal) sayılmaz.
    await prisma.roll.update({ where: { id: dyed }, data: { colorId: YESIL, status: RollStatus.CANCELLED } });
    const u3 = await catchErr(() => workOrderService.update(wo.id, { targetColorId: MAVI }, ADMIN));
    check("kısmi: ölü top sayılmaz (onay istenmez)", u3 === null, u3?.message);
  }

  // ── §6 Fason kabul: hedef renk bu arada değişti ──────────────────────────
  console.log("\n=== §6 Fason kabul TARGET_COLOR_CHANGED ===");
  {
    const wo = await mkWo({
      tag: "S6", targetColorId: KIRMIZI, withCard: true,
      steps: [
        { stationId: ST_BOYA, status: "PENDING", requiredCategoryId: CAT_BOYA },
        { stationId: ST_KURSUN, status: "PENDING" },
      ],
    });
    const [boyaStep] = wo.stepIds;
    const r1 = await mkRoll({ status: RollStatus.STOCK, qty: 100 });
    const r2 = await mkRoll({ status: RollStatus.STOCK, qty: 100 });
    await sub.dispatch({ workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1, r2] }, ADMIN);

    // Tablet ekranı KIRMIZI iken açtı; planlamacı MAVİ yaptı (kısmi değil: henüz boyanmış top yok).
    await workOrderLinkService.changeTargetColor(wo.id, MAVI, "telefonla değişti", ADMIN);
    const stale = await catchErr(() =>
      sub.receive({
        workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, clientToken: randomUUID(),
        returns: [{ rollId: r1 }], newRolls: [{ qty: 100 }],
        appliedColorId: KIRMIZI, expectedTargetColorId: KIRMIZI,
      }, ADMIN),
    );
    check("kabul: bayat hedefle 409", stale?.statusCode === 409, stale?.message);
    check("kabul: kod TARGET_COLOR_CHANGED", stale?.code === "TARGET_COLOR_CHANGED", String(stale?.code));
    const r1After = await prisma.roll.findUnique({ where: { id: r1 }, select: { status: true } });
    check("kabul: top hâlâ fasonda (hiçbir şey yazılmadı)", r1After?.status === RollStatus.AT_SUBCONTRACTOR);

    // Taze hedefle (override olmadan) → doğan top TAZE rengi alır.
    const fresh = await catchErr(() =>
      sub.receive({
        workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, clientToken: randomUUID(),
        returns: [{ rollId: r1 }], newRolls: [{ qty: 100 }],
        expectedTargetColorId: MAVI,
      }, ADMIN),
    );
    check("kabul: taze hedefle geçer", fresh === null, fresh?.message);
    if (CAT_BOYA) {
      const born = await prisma.roll.findFirst({
        where: { parentReceipt: { workOrderId: wo.id }, parentRollId: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, colorId: true },
      });
      if (born) created.rolls.push(born.id);
      check("kabul: doğan top TAZE hedef rengi (MAVİ) aldı", born?.colorId === MAVI, String(born?.colorId));
    } else {
      console.log("   (boyahane fixture'ının renk veren kategorisi yok — doğan top rengi atlandı)");
    }
    // Alan gönderilmeyen eski APK: kontrol yok, geçer.
    const legacy = await catchErr(() =>
      sub.receive({
        workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, clientToken: randomUUID(),
        returns: [{ rollId: r2 }], newRolls: [{ qty: 100 }],
      }, ADMIN),
    );
    check("kabul: eski APK (alan yok) geçer", legacy === null, legacy?.message);
    const born2 = await prisma.roll.findMany({
      where: { parentReceipt: { workOrderId: wo.id }, parentRollId: null },
      select: { id: true },
    });
    for (const b of born2) if (!created.rolls.includes(b.id)) created.rolls.push(b.id);
  }

  // ── §7 Sipariş kalemi rengi — dar uç ─────────────────────────────────────
  console.log("\n=== §7 Sipariş kalemi rengi ===");
  {
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-TCG-ORD2-${ts}`.slice(0, 40),
        customerId: customer.id,
        lines: { create: [{ itemId: ITEM, colorId: KIRMIZI, quantity: 100 }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    created.orders.push(order.id);
    const line = order.lines[0];
    const wo = await mkWo({ tag: "S7", targetColorId: KIRMIZI, steps: [{ stationId: ST_BOYA, status: "ACTIVE", requiredCategoryId: CAT_BOYA }] });
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: wo.id, orderLineId: line.id } });

    const generic = await catchErr(() =>
      orderService.update(order.id, { lines: [{ id: line.id, itemId: ITEM, colorId: MAVI, quantity: 100 }] }, ADMIN),
    );
    check("genel update: iş emri bağlı kalem 409 (kural korunur)", generic?.statusCode === 409, generic?.message);

    const noReason = await catchErr(() => orderService.changeLineColor(order.id, line.id, MAVI, " ", ADMIN));
    check("dar uç: sebepsiz 400", noReason?.statusCode === 400, noReason?.message);
    const ok = await catchErr(() => orderService.changeLineColor(order.id, line.id, MAVI, "müşteri telefonla istedi", ADMIN));
    check("dar uç: renk değişti", ok === null, ok?.message);
    const lineAfter = await prisma.orderLine.findUnique({ where: { id: line.id }, select: { colorId: true } });
    check("dar uç: kalem MAVİ", lineAfter?.colorId === MAVI);
    const audit = await prisma.systemLog.findFirst({
      where: { tableName: "ORDER", recordId: order.id },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    check("dar uç: audit ORDER_LINE_COLOR_CHANGED", (audit?.newData as Record<string, unknown> | null)?.event === "ORDER_LINE_COLOR_CHANGED");
    const same = await catchErr(() => orderService.changeLineColor(order.id, line.id, MAVI, "tekrar", ADMIN));
    check("dar uç: aynı renk 400", same?.statusCode === 400, same?.message);
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    const cancelled = await catchErr(() => orderService.changeLineColor(order.id, line.id, YESIL, "olmaz", ADMIN));
    check("dar uç: iptal siparişte 409", cancelled?.statusCode === 409, cancelled?.message);
  }

  // ── §8 Kurşun bitişi: renk veren iç adım renksiz topu boyar ──────────────
  console.log("\n=== §8 İç istasyon bitişi renk yazar ===");
  {
    const station = await prisma.station.create({
      data: {
        code: `TST-TCG-${ts.toString(36).toUpperCase()}`.slice(0, 32),
        name: `TEST IC BOYA+KK2 ${ts}`,
        type: "INTERNAL",
        kind: "PROCESS_QC",
        appliesColor: true,
      },
      select: { id: true },
    });
    created.stations.push(station.id);
    const wo = await mkWo({
      tag: "S8", targetColorId: MAVI, withCard: true,
      steps: [{ stationId: station.id, status: "ACTIVE" }, { stationId: ST_KURSUN, status: "PENDING" }],
    });
    const [icStep] = wo.stepIds;
    const roll = await mkRoll({ colorId: null, status: RollStatus.IN_PRODUCTION, currentStepId: icStep, withBarcode: false });
    await prisma.rollMovement.create({ data: { rollId: roll, workOrderStepId: icStep, qtyIn: 100, operatorId: ADMIN } });
    const fin = await catchErr(() => inventory.kursunFinish(roll, {}, ADMIN));
    check("kursunFinish çalıştı", fin === null, fin?.message);
    const after = await prisma.roll.findUnique({ where: { id: roll }, select: { colorId: true } });
    check("renk veren iç adım bitince top WO hedef rengini aldı", after?.colorId === MAVI, String(after?.colorId));

    // Renk VERMEYEN iç adım (appliesColor=false) → renk yazmaz. Seed KURSUN_KK2
    // kullanılmaz: dev DB'de kurşun-dağıtım bayrağı açıksa tablet bitişi orada
    // 409 alır (ortam bayrağı) — negatif sonda kendi istasyonunda ölçülür.
    const plainStation = await prisma.station.create({
      data: {
        code: `TST-TCG2-${ts.toString(36).toUpperCase()}`.slice(0, 32),
        name: `TEST IC KK2 RENKSIZ ${ts}`,
        type: "INTERNAL",
        kind: "PROCESS_QC",
        appliesColor: false,
      },
      select: { id: true },
    });
    created.stations.push(plainStation.id);
    const wo2 = await mkWo({
      tag: "S8B", targetColorId: MAVI, withCard: true,
      steps: [{ stationId: plainStation.id, status: "ACTIVE" }, { stationId: ST_KURSUN, status: "PENDING" }],
    });
    const roll2 = await mkRoll({ colorId: null, status: RollStatus.IN_PRODUCTION, currentStepId: wo2.stepIds[0], withBarcode: false });
    await prisma.rollMovement.create({ data: { rollId: roll2, workOrderStepId: wo2.stepIds[0], qtyIn: 100, operatorId: ADMIN } });
    const fin2 = await catchErr(() => inventory.kursunFinish(roll2, {}, ADMIN));
    check("kursunFinish (renk vermeyen) çalıştı", fin2 === null, fin2?.message);
    const after2 = await prisma.roll.findUnique({ where: { id: roll2 }, select: { colorId: true } });
    check("renk vermeyen adım rengi YAZMAZ", after2?.colorId === null, String(after2?.colorId));
  }

  // ── §9 Kabulde plandan farklı renk: "sadece toplar" / "iş emri de" ───────
  console.log("\n=== §9 Kabul kararı (planColorAction) ===");
  if (!CAT_BOYA) {
    console.log("   (boyahane fixture'ının renk veren kategorisi yok — §9 atlandı)");
  } else {
    const wo = await mkWo({
      tag: "S9", targetColorId: KIRMIZI, withCard: true,
      steps: [
        { stationId: ST_BOYA, status: "PENDING", requiredCategoryId: CAT_BOYA },
        { stationId: ST_KURSUN, status: "PENDING" },
      ],
    });
    const [boyaStep] = wo.stepIds;
    const r1 = await mkRoll({ status: RollStatus.STOCK, qty: 100 });
    const r2 = await mkRoll({ status: RollStatus.STOCK, qty: 100 });
    await sub.dispatch({ workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [r1, r2] }, ADMIN);

    // (a) ROLLS_ONLY — boyahane YEŞİL boyadı, plan KIRMIZI kalsın; sapma kabulde deftere.
    const a = await catchErr(() =>
      sub.receive({
        workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, clientToken: randomUUID(),
        returns: [{ rollId: r1 }], newRolls: [{ qty: 100 }],
        appliedColorId: YESIL, expectedTargetColorId: KIRMIZI, planColorAction: "ROLLS_ONLY",
      }, ADMIN),
    );
    check("ROLLS_ONLY: kabul geçti", a === null, a?.message);
    const bornA = await prisma.roll.findFirst({
      where: { parentReceipt: { workOrderId: wo.id }, parentRollId: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, barcode: true, colorId: true, width: true },
    });
    if (bornA) created.rolls.push(bornA.id);
    check("ROLLS_ONLY: doğan top YEŞİL", bornA?.colorId === YESIL, String(bornA?.colorId));
    const planStill = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetColorId: true } });
    check("ROLLS_ONLY: plan KIRMIZI kaldı", planStill?.targetColorId === KIRMIZI);
    const dev = await prisma.rollPlanDeviation.findFirst({
      where: { rollId: bornA?.id ?? "", field: "color", source: FASON_RECEIPT_DEVIATION_SOURCE },
      select: { id: true, rollValue: true, planValue: true },
    });
    check("ROLLS_ONLY: sapma KABULDE deftere düştü", Boolean(dev), dev ? `${dev.rollValue} ↔ ${dev.planValue}` : "yok");
    // Tambur kapısı aynı topa aynı soruyu SORMAZ (onaysız çağrı fırlatmaz, boş döner).
    const gate = await catchErr(async () => {
      const r = await assertRollMatchesPlan(
        { id: bornA!.id, barcode: bornA!.barcode, colorId: bornA!.colorId, width: bornA!.width },
        { workOrderId: wo.id, targetColorId: KIRMIZI, width: null },
        false, ADMIN, "finalize",
      );
      if (r.length !== 0) throw new Error(`beklenmeyen sapma: ${r.length}`);
    });
    check("ROLLS_ONLY: Tambur kapısı tekrar sormaz", gate === null, gate?.message);
    // Plan sonradan değişirse o onay artık bu duruma ait değil → kapı yine sorar.
    const gate2 = await catchErr(() =>
      assertRollMatchesPlan(
        { id: bornA!.id, barcode: bornA!.barcode, colorId: bornA!.colorId, width: bornA!.width },
        { workOrderId: wo.id, targetColorId: MAVI, width: null },
        false, ADMIN, "finalize",
      ),
    );
    check("ROLLS_ONLY: plan başka renge dönerse kapı yine sorar (409)", gate2?.statusCode === 409, gate2?.message);

    // (b) APPLY_TO_PLAN — ikinci top da YEŞİL geldi, "iş emri de YEŞİL olsun":
    // eldeki boyanmış top zaten YEŞİL → uyum tam, plan YEŞİL'e döner.
    const b = await sub.receive({
      workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, clientToken: randomUUID(),
      returns: [{ rollId: r2 }], newRolls: [{ qty: 100 }],
      appliedColorId: YESIL, expectedTargetColorId: KIRMIZI, planColorAction: "APPLY_TO_PLAN",
    }, ADMIN);
    check("APPLY_TO_PLAN: kabul geçti, uyarı yok", b.success && !(b.warnings?.length), (b.warnings ?? []).join(" | "));
    const planNow = await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { targetColorId: true } });
    check("APPLY_TO_PLAN: plan YEŞİL oldu", planNow?.targetColorId === YESIL, String(planNow?.targetColorId));
    const born2 = await prisma.roll.findMany({ where: { parentReceipt: { workOrderId: wo.id }, parentRollId: null }, select: { id: true } });
    for (const x of born2) if (!created.rolls.includes(x.id)) created.rolls.push(x.id);
  }

  // ── §10 Planlamacı (workorder:write) iş emrinin toplarını düzeltebilir ────
  console.log("\n=== §10 Planlamacı toplu düzeltme ===");
  {
    const wo = await mkWo({
      tag: "S10", targetColorId: MAVI,
      steps: [{ stationId: ST_BOYA, status: "COMPLETED", requiredCategoryId: CAT_BOYA }, { stationId: ST_KURSUN, status: "ACTIVE" }],
    });
    const k = wo.stepIds[1];
    const r1 = await mkRoll({ colorId: KIRMIZI, status: RollStatus.IN_PRODUCTION, currentStepId: k });
    const r2 = await mkRoll({ colorId: KIRMIZI, status: RollStatus.IN_PRODUCTION, currentStepId: k });
    // Yalnız roll:read → üretimdeki top süpervizör ister → başarısız (kural korunur).
    const weak = await workOrderLinkService.applyAttributeToRolls(
      wo.id, { rollIds: [r1, r2], colorId: MAVI, reason: "kayıt yanlış" }, ADMIN, ["roll:read"],
    );
    check("yetkisiz: üretimdeki toplar düzeltilmedi", weak.data.updated === 0 && weak.data.failed.length === 2, weak.data.failed[0]?.message);
    // Planlamacı (workorder:write) → geçer.
    const planner = await workOrderLinkService.applyAttributeToRolls(
      wo.id, { rollIds: [r1, r2], colorId: MAVI, reason: "kayıt yanlış — aslında mavi" }, ADMIN, ["workorder:write"],
    );
    check("planlamacı: 2 top düzeltildi", planner.data.updated === 2, `updated=${planner.data.updated} failed=${planner.data.failed.length}`);
    const rr = await prisma.roll.findMany({ where: { id: { in: [r1, r2] } }, select: { colorId: true } });
    check("toplar MAVİ", rr.every((r) => r.colorId === MAVI));
  }
}

async function cleanup(): Promise<void> {
  try {
    const woIds = created.wos;
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatchIds = dispatches.map((d) => d.id);
    const bornIds = (await prisma.roll.findMany({ where: { parentReceiptId: { in: receiptIds } }, select: { id: true } })).map((r) => r.id);
    const rollIds = [...new Set([...created.rolls, ...bornIds])];
    await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: created.items } } });
    await prisma.item.deleteMany({ where: { id: { in: created.items } } });
    await prisma.station.deleteMany({ where: { id: { in: created.stations } } });
    await prisma.color.deleteMany({ where: { id: { in: created.colors } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds, ...created.orders] } },
    });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
