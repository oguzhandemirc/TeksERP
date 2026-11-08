// =============================================================================
// EMANET ÇIKIŞ BELGESİ (genel fason F5) — sahibine levent/iplik iadesi
// =============================================================================
// Ölçer (gerçek DB, servis katmanı + middleware doğrudan):
//   §0 statik — route `verifyToken, requireEmanetEnabled` HER uçtan önce · defter/token beyanı · tek yazarlar
//   §1 kapalı modül — emanet kapalı 403 (middleware) · devere kapalı levent satırı 403 · iplik kapalı iplik satırı 403
//   §2 gövde — boş kalem 400 CONSIGNMENT_ITEMS_EMPTY · YARN lotsuz 400 · tekrarlı satır 400
//   §3 sahip uyuşmazlığı — başkasının leventi/lotu ve sahipsiz lot 409 CONSIGNMENT_OWNER_MISMATCH, belge doğmaz;
//      önizleme aynı yüklemle blockedReason · lot bakiyesi aşımı 409 CONSIGNMENT_YARN_INSUFFICIENT
//   §4 oluştur — numara doğuşta (EC…) · levent READY→SHIPPED_TO_OWNER + SHIP_TO_OWNER (kaleme bağlı, kalan metre) ·
//      iplik CONSIGNMENT_OUT (lot bakiyesi düştü) · F4 arayüzü leventi aktif listeler
//   §5 replay dört durum — ①ilk ②aynı gövde 200 aynı belge ③farklı gövde 409 CLIENT_TOKEN_COLLISION ④iptal sonrası 409
//   §6 levent durum claim — çıkmış levent ikinci belgeye 409 · eşzamanlı iki belge aynı levent: TEK kazanan
//   §7 iptal — önizleme her satırı listeler · bayat damga 409 CHANGED · ters çift (SHIP_TO_OWNER_CANCEL reversesEventId,
//      CONSIGNMENT_OUT_CANCEL aynı kg) · levent READY · lot bakiyesi geri · ikinci iptal 409 · F4 listesi boşaldı
//   §8 liste — sahip süzgeci + özet şeridi aynı where
//   §9 iptal engelleri — CONFIRMED faturalı levent bağı 409 CONSIGNMENT_BEAM_INVOICED (belge iptal değil, bağ damgasız;
//      engel `cancelledAt`ın gölgesinde kalmaz) · DRAFT bağ iptalde damgalanır (revokeReason CONSIGNMENT_CANCEL) ·
//      çıkıştan sonra levent başka olay aldıysa gerçek iptal 409 CONSIGNMENT_BEAM_MOVED_AFTER (WARP_BEAM_STATE değil)
//   §10 pasif lot — önizleme blockedReason YARN_LOT_INACTIVE = oluştur 409 · iptal ters kaydı pasif lota yazılır ·
//      istisna yalnız CONSIGNMENT_OUT_CANCEL (pasif lota IN hâlâ 400)
//
// NEGATİF SONDALAR (cp + geri al, 2026-11-08): bkz. PR gövdesi / dosya sonu notu.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Currency, Prisma, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { YarnLotService } from "../src/services/yarn-lot.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { yarnLotBalanceTx } from "../src/services/helpers/yarn-lot.helper";
import { applyWarpBeamEventTx } from "../src/services/helpers/warp-beam-event.helper";
import { listActiveShipToOwnerBeams } from "../src/services/helpers/consignment-beam.helper";
import { requireEmanetEnabled } from "../src/middlewares/module.middleware";
import { createConsignmentDispatch, previewConsignmentDispatch } from "../src/services/consignment-dispatch/create";
import { cancelConsignmentDispatch, cancelPreviewConsignmentDispatch } from "../src/services/consignment-dispatch/cancel";
import { listConsignmentDispatches } from "../src/services/consignment-dispatch/read";
import type { ConsignmentDispatchCreateInput } from "../src/services/consignment-dispatch/types";
import { AppError } from "../src/utils/app-error";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
const durum = (e: AppError | null): number => e?.statusCode ?? 0;

const TAG = `TEST-ECK-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED] as const;

function statik(): void {
  console.log("── §0 Statik ──");
  const route = readFileSync(path.join(ROOT, "src/routes/consignment-dispatch.routes.ts"), "utf8");
  const use = route.indexOf("router.use(verifyToken, requireEmanetEnabled)");
  const firstUc = Math.min(...["router.get(", "router.post("].map((s) => route.indexOf(s)).filter((i) => i >= 0));
  check("§0a route: `router.use(verifyToken, requireEmanetEnabled)` HER uçtan önce", use > 0 && use < firstUc);
  const beyan = readFileSync(path.join(ROOT, "scripts/lib/defter-beyan.ts"), "utf8");
  check("§0b defter beyanı: WarpBeamEvent ters yazanında `cancelConsignmentDispatch`", /consignment-dispatch\/cancel\.ts", sembol: "cancelConsignmentDispatch"/.test(beyan));
  const tok = readFileSync(path.join(ROOT, "scripts/lib/token-replay-beyan.ts"), "utf8");
  check("§0c token beyanı: `createConsignmentDispatch` R kipinde boğazda", /consignment-dispatch\/create\.ts::createConsignmentDispatch`\]: "R"/.test(tok));
  const svc = ["create.ts", "cancel.ts", "lines.ts"].map((f) => readFileSync(path.join(ROOT, "src/services/consignment-dispatch", f), "utf8")).join("\n");
  check("§0d tek yazarlar: servis `warpBeamEvent.create`/`yarnMovement.create` çağırmaz; `applyWarpBeamEventTx` + `applyYarnMovementTx`",
    !/warpBeamEvent\.create\(|yarnMovement\.create\(/.test(svc) && /applyWarpBeamEventTx\(/.test(svc) && /applyYarnMovementTx\(/.test(svc));
  const yarnSvc = readFileSync(path.join(ROOT, "src/services/yarn.service.ts"), "utf8");
  check("§0e iplik yazarı allowlist'i `consignmentItemId` taşır (sessiz düşme yok)", /consignmentItemId: input\.consignmentItemId \?\? null/.test(yarnSvc));
}

async function middleware403(): Promise<AppError | null> {
  let got: unknown = null;
  await requireEmanetEnabled({} as Request, {} as Response, (e?: unknown) => { got = e ?? null; });
  return got instanceof AppError ? got : null;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== EMANET ÇIKIŞ BELGESİ (F5) BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...FLAGS] } }, select: { key: true, value: true } });
  const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
  const admin = await ensureTestAdmin();
  const whId = await fixtureWarehouseId();
  const lots = new YarnLotService();
  const ids = { custs: [] as string[], yarn: "", spec: "", lots: [] as string[], beams: [] as string[], invoices: [] as string[], svc: "" };

  try {
    console.log("\n── fikstür ──");
    for (const f of FLAGS) await setFlag(f, true);
    const custA = await prisma.customer.create({ data: { code: `${TAG}-A`, name: `${TAG} Müşteri A` }, select: { id: true } });
    const custB = await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Müşteri B` }, select: { id: true } });
    ids.custs.push(custA.id, custB.id);
    const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
    ids.yarn = yarn.id;
    const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
    ids.spec = spec.id;
    const lotA = (await lots.create({ itemId: yarn.id, lotNo: `${TAG}-LA`, ownerCustomerId: custA.id }, admin.id)).data;
    const lotB = (await lots.create({ itemId: yarn.id, lotNo: `${TAG}-LB`, ownerCustomerId: custB.id }, admin.id)).data;
    const lotN = (await lots.create({ itemId: yarn.id, lotNo: `${TAG}-LN` }, admin.id)).data;
    ids.lots.push(lotA.id, lotB.id, lotN.id);
    for (const l of [lotA.id, lotB.id, lotN.id]) {
      await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 100, lotId: l, reason: `${TAG} giriş` }));
    }
    const beam = async (owner: string, m: number): Promise<string> => {
      const b = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: m, originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: owner });
      ids.beams.push(b.data.id);
      await windWarpBeam(b.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL }, admin.id);
      return b.data.id;
    };
    const bA1 = await beam(custA.id, 500);
    const bA2 = await beam(custA.id, 300);
    const bB = await beam(custB.id, 200);
    const st = await prisma.warpBeam.findMany({ where: { id: { in: [bA1, bA2, bB] } }, select: { status: true } });
    check("fikstür: üç levent READY, lotlar 100 kg", st.every((s) => s.status === WarpBeamStatus.READY) && (await yarnLotBalanceTx(prisma, lotA.id, whId)).eq(100));

    const yarnLine = (lotId: string, qtyKg: string) => ({ kind: "YARN" as const, yarnItemId: yarn.id, warehouseId: whId, lotId, qtyKg });
    const body = (items: ConsignmentDispatchCreateInput["items"], owner = custA.id, clientToken: string = randomUUID()): ConsignmentDispatchCreateInput => ({ ownerCustomerId: owner, items, clientToken });
    const headerCount = () => prisma.consignmentDispatch.count({ where: { ownerCustomerId: { in: ids.custs } } });

    console.log("\n── §1 Kapalı modül ──");
    await setFlag(SETTING_KEYS.EMANET_ENABLED, false);
    const m1 = await middleware403();
    check("§1a ⭐ emanet kapalı → middleware 403 MODULE_DISABLED", durum(m1) === 403 && kod(m1) === "MODULE_DISABLED", kod(m1));
    await setFlag(SETTING_KEYS.EMANET_ENABLED, true);
    check("§1a′ emanet açık → middleware geçer", (await middleware403()) === null);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, false);
    const e1b = await beklenenHata(() => createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }]), admin.id));
    const e1bp = await beklenenHata(() => previewConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }])));
    check("§1b devere kapalı + levent satırı → 403 (oluştur + önizleme), belge doğmadı", durum(e1b) === 403 && kod(e1b) === "MODULE_DISABLED" && durum(e1bp) === 403 && (await headerCount()) === 0);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    const e1c = await beklenenHata(() => createConsignmentDispatch(body([yarnLine(lotA.id, "5")]), admin.id));
    check("§1c iplik kapalı + iplik satırı → 403 MODULE_DISABLED", durum(e1c) === 403 && kod(e1c) === "MODULE_DISABLED");
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, true);

    console.log("\n── §2 Gövde ──");
    check("§2a boş kalem → 400 CONSIGNMENT_ITEMS_EMPTY", kod(await beklenenHata(() => createConsignmentDispatch(body([]), admin.id))) === "CONSIGNMENT_ITEMS_EMPTY");
    const lotsuz = { kind: "YARN", yarnItemId: yarn.id, warehouseId: whId, qtyKg: "5" } as unknown as ConsignmentDispatchCreateInput["items"][number];
    const e2b = await beklenenHata(() => createConsignmentDispatch(body([lotsuz]), admin.id));
    check("§2b ⭐ YARN lotsuz → 400 CONSIGNMENT_YARN_LOT_REQUIRED", durum(e2b) === 400 && kod(e2b) === "CONSIGNMENT_YARN_LOT_REQUIRED", kod(e2b));
    check("§2c aynı levent iki satır → 400", kod(await beklenenHata(() => createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }, { kind: "WARP_BEAM", warpBeamId: bA1 }]), admin.id))) === "CONSIGNMENT_DUPLICATE_LINE");
    check("§2d gövde hataları belge doğurmadı", (await headerCount()) === 0);

    console.log("\n── §3 Sahip uyuşmazlığı · bakiye ──");
    const e3a = await beklenenHata(() => createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }, { kind: "WARP_BEAM", warpBeamId: bB }]), admin.id));
    const bBst = await prisma.warpBeam.findUniqueOrThrow({ where: { id: bB }, select: { status: true } });
    check("§3a ⭐ A belgesine B'nin leventi → 409 CONSIGNMENT_OWNER_MISMATCH; belge yok, A1 READY kaldı (tx geri)",
      durum(e3a) === 409 && kod(e3a) === "CONSIGNMENT_OWNER_MISMATCH" && (await headerCount()) === 0 && bBst.status === "READY" && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bA1 }, select: { status: true } })).status === "READY", kod(e3a));
    check("§3b ⭐ A belgesine B'nin lotu → 409 CONSIGNMENT_OWNER_MISMATCH", kod(await beklenenHata(() => createConsignmentDispatch(body([yarnLine(lotB.id, "5")]), admin.id))) === "CONSIGNMENT_OWNER_MISMATCH");
    check("§3c sahipsiz (fabrikanın) lot → 409 CONSIGNMENT_OWNER_MISMATCH (KATI)", kod(await beklenenHata(() => createConsignmentDispatch(body([yarnLine(lotN.id, "5")]), admin.id))) === "CONSIGNMENT_OWNER_MISMATCH");
    const p3 = await previewConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }, { kind: "WARP_BEAM", warpBeamId: bB }, yarnLine(lotA.id, "150")]));
    const reason = (ref: string) => p3.lines.find((l) => l.refId === ref)?.blockedReason ?? null;
    check("§3d önizleme aynı yüklem: B leventi OWNER_MISMATCH · A1 temiz · 150 kg YARN_INSUFFICIENT · canCreate=false",
      reason(bB) === "CONSIGNMENT_OWNER_MISMATCH" && reason(bA1) === null && reason(lotA.id) === "CONSIGNMENT_YARN_INSUFFICIENT" && !p3.canCreate && p3.lines.find((l) => l.refId === bA1)?.qty === "500.000");
    const e3e = await beklenenHata(() => createConsignmentDispatch(body([yarnLine(lotA.id, "150")]), admin.id));
    check("§3e ⭐ lot bakiyesi aşımı (100 < 150) → 409 CONSIGNMENT_YARN_INSUFFICIENT", durum(e3e) === 409 && kod(e3e) === "CONSIGNMENT_YARN_INSUFFICIENT", kod(e3e));

    console.log("\n── §4 Oluştur ──");
    const T1 = randomUUID();
    const b1 = body([yarnLine(lotA.id, "10"), { kind: "WARP_BEAM", warpBeamId: bA1 }], custA.id, T1);
    const c1 = await createConsignmentDispatch(b1, admin.id);
    const d1 = c1.data;
    check("§4a belge doğdu: replayed=false, numara `EC` önekli, 1 levent 500 m + 10 kg", !c1.replayed && d1.dispatchNo.startsWith("EC") && d1.totals.beamCount === 1 && d1.totals.beamLengthM === "500.000" && d1.totals.yarnKg === "10.000", d1.dispatchNo);
    const beamItem = d1.items.find((i) => i.kind === "WARP_BEAM")!;
    const shipEv = await prisma.warpBeamEvent.findMany({ where: { beamId: bA1, kind: "SHIP_TO_OWNER" }, select: { id: true, consignmentItemId: true, lengthM: true, fromStatus: true, toStatus: true } });
    check("§4b ⭐ levent READY→SHIPPED_TO_OWNER; TEK SHIP_TO_OWNER olayı kaleme bağlı, 500 m",
      (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bA1 }, select: { status: true } })).status === "SHIPPED_TO_OWNER" && shipEv.length === 1 && shipEv[0]!.consignmentItemId === beamItem.id && shipEv[0]!.lengthM?.eq(500) === true && shipEv[0]!.fromStatus === "READY" && shipEv[0]!.toStatus === "SHIPPED_TO_OWNER");
    const yarnItem = d1.items.find((i) => i.kind === "YARN")!;
    const outMv = await prisma.yarnMovement.findMany({ where: { consignmentItemId: yarnItem.id }, select: { kind: true, qtyKg: true, lotId: true } });
    check("§4c ⭐ iplik CONSIGNMENT_OUT 10 kg lot A'dan, kaleme bağlı; lot bakiyesi 90",
      outMv.length === 1 && outMv[0]!.kind === "CONSIGNMENT_OUT" && outMv[0]!.qtyKg.eq(10) && outMv[0]!.lotId === lotA.id && (await yarnLotBalanceTx(prisma, lotA.id, whId)).eq(90));
    const f4 = await listActiveShipToOwnerBeams(prisma, { ownerCustomerId: custA.id });
    check("§4d F4 arayüzü: A1 aktif sahibine dönüş, belge no + çıkış anı", f4.length === 1 && f4[0]!.warpBeamId === bA1 && f4[0]!.dispatchNo === d1.dispatchNo && f4[0]!.dispatchedAt.toISOString() === d1.dispatchedAt && f4[0]!.shipEventId === shipEv[0]!.id);
    const audit = await prisma.systemLog.count({ where: { tableName: "CONSIGNMENT_DISPATCH", recordId: d1.id, action: "CREATE" } });
    check("§4e audit CONSIGNMENT_DISPATCH CREATE yazıldı", audit === 1);

    console.log("\n── §5 Replay dört durum ──");
    const r2 = await createConsignmentDispatch({ ...b1, items: [...b1.items].reverse() }, admin.id);
    check("§5a ⭐ ② aynı token + aynı gövde (sıra farklı) → replayed=true, AYNI belge, ikinci belge yok", r2.replayed && r2.data.id === d1.id && (await headerCount()) === 1);
    const e5b = await beklenenHata(() => createConsignmentDispatch({ ...b1, items: [yarnLine(lotA.id, "11"), { kind: "WARP_BEAM", warpBeamId: bA1 }] }, admin.id));
    check("§5b ⭐ ③ aynı token + farklı gövde → 409 CLIENT_TOKEN_COLLISION", durum(e5b) === 409 && kod(e5b) === "CLIENT_TOKEN_COLLISION", kod(e5b));
    const e5c = await beklenenHata(() => createConsignmentDispatch({ ...b1, ownerCustomerId: custB.id }, admin.id));
    check("§5c ③′ aynı token + farklı sahip → 409 CLIENT_TOKEN_COLLISION", kod(e5c) === "CLIENT_TOKEN_COLLISION");

    console.log("\n── §6 Levent durum claim ──");
    const e6a = await beklenenHata(() => createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }]), admin.id));
    check("§6a çıkmış levent ikinci belgeye → 409 CONSIGNMENT_BEAM_NOT_READY", kod(e6a) === "CONSIGNMENT_BEAM_NOT_READY");
    const e6b = await beklenenHata(() => prisma.$transaction((tx) => applyWarpBeamEventTx(tx, { beamId: bA1, kind: "SHIP_TO_OWNER", from: WarpBeamStatus.READY, to: WarpBeamStatus.SHIPPED_TO_OWNER, data: { consignmentItemId: beamItem.id, lengthM: 1 } })));
    check("§6b ⭐ yazar claim'i: READY beklenen ama SHIPPED_TO_OWNER → 409 WARP_BEAM_STATE (updateMany WHERE status)", kod(e6b) === "WARP_BEAM_STATE");
    const race = await Promise.allSettled([
      createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA2 }]), admin.id),
      createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA2 }]), admin.id),
    ]);
    const ok = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const lostCode = lost[0] ? kod(lost[0].reason instanceof AppError ? lost[0].reason : null) : "-";
    const ships = await prisma.warpBeamEvent.count({ where: { beamId: bA2, kind: "SHIP_TO_OWNER" } });
    check("§6c ⭐ eşzamanlı iki belge aynı levent → TEK kazanan, kaybeden 409, TEK SHIP_TO_OWNER", ok.length === 1 && lost.length === 1 && ships === 1 && ["CONSIGNMENT_BEAM_NOT_READY", "WARP_BEAM_STATE"].includes(lostCode), `${ok.length}/${lost.length} ${lostCode}`);
    const d2 = ok[0]?.status === "fulfilled" ? ok[0].value.data : null;

    console.log("\n── §7 İptal ──");
    const cp = await cancelPreviewConsignmentDispatch(d1.id);
    check("§7a önizleme: canCancel, etkilenen HER satır (levent 500 m + iplik 10 kg), fatura bağı yok",
      cp.canCancel && cp.affected.length === 2 && cp.affected.some((a) => a.kind === "WARP_BEAM" && a.refId === bA1 && a.qty === "500.000") && cp.affected.some((a) => a.kind === "YARN" && a.qty === "10.000") && cp.billingLinks.length === 0);
    const e7b = await beklenenHata(() => cancelConsignmentDispatch(d1.id, { reason: "test", expectedUpdatedAt: new Date(Date.parse(d1.updatedAt) - 1000).toISOString() }, admin.id));
    check("§7b bayat damga → 409 CONSIGNMENT_DISPATCH_CHANGED, belge iptal edilmedi", kod(e7b) === "CONSIGNMENT_DISPATCH_CHANGED" && (await prisma.consignmentDispatch.findUniqueOrThrow({ where: { id: d1.id }, select: { cancelledAt: true } })).cancelledAt === null);
    const cancelled = await cancelConsignmentDispatch(d1.id, { reason: `${TAG} yanlış çıkış`, expectedUpdatedAt: d1.updatedAt }, admin.id);
    const rev = await prisma.warpBeamEvent.findMany({ where: { beamId: bA1, kind: "SHIP_TO_OWNER_CANCEL" }, select: { reversesEventId: true, consignmentItemId: true, lengthM: true, toStatus: true } });
    check("§7c ⭐ ters çift levent: SHIP_TO_OWNER_CANCEL → READY, reversesEventId = ileri olay, aynı kalem, 500 m; ileri satır duruyor",
      cancelled.cancelledAt !== null && rev.length === 1 && rev[0]!.reversesEventId === shipEv[0]!.id && rev[0]!.consignmentItemId === beamItem.id && rev[0]!.lengthM?.eq(500) === true && rev[0]!.toStatus === "READY"
      && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bA1 }, select: { status: true } })).status === "READY" && (await prisma.warpBeamEvent.count({ where: { id: shipEv[0]!.id } })) === 1);
    const back = await prisma.yarnMovement.findMany({ where: { consignmentItemId: yarnItem.id }, select: { kind: true, qtyKg: true }, orderBy: { createdAt: "asc" } });
    check("§7d ⭐ ters çift iplik: CONSIGNMENT_OUT + CONSIGNMENT_OUT_CANCEL (10 kg), lot bakiyesi 100'e döndü",
      back.length === 2 && back[0]!.kind === "CONSIGNMENT_OUT" && back[1]!.kind === "CONSIGNMENT_OUT_CANCEL" && back[1]!.qtyKg.eq(10) && (await yarnLotBalanceTx(prisma, lotA.id, whId)).eq(100));
    check("§7e ikinci iptal → 409 CONSIGNMENT_DISPATCH_CANCELLED", kod(await beklenenHata(() => cancelConsignmentDispatch(d1.id, { reason: "x" }, admin.id))) === "CONSIGNMENT_DISPATCH_CANCELLED");
    const e7f = await beklenenHata(() => createConsignmentDispatch(b1, admin.id));
    check("§7f ⭐ ④ replay: iptal edilmiş belgenin token'ı → 409 CONSIGNMENT_DISPATCH_CANCELLED (başarı dönmez)", durum(e7f) === 409 && kod(e7f) === "CONSIGNMENT_DISPATCH_CANCELLED", kod(e7f));
    const f4b = await listActiveShipToOwnerBeams(prisma, { ownerCustomerId: custA.id });
    check("§7g F4 arayüzü: iptal edilen A1 artık aktif değil (yalnız eşzamanlı yarışın A2'si)", f4b.length === (d2 ? 1 : 0) && f4b.every((r) => r.warpBeamId === bA2));
    const again = await createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA1 }]), admin.id);
    check("§7h iptalden sonra levent yeniden çıkabilir (READY döngüsü)", !again.replayed && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bA1 }, select: { status: true } })).status === "SHIPPED_TO_OWNER");

    console.log("\n── §8 Liste ──");
    const lst = await listConsignmentDispatches({ ownerCustomerId: custA.id, status: "ALL", limit: 50 });
    const act = await listConsignmentDispatches({ ownerCustomerId: custA.id, status: "ACTIVE", limit: 1 });
    check("§8a sahip süzgeci: 3 belge (1 iptal), özet count/activeCount aynı where; aktif levent 2",
      lst.data.length === 3 && lst.summary.count === 3 && lst.summary.activeCount === 2 && lst.summary.beamCount === 2 && lst.data.every((r) => r.ownerCustomer.id === custA.id), JSON.stringify(lst.summary));
    const page2 = act.nextCursor ? await listConsignmentDispatches({ ownerCustomerId: custA.id, status: "ACTIVE", limit: 1, cursor: act.nextCursor }) : null;
    check("§8b cursor: ACTIVE süzgeci sayfada korunur, mükerrer yok", act.data.length === 1 && page2?.data.length === 1 && page2.data[0]!.id !== act.data[0]!.id && page2.data[0]!.cancelledAt === null && act.summary.count === 2);
    const lstB = await listConsignmentDispatches({ ownerCustomerId: custB.id, status: "ALL", limit: 50 });
    check("§8c B süzgeci boş (sessiz düşme yok)", lstB.data.length === 0 && lstB.summary.count === 0);

    console.log("\n── §9 İptal engelleri (fatura bağı · LIFO) ──");
    const bA3 = await beam(custA.id, 400);
    const d3 = (await createConsignmentDispatch(body([{ kind: "WARP_BEAM", warpBeamId: bA3 }, yarnLine(lotA.id, "5")]), admin.id)).data;
    const svc = await prisma.serviceItem.create({ data: { code: `${TAG}-SV`.slice(0, 32), name: `${TAG} levent sarım` }, select: { id: true } });
    ids.svc = svc.id;
    const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: custA.id, subcontractorId: null }));
    const inv = await prisma.invoice.create({ data: { docNo: `${TAG}-F`, type: "SALES", cariId: cari.id, issueDate: new Date(), status: "CONFIRMED", confirmedAt: new Date() }, select: { id: true } });
    ids.invoices.push(inv.id);
    const link = await prisma.serviceBillingLink.create({ data: {
      invoiceId: inv.id, subjectKind: "WARP_BEAM", warpBeamId: bA3, serviceItemId: svc.id, billedMeters: "400", meterBasis: "WOUND", unitPrice: "1", currency: Currency.TRY, serviceAt: new Date(),
    }, select: { id: true } });
    const cp9 = await cancelPreviewConsignmentDispatch(d3.id);
    check("§9a önizleme: CONFIRMED fatura bağı listelenir, canCancel=false, blockedReason CONSIGNMENT_BEAM_INVOICED",
      !cp9.canCancel && cp9.blockedReason === "CONSIGNMENT_BEAM_INVOICED" && cp9.billingLinks.length === 1 && cp9.billingLinks[0]!.linkId === link.id);
    const e9b = await beklenenHata(() => cancelConsignmentDispatch(d3.id, { reason: `${TAG} faturalı`, expectedUpdatedAt: d3.updatedAt }, admin.id));
    const d3row = await prisma.consignmentDispatch.findUniqueOrThrow({ where: { id: d3.id }, select: { cancelledAt: true } });
    const link9 = await prisma.serviceBillingLink.findUniqueOrThrow({ where: { id: link.id }, select: { revokedAt: true, revokeReason: true } });
    check("§9b ⭐ CONFIRMED faturalı levent → iptal 409 CONSIGNMENT_BEAM_INVOICED; belge iptal EDİLMEDİ, bağ damgasız, levent SHIPPED_TO_OWNER",
      durum(e9b) === 409 && kod(e9b) === "CONSIGNMENT_BEAM_INVOICED" && d3row.cancelledAt === null && link9.revokedAt === null
      && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bA3 }, select: { status: true } })).status === "SHIPPED_TO_OWNER", kod(e9b));
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: "DRAFT" } });

    console.log("\n── §10 Pasif lot ──");
    await prisma.yarnLot.update({ where: { id: lotA.id }, data: { isActive: false } });
    const p10 = await previewConsignmentDispatch(body([yarnLine(lotA.id, "1")]));
    const e10 = await beklenenHata(() => createConsignmentDispatch(body([yarnLine(lotA.id, "1")]), admin.id));
    check("§10a ⭐ pasif lot: önizleme blockedReason YARN_LOT_INACTIVE + canCreate=false = oluştur 409 YARN_LOT_INACTIVE (önizleme = işlem)",
      p10.lines[0]?.blockedReason === "YARN_LOT_INACTIVE" && !p10.canCreate && durum(e10) === 409 && kod(e10) === "YARN_LOT_INACTIVE", `${p10.lines[0]?.blockedReason} / ${kod(e10)}`);
    const e10b = await beklenenHata(() => prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 1, lotId: lotA.id, reason: `${TAG} pasif giriş` })));
    check("§10b istisna dar: pasif lota IN → 400 YARN_LOT_INACTIVE (ortak kapı gevşemedi)", kod(e10b) === "YARN_LOT_INACTIVE", kod(e10b));

    const before10 = await yarnLotBalanceTx(prisma, lotA.id, whId);
    const c9 = await cancelConsignmentDispatch(d3.id, { reason: `${TAG} taslak faturalı`, expectedUpdatedAt: d3.updatedAt }, admin.id);
    const link9c = await prisma.serviceBillingLink.findUniqueOrThrow({ where: { id: link.id }, select: { revokedAt: true, revokeReason: true } });
    check("§9c ⭐ DRAFT fatura bağı → iptal geçer, bağ damgalı revokeReason=CONSIGNMENT_CANCEL, levent READY",
      c9.cancelledAt !== null && link9c.revokedAt !== null && link9c.revokeReason === "CONSIGNMENT_CANCEL"
      && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: bA3 }, select: { status: true } })).status === "READY");
    const d3yarn = d3.items.find((i) => i.kind === "YARN")!;
    const back10 = await prisma.yarnMovement.findMany({ where: { consignmentItemId: d3yarn.id, kind: "CONSIGNMENT_OUT_CANCEL" }, select: { qtyKg: true, lotId: true } });
    check("§10c ⭐ iptal ters kaydı PASİF lota yazıldı (CONSIGNMENT_OUT_CANCEL 5 kg), lot bakiyesi +5",
      back10.length === 1 && back10[0]!.lotId === lotA.id && back10[0]!.qtyKg.eq(5) && (await yarnLotBalanceTx(prisma, lotA.id, whId)).eq(before10.plus(5)));
    await prisma.yarnLot.update({ where: { id: lotA.id }, data: { isActive: true } });

    // LIFO: §7h'nin belgesi (A1 çıkışı) — çıkıştan sonra leventi başka olay çevirir (yazar doğrudan), iptal sözleşme koduyla düşer.
    const shipAgain = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: bA1, kind: "SHIP_TO_OWNER" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, consignmentItemId: true, lengthM: true } });
    await prisma.$transaction((tx) => applyWarpBeamEventTx(tx, { beamId: bA1, kind: "SHIP_TO_OWNER_CANCEL", from: WarpBeamStatus.SHIPPED_TO_OWNER, to: WarpBeamStatus.READY, data: { consignmentItemId: shipAgain.consignmentItemId, reversesEventId: shipAgain.id, lengthM: shipAgain.lengthM, reason: `${TAG} LIFO` } }));
    const e9d = await beklenenHata(() => cancelConsignmentDispatch(again.data.id, { reason: `${TAG} LIFO` }, admin.id));
    check("§9d ⭐ LIFO: çıkıştan sonra olay almış levent → gerçek iptal 409 CONSIGNMENT_BEAM_MOVED_AFTER, belge iptal edilmedi",
      durum(e9d) === 409 && kod(e9d) === "CONSIGNMENT_BEAM_MOVED_AFTER" && (await prisma.consignmentDispatch.findUniqueOrThrow({ where: { id: again.data.id }, select: { cancelledAt: true } })).cancelledAt === null, kod(e9d));
  } finally {
    const dispatches = await prisma.consignmentDispatch.findMany({ where: { ownerCustomerId: { in: ids.custs } }, select: { id: true } });
    const dIds = dispatches.map((d) => d.id);
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: ids.beams } } });
    if (ids.yarn) {
      await prisma.yarnMovement.deleteMany({ where: { itemId: ids.yarn } });
      await prisma.yarnStock.deleteMany({ where: { itemId: ids.yarn } });
    }
    if (ids.invoices.length) {
      await prisma.serviceBillingLink.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
      await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
    }
    if (ids.svc) await prisma.serviceItem.deleteMany({ where: { id: ids.svc } });
    await prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.custs } } });
    await prisma.consignmentDispatchItem.deleteMany({ where: { dispatchId: { in: dIds } } });
    await prisma.consignmentDispatch.deleteMany({ where: { id: { in: dIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beams } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: ids.lots } } });
    if (ids.spec) await prisma.warpSpec.deleteMany({ where: { id: ids.spec } });
    if (ids.yarn) await prisma.item.deleteMany({ where: { id: ids.yarn } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.custs } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...dIds, ...ids.beams, ...ids.lots] } } });
    for (const key of FLAGS) {
      const f = foto.find((x) => x.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
