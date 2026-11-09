// =============================================================================
// BEKÇİ — TABLET "KAT TİPİNİ DEĞİŞTİR": `PATCH /api/work-orders/:id/fold-type` ("Eni Değiştir" ikizi)
// Çalıştır: npx tsx scripts/run-all-tests.ts wo_fold_change
// =============================================================================
//   §1 katalog dışı kat 400, kolon ve defter değişmez
//   §2 ⭐ başarı (yalnız tablet izniyle): kanonik kod yazılır · açık refakat kartı contentDirty · İE hareket
//      defterine FIELD_CHANGED `foldType` (trigger FOLD_CHANGE + sebep + sebep kodu) · audit TARGET_FOLD_CHANGED
//   §3 aynı değer 400 · kısa sebep 400 (Zod)
//   §4 ⭐ Tambur adımı başladıysa 409, kat değişmez
//   §5 ⭐ tx İÇİ kilit: ön kontrolden sonra, kilit beklenirken Tambur başlarsa 409 (yarış)
//   §6 kapanmış İE 409 WO_PLAN_FROZEN
//   §7 route zinciri: `mobile:is-emri-duzelt` geçer · `workorder:write` geçer · ikisi de yoksa 403
// NEGATİF SONDA (2026-11-09): yalnız tx içi kilit kaldırılınca §5 2 ❌ · iki kilit kaldırılınca §4/§5 4 ❌ ·
//   `resolveFoldTypeForWrite` yerine `normalizeFoldType` konunca §1/§2 6 ❌ · route'tan `mobile:is-emri-duzelt` düşünce §7 1 ❌.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { patchFoldType } from "../src/controllers/workorder-process.controller";
import workOrderRouter from "../src/routes/workorder.routes";
import { FOLD_PROPERTY_CODE } from "../src/services/helpers/fold-type";
import { WO_PLAN_FROZEN_CODE } from "../src/services/helpers/workorder-target-color.helper";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-WFC-${STAMP}`;
const fx = {
  woIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[], valueIds: [] as string[],
  propCreated: null as string | null,
};

type Captured = { status: number; body: { data?: { previousFoldType: string | null; foldType: string | null } } | null; err: unknown };
async function callPatch(workOrderId: string, userId: string, body: unknown): Promise<Captured> {
  const out: Captured = { status: 0, body: null, err: null };
  const req = { params: { id: workOrderId }, body, user: { userId, permissions: ["mobile:is-emri-duzelt"] } } as unknown as Request;
  const res = { status(c: number) { out.status = c; return this; }, json(b: Captured["body"]) { out.body = b; return this; } } as unknown as Response;
  await patchFoldType(req, res, ((e: unknown) => { out.err = e; }) as NextFunction);
  return out;
}
const errStatus = (c: Captured): number | null => (c.err instanceof AppError ? c.err.statusCode : null);
const errText = (c: Captured): string => String((c.err as Error | null)?.message ?? c.status);

// Route zinciri koşturucu (test_document_template_permission sözleşmesi): [verifyToken, ...kapılar, controller].
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string; handle: (req: Request, res: Response, next: NextFunction) => void }> } };
function gate(permissions: string[]): { ok: boolean; err: unknown } | null {
  const layer = (workOrderRouter as unknown as { stack: RouteLayer[] }).stack.find((l) => l.route?.path === "/:id/fold-type" && l.route.methods.patch);
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken" || chain[chain.length - 1]!.handle !== patchFoldType) return null;
  const req = { user: { userId: "x", permissions }, params: {}, body: {} } as unknown as Request;
  for (const link of chain.slice(1, -1)) {
    let called = false;
    let err: unknown;
    link.handle(req, {} as Response, ((e?: unknown) => { called = true; err = e; }) as NextFunction);
    if (!called || err) return { ok: false, err };
  }
  return { ok: true, err: null };
}

async function ensureFoldCatalog(): Promise<void> {
  // Gerçek "KAT" satırına dokunulmaz: varsa yalnız eksik sonda değeri eklenir, yoksa kurulur ve sonda silinir.
  let prop = await prisma.fabricProperty.findUnique({ where: { code: FOLD_PROPERTY_CODE }, select: { id: true, isActive: true } });
  if (!prop) {
    prop = await prisma.fabricProperty.create({ data: { code: FOLD_PROPERTY_CODE, name: "Kat", valueType: "CHOICE" }, select: { id: true, isActive: true } });
    fx.propCreated = prop.id;
  }
  if (!prop.isActive) throw new Error("KAT özelliği pasif — katalog fail-open olur, bekçi anlamsız");
  for (const [code, name, sortOrder] of [["2-KAT", "2 Kat", 10], ["4-KAT", "4 Kat", 20]] as const) {
    const has = await prisma.fabricPropertyValue.findFirst({ where: { propertyId: prop.id, code } });
    if (!has) fx.valueIds.push((await prisma.fabricPropertyValue.create({ data: { propertyId: prop.id, code, name, sortOrder }, select: { id: true } })).id);
  }
}

let seq = 0;
async function mkWo(itemId: string, stQc: string, stTambur: string): Promise<{ id: string; tamburStepId: string }> {
  seq++;
  const number = `${P}-WO${seq}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number, type: "STOCK_PRODUCTION", status: "PLANNED", targetItemId: itemId, foldType: "2-KAT",
      steps: { create: [{ stationId: stQc, stepSequence: 1 }, { stationId: stTambur, stepSequence: 2 }] },
    },
    select: { id: true, steps: { select: { id: true, stationId: true } } },
  });
  fx.woIds.push(wo.id);
  await prisma.travelerCard.create({ data: { workOrderId: wo.id, cardNumber: number, barcode: number } });
  return { id: wo.id, tamburStepId: wo.steps.find((s) => s.stationId === stTambur)!.id };
}

const foldOf = async (id: string) => (await prisma.workOrder.findUniqueOrThrow({ where: { id }, select: { foldType: true } })).foldType;
const foldEvents = (id: string) => prisma.workOrderEvent.findMany({
  where: { workOrderId: id, type: "FIELD_CHANGED", field: "foldType" },
  select: { fromValue: true, toValue: true, trigger: true, reason: true, reasonCode: true, createdById: true },
});

async function waitForLockWaiter(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(rows[0]?.n ?? 0) > 0) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

async function main(): Promise<void> {
  console.log("=== Tablet Kat Tipini Değiştir ===");
  const actor = await testActorId();
  await ensureFoldCatalog();
  const item = await prisma.item.create({ data: { code: `${P}-ITM`, name: `TEST WFC kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  fx.itemIds.push(item.id);
  const mkSt = async (suffix: string, kind: "PROCESS_QC" | "TAMBUR") => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST WFC ${suffix} ${STAMP}`, type: "INTERNAL", kind }, select: { id: true } });
    fx.stationIds.push(s.id);
    return s.id;
  };
  const stQc = await mkSt("QC", "PROCESS_QC");
  const stTambur = await mkSt("TB", "TAMBUR");

  section("§1 katalog dışı değer");
  const a = await mkWo(item.id, stQc, stTambur);
  const bad = await callPatch(a.id, actor, { foldType: "99-KAT", reason: "Müşteri istedi" });
  check("katalog dışı kat → 400", errStatus(bad) === 400, errText(bad));
  check("kolon ve defter değişmedi", (await foldOf(a.id)) === "2-KAT" && (await foldEvents(a.id)).length === 0);

  section("§2 başarı — yalnız tablet izni");
  const ok = await callPatch(a.id, actor, { foldType: "4 kat", reason: "Müşteri dört kat istedi", reasonCode: "MUSTERI_DEGISTIRDI" });
  check("200 + yanıt eski/yeni", ok.status === 200 && ok.err === null && ok.body?.data?.previousFoldType === "2-KAT" && ok.body?.data?.foldType === "4-KAT", errText(ok));
  check("⭐ kolon kanonik kodla yazıldı (4-KAT)", (await foldOf(a.id)) === "4-KAT");
  const card = await prisma.travelerCard.findUniqueOrThrow({ where: { workOrderId: a.id }, select: { contentDirty: true } });
  check("⭐ refakat kartı güncel değil (contentDirty)", card.contentDirty === true);
  const ev = await foldEvents(a.id);
  check("⭐ İE hareket defteri: FIELD_CHANGED foldType 2-KAT→4-KAT, FOLD_CHANGE, sebep + kod + yazar",
    ev.length === 1 && ev[0]!.fromValue === "2-KAT" && ev[0]!.toValue === "4-KAT" && ev[0]!.trigger === "FOLD_CHANGE"
      && ev[0]!.reason === "Müşteri dört kat istedi" && ev[0]!.reasonCode === "MUSTERI_DEGISTIRDI" && ev[0]!.createdById === actor,
    JSON.stringify(ev));
  const logs = await prisma.systemLog.findMany({ where: { tableName: "WORK_ORDER", recordId: a.id, action: "UPDATE" }, select: { newData: true, oldData: true } });
  const log = logs.find((l) => (l.newData as { event?: string } | null)?.event === "TARGET_FOLD_CHANGED");
  check("⭐ audit: TARGET_FOLD_CHANGED eski/yeni + sebep",
    !!log && (log.oldData as { foldType?: string }).foldType === "2-KAT" && (log.newData as { foldType?: string; reason?: string }).foldType === "4-KAT"
      && (log.newData as { reason?: string }).reason === "Müşteri dört kat istedi",
    JSON.stringify(logs.map((l) => l.newData)));

  section("§3 aynı değer · sebep");
  const same = await callPatch(a.id, actor, { foldType: "4-KAT", reason: "Tekrar deneme" });
  check("aynı değer → 400, yeni defter satırı yok", errStatus(same) === 400 && (await foldEvents(a.id)).length === 1, errText(same));
  const noReason = await callPatch(a.id, actor, { foldType: "2-KAT", reason: "x" });
  check("kısa sebep → reddedilir, kat değişmez", noReason.err !== null && noReason.status === 0 && (await foldOf(a.id)) === "4-KAT");

  section("§4 Tambur başladı");
  const b = await mkWo(item.id, stQc, stTambur);
  await prisma.workOrderStep.update({ where: { id: b.tamburStepId }, data: { status: "ACTIVE" } });
  const locked = await callPatch(b.id, actor, { foldType: "4-KAT", reason: "Müşteri istedi" });
  check("⭐ Tambur adımı başladı → 409", errStatus(locked) === 409, errText(locked));
  check("kat ve defter değişmedi", (await foldOf(b.id)) === "2-KAT" && (await foldEvents(b.id)).length === 0);

  section("§5 tx içi kilit (yarış)");
  const c = await mkWo(item.id, stQc, stTambur);
  let raced: Captured | null = null;
  let waited = false;
  await prisma.$transaction(async (tx) => {
    // İE satır kilidi elde: servis ön kontrolü geçer (Tambur PENDING), `touchWorkOrderTx`te bekler.
    await tx.workOrder.updateMany({ where: { id: c.id }, data: { updatedAt: new Date() } });
    const pending = callPatch(c.id, actor, { foldType: "4-KAT", reason: "Müşteri istedi" });
    waited = await waitForLockWaiter(5000);
    await tx.workOrderStep.update({ where: { id: c.tamburStepId }, data: { status: "ACTIVE" } });
    void pending.then((r) => { raced = r; });
  }, { timeout: 15000 });
  for (let i = 0; i < 200 && raced === null; i++) await new Promise((r) => setTimeout(r, 25));
  const r5 = raced as Captured | null;
  check("servis kilitte bekledi (yarış kuruldu)", waited);
  check("⭐ kilit beklenirken Tambur başladı → 409", r5 !== null && errStatus(r5) === 409, r5 ? errText(r5) : "yanıt yok");
  check("kat ve defter değişmedi", (await foldOf(c.id)) === "2-KAT" && (await foldEvents(c.id)).length === 0);

  section("§6 kapanmış İE");
  const d = await mkWo(item.id, stQc, stTambur);
  await prisma.workOrder.update({ where: { id: d.id }, data: { status: "COMPLETED" } });
  const frozen = await callPatch(d.id, actor, { foldType: "4-KAT", reason: "Müşteri istedi" });
  check("kapanmış İE → 409 WO_PLAN_FROZEN",
    frozen.err instanceof AppError && frozen.err.statusCode === 409 && (frozen.err.details as { code?: string } | undefined)?.code === WO_PLAN_FROZEN_CODE,
    errText(frozen));

  section("§7 route kapısı");
  const g1 = gate(["mobile:is-emri-duzelt"]);
  check("zincir bulundu: [verifyToken, …, patchFoldType]", g1 !== null);
  check("yalnız mobile:is-emri-duzelt geçer", g1?.ok === true);
  check("yalnız workorder:write geçer", gate(["workorder:write"])?.ok === true);
  const denied = gate(["workorder:read", "roll:read"]);
  check("ikisi de yoksa 403", denied?.ok === false && denied.err instanceof AppError && denied.err.statusCode === 403);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  // Hareket defteri silinmeye kapalı (tamper trigger'ı) — öteki bekçiler gibi sessiz geçilir.
  await prisma.workOrderEvent.deleteMany({ where: { workOrderId: { in: fx.woIds } } }).catch(() => undefined);
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("kat değeri", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  if (fx.propCreated) { const k = fx.propCreated; await del("KAT", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  const left = await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: P } } });
  check("temizlik: TEST-WFC iş emri kalıntısı yok", left === 0, String(left));
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
