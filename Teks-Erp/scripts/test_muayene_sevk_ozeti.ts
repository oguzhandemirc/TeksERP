/**
 * test_muayene_sevk_ozeti — sevkiyat muayene özeti (Muayene raporu belgesinin TEK kaynağı).
 *
 * Ölçtüğü değişmezler (K4P-RAPOR):
 *  §1 Top başına aktif muayene: FINAL > RAW; muayenesiz top `result: NONE`.
 *  §2 Müşteri seti etiket/sonucu EZER ama `roll_inspections` satırı ve
 *     `Roll.qualityGradeId` DEĞİŞMEZ (özet okuyucudur, yazıcı değil).
 *  §3 Çocuk topa ebeveynin muayenesi DÜŞMEZ (topun KENDİ muayenesi).
 *  §4 Toplamlar backend'de; §5 HTTP: modül kapalı 403 MODULE_DISABLED, sevk izni şart.
 *
 * Negatif sonda (2026-10-25): servis `byRoll.get(r.parentRollId ?? r.id)` ile ebeveyni
 * okuyacak şekilde bozuldu → §3 ❌; geri alındı → yeşil.
 *
 * Koşum: npx tsx scripts/test_muayene_sevk_ozeti.ts (test DB'si; fabrika verisinde KOŞMA).
 */
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import * as svc from "../src/services/quality-inspection.service";
import { buildShipmentInspectionSummary } from "../src/services/quality-inspection-shipment.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TAG = `K4S${Date.now().toString(36).toUpperCase()}`;
const made = { items: [] as string[], rolls: [] as string[], types: [] as string[], grades: [] as string[], sets: [] as string[], users: [] as string[], customers: [] as string[], shipments: [] as string[], sacks: [] as string[] };
let parkedFactory: string[] = [];

async function fixtures(adminId: string) {
  // Başka koşumun aktif fabrika seti "tek aktif FACTORY" seddine çarpmasın: koşum boyunca park edilir.
  parkedFactory = (await prisma.fourPointRuleSet.findMany({ where: { scope: "FACTORY", isActive: true }, select: { id: true } })).map((s) => s.id);
  await prisma.fourPointRuleSet.updateMany({ where: { id: { in: parkedFactory } }, data: { isActive: false } });
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} kumaş`, itemType: "FABRIC", widthCm: 150 }, select: { id: true } });
  made.items.push(item.id);
  const customer = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} müşteri` }, select: { id: true } });
  made.customers.push(customer.id);
  const type = await prisma.defectType.create({ data: { code: `${TAG}S`, name: `${TAG} S` }, select: { id: true } });
  made.types.push(type.id);
  // Kod koşuma özgü sıra numarasıyla üretilir (kalite kodu literali yazılmaz — `test_quality_code_literal`).
  const mkGrade = async (n: number) => {
    const g = await prisma.qualityGrade.create({ data: { code: `${TAG}Q${n}`, name: `${TAG} derece ${n}` }, select: { id: true, code: true } });
    made.grades.push(g.id);
    return g;
  };
  const grades = { a: await mkGrade(1), b: await mkGrade(2), c: await mkGrade(3) };
  const factory = await prisma.fourPointRuleSet.create({
    data: {
      name: `${TAG} fabrika`, scope: "FACTORY", unit: "M2", runningCap: "YARD",
      bands: { create: [
        { sortOrder: 0, maxScore: 5, label: "A", accepted: true, qualityGradeId: grades.a.id },
        { sortOrder: 1, maxScore: 10, label: "B", accepted: true, qualityGradeId: grades.b.id },
        { sortOrder: 2, maxScore: null, label: "C", accepted: false, qualityGradeId: grades.c.id },
      ] },
    },
    select: { id: true },
  });
  // Müşteri seti fabrikadan SIKI: 5'in üstü RET (fabrika B kabul ederdi).
  const cust = await prisma.fourPointRuleSet.create({
    data: {
      name: `${TAG} müşteri`, scope: "CUSTOMER", customerId: customer.id, unit: "M2", runningCap: "YARD",
      bands: { create: [
        { sortOrder: 0, maxScore: 5, label: "İYİ", accepted: true },
        { sortOrder: 1, maxScore: null, label: "RET", accepted: false },
      ] },
    },
    select: { id: true },
  });
  made.sets.push(factory.id, cust.id);
  const shipment = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-SVK`, customerId: customer.id }, select: { id: true } });
  made.shipments.push(shipment.id);
  const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-CV`, shipmentId: shipment.id, seq: 1 }, select: { id: true } });
  made.sacks.push(sack.id);
  const mkRoll = async (suffix: string, opts: { inSack: boolean; parentRollId?: string }) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${suffix}`, itemId: item.id, initialQty: 100, currentQty: 100, createdById: adminId,
        parentRollId: opts.parentRollId ?? null,
        ...(opts.inSack ? { sackId: sack.id, shipmentId: shipment.id } : {}),
      },
      select: { id: true },
    });
    made.rolls.push(r.id);
    return r.id;
  };
  const parent = await mkRoll("P", { inSack: false });
  const rolls = {
    a: await mkRoll("A", { inSack: true }),
    b: await mkRoll("B", { inSack: true }),
    c: await mkRoll("C", { inSack: true }),
    child: await mkRoll("D", { inSack: true, parentRollId: parent }),
    parent,
  };
  return { rolls, typeId: type.id, grades, shipmentId: shipment.id, customerId: customer.id };
}
type Fx = Awaited<ReturnType<typeof fixtures>>;

async function cleanup(): Promise<void> {
  const ins = { rollId: { in: made.rolls } };
  await prisma.rollError.deleteMany({ where: ins });
  for (let i = 0; i < 20 && (await prisma.rollInspection.count({ where: ins })) > 0; i++) {
    await prisma.rollInspection.deleteMany({ where: { ...ins, supersededBy: { is: null } } });
  }
  await prisma.fourPointRuleBand.deleteMany({ where: { ruleSetId: { in: made.sets } } });
  await prisma.fourPointRuleSet.deleteMany({ where: { id: { in: made.sets } } });
  await prisma.fourPointRuleSet.updateMany({ where: { id: { in: parkedFactory } }, data: { isActive: true } });
  await prisma.roll.updateMany({ where: { id: { in: made.rolls } }, data: { parentRollId: null } });
  await prisma.roll.deleteMany({ where: { id: { in: made.rolls } } });
  await prisma.sack.deleteMany({ where: { id: { in: made.sacks } } });
  await prisma.shipment.deleteMany({ where: { id: { in: made.shipments } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.defectType.deleteMany({ where: { id: { in: made.types } } });
  await prisma.qualityGrade.deleteMany({ where: { id: { in: made.grades } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
}

/** 3 konumlu hata, farklı yardlarda (tavan 4'e değmez): 4+2+3 = 9 puan → 100 m × 1,5 m'de 6,00. */
const sixPoints = (fx: Fx) => [
  { defectTypeId: fx.typeId, sizeClass: "OVER_9IN" as const, startMeter: "1.0" },
  { defectTypeId: fx.typeId, sizeClass: "IN_3_TO_6" as const, startMeter: "10" },
  { defectTypeId: fx.typeId, sizeClass: "IN_6_TO_9" as const, startMeter: "20" },
];

async function sectionSummary(adminId: string, fx: Fx) {
  console.log("§1–§4 özet");
  const create = (rollId: string, phase: "RAW" | "FINAL", defects: ReturnType<typeof sixPoints>) =>
    svc.create({ rollId, phase, defects, clientToken: randomUUID() }, adminId);
  const aRaw = await create(fx.rolls.a, "RAW", sixPoints(fx));
  const aFinal = await create(fx.rolls.a, "FINAL", []);
  const bRaw = await create(fx.rolls.b, "RAW", sixPoints(fx));
  const pRaw = await create(fx.rolls.parent, "RAW", []);
  check("fikstür: fabrika seti B önerdi (6,00)", bRaw.suggestedQualityGradeId === fx.grades.b.id && bRaw.gradeScore?.toFixed(2) === "6.00", `${bRaw.gradeScore}`);
  const before = await prisma.rollInspection.findMany({ where: { id: { in: [aRaw.id, aFinal.id, bRaw.id, pRaw.id] } }, orderBy: { id: "asc" } });
  const rollsBefore = await prisma.roll.findMany({ where: { id: { in: made.rolls } }, select: { id: true, qualityGradeId: true, qualityGrade: true }, orderBy: { id: "asc" } });

  const s = await buildShipmentInspectionSummary(prisma, fx.shipmentId);
  if (!s) return check("özet döndü", false);
  const row = (rollId: string) => s.rows.find((r) => r.rollId === rollId);
  const a = row(fx.rolls.a), b = row(fx.rolls.b), c = row(fx.rolls.c), child = row(fx.rolls.child);
  check("sevkteki 4 top, ebeveyn (çuvalda değil) yok", s.rows.length === 4 && !row(fx.rolls.parent));
  check("§1 FINAL > RAW: A'nın satırı FINAL muayenesi", a?.inspectionId === aFinal.id && a?.phase === "FINAL", `${a?.phase}`);
  check("§1 FINAL 0 puan → müşteri İYİ, PASS", a?.label === "İYİ" && a?.result === "PASS" && a?.score === 0, `${a?.label}/${a?.score}`);
  check("§1 muayenesiz top → NONE, alanlar boş", c?.result === "NONE" && c?.inspectionId === null && c?.label === null);
  check("§2 müşteri seti ezer: B 6,00 → RET/FAIL (fabrika B derdi)", b?.label === "RET" && b?.accepted === false && b?.result === "FAIL" && b?.score === 6, `${b?.label}/${b?.score}`);
  check("§2 fabrika derecesi ayrı sütunda korunur", b?.factoryGrade === fx.grades.b.code, `${b?.factoryGrade}`);
  check("§2 kural listesi yalnız kullanılan müşteri seti", s.rules.length === 1 && s.rules[0]!.scope === "CUSTOMER" && s.rules[0]!.bands.length === 2);
  check("§3 çocuk topa ebeveyn muayenesi düşmez → NONE", child?.result === "NONE" && child?.inspectionId === null, `${child?.inspectionId}`);
  const t = s.totals;
  check("§4 toplamlar: 4 top · 2 muayeneli · 2 muayenesiz · 1 geçti · 1 kaldı", t.rollCount === 4 && t.inspectedCount === 2 && t.uninspectedCount === 2 && t.passCount === 1 && t.failCount === 1 && t.noScoreCount === 0, JSON.stringify(t));
  check("§4 toplam metre 400, puan 9, hata 3, ort. 3,00", t.totalMeters === 400 && t.totalPoints === 9 && t.defectCount === 3 && t.avgPointsPer100M2 === 3, JSON.stringify(t));
  check("başlık müşteriden", s.header.customerId === fx.customerId && s.header.shipmentNo === `${TAG}-SVK`);

  const after = await prisma.rollInspection.findMany({ where: { id: { in: before.map((r) => r.id) } }, orderBy: { id: "asc" } });
  const rollsAfter = await prisma.roll.findMany({ where: { id: { in: made.rolls } }, select: { id: true, qualityGradeId: true, qualityGrade: true }, orderBy: { id: "asc" } });
  check("§2 roll_inspections satırları DEĞİŞMEDİ", JSON.stringify(after) === JSON.stringify(before));
  check("§2 Roll.qualityGrade(Id) DEĞİŞMEDİ", JSON.stringify(rollsAfter) === JSON.stringify(rollsBefore));
  check("var olmayan sevkiyat → null", (await buildShipmentInspectionSummary(prisma, randomUUID())) === null);
}

async function sectionHttp(admin: { id: string; username: string; password: string }, fx: Fx) {
  console.log("§5 HTTP");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = async (username: string, password: string) => {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType: "electron" }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const get = async (path: string, token: string) => {
      const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json().catch(() => ({}))) as { details?: { code?: string }; data?: { rows?: unknown[] } };
      return { status: r.status, code: j.details?.code, rows: j.data?.rows?.length };
    };
    const bcrypt = await import("bcryptjs");
    const parola = kosumaOzguParola();
    const mk = async (suffix: string, perms: string[]) => {
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      made.users.push(u.id);
      return login(u.username, parola);
    };
    const adminToken = await login(admin.username, admin.password);
    const both = await mk("ikisi", ["inspection:read", "shipping:read"]);
    const onlyInspection = await mk("muayene", ["inspection:read"]);
    const onlyShipping = await mk("sevk", ["shipping:read"]);
    const path = `/api/quality-inspections/shipment/${fx.shipmentId}/summary`;

    await prisma.systemSetting.upsert({ where: { key: "kaliteGuvence.enabled" }, update: { value: false }, create: { key: "kaliteGuvence.enabled", value: false } });
    const off = await get(path, adminToken);
    check("modül kapalı → 403 MODULE_DISABLED", off.status === 403 && off.code === "MODULE_DISABLED", `${off.status} ${off.code}`);
    await prisma.systemSetting.update({ where: { key: "kaliteGuvence.enabled" }, data: { value: true } });
    const ok = await get(path, both);
    check("inspection:read + shipping:read → 200, 4 satır", ok.status === 200 && ok.rows === 4, `${ok.status} ${ok.rows}`);
    check("yalnız inspection:read → 403", (await get(path, onlyInspection)).status === 403);
    check("yalnız shipping:read → 403", (await get(path, onlyShipping)).status === 403);
    const missing = await get(`/api/quality-inspections/shipment/${randomUUID()}/summary`, adminToken);
    check("var olmayan sevkiyat → 404", missing.status === 404, `${missing.status}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function main(): Promise<void> {
  console.log("=== K4P sevkiyat muayene özeti bekçisi ===\n");
  const flagPrior = await prisma.systemSetting.findUnique({ where: { key: "kaliteGuvence.enabled" }, select: { value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  try {
    await prisma.systemSetting.upsert({ where: { key: "kaliteGuvence.enabled" }, update: { value: true }, create: { key: "kaliteGuvence.enabled", value: true } });
    const fx = await fixtures(admin.id);
    await sectionSummary(admin.id, fx);
    await sectionHttp(admin, fx);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    if (flagPrior) await prisma.systemSetting.update({ where: { key: "kaliteGuvence.enabled" }, data: { value: flagPrior.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: "kaliteGuvence.enabled" } });
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
