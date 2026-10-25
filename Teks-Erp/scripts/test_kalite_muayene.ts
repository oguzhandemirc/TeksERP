// =============================================================================
// BEKÇİ: K4P muayene motoru — yazım, replay, revizyon, iptal, kapsam, liste, HTTP (K4P-MOTOR)
// Çalıştır: npx tsx scripts/test_kalite_muayene.ts
// =============================================================================
// NEDEN: muayene DEFTERDİR (silinmez, revizyon damgayla, iptal damgayla) ve TEK yazarı
// `createInspectionTx`tir. Bu bekçi kuralları servis + DB seddi + HTTP kapısı üçlüsünde ölçer:
//   §1 oluştur → INSPECTION hata satırları + snapshot (tavan, en kaynağı, öneri, uyumsuzluk)
//   §2 aynı token → aynı kayıt · başka gövde → 409 CLIENT_TOKEN_COLLISION
//   §3 ikinci ilk muayene → 409 (servis ön kontrolü + DB partial unique seddi)
//   §4 revize: eski supersededAt dolu, yeni rev 2, eski hatalar yerinde · gerekçe < 3 → 400
//   §5 eşzamanlı iki revize (zorlanmış sıra) → biri 409 INSPECTION_NOT_ACTIVE
//   §6 iptal: önizleme + voidedAt · ikinci iptal 409 · iptalden sonra yeni ilk muayene açılır
//   §7 kapsam: muayenesi kapalı istasyonda 400 · açık istasyonda geçer
//   §8 pasif tür KABUL · bilinmeyen tür 400 · payload tekrarı 400 · boyutsuz 400 · en yok → öneri yok
//   §9 önizleme yazmaz ve muayeneyle aynı sayıyı verir
//   §10 liste özeti = liste toplamı (aynı where, sayfalı)
//   §11 HTTP: modül kapalı 403 MODULE_DISABLED · izinsiz 403 · tablet izni (mobile:muayene) önizler
// Negatif sonda: revize claim'inden `supersededAt: null` kaldırılınca (ACTIVE_INSPECTION_WHERE yerine
// yalnız `voidedAt: null`) §5 kırmızı — ikinci revize claim'i geçer, DB seddine çarpar.
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import * as svc from "../src/services/quality-inspection.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { SIRA_ZORLANDI, sonucKodu, zorlanmisSira } from "./lib/zorlanmis-sira";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) {
    const x = e as { details?: { code?: string }; code?: string; message?: string };
    return String(x.details?.code ?? x.code ?? x.message);
  }
}

const TAG = `K4M${Date.now().toString(36).toUpperCase()}`;
const made = { items: [] as string[], rolls: [] as string[], types: [] as string[], grades: [] as string[], sets: [] as string[], stations: [] as string[], users: [] as string[] };
let parkedFactory: string[] = [];

async function fixtures(adminId: string) {
  // Başka koşumun aktif fabrika seti "tek aktif FACTORY" seddine çarpmasın: koşum boyunca park edilir.
  parkedFactory = (await prisma.fourPointRuleSet.findMany({ where: { scope: "FACTORY", isActive: true }, select: { id: true } })).map((s) => s.id);
  await prisma.fourPointRuleSet.updateMany({ where: { id: { in: parkedFactory } }, data: { isActive: false } });
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} kumaş`, itemType: "FABRIC", widthCm: 150 }, select: { id: true } });
  const bare = await prisma.item.create({ data: { code: `${TAG}-J`, name: `${TAG} ensiz kumaş`, itemType: "FABRIC" }, select: { id: true } });
  made.items.push(item.id, bare.id);
  const mkRoll = async (suffix: string, itemId: string) => {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-${suffix}`, itemId, initialQty: 100, currentQty: 100, createdById: adminId }, select: { id: true } });
    made.rolls.push(r.id);
    return r.id;
  };
  const rolls = { a: await mkRoll("A", item.id), b: await mkRoll("B", item.id), c: await mkRoll("C", item.id), d: await mkRoll("D", bare.id), e: await mkRoll("E", item.id) };
  const mkType = async (suffix: string, extra: Prisma.DefectTypeCreateInput | Record<string, unknown>) => {
    const t = await prisma.defectType.create({ data: { code: `${TAG}${suffix}`, name: `${TAG} ${suffix}`, ...extra } as Prisma.DefectTypeCreateInput, select: { id: true } });
    made.types.push(t.id);
    return t.id;
  };
  const types = { size: await mkType("S", {}), fixed: await mkType("F", { fixedPoints: 4 }), passive: await mkType("P", { isActive: false }) };
  // Kod koşuma özgü sıra numarasıyla üretilir (kalite kodu literali yazılmaz — `test_quality_code_literal`).
  const mkGrade = async (n: number) => {
    const g = await prisma.qualityGrade.create({ data: { code: `${TAG}Q${n}`, name: `${TAG} derece ${n}` }, select: { id: true, code: true } });
    made.grades.push(g.id);
    return g;
  };
  const grades = { a: await mkGrade(1), b: await mkGrade(2), c: await mkGrade(3) };
  const set = await prisma.fourPointRuleSet.create({
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
  made.sets.push(set.id);
  const mkStation = async (suffix: string, inspectionEnabled: boolean) => {
    const s = await prisma.station.create({ data: { code: `${TAG}${suffix}`, name: `${TAG} ${suffix}`, type: "INTERNAL", inspectionEnabled }, select: { id: true } });
    made.stations.push(s.id);
    return s.id;
  };
  const stations = { on: await mkStation("ON", true), off: await mkStation("OFF", false) };
  return { rolls, types, grades, setId: set.id, stations };
}
type Fx = Awaited<ReturnType<typeof fixtures>>;

async function cleanup(): Promise<void> {
  const ins = { rollId: { in: made.rolls } };
  await prisma.rollError.deleteMany({ where: { rollId: { in: made.rolls } } });
  // Revizyon zinciri ardıldan geriye silinir (supersedesId RESTRICT + revision CHECK).
  for (let i = 0; i < 20 && (await prisma.rollInspection.count({ where: ins })) > 0; i++) {
    await prisma.rollInspection.deleteMany({ where: { ...ins, supersededBy: { is: null } } });
  }
  await prisma.fourPointRuleBand.deleteMany({ where: { ruleSetId: { in: made.sets } } });
  await prisma.fourPointRuleSet.deleteMany({ where: { id: { in: made.sets } } });
  await prisma.fourPointRuleSet.updateMany({ where: { id: { in: parkedFactory } }, data: { isActive: true } });
  await prisma.roll.deleteMany({ where: { id: { in: made.rolls } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.defectType.deleteMany({ where: { id: { in: made.types } } });
  await prisma.qualityGrade.deleteMany({ where: { id: { in: made.grades } } });
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: made.users } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => undefined);
}

/** §1 altın girdi: 4+2 aynı yarda (tavan 4) · sabit 4 konumsuz · pasif tür 1 → ham 11, tavanlı 9 → 6,00 → B. */
const golden = (fx: Fx) => [
  { defectTypeId: fx.types.size, sizeClass: "OVER_9IN" as const, startMeter: "1.0" },
  { defectTypeId: fx.types.size, sizeClass: "IN_3_TO_6" as const, startMeter: "1.2" },
  { defectTypeId: fx.types.fixed, sizeClass: "UP_TO_3IN" as const, startMeter: null },
  { defectTypeId: fx.types.passive, sizeClass: "UP_TO_3IN" as const, startMeter: "50" },
];

async function sectionCreate(adminId: string, fx: Fx) {
  console.log("§1 oluştur");
  const token = randomUUID();
  const row = await svc.create({ rollId: fx.rolls.a, defects: golden(fx), clientToken: token }, adminId);
  const errs = await prisma.rollError.findMany({ where: { inspectionId: row.id }, select: { origin: true, points: true, sizeClass: true, isProcessed: true, detectedByUserId: true, startMeter: true } });
  check("4 hata satırı, hepsi origin=INSPECTION, işlenmemiş", errs.length === 4 && errs.every((e) => e.origin === "INSPECTION" && !e.isProcessed && e.detectedByUserId === adminId));
  check("sabit puanlı türde boyut NULL, puan 4", errs.some((e) => e.sizeClass === null && e.points === 4 && e.startMeter === null));
  check("tavanlı toplam 9 (ham 11), konumsuz 1", row.totalPoints === 9 && row.defectCount === 4 && row.unplacedDefectCount === 1, `${row.totalPoints}/${row.unplacedDefectCount}`);
  check("en ürün kartından 150", row.widthSource === "ITEM_CARD" && row.widthCm?.toFixed(2) === "150.00");
  check("puan/100 m² = 6,00 · gradeScore = 6,00", row.pointsPer100M2?.toFixed(2) === "6.00" && row.gradeScore?.toFixed(2) === "6.00");
  check("öneri B bandı → GB derecesi", row.suggestedQualityGradeId === fx.grades.b.id && row.suggestedGradeCode === fx.grades.b.code);
  check("top kalitesi boş + öneri var → uyumsuz", row.gradeMismatch === true);
  check("aşama topun durumundan RAW, rev 1", row.phase === "RAW" && row.revision === 1);
  const full = await prisma.rollInspection.findUniqueOrThrow({ where: { id: row.id }, select: { ruleSnapshot: true, ruleSetId: true } });
  const snap = full.ruleSnapshot as { ruleSetId: string; unit: string; runningCap: string; bands: Array<{ maxScore: string | null; qualityGradeId: string }> };
  check("snapshot: kimlik + sayı (3 bant, birim, tavan)", snap.ruleSetId === fx.setId && snap.unit === "M2" && snap.runningCap === "YARD" && snap.bands.length === 3 && snap.bands[0]!.maxScore === "5.00");
  check("snapshot derece ADI taşımaz", !JSON.stringify(snap).includes(`${TAG} derece`));
  const audit = await prisma.systemLog.findFirst({ where: { tableName: "ROLL_INSPECTION", recordId: row.id, action: "CREATE" }, select: { newData: true } });
  const nd = audit?.newData as Record<string, unknown> | undefined;
  check("audit CREATE: sayılar var, hata dizisi yok", nd?.defectCount === 4 && !("defects" in (nd ?? {})));
  return { id: row.id, token };
}

async function sectionReplay(adminId: string, fx: Fx, first: { id: string; token: string }) {
  console.log("§2 token replay");
  const again = await svc.create({ rollId: fx.rolls.a, defects: golden(fx), clientToken: first.token }, adminId);
  check("aynı token → aynı kayıt", again.id === first.id);
  check("başka top + aynı token → 409 CLIENT_TOKEN_COLLISION", (await errCode(svc.create({ rollId: fx.rolls.b, defects: [], clientToken: first.token }, adminId))) === "CLIENT_TOKEN_COLLISION");
}

async function sectionSecond(adminId: string, fx: Fx) {
  console.log("§3 ikinci ilk muayene");
  check("servis: ikinci ilk muayene → 409 INSPECTION_ALREADY_ACTIVE", (await errCode(svc.create({ rollId: fx.rolls.a, defects: [] }, adminId))) === "INSPECTION_ALREADY_ACTIVE");
  // Ön kontrolü atlayan eşzamanlı ikinci yazar: DB partial unique seddi aynı 409'u verir.
  const roll = await prisma.roll.findUniqueOrThrow({ where: { id: fx.rolls.a }, select: svc.INSPECTION_ROLL_SELECT });
  const code = await errCode(prisma.$transaction((tx) => svc.createInspectionTx(tx, { roll, defects: [], userId: adminId })));
  check("DB seddi (ön kontrolsüz yazar) → 409 INSPECTION_ALREADY_ACTIVE", code === "INSPECTION_ALREADY_ACTIVE", code);
}

async function sectionRevise(adminId: string, fx: Fx, firstId: string) {
  console.log("§4 revize");
  check("gerekçe < 3 → 400", (await errCode(svc.revise(firstId, { defects: [], reviseReason: "ab" }, adminId))) === "REASON_REQUIRED");
  const rev = await svc.revise(firstId, { defects: [{ defectTypeId: fx.types.size, sizeClass: "UP_TO_3IN", startMeter: "3" }], manualWidthCm: 160, reviseReason: "yanlış sayım" }, adminId);
  const old = await prisma.rollInspection.findUniqueOrThrow({ where: { id: firstId }, select: { supersededAt: true, supersededById: true, _count: { select: { rollErrors: true } } } });
  check("eski supersededAt dolu, damgalayan kullanıcı", old.supersededAt !== null && old.supersededById === adminId);
  check("yeni revizyon 2, supersedesId eski", rev.revision === 2 && rev.supersedesId === firstId);
  check("eski hatalar yerinde (4)", old._count.rollErrors === 4);
  check("yeni hatalar yeni revizyona bağlı (1), en MANUAL 160", (await prisma.rollError.count({ where: { inspectionId: rev.id } })) === 1 && rev.widthSource === "MANUAL" && rev.widthCm?.toFixed(2) === "160.00");
  check("revize edilmiş muayene yeniden revize edilemez → 409", (await errCode(svc.revise(firstId, { defects: [], reviseReason: "tekrar" }, adminId))) === "INSPECTION_NOT_ACTIVE");
  return rev.id;
}

async function sectionRace(adminId: string, revId: string) {
  console.log("§5 eşzamanlı iki revize (zorlanmış sıra)");
  const { sonuclar, kapi } = await zorlanmisSira(
    { model: "rollInspection", metod: "updateMany" },
    () => svc.revise(revId, { defects: [], reviseReason: "B düzeltmesi" }, adminId),
    () => svc.revise(revId, { defects: [], reviseReason: "A düzeltmesi" }, adminId),
  );
  check("sıra zorlandı", SIRA_ZORLANDI.has(kapi), kapi);
  const [b, a] = sonuclar;
  check("A kazandı", sonucKodu(a) === "ok", sonucKodu(a));
  check("B → 409 INSPECTION_NOT_ACTIVE", sonucKodu(b) === "INSPECTION_NOT_ACTIVE", sonucKodu(b));
  const succ = await prisma.rollInspection.count({ where: { supersedesId: revId } });
  check("tek ardıl revizyon", succ === 1);
}

async function sectionVoid(adminId: string, fx: Fx) {
  console.log("§6 iptal");
  const row = await svc.create({ rollId: fx.rolls.b, defects: [{ defectTypeId: fx.types.fixed, startMeter: "4" }] }, adminId);
  const pv = await svc.voidPreview(row.id);
  check("önizleme: künye + hata sayısı + boş belge listesi", pv.inspection.id === row.id && pv.defectCount === 1 && pv.printedDocuments.length === 0 && pv.active);
  check("gerekçe < 3 → 400", (await errCode(svc.voidInspection(row.id, "x", adminId))) === "REASON_REQUIRED");
  await svc.voidInspection(row.id, "yanlış top", adminId);
  const v = await prisma.rollInspection.findUniqueOrThrow({ where: { id: row.id }, select: { voidedAt: true, voidReason: true, _count: { select: { rollErrors: true } } } });
  check("voidedAt + gerekçe, hatalar yerinde", v.voidedAt !== null && v.voidReason === "yanlış top" && v._count.rollErrors === 1);
  check("ikinci iptal → 409", (await errCode(svc.voidInspection(row.id, "tekrar", adminId))) === "INSPECTION_NOT_ACTIVE");
  check("iptal edilmiş muayene revize edilemez → 409", (await errCode(svc.revise(row.id, { defects: [], reviseReason: "deneme" }, adminId))) === "INSPECTION_NOT_ACTIVE");
  const fresh = await svc.create({ rollId: fx.rolls.b, defects: [] }, adminId);
  check("iptalden sonra yeni ilk muayene açılır", fresh.revision === 1 && fresh.id !== row.id);
}

async function sectionScope(adminId: string, fx: Fx) {
  console.log("§7 kapsam (istasyon yeteneği)");
  check("muayenesi kapalı istasyonda → 400 INSPECTION_STATION_NOT_CAPABLE",
    (await errCode(svc.create({ rollId: fx.rolls.c, defects: [], stationId: fx.stations.off }, adminId))) === "INSPECTION_STATION_NOT_CAPABLE");
  check("önizleme de aynı kapıdan geçer", (await errCode(svc.preview({ rollId: fx.rolls.c, defects: [], stationId: fx.stations.off }))) === "INSPECTION_STATION_NOT_CAPABLE");
  check("kapalı istasyon denemesi satır yazmadı", (await prisma.rollInspection.count({ where: { rollId: fx.rolls.c } })) === 0);
  const ok = await svc.create({ rollId: fx.rolls.c, defects: [], stationId: fx.stations.on }, adminId);
  check("muayenesi açık istasyonda yazılır (istasyon veri olarak)", ok.id.length > 0 && (await prisma.rollInspection.findUniqueOrThrow({ where: { id: ok.id } })).stationId === fx.stations.on);
}

async function sectionValidation(adminId: string, fx: Fx) {
  console.log("§8 doğrulama");
  check("bilinmeyen tür → 400 UNKNOWN_DEFECT_TYPE", (await errCode(svc.create({ rollId: fx.rolls.e, defects: [{ defectTypeId: randomUUID(), sizeClass: "UP_TO_3IN" }] }, adminId))) === "UNKNOWN_DEFECT_TYPE");
  check("payload içi (metre, tür) tekrarı → 400", (await errCode(svc.create({ rollId: fx.rolls.e, defects: [
    { defectTypeId: fx.types.size, sizeClass: "UP_TO_3IN", startMeter: "7" }, { defectTypeId: fx.types.size, sizeClass: "OVER_9IN", startMeter: "7.000" },
  ] }, adminId))) === "DUPLICATE_DEFECT_IN_PAYLOAD");
  check("boyutsuz (sabit puansız) → 400 DEFECT_SIZE_REQUIRED", (await errCode(svc.create({ rollId: fx.rolls.e, defects: [{ defectTypeId: fx.types.size, startMeter: "2" }] }, adminId))) === "DEFECT_SIZE_REQUIRED");
  check("hatalı denemeler satır yazmadı", (await prisma.rollInspection.count({ where: { rollId: fx.rolls.e } })) === 0);
  const nw = await svc.create({ rollId: fx.rolls.d, defects: [{ defectTypeId: fx.types.passive, sizeClass: "OVER_9IN", startMeter: "1" }] }, adminId);
  check("en bilinmiyor → UNKNOWN, skor ve öneri yok, uyumsuz değil", nw.widthSource === "UNKNOWN" && nw.widthCm === null && nw.pointsPer100M2 === null && nw.suggestedGradeCode === null && !nw.gradeMismatch);
}

async function sectionPreview(adminId: string, fx: Fx) {
  console.log("§9 önizleme yazmaz");
  const before = [await prisma.rollInspection.count(), await prisma.rollError.count()];
  const pv = await svc.preview({ rollId: fx.rolls.e, defects: golden(fx) });
  const after = [await prisma.rollInspection.count(), await prisma.rollError.count()];
  check("satır sayıları aynı", before[0] === after[0] && before[1] === after[1]);
  check("önizleme = muayene sayıları (ham 11, tavanlı 9, 6,00, B/GB)", pv.totalPoints === 11 && pv.cappedPoints === 9 && pv.pointsPer100M2?.toFixed(2) === "6.00" && pv.suggested?.label === "B" && pv.suggested.code === fx.grades.b.code);
  const real = await svc.create({ rollId: fx.rolls.e, defects: golden(fx) }, adminId);
  check("aynı girdiyle yazılan muayene önizlemeyle eşit", real.totalPoints === pv.cappedPoints && real.pointsPer100M2?.equals(pv.pointsPer100M2!) === true && real.suggestedGradeCode === pv.suggested?.code);
}

async function sectionList(fx: Fx) {
  console.log("§10 liste + özet");
  for (const history of ["0", "1"]) {
    const base = { rollId: made.rolls.join(","), includeHistory: history };
    let cursor: string | undefined;
    let seen = 0;
    let summary: Awaited<ReturnType<typeof svc.listInspections>>["summary"] | null = null;
    for (let i = 0; i < 50; i++) {
      const page = await svc.listInspections({ ...base, limit: 2, cursor });
      summary ??= page.summary;
      seen += page.items.length;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const direct = await prisma.rollInspection.count({ where: { rollId: { in: made.rolls }, ...(history === "1" ? {} : { supersededAt: null, voidedAt: null }) } });
    check(`özet toplamı = sayfalı liste toplamı (tarihçe=${history})`, summary?.total === seen && seen === direct, `${summary?.total} = ${seen} = ${direct}`);
  }
  const mm = await svc.listInspections({ rollId: made.rolls.join(","), mismatch: "1" });
  check("uyumsuz süzgeci özetle tutarlı", mm.summary.total === mm.items.length && mm.items.every((i) => i.gradeMismatch));
  const wu = await svc.listInspections({ rollId: made.rolls.join(","), widthUnknown: "1" });
  check("en bilinmiyor süzgeci", wu.items.length === 1 && wu.items[0]!.widthSource === "UNKNOWN");
  const all = await svc.listInspections({ rollId: made.rolls.join(",") });
  check("özet şeridi 'en yok' = en bilinmiyor süzgecinin toplamı (aynı where)", all.summary.widthUnknown === wu.summary.total, `${all.summary.widthUnknown} = ${wu.summary.total}`);
  const noBatch = await svc.listInspections({ rollId: made.rolls.join(","), batchId: "00000000-0000-4000-8000-000000000000" });
  check("parti süzgeci sunucuda (başka parti → boş)", noBatch.items.length === 0 && noBatch.summary.total === 0);
  check("biçimsiz parti kimliği → 400", (await errCode(svc.listInspections({ batchId: "x" }))) === "INSPECTION_FILTER_INVALID");
  check("biçimsiz kimlik → 400", (await errCode(svc.listInspections({ rollId: "x" }))) === "INSPECTION_FILTER_INVALID");
  check("tanınmayan aşama → 400", (await errCode(svc.listInspections({ phase: "MID" }))) === "INSPECTION_FILTER_INVALID");
  const det = await svc.getInspection((await prisma.rollInspection.findFirstOrThrow({ where: { rollId: fx.rolls.a, revision: 2 } })).id);
  check("detay: revizyon geçmişi + hesap dökümü", det.history.length >= 2 && det.breakdown.cappedPoints === det.totalPoints && det.rollErrors.length === 1);
}

async function sectionHttp(admin: { id: string; username: string; password: string }, fx: Fx) {
  console.log("§11 HTTP kapıları");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = async (username: string, password: string, clientType = "electron") => {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, clientType }) });
      return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
    };
    const call = async (method: string, path: string, token: string, body?: unknown) => {
      const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { details?: { code?: string } };
      return { status: r.status, code: j.details?.code };
    };
    const adminToken = await login(admin.username, admin.password);
    check("admin login", adminToken.length > 0);
    const bcrypt = await import("bcryptjs");
    const parola = kosumaOzguParola();
    const mk = async (suffix: string, perms: string[], clientType = "electron") => {
      const ps = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), passwordHash: await bcrypt.hash(parola, 10), fullName: `${TAG} ${suffix}`, isActive: true, permissions: { create: ps.map((p) => ({ permissionId: p.id, grantedById: admin.id })) } },
        select: { id: true, username: true },
      });
      made.users.push(u.id);
      return login(u.username, parola, clientType);
    };
    const readerToken = await mk("okur", ["inspection:read"]);
    const noneToken = await mk("yok", ["roll:read"]);
    const tabletToken = await mk("tablet", ["mobile:kk1", "mobile:muayene"], "mobile");

    await prisma.systemSetting.upsert({ where: { key: "kaliteGuvence.enabled" }, update: { value: false }, create: { key: "kaliteGuvence.enabled", value: false } });
    for (const [m, p] of [["GET", "/api/quality-inspections"], ["POST", "/api/quality-inspections/preview"], ["GET", "/api/four-point-rules"]] as const) {
      const r = await call(m, p, adminToken, m === "POST" ? { rollId: fx.rolls.e, defects: [] } : undefined);
      check(`modül kapalı ${m} ${p} → 403 MODULE_DISABLED`, r.status === 403 && r.code === "MODULE_DISABLED", `${r.status} ${r.code}`);
    }
    await prisma.systemSetting.update({ where: { key: "kaliteGuvence.enabled" }, data: { value: true } });
    check("modül açık + admin liste 200", (await call("GET", "/api/quality-inspections", adminToken)).status === 200);
    check("inspection:read liste 200", (await call("GET", "/api/quality-inspections", readerToken)).status === 200);
    check("inspection:read ile yazma 403", (await call("POST", "/api/quality-inspections", readerToken, { rollId: fx.rolls.e, defects: [] })).status === 403);
    check("inspection:read ile iptal 403", (await call("POST", `/api/quality-inspections/${randomUUID()}/void`, readerToken, { reason: "deneme" })).status === 403);
    check("inspection:read ile kural yazma 403", (await call("POST", "/api/four-point-rules", readerToken, {})).status === 403);
    check("izinsiz liste 403", (await call("GET", "/api/quality-inspections", noneToken)).status === 403);
    check("izinsiz önizleme 403", (await call("POST", "/api/quality-inspections/preview", noneToken, { rollId: fx.rolls.e, defects: [] })).status === 403);
    const tp = await call("POST", "/api/quality-inspections/preview", tabletToken, { rollId: fx.rolls.e, defects: [] });
    check("tablet (mobile:muayene) önizleme 200", tp.status === 200, `${tp.status} ${tp.code}`);
    check("tablet liste okuyamaz 403", (await call("GET", "/api/quality-inspections", tabletToken)).status === 403);
    const strict = await call("POST", "/api/quality-inspections/preview", adminToken, { rollId: fx.rolls.e, defects: [], bogus: 1 });
    check("strict gövde: tanınmayan alan → 400", strict.status === 400, `${strict.status}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function main(): Promise<void> {
  console.log("=== K4P muayene motoru bekçisi ===\n");
  const flagPrior = await prisma.systemSetting.findUnique({ where: { key: "kaliteGuvence.enabled" }, select: { value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  try {
    const fx = await fixtures(admin.id);
    const first = await sectionCreate(admin.id, fx);
    await sectionReplay(admin.id, fx, first);
    await sectionSecond(admin.id, fx);
    const revId = await sectionRevise(admin.id, fx, first.id);
    await sectionRace(admin.id, revId);
    await sectionVoid(admin.id, fx);
    await sectionScope(admin.id, fx);
    await sectionValidation(admin.id, fx);
    await sectionPreview(admin.id, fx);
    await sectionList(fx);
    await sectionHttp(admin, fx);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    if (flagPrior) await prisma.systemSetting.update({ where: { key: "kaliteGuvence.enabled" }, data: { value: flagPrior.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: "kaliteGuvence.enabled" } });
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

void main();
