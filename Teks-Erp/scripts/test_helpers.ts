// =============================================================================
// Test: SAF helper birim testleri (src/services/helpers/*)
// Çalıştır: npx tsx scripts/test_helpers.ts
// =============================================================================
// Gerçek DB GEREKMEZ. Saf fonksiyonlar doğrudan; DB'ye dokunan karar-mantığı
// (quality-grade resolve, order-status recompute, roll-step recompute,
// workorder-locks compute) elle örülmüş HAFİF bir in-memory sahte Prisma
// client ile sürülür — gerçek helper kodu, gerçek girdi/çıktı, mock dönüş.
//
// Kapsanan test EDİLMEMİŞ helper'lar:
//   - quality-grade.helper       resolveQualityGradeId (lenient) +
//                                resolveQualityGradeIdStrict (400 katalog/pasif)
//   - customer-name.helper       resolveName cascade + normalizeOverride
//   - order-status.helper        recomputeOrderStatus (APPROVED/PARTIAL/COMPLETED,
//                                CANCELLED & manuel terminal, re-open, tolerans)
//   - roll-step.helper           recomputeStepStatus (PENDING/ACTIVE/COMPLETED,
//                                SKIPPED terminal), canRollGoBackFromStep,
//                                ensureWorkOrderInProgress (idempotent)
//   - workorder-locks.helper     computeWorkOrderLocks (materialCommitted, renk/
//                                kat/özellik kilitleri, eksik WO)
// Ayrıca normalize* ek kenar-durumları (mevcut testlerin kapsamadığı
// idempotans/çoklu-sayı yolları).
// =============================================================================

import {
  resolveQualityGradeId,
  resolveQualityGradeIdStrict,
} from "../src/services/helpers/quality-grade.helper";
import {
  resolveName,
  normalizeOverride,
} from "../src/services/helpers/customer-name.helper";
import {
  normalizeItemName,
  normalizeColorName,
} from "../src/services/helpers/name-normalize.helper";
import { recomputeOrderStatus } from "../src/services/helpers/order-status.helper";
import {
  recomputeStepStatus,
  canRollGoBackFromStep,
  ensureWorkOrderInProgress,
} from "../src/services/helpers/roll-step.helper";
import { computeWorkOrderLocks } from "../src/services/helpers/workorder-locks.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

// =============================================================================
// 1) name-normalize.helper — saf (ek kenar durumları)
// =============================================================================
function testNameNormalize() {
  check("item: tr büyük (i→İ)", normalizeItemName("ipliği boyalı") === "İPLİĞİ BOYALI");
  check(
    "item: çoklu boşluk tekle + trim",
    normalizeItemName("  a   b ") === "A B",
    JSON.stringify(normalizeItemName("  a   b ")),
  );
  // Renk: sayı bloğu başa, boşluk KORUNUR (2026-07-27 — tire standardı kalktı;
  // legacy tireli ad idempotent bırakılır)
  check("color: sayı başa + boşluk korunur", normalizeColorName("beyaz 055") === "055 BEYAZ");
  check("color: çok kelime boşluklu", normalizeColorName("krem gümüş") === "KREM GÜMÜŞ");
  check("color: legacy tireli idempotent", normalizeColorName("055-BEYAZ") === "055-BEYAZ");
  check(
    "color: çoklu sayı SIRASI korunur",
    normalizeColorName("12 lacivert 7") === "12 7 LACİVERT",
    normalizeColorName("12 lacivert 7"),
  );
  check(
    "color: boşlukla ayrık yalnız-tire token düşer",
    normalizeColorName("açık - mavi  03") === "03 AÇIK MAVİ",
    normalizeColorName("açık - mavi  03"),
  );
  check("color: yalnız sayı", normalizeColorName("042") === "042");
  check("color: boş → boş", normalizeColorName("   ") === "");
}

// =============================================================================
// 3) customer-name.helper — saf cascade
// =============================================================================
function testCustomerName() {
  check("resolveName: OVERRIDE öncelikli", (() => { const r = resolveName("Özel", "Master", "Default"); return r.name === "Özel" && r.source === "OVERRIDE"; })());
  check("resolveName: override boş → MASTER", (() => { const r = resolveName("  ", "Master", "Default"); return r.name === "Master" && r.source === "MASTER"; })());
  check("resolveName: ikisi de yok → DEFAULT", (() => { const r = resolveName(null, undefined, "Default"); return r.name === "Default" && r.source === "DEFAULT"; })());
  check("normalizeOverride: boş/whitespace → null", normalizeOverride("   ") === null && normalizeOverride(undefined) === null && normalizeOverride(null) === null);
  check("normalizeOverride: trim'li değer", normalizeOverride("  abc ") === "abc");
}

// =============================================================================
// 4) quality-grade.helper — hafif sahte client (qualityGrade.findUnique)
// =============================================================================
// Katalog: kod → { id, isActive }
const QG_CATALOG: Record<string, { id: string; isActive: boolean }> = {
  "1.KALITE": { id: "qg-1kalite", isActive: true },
  A1: { id: "qg-a1", isActive: true },
  FIRE: { id: "qg-fire", isActive: true },
  ESKI: { id: "qg-eski", isActive: false }, // pasifleştirilmiş
};
function makeQgClient() {
  return {
    qualityGrade: {
      findUnique: async (args: { where: { code: string }; select?: Record<string, boolean> }) => {
        const row = QG_CATALOG[args.where.code];
        return row ?? null;
      },
    },
  } as unknown as Parameters<typeof resolveQualityGradeId>[1];
}

async function testQualityGrade() {
  const client = makeQgClient();
  check("qg lenient: bilinen kod → id", (await resolveQualityGradeId("1.KALITE", client)) === "qg-1kalite");
  check("qg lenient: bilinmeyen kod → null", (await resolveQualityGradeId("YOK", client)) === null);
  // Lenient pasif kaliteyi de döner (sistem-türetimli kodlar için)
  check("qg lenient: pasif kalite de id döner", (await resolveQualityGradeId("ESKI", client)) === "qg-eski");

  check("qg strict: bilinen+aktif → id", (await resolveQualityGradeIdStrict("FIRE", client)) === "qg-fire");

  let missing400 = false;
  try {
    await resolveQualityGradeIdStrict("YOK", client);
  } catch (e) {
    missing400 = (e as { statusCode?: number }).statusCode === 400;
  }
  check("qg strict: katalog-dışı kod → 400", missing400);

  let inactive400 = false;
  try {
    await resolveQualityGradeIdStrict("ESKI", client);
  } catch (e) {
    inactive400 = (e as { statusCode?: number }).statusCode === 400;
  }
  check("qg strict: pasif kalite → 400", inactive400);
}

// =============================================================================
// 5) order-status.helper — sahte tx (order.findUnique/update + systemSetting)
// =============================================================================
type Line = { quantity: number; shippedQty: number };
type OrderRow = {
  id: string;
  status: string;
  completedAt: Date | null;
  manualClosedById: string | null;
  lines: Line[];
};
function makeOrderTx(order: OrderRow | null, tolerance = 5) {
  const updates: Record<string, unknown>[] = [];
  // Ledger-otoritatif model (ÇUVAL DEPO): recompute shippedQty'yi OrderLine.shippedQty
  // alanından DEĞİL, SackAllocation + SubcontractorDirectShipAllocation defterinden
  // (orderLineId ile) YENİDEN hesaplar. Bu yüzden satırlara id atıyoruz ve line.shippedQty'yi
  // "sevk edilmiş çuval tahsisi" olarak groupBy mock'una taşıyoruz.
  const linesWithId = order
    ? order.lines.map((l, i) => ({ ...l, id: `${order.id}-l${i}` }))
    : [];
  const tx = {
    order: {
      findUnique: async () => (order ? { ...order, lines: linesWithId } : null),
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        if (order) {
          if (args.data.status) order.status = args.data.status as string;
          if ("completedAt" in args.data) order.completedAt = args.data.completedAt as Date | null;
        }
        return {};
      },
    },
    orderLine: {
      // Denorm shippedQty yazımı — testte doğrulanmıyor, no-op.
      update: async () => ({}),
    },
    sackAllocation: {
      // shipped = Σ dispatched çuval tahsisi. Line.shippedQty > 0 olanları tahsis say.
      groupBy: async () =>
        linesWithId
          .filter((l) => l.shippedQty > 0)
          .map((l) => ({ orderLineId: l.id, _sum: { qty: l.shippedQty } })),
    },
    subcontractorDirectShipAllocation: {
      // Bu senaryolarda fason doğrudan sevk yok.
      groupBy: async () => [] as { orderLineId: string; _sum: { qty: number } }[],
    },
    systemSetting: {
      findUnique: async () => ({ value: String(tolerance) }),
    },
  } as unknown as Parameters<typeof recomputeOrderStatus>[0];
  return { tx, updates };
}

async function testOrderStatus() {
  // shipped 0 → APPROVED
  {
    const { tx } = makeOrderTx({ id: "o1", status: "PENDING", completedAt: null, manualClosedById: null, lines: [{ quantity: 100, shippedQty: 0 }] });
    const r = await recomputeOrderStatus(tx, "o1");
    check("order: shipped 0 → APPROVED", r?.newStatus === "APPROVED" && r?.changed === true, r?.newStatus);
  }
  // kısmi → PARTIAL_SHIPPED
  {
    const { tx } = makeOrderTx({ id: "o2", status: "APPROVED", completedAt: null, manualClosedById: null, lines: [{ quantity: 100, shippedQty: 40 }] });
    const r = await recomputeOrderStatus(tx, "o2");
    check("order: kısmi sevk → PARTIAL_SHIPPED", r?.newStatus === "PARTIAL_SHIPPED", r?.newStatus);
  }
  // tolerans içinde → COMPLETED + completedAt yazılır
  {
    const order: OrderRow = { id: "o3", status: "PARTIAL_SHIPPED", completedAt: null, manualClosedById: null, lines: [{ quantity: 100, shippedQty: 96 }] };
    const { tx, updates } = makeOrderTx(order, 5);
    const r = await recomputeOrderStatus(tx, "o3");
    check("order: kalan ≤ tolerans → COMPLETED", r?.newStatus === "COMPLETED", r?.newStatus);
    check("order: COMPLETED'de completedAt damgalandı", updates.some((u) => u.completedAt instanceof Date));
  }
  // tolerans tam sınırda (kalan == tolerans) → COMPLETED
  {
    const { tx } = makeOrderTx({ id: "o3b", status: "APPROVED", completedAt: null, manualClosedById: null, lines: [{ quantity: 100, shippedQty: 95 }] }, 5);
    const r = await recomputeOrderStatus(tx, "o3b");
    check("order: kalan == tolerans sınırı → COMPLETED", r?.newStatus === "COMPLETED", r?.newStatus);
  }
  // CANCELLED terminal — değişmez
  {
    const { tx, updates } = makeOrderTx({ id: "o4", status: "CANCELLED", completedAt: null, manualClosedById: null, lines: [{ quantity: 100, shippedQty: 100 }] });
    const r = await recomputeOrderStatus(tx, "o4");
    check("order: CANCELLED terminal — değişmez", r?.changed === false && r?.newStatus === "CANCELLED");
    // Ledger modeli: denorm shippedQty her zaman senkronlanır (update çağrılır) ama
    // terminal siparişin status'u ASLA yazılmaz.
    check("order: CANCELLED'de status yazılmadı", updates.every((u) => !("status" in u)));
  }
  // Manuel kapatılmış COMPLETED terminal
  {
    const { tx } = makeOrderTx({ id: "o5", status: "COMPLETED", completedAt: new Date(), manualClosedById: "user-1", lines: [{ quantity: 100, shippedQty: 10 }] });
    const r = await recomputeOrderStatus(tx, "o5");
    check("order: manuel kapatılmış COMPLETED terminal", r?.changed === false && r?.newStatus === "COMPLETED");
  }
  // Otomatik COMPLETED → re-open (sevk düşünce) + completedAt temizlenir
  {
    const order: OrderRow = { id: "o6", status: "COMPLETED", completedAt: new Date(), manualClosedById: null, lines: [{ quantity: 100, shippedQty: 40 }] };
    const { tx, updates } = makeOrderTx(order, 5);
    const r = await recomputeOrderStatus(tx, "o6");
    check("order: oto-COMPLETED → re-open PARTIAL", r?.newStatus === "PARTIAL_SHIPPED", r?.newStatus);
    check("order: re-open'da completedAt null'landı", updates.some((u) => "completedAt" in u && u.completedAt === null));
  }
  // Bilinmeyen sipariş → null
  {
    const { tx } = makeOrderTx(null);
    const r = await recomputeOrderStatus(tx, "yok");
    check("order: bulunamayan sipariş → null", r === null);
  }
}

// =============================================================================
// 6) roll-step.helper — sahte tx
// =============================================================================
// recomputeStepStatus için: workOrderStep.findUnique/update, rollMovement.count,
// roll.count. Sayıları senaryo başına sabitliyoruz.
function makeStepTx(opts: {
  step: { id: string; status: string; workOrderId: string; startedAt: Date | null } | null;
  openCount: number;
  closedCount: number;
  pendingRolls: number;
}) {
  const stepUpdates: Record<string, unknown>[] = [];
  const woUpdates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  let movementCountCall = 0;
  const tx = {
    workOrderStep: {
      findUnique: async () => opts.step,
      update: async (args: { data: Record<string, unknown> }) => {
        stepUpdates.push(args.data);
        if (opts.step && args.data.status) opts.step.status = args.data.status as string;
        return {};
      },
    },
    rollMovement: {
      // İlk çağrı openCount, ikinci çağrı closedCount (helper sırası: open → closed)
      count: async () => {
        movementCountCall += 1;
        return movementCountCall === 1 ? opts.openCount : opts.closedCount;
      },
    },
    roll: {
      count: async () => opts.pendingRolls,
    },
    workOrder: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        woUpdates.push(args);
        return { count: 1 };
      },
    },
  } as unknown as Parameters<typeof recomputeStepStatus>[0];
  return { tx, stepUpdates, woUpdates };
}

async function testRollStep() {
  // PENDING: hiç movement, bekleyen rol yok
  {
    const { tx } = makeStepTx({ step: { id: "s1", status: "PENDING", workOrderId: "w1", startedAt: null }, openCount: 0, closedCount: 0, pendingRolls: 0 });
    check("step: hiç hareket → PENDING", (await recomputeStepStatus(tx, "s1")) === "PENDING");
  }
  // ACTIVE: açık movement var → WO da IN_PROGRESS'e çekilir
  {
    const { tx, stepUpdates, woUpdates } = makeStepTx({ step: { id: "s2", status: "PENDING", workOrderId: "w2", startedAt: null }, openCount: 1, closedCount: 0, pendingRolls: 0 });
    const r = await recomputeStepStatus(tx, "s2");
    check("step: açık hareket → ACTIVE", r === "ACTIVE");
    check("step: ACTIVE'e geçişte startedAt damgalandı", stepUpdates.some((u) => u.startedAt instanceof Date));
    check("step: ACTIVE → WO ensureInProgress çağrıldı (PLANNED filtresi)", woUpdates.some((u) => u.where.status === "PLANNED" && u.data.status === "IN_PROGRESS"));
  }
  // COMPLETED: açık yok, kapalı var, bekleyen rol yok
  {
    const { tx, stepUpdates } = makeStepTx({ step: { id: "s3", status: "ACTIVE", workOrderId: "w3", startedAt: new Date() }, openCount: 0, closedCount: 2, pendingRolls: 0 });
    const r = await recomputeStepStatus(tx, "s3");
    check("step: kapalı var + bekleyen yok → COMPLETED", r === "COMPLETED");
    check("step: COMPLETED'de completedAt damgalandı", stepUpdates.some((u) => u.completedAt instanceof Date));
  }
  // Kapalı var ama hala bekleyen rol → ACTIVE tut
  {
    const { tx } = makeStepTx({ step: { id: "s4", status: "ACTIVE", workOrderId: "w4", startedAt: new Date() }, openCount: 0, closedCount: 2, pendingRolls: 3 });
    check("step: kapalı var + bekleyen var → ACTIVE", (await recomputeStepStatus(tx, "s4")) === "ACTIVE");
  }
  // SKIPPED terminal — dokunulmaz
  {
    const { tx, stepUpdates } = makeStepTx({ step: { id: "s5", status: "SKIPPED", workOrderId: "w5", startedAt: null }, openCount: 5, closedCount: 5, pendingRolls: 5 });
    const r = await recomputeStepStatus(tx, "s5");
    check("step: SKIPPED terminal — değişmez", r === "SKIPPED");
    check("step: SKIPPED'te update çağrılmadı", stepUpdates.length === 0);
  }
  // Bilinmeyen step → PENDING
  {
    const { tx } = makeStepTx({ step: null, openCount: 0, closedCount: 0, pendingRolls: 0 });
    check("step: bulunamayan step → PENDING", (await recomputeStepStatus(tx, "yok")) === "PENDING");
  }
}

// canRollGoBackFromStep — sahte tx (sonraki adım izleri)
function makeGoBackTx(opts: { closedMovement: boolean; operation: { operationType: string } | null; dispatch: { dispatchNo: string } | null }) {
  const tx = {
    rollMovement: {
      findFirst: async () => (opts.closedMovement ? { id: "m1" } : null),
    },
    rollOperation: {
      findFirst: async () => (opts.operation ? { id: "op1", operationType: opts.operation.operationType } : null),
    },
    subcontractorDispatch: {
      findFirst: async () => (opts.dispatch ? { id: "d1", dispatchNo: opts.dispatch.dispatchNo } : null),
    },
  } as unknown as Parameters<typeof canRollGoBackFromStep>[0];
  return tx;
}

async function testCanGoBack() {
  // nextStepId null → her zaman serbest (DB'ye bakmaz)
  {
    const tx = makeGoBackTx({ closedMovement: false, operation: null, dispatch: null });
    const r = await canRollGoBackFromStep(tx, "r1", null);
    check("goBack: son adım (nextStepId null) → serbest", r.canGoBack === true && r.reason === null);
  }
  // sonraki adımda kapalı movement → engelli
  {
    const tx = makeGoBackTx({ closedMovement: true, operation: null, dispatch: null });
    const r = await canRollGoBackFromStep(tx, "r2", "s-next");
    check("goBack: sonraki adım tamamlanmış → engelli", r.canGoBack === false && (r.reason ?? "").includes("tamamlanmış"));
  }
  // sonraki adımda operasyon → engelli (operationType mesajda)
  {
    const tx = makeGoBackTx({ closedMovement: false, operation: { operationType: "QC2_COMPLETED" }, dispatch: null });
    const r = await canRollGoBackFromStep(tx, "r3", "s-next");
    check("goBack: sonraki adımda işlem → engelli", r.canGoBack === false && (r.reason ?? "").includes("QC2_COMPLETED"));
  }
  // sonraki adımda fason sevki → engelli (dispatchNo mesajda)
  {
    const tx = makeGoBackTx({ closedMovement: false, operation: null, dispatch: { dispatchNo: "FSV-99" } });
    const r = await canRollGoBackFromStep(tx, "r4", "s-next");
    check("goBack: sonraki adımda fason sevki → engelli", r.canGoBack === false && (r.reason ?? "").includes("FSV-99"));
  }
  // hiç iz yok → serbest
  {
    const tx = makeGoBackTx({ closedMovement: false, operation: null, dispatch: null });
    const r = await canRollGoBackFromStep(tx, "r5", "s-next");
    check("goBack: iz yok → serbest", r.canGoBack === true && r.reason === null);
  }
}

// ensureWorkOrderInProgress — sadece PLANNED filtresiyle updateMany çağırmalı
async function testEnsureInProgress() {
  const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const tx = {
    workOrder: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.push(args);
        return { count: 0 };
      },
    },
  } as unknown as Parameters<typeof ensureWorkOrderInProgress>[0];
  await ensureWorkOrderInProgress(tx, "wo-x");
  check(
    "ensureInProgress: yalnız PLANNED→IN_PROGRESS updateMany (idempotent filtre)",
    calls.length === 1 && calls[0].where.id === "wo-x" && calls[0].where.status === "PLANNED" && calls[0].data.status === "IN_PROGRESS",
  );
}

// =============================================================================
// 7) workorder-locks.helper — sahte db (workOrder.findUnique)
// =============================================================================
type StepFix = {
  id: string;
  status: string;
  stationId: string | null;
  /// Renk kilidinin TEK kaynağı (2026-08-02). Eskiden station.colorCapabilities
  /// idi; hedef renk hiçbir istasyon listesinde değilse boya bittiği hâlde renk
  /// kilitlenmiyordu — bkz. aşağıdaki "listede olmayan renk" vakası.
  requiredCategory: { appliesColor: boolean } | null;
  station: {
    id: string;
    kind: string;
    propertyCapabilities: { propertyId: string }[];
  } | null;
};
function makeLocksDb(wo: {
  id: string;
  targetColorId: string | null;
  targetProperties: { propertyId: string }[];
  steps: StepFix[];
  activeDispatches: number;
} | null) {
  return {
    workOrder: {
      findUnique: async () => {
        if (!wo) return null;
        return {
          id: wo.id,
          targetColorId: wo.targetColorId,
          targetProperties: wo.targetProperties,
          steps: wo.steps,
          _count: { dispatches: wo.activeDispatches },
        };
      },
    },
  } as unknown as Parameters<typeof computeWorkOrderLocks>[0];
}

async function testWorkOrderLocks() {
  // Hiç başlamamış (tüm step PENDING, dispatch yok) → hiçbir şey kilitli değil
  {
    const db = makeLocksDb({
      id: "w1",
      targetColorId: null,
      targetProperties: [],
      steps: [{ id: "st1", status: "PENDING", stationId: "stn1", requiredCategory: null, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [] } }],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w1");
    check("locks: hiç başlamamış → materialCommitted false", r.materialCommitted === false && r.targetItem === false && r.width === false);
  }
  // Bir adım başladı → materialCommitted + targetItem + width kilitli
  {
    const db = makeLocksDb({
      id: "w2",
      targetColorId: null,
      targetProperties: [],
      steps: [{ id: "st1", status: "ACTIVE", stationId: "stn1", requiredCategory: null, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [] } }],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w2");
    check("locks: adım başladı → materialCommitted", r.materialCommitted === true && r.targetItem === true && r.width === true);
    check("locks: targetQuantity ASLA sertçe kilitli değil", r.targetQuantity === false);
    check("locks: materialCommitted sebebi yazıldı", !!r.reasons.materialCommitted);
  }
  // Aktif fason sevki (tüm step PENDING ama dispatch>0) → materialCommitted
  {
    const db = makeLocksDb({
      id: "w3",
      targetColorId: null,
      targetProperties: [],
      steps: [{ id: "st1", status: "PENDING", stationId: "stn1", requiredCategory: null, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [] } }],
      activeDispatches: 2,
    });
    const r = await computeWorkOrderLocks(db, "w3");
    check("locks: aktif fason sevki → materialCommitted", r.materialCommitted === true);
  }
  // Renk kilidi: "renk veren" adım COMPLETED → renk kilitli.
  // Rengin hiçbir istasyon listesinde olması GEREKMEZ (2026-08-02) — bu vaka
  // eski StationColor-tabanlı kurguda targetColor=false veriyordu, yani boya
  // bittikten sonra renk hâlâ değiştirilebiliyordu.
  {
    const db = makeLocksDb({
      id: "w4",
      targetColorId: "col-mavi",
      targetProperties: [],
      steps: [{ id: "st1", status: "COMPLETED", stationId: "stn1", requiredCategory: { appliesColor: true }, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [] } }],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w4");
    check("locks: boya adımı COMPLETED → renk kilitli (renk hiçbir istasyon listesinde olmasa da)", r.targetColor === true && !!r.reasons.targetColor);
  }
  // Renk: boya adımı henüz açık (ACTIVE) → renk editable
  {
    const db = makeLocksDb({
      id: "w5",
      targetColorId: "col-mavi",
      targetProperties: [],
      steps: [{ id: "st1", status: "ACTIVE", stationId: "stn1", requiredCategory: { appliesColor: true }, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [] } }],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w5");
    check("locks: boya adımı açıkken renk editable", r.targetColor === false);
  }
  // Renk vermeyen adım (ör. Tambur/Zımpara) COMPLETED olsa da renk kilitlenmez —
  // "her COMPLETED adım rengi dondurur" sapmasının bekçisi.
  {
    const db = makeLocksDb({
      id: "w5b",
      targetColorId: "col-mavi",
      targetProperties: [],
      steps: [{ id: "st1", status: "COMPLETED", stationId: "stn1", requiredCategory: { appliesColor: false }, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [] } }],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w5b");
    check("locks: renk VERMEYEN adım COMPLETED → renk hâlâ editable", r.targetColor === false);
  }
  // Kat tipi: TAMBUR adımı PENDING değil → foldType kilitli
  {
    const db = makeLocksDb({
      id: "w6",
      targetColorId: null,
      targetProperties: [],
      steps: [{ id: "st1", status: "ACTIVE", stationId: "stn-t", requiredCategory: null, station: { id: "stn-t", kind: "TAMBUR", propertyCapabilities: [] } }],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w6");
    check("locks: TAMBUR başladı → foldType kilitli", r.foldType === true && !!r.reasons.foldType);
  }
  // Özellik kilidi: özelliği uygulayan istasyon COMPLETED → property locked + applicable hesabı
  {
    const db = makeLocksDb({
      id: "w7",
      targetColorId: null,
      targetProperties: [{ propertyId: "prop-kursun" }, { propertyId: "prop-other" }],
      steps: [
        { id: "st1", status: "COMPLETED", stationId: "stn1", requiredCategory: null, station: { id: "stn1", kind: "PROCESS_QC", propertyCapabilities: [{ propertyId: "prop-kursun" }] } },
        { id: "st2", status: "PENDING", stationId: "stn2", requiredCategory: null, station: { id: "stn2", kind: "PROCESS_QC", propertyCapabilities: [{ propertyId: "prop-other" }] } },
      ],
      activeDispatches: 0,
    });
    const r = await computeWorkOrderLocks(db, "w7");
    check("locks: COMPLETED istasyonun özelliği kilitli", r.lockedPropertyIds.includes("prop-kursun") && !r.lockedPropertyIds.includes("prop-other"));
    check("locks: applicable = COMPLETED OLMAYAN istasyonların özellikleri", r.applicablePropertyIds.includes("prop-other") && !r.applicablePropertyIds.includes("prop-kursun"));
    check("locks: property kilit sebebi yazıldı", !!r.reasons.properties && !!r.reasons.properties["prop-kursun"]);
  }
  // Bilinmeyen WO → tamamı false/boş
  {
    const db = makeLocksDb(null);
    const r = await computeWorkOrderLocks(db, "yok");
    check("locks: bulunamayan WO → tamamı serbest/boş", r.materialCommitted === false && r.lockedPropertyIds.length === 0 && r.applicablePropertyIds.length === 0);
  }
}

async function main() {
  testNameNormalize();
  testCustomerName();
  await testQualityGrade();
  await testOrderStatus();
  await testRollStep();
  await testCanGoBack();
  await testEnsureInProgress();
  await testWorkOrderLocks();

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
