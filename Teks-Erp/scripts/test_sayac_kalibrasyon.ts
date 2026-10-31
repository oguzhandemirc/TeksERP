// =============================================================================
// BEKÇİ — Sayaç kalibrasyon kaydı + `tambur.kalibrasyonKontrolu` (D4-B5k; B-3 kullanıcı kararı 2026-10-31)
// =============================================================================
// SORU: kalibrasyon kaydı İSTEĞE BAĞLI mı (varsayılan KAPALI = bugünkü yanıt bayt-aynı), UYAR'da süresi
// geçmiş sayaçla ölçüm `warnings` notu alıp YİNE kaydediliyor mu (kaynak MACHINE), tarihsiz sayaç sessiz mi?
// §1 ayar DÖRT KAPI (tip/varsayılan + Zod + servis sanitize + kapsam/paket) · §2 vade karşılaştırması (saf)
// §3 cihaz kartı alan doğrulaması (saf) · §4 meterCalibrationWarnings DB · §5 uçtan uca TamburController.cutOpenFabric
// §6 yedi ölçüm ucunun hepsi uyarıyı ekliyor (kaynak taraması)
// Global durum yazar (SystemSetting): `hedefDbEngeli()` ilk adım; ayar satırı birebir geri yüklenir.
// NEGATİF SONDA: `isCalibrationExpired` karşılaştırması ters çevrilince (`<`) §2 ve §4/§5 kırmızı.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import type { Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { FLAG_KEY_SCOPE } from "../src/constants/settings-scopes";
import { factoryDayStartOfKey, factoryYmd } from "../src/constants/time";
import { isCalibrationExpired, meterCalibrationWarnings, withResponseWarnings } from "../src/services/helpers/meter-calibration.helper";
import { assertMeterCalibrationFields } from "../src/services/helpers/peripheral-counter.helper";
import { TamburController } from "../src/controllers/tambur.controller";
import { HIZMET_AYAR_PAKETI } from "./hizmet-ayar-paketi";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const FIELD = "tamburCalibrationCheck";
const KEY = SETTING_KEYS.TAMBUR_CALIBRATION_CHECK;
const DAY = 24 * 3600 * 1000;
const rnd = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
let saved: { value: Prisma.JsonValue; description: string | null } | null = null;
const created = { peripherals: [] as string[], rolls: [] as string[], steps: [] as string[], wos: [] as string[], item: null as string | null, station: null as string | null, grade: null as string | null };

async function setMode(key: string, v: "KAPALI" | "UYAR" | null): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } });
  if (v) await prisma.systemSetting.create({ data: { key, value: v } });
  invalidateFeatureFlagsCache();
}

function statusOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
  }
}

async function section1(actor: string): Promise<void> {
  check("§1a anahtar adı tasarımla aynı", KEY === "tambur.kalibrasyonKontrolu", KEY);
  await setMode(KEY, null);
  const def = ((await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>)[FIELD];
  check("§1b ⭐ kayıt yokken KAPALI (bugünkü davranış)", def === "KAPALI", String(def));
  const bad = updateSchema.safeParse({ [FIELD]: "ACIK" });
  check("§1c ⭐ Zod: bilinmeyen değer reddedilir + Türkçe mesaj", !bad.success && /KAPALI ya da UYAR/.test(bad.error.issues.map((i) => i.message).join("|")));
  check("§1d Zod: KAPALI/UYAR kabul", updateSchema.safeParse({ [FIELD]: "KAPALI" }).success && updateSchema.safeParse({ [FIELD]: "UYAR" }).success);
  let status: number | null = null;
  try {
    await systemSettingService.setFeatureFlags({ [FIELD]: "ACIK" } as never, actor);
  } catch (e) {
    status = (e as { statusCode?: number }).statusCode ?? -1;
  }
  check("§1e ⭐ servis sanitize: bilinmeyen değer 400", status === 400, String(status));
  await systemSettingService.setFeatureFlags({ [FIELD]: "UYAR" } as never, actor);
  invalidateFeatureFlagsCache();
  const on = ((await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>)[FIELD];
  check("§1f yaz UYAR → oku UYAR", on === "UYAR", String(on));
  check("§1g dar ayar kapsamında", FLAG_KEY_SCOPE.has(FIELD), String(FLAG_KEY_SCOPE.get(FIELD)));
  const row = HIZMET_AYAR_PAKETI.find((r) => r.alan === FIELD);
  check("§1h hizmet ayar paketi: Gülkesim KAPALI (açık beyan)", row?.anahtar === KEY && row?.hedef === "KAPALI", JSON.stringify(row ?? null));
}

function section2(): void {
  const now = new Date();
  const today = factoryDayStartOfKey(factoryYmd(now));
  check("§2a vadesiz → geçmemiş", !isCalibrationExpired(null, now) && !isCalibrationExpired(undefined, now));
  check("§2b ⭐ vade dün → geçmiş", isCalibrationExpired(new Date(today.getTime() - DAY), now));
  check("§2c vade bugün (gün dahil geçerli) → geçmemiş", !isCalibrationExpired(today, now));
  check("§2d ⭐ vade yarın → geçmemiş", !isCalibrationExpired(new Date(today.getTime() + DAY), now));
}

function section3(): void {
  const d1: Record<string, unknown> = { calibratedAt: "2026-01-10", calibrationDueAt: "2027-01-10", calibrationNote: "  TSE  " };
  assertMeterCalibrationFields(d1, "METER");
  check("§3a METER: YYYY-AA-GG → fabrika günü başı; not kırpılır",
    d1.calibratedAt instanceof Date && factoryYmd(d1.calibratedAt as Date) === "2026-01-10" && d1.calibrationNote === "TSE");
  const d2: Record<string, unknown> = { calibratedAt: "", calibrationDueAt: null, calibrationNote: "" };
  assertMeterCalibrationFields(d2, "METER");
  check("§3b boş → null (kayıt isteğe bağlı)", d2.calibratedAt === null && d2.calibrationDueAt === null && d2.calibrationNote === null);
  check("§3c METER olmayan cihazda dolu alan 400", statusOf(() => assertMeterCalibrationFields({ calibrationDueAt: "2027-01-01" }, "SCALE")) === "CALIBRATION_FIELDS_METER_ONLY");
  check("§3d vade < kalibrasyon 400", statusOf(() => assertMeterCalibrationFields({ calibratedAt: "2026-05-01", calibrationDueAt: "2026-04-01" }, "METER")) === "CALIBRATION_DUE_BEFORE_DATE");
  check("§3e PATCH: gönderilmeyen taraf mevcut kayıttan (vade < mevcut kalibrasyon) 400",
    statusOf(() => assertMeterCalibrationFields({ calibrationDueAt: "2026-04-01" }, "METER", { calibratedAt: new Date("2026-05-01T00:00:00Z"), calibrationDueAt: null })) === "CALIBRATION_DUE_BEFORE_DATE");
  check("§3f bozuk tarih 400", statusOf(() => assertMeterCalibrationFields({ calibratedAt: "dün" }, "METER")) === "INVALID_CALIBRATION_DATE");
  check("§3g 200 karakteri aşan not 400", statusOf(() => assertMeterCalibrationFields({ calibrationNote: "x".repeat(201) }, "METER")) === "INVALID_CALIBRATION_NOTE");
  const d3: Record<string, unknown> = { kind: "SCALE" };
  assertMeterCalibrationFields(d3, "SCALE");
  check("§3h tür METER'den çıkınca alanlar temizlenir", d3.calibratedAt === null && d3.calibrationDueAt === null && d3.calibrationNote === null);
}

async function meter(dueAt: Date | null): Promise<{ id: string; code: string }> {
  const code = `TEST-KAL-${rnd()}`;
  const p = await prisma.peripheralDevice.create({
    data: { code, name: `TEST-KAL Sayaç ${code}`, kind: "METER", connectionType: "BLUETOOTH_SPP", calibratedAt: dueAt ? new Date(dueAt.getTime() - 300 * DAY) : null, calibrationDueAt: dueAt },
    select: { id: true, code: true },
  });
  created.peripherals.push(p.id);
  return p;
}

async function section4(): Promise<{ expired: { id: string; code: string }; undated: { id: string } }> {
  const today = factoryDayStartOfKey(factoryYmd(new Date()));
  const expired = await meter(new Date(today.getTime() - DAY));
  const valid = await meter(new Date(today.getTime() + 30 * DAY));
  const undated = await meter(null);
  await setMode(KEY, "KAPALI");
  const off = await meterCalibrationWarnings([{ source: "MACHINE", peripheralId: expired.id }]);
  const r = { success: true, data: { a: 1 } };
  check("§4a ⭐ KAPALI → uyarı yok ve yanıt AYNI nesne (bayt-aynı)", off.length === 0 && withResponseWarnings(r, off) === r && JSON.stringify(withResponseWarnings(r, off)) === JSON.stringify(r));
  await setMode(KEY, "UYAR");
  const on = await meterCalibrationWarnings([{ source: "MACHINE", peripheralId: expired.id }, { source: "MACHINE", peripheralId: valid.id }]);
  check("§4b ⭐ UYAR + süresi geçmiş → tek uyarı (cihaz kodu metinde)", on.length === 1 && on[0].includes(expired.code), JSON.stringify(on));
  check("§4c tarih girilmemiş sayaçta uyarı yok", (await meterCalibrationWarnings([{ source: "MACHINE", peripheralId: undated.id }])).length === 0);
  check("§4d elle (OPERATOR) ölçümde sayaç sorulmaz", (await meterCalibrationWarnings([{ source: "OPERATOR", peripheralId: expired.id }])).length === 0);
  check("§4e cihazsız / measure'sız ölçümde uyarı yok", (await meterCalibrationWarnings([null, undefined, { source: "MACHINE" }])).length === 0);
  const merged = withResponseWarnings({ success: true, data: null, warnings: ["önceki"] }, on) as { warnings: string[] };
  check("§4f önceki warnings korunur, not sona eklenir", merged.warnings.length === 2 && merged.warnings[0] === "önceki");
  return { expired, undated };
}

async function cutViaController(rollId: string, measure: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = { status: 0, body: {} as Record<string, unknown> };
  const res = { status(c: number) { out.status = c; return this; }, json(b: unknown) { out.body = JSON.parse(JSON.stringify(b)); return this; } } as unknown as Response;
  let err: unknown = null;
  const req = { params: { id: rollId }, body: { lengthMeters: 10, status: "WAREHOUSE", measure } } as unknown as Request;
  await new TamburController().cutOpenFabric(req, res, (e?: unknown) => { err = e; });
  if (err) throw err;
  return out;
}

async function section5(meters: { expired: { id: string }; undated: { id: string } }): Promise<void> {
  const grade = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  let gradeCode = grade?.code;
  if (!gradeCode) {
    const g = await prisma.qualityGrade.create({ data: { code: `TEST-KAL-K1-${rnd()}`, name: `TEST-KAL K1 ${rnd()}`, role: "FIRST", targetStatus: RollStatus.WAREHOUSE }, select: { id: true, code: true } });
    created.grade = g.id;
    gradeCode = g.code;
  }
  const item = await prisma.item.create({ data: { code: `TEST-KAL-${rnd()}`, name: `TEST-KAL Kumaş ${rnd()}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  created.item = item.id;
  let station = await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR, isActive: true }, select: { id: true } });
  if (!station) {
    station = await prisma.station.create({ data: { code: `TEST-KAL-TMB-${rnd()}`, name: "TEST-KAL Tambur", type: StationType.INTERNAL, kind: StationKind.TAMBUR }, select: { id: true } });
    created.station = station.id;
  }
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `TEST-KAL-WO-${rnd()}`, status: "IN_PROGRESS" }, select: { id: true } });
  created.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
  created.steps.push(step.id);
  const roll = await prisma.roll.create({
    data: { barcode: null, itemId: item.id, colorId: null, width: 150, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, qualityGrade: gradeCode, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, currentStepId: step.id },
    select: { id: true },
  });
  created.rolls.push(roll.id);

  const shape = (b: Record<string, unknown>) => Object.keys(b).sort().join(",");
  await setMode(KEY, "KAPALI");
  const off = await cutViaController(roll.id, { source: "MACHINE", peripheralId: meters.expired.id });
  await setMode(KEY, null);
  const none = await cutViaController(roll.id, { source: "MACHINE", peripheralId: meters.expired.id });
  await setMode(KEY, "UYAR");
  const on = await cutViaController(roll.id, { source: "MACHINE", peripheralId: meters.expired.id });
  const undated = await cutViaController(roll.id, { source: "MACHINE", peripheralId: meters.undated.id });
  for (const r of [off, none, on, undated]) created.rolls.push(((r.body.data as { childRoll: { id: string } }).childRoll).id);
  check("§5a ⭐ KAPALI / satır yok → yanıtta warnings YOK, şekil aynı", off.status === 201 && !("warnings" in off.body) && shape(off.body) === shape(none.body), shape(off.body));
  const w = (on.body.warnings ?? []) as string[];
  check("§5b ⭐ UYAR + süresi geçmiş → 201 + warnings'te kalibrasyon notu", on.status === 201 && w.length === 1 && /kalibrasyon süresi/.test(w[0]), JSON.stringify(w));
  const kid = (on.body.data as { childRoll: { id: string } }).childRoll.id;
  const reading = await prisma.rollMeterReading.findFirst({ where: { rollId: kid, phase: "CUT" }, select: { source: true, peripheralId: true } });
  check("§5c ⭐ ölçüm ENGELLENMEDİ: CUT okuması yazıldı, kaynak MACHINE kaldı", reading?.source === "MACHINE" && reading.peripheralId === meters.expired.id, JSON.stringify(reading));
  check("§5d UYAR + tarih girilmemiş sayaç → warnings yok", undated.status === 201 && !("warnings" in undated.body));
}

function section6(): void {
  const src = (f: string) => readFileSync(join(__dirname, "..", "src", "controllers", f), "utf8");
  const n = (t: string) => (t.match(/withResponseWarnings\(result, await meterCalibrationWarnings\(/g) ?? []).length;
  const counts = { tambur: n(src("tambur.controller.ts")), manual: n(src("tambur-manual.controller.ts")), kursun: n(src("kursun-qc.controller.ts")) };
  check("§6 ⭐ yedi ölçüm ucu uyarıyı ekler (Tambur finalize/cut/cut-warehouse · manuel top/üretim · kurşun QC2/okuma)",
    counts.tambur === 3 && counts.manual === 2 && counts.kursun === 2, JSON.stringify(counts));
}

async function cleanup(): Promise<void> {
  const ce = (e: unknown) => console.error("temizlik hatası:", (e as Error).message);
  if (created.rolls.length) {
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(ce);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: created.rolls } } }).catch(ce);
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(ce);
    await prisma.warehouseMovement.deleteMany({ where: { OR: [{ rollId: { in: created.rolls } }, { rollVariance: { rollId: { in: created.rolls } } }] } }).catch(ce);
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(ce);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(ce);
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(ce);
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls }, parentRollId: { not: null } } }).catch(ce);
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } }).catch(ce);
  }
  if (created.steps.length) {
    await prisma.rollOperation.deleteMany({ where: { workOrderStepId: { in: created.steps } } }).catch(ce);
    await prisma.workOrderStep.deleteMany({ where: { id: { in: created.steps } } }).catch(ce);
  }
  if (created.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } }).catch(ce);
  if (created.item) await prisma.item.deleteMany({ where: { id: created.item } }).catch(ce);
  if (created.station) await prisma.station.deleteMany({ where: { id: created.station } }).catch(ce);
  if (created.grade) await prisma.qualityGrade.deleteMany({ where: { id: created.grade } }).catch(ce);
  if (created.peripherals.length) await prisma.peripheralDevice.deleteMany({ where: { id: { in: created.peripherals } } }).catch(ce);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  saved = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true, description: true } });
  await section1(await testActorId());
  section2();
  section3();
  const meters = await section4();
  await section5(meters);
  section6();
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    try {
      await cleanup();
      if (saved) await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: saved.value as never, description: saved.description }, update: { value: saved.value as never, description: saved.description } });
      else await prisma.systemSetting.deleteMany({ where: { key: KEY } });
      invalidateFeatureFlagsCache();
    } catch (e) {
      console.error("geri yükleme hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
