// =============================================================================
// EMANET ÇIKIŞ ADAY LİSTESİ (T1) — `GET /api/consignment-dispatches/candidates`
// =============================================================================
// Ölçer (gerçek DB; route katmanı router yığınından doğrudan, sunucusuz):
//   §0 statik — aday rotası `/:id`ten önce · guard `consignment:write ∨ mobile:depo` · satır çözücü ve aday ucu
//      seçilebilirliği TEK helper'dan (`eligibility.ts`) okur, çözücüde elle yüklem kalmadı · tavan sorguda
//   §1 kapı — tanınmayan parametre 400 · sahip eksik 400 · yalnız `mobile:depo` geçer · yalnız `warehouse:read` 403 ·
//      bilinmeyen sahip 404 OWNER_CUSTOMER_INVALID
//   §2 sahip süzgeci + seçilebilirlik — A'nın READY leventi + bakiyeli lotu var; B'nin ve sahipsiz lot yok; sıfır
//      bakiyeli lot yok; pasif lot YARN_LOT_INACTIVE ile listede · her adayın engeli önizlemeyle AYNI
//   §3 tavan + arama · §4 kapalı modülün listesi boş (`modules`)
//
// NEGATİF SONDALAR (cp + geri al, 2026-11-08):
//   S1 candidates.ts iplik `blockedReason` → null sabit ⇒ §2f (önizlemeyle aynı engel) ❌
//   S2 candidates.ts `HAVING ... > 0` kaldırıldı ⇒ §2d (sıfır bakiyeli lot listede değil) ❌
//   S3 route `CandidatesQuery` `.strict()` kaldırıldı ⇒ §1a (tanınmayan parametre 400) ❌
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döndürülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { Prisma, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { YarnLotService } from "../src/services/yarn-lot.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { previewConsignmentDispatch } from "../src/services/consignment-dispatch/create";
import type { ConsignmentCandidates } from "../src/services/consignment-dispatch/candidate-types";
import router from "../src/routes/consignment-dispatch.routes";
import { AppError } from "../src/utils/app-error";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-ECA-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED] as const;

function statik(): void {
  console.log("── §0 Statik ──");
  const route = readFileSync(path.join(ROOT, "src/routes/consignment-dispatch.routes.ts"), "utf8");
  const aday = route.indexOf('router.get("/candidates"');
  check("§0a aday rotası `/:id`ten ÖNCE (yoksa kimlik diye okunur)", aday > 0 && aday < route.indexOf('router.get("/:id"'));
  check("§0b guard anahtar-kapsamlı: `requireAnyPermission(\"consignment:write\", \"mobile:depo\")`",
    /router\.get\("\/candidates", requireAnyPermission\("consignment:write", "mobile:depo"\)/.test(route));
  const dir = path.join(ROOT, "src/services/consignment-dispatch");
  const lines = readFileSync(path.join(dir, "lines.ts"), "utf8");
  const cand = readFileSync(path.join(dir, "candidates.ts"), "utf8");
  const imp = /import \{ beamBlockedReason, yarnBlockedReason \} from "\.\/eligibility";/;
  check("§0c ⭐ satır çözücü ve aday ucu seçilebilirliği TEK helper'dan okur", imp.test(lines) && imp.test(cand));
  check("§0d çözücüde elle engel yüklemi kalmadı (kod literal'i yalnız eligibility/assert'te)",
    !/\? "CONSIGNMENT_BEAM_NOT_READY"|\? "YARN_LOT_INACTIVE"|\? "CONSIGNMENT_YARN_INSUFFICIENT"|\? "CONSIGNMENT_OWNER_MISMATCH"/.test(lines + cand));
  check("§0e satır tavanı sorgunun içinde (`take: q.limit + 1` · `LIMIT ${q.limit + 1}`)", cand.includes("take: q.limit + 1") && cand.includes("LIMIT ${q.limit + 1}"));
}

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => unknown }> } };

/** Router yığınındaki `/candidates` GET katmanını gerçek middleware'leriyle koşar (verifyToken/emanet kapısı hariç). */
async function call(query: Record<string, string>, permissions: string[]): Promise<{ status: number; code?: string; data?: ConsignmentCandidates }> {
  const layer = (router as { stack: RouteLayer[] }).stack.find((l) => l.route?.path === "/candidates" && l.route.methods.get);
  if (!layer?.route) return { status: -1, code: "ROUTE_YOK" };
  const req = { query, user: { userId: "x", username: "x", permissions } } as unknown as Request;
  let out: { status: number; body?: { data?: ConsignmentCandidates } } | null = null;
  let err: unknown = null;
  const res = { status(s: number) { return { json(b: { data?: ConsignmentCandidates }) { out = { status: s, body: b }; } }; } } as unknown as Response;
  for (const h of layer.route.stack) {
    let nexted = false;
    await h.handle(req, res, (e?: unknown) => { nexted = true; err = e ?? null; });
    if (err || !nexted) break;
  }
  if (err instanceof AppError) return { status: err.statusCode, code: String((err.details as { code?: string } | undefined)?.code ?? "") };
  if (err) throw err;
  const o = out as { status: number; body?: { data?: ConsignmentCandidates } } | null;
  return { status: o?.status ?? 0, data: o?.body?.data };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== EMANET ÇIKIŞ ADAY LİSTESİ (T1) BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...FLAGS] } }, select: { key: true, value: true } });
  const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
  const admin = await ensureTestAdmin();
  const whId = await fixtureWarehouseId();
  const lotSvc = new YarnLotService();
  const ids = { custs: [] as string[], yarn: "", spec: "", lots: [] as string[], beams: [] as string[] };
  const W = ["consignment:write"];

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
    const mkLot = async (suffix: string, owner?: string): Promise<string> => {
      const l = (await lotSvc.create({ itemId: yarn.id, lotNo: `${TAG}-${suffix}`, ...(owner ? { ownerCustomerId: owner } : {}) }, admin.id)).data;
      ids.lots.push(l.id);
      return l.id;
    };
    const move = (lotId: string, kind: YarnMovementKind, qtyKg: number) =>
      prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: whId, kind, qtyKg, lotId, reason: `${TAG} hareket` }));
    const lotA = await mkLot("LA", custA.id);
    const lotPasif = await mkLot("LP", custA.id);
    const lotSifir = await mkLot("LZ", custA.id);
    const lotB = await mkLot("LB", custB.id);
    const lotN = await mkLot("LN");
    for (const l of [lotA, lotPasif, lotB, lotN]) await move(l, YarnMovementKind.IN, 40);
    await move(lotSifir, YarnMovementKind.IN, 10);
    await move(lotSifir, YarnMovementKind.OUT, 10);
    await prisma.yarnLot.update({ where: { id: lotPasif }, data: { isActive: false } });
    const beam = async (owner: string, m: number, wind: boolean): Promise<string> => {
      const b = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: m, originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: owner });
      ids.beams.push(b.data.id);
      if (wind) await windWarpBeam(b.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL }, admin.id);
      return b.data.id;
    };
    const bA1 = await beam(custA.id, 500, true);
    const bA2 = await beam(custA.id, 300, true);
    const bAplan = await beam(custA.id, 100, false);
    const bB = await beam(custB.id, 200, true);

    console.log("\n── §1 Kapı ──");
    const r1a = await call({ ownerCustomerId: custA.id, sahip: "x" }, W);
    check("§1a ⭐ tanınmayan parametre → 400 VALIDATION_ERROR", r1a.status === 400 && r1a.code === "VALIDATION_ERROR", `${r1a.status} ${r1a.code}`);
    const r1b = await call({}, W);
    check("§1b sahip eksik → 400", r1b.status === 400, String(r1b.status));
    const r1c = await call({ ownerCustomerId: custA.id }, ["mobile:depo"]);
    check("§1c ⭐ yalnız `mobile:depo` (levent/iplik okuma izni yok) → 200", r1c.status === 200, String(r1c.status));
    const r1d = await call({ ownerCustomerId: custA.id }, ["warehouse:read", "warpbeam:read"]);
    check("§1d `consignment:write`/`mobile:depo` yok → 403", r1d.status === 403, String(r1d.status));
    const r1e = await call({ ownerCustomerId: "00000000-0000-4000-8000-000000000000" }, W);
    check("§1e bilinmeyen sahip → 404 OWNER_CUSTOMER_INVALID", r1e.status === 404 && r1e.code === "OWNER_CUSTOMER_INVALID", `${r1e.status} ${r1e.code}`);

    console.log("\n── §2 Sahip süzgeci + seçilebilirlik ──");
    const r = await call({ ownerCustomerId: custA.id, search: TAG }, W);
    const d = r.data!;
    const beamIds = new Set(d.beams.map((b) => b.warpBeamId));
    const lotIds = new Set(d.yarns.map((y) => y.lotId));
    check("§2a A'nın iki READY leventi listede, seçilebilir", beamIds.has(bA1) && beamIds.has(bA2) && d.beams.every((b) => b.blockedReason === null));
    check("§2b sarılmamış (READY değil) levent ve B'nin leventi YOK", !beamIds.has(bAplan) && !beamIds.has(bB));
    const ya = d.yarns.find((y) => y.lotId === lotA);
    check("§2c A'nın bakiyeli lotu lot × depo satırıyla listede (40 kg, seçilebilir)", ya?.balanceKg === "40.000" && ya.warehouseId === whId && ya.blockedReason === null, JSON.stringify(ya));
    check("§2d ⭐ sıfır bakiyeli lot, B'nin lotu ve sahipsiz lot YOK (sahip süzgeci sunucuda)", !lotIds.has(lotSifir) && !lotIds.has(lotB) && !lotIds.has(lotN));
    const yp = d.yarns.find((y) => y.lotId === lotPasif);
    check("§2e pasif lot listede, engeli YARN_LOT_INACTIVE", yp?.blockedReason === "YARN_LOT_INACTIVE", JSON.stringify(yp?.blockedReason));
    let ayni = true;
    const fark: string[] = [];
    for (const y of d.yarns) {
      const p = await previewConsignmentDispatch({ ownerCustomerId: custA.id, items: [{ kind: "YARN", yarnItemId: y.yarnItemId, warehouseId: y.warehouseId, lotId: y.lotId, qtyKg: y.balanceKg }] });
      if (p.lines[0]?.blockedReason !== y.blockedReason) { ayni = false; fark.push(`${y.lotNo}: aday=${y.blockedReason} önizleme=${p.lines[0]?.blockedReason}`); }
    }
    for (const b of d.beams) {
      const p = await previewConsignmentDispatch({ ownerCustomerId: custA.id, items: [{ kind: "WARP_BEAM", warpBeamId: b.warpBeamId }] });
      if (p.lines[0]?.blockedReason !== b.blockedReason) { ayni = false; fark.push(`${b.beamNo}: aday=${b.blockedReason} önizleme=${p.lines[0]?.blockedReason}`); }
    }
    check("§2f ⭐ her adayın engeli önizleme/oluştur çözücüsüyle AYNI (pasif lot dahil)", ayni && d.yarns.length >= 2 && d.beams.length >= 2, fark.join(" · "));
    const pz = await previewConsignmentDispatch({ ownerCustomerId: custA.id, items: [{ kind: "YARN", yarnItemId: yarn.id, warehouseId: whId, lotId: lotSifir, qtyKg: "0.001" }] });
    check("§2g listede olmayan sıfır bakiyeli lot önizlemede de engelli (INSUFFICIENT)", pz.lines[0]?.blockedReason === "CONSIGNMENT_YARN_INSUFFICIENT");

    console.log("\n── §3 Tavan + arama ──");
    const r3 = await call({ ownerCustomerId: custA.id, search: TAG, limit: "1" }, W);
    check("§3a ⭐ limit=1 → tür başına 1 satır + truncated", r3.data?.beams.length === 1 && r3.data.truncated.beams && r3.data.yarns.length === 1 && r3.data.truncated.yarns);
    const r3b = await call({ ownerCustomerId: custA.id, search: `${TAG}-LA` }, W);
    check("§3b arama lot noyu süzer (yalnız LA)", r3b.data?.yarns.length === 1 && r3b.data.yarns[0]!.lotId === lotA && !r3b.data.truncated.yarns);
    const r3c = await call({ ownerCustomerId: custA.id, limit: "101" }, W);
    check("§3c limit tavanı aşılırsa 400", r3c.status === 400);
    const r3d = await call({ ownerCustomerId: custA.id, search: "%" }, W);
    check("§3d `%` joker değil, düz karakter (kaçırıldı)", r3d.status === 200 && !r3d.data!.yarns.some((y) => y.lotId === lotA));

    console.log("\n── §4 Kapalı modül ──");
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, false);
    const r4 = await call({ ownerCustomerId: custA.id, search: TAG }, W);
    check("§4a devere kapalı → levent listesi boş, modules.devere=false, iplik dolu", r4.status === 200 && r4.data!.beams.length === 0 && !r4.data!.modules.devere && r4.data!.yarns.length > 0);
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    const r4b = await call({ ownerCustomerId: custA.id, search: TAG }, W);
    check("§4b iplik kapalı → lot listesi boş, modules.iplik=false", r4b.data!.yarns.length === 0 && !r4b.data!.modules.iplik && r4b.data!.beams.length > 0);
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: ids.beams } } });
    if (ids.yarn) {
      await prisma.yarnMovement.deleteMany({ where: { itemId: ids.yarn } });
      await prisma.yarnStock.deleteMany({ where: { itemId: ids.yarn } });
    }
    await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beams } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: ids.lots } } });
    if (ids.spec) await prisma.warpSpec.deleteMany({ where: { id: ids.spec } });
    if (ids.yarn) await prisma.item.deleteMany({ where: { id: ids.yarn } });
    await prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.custs } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.custs } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.beams, ...ids.lots] } } });
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
