// =============================================================================
// GÖLGE MOD bekçisi — künye yazma yüzeyi + OFF→SHADOW→LIVE durum makinesi (B3)
// =============================================================================
// Koşum: npx tsx scripts/test_machine_shadow_mode.ts   (DB'li; TEST- fikstürü)
//
// Ölçer (DOKUMA-TEZGAH §2.3, §9 S1–S6; ölçülemeyenler ⏭ BEYANLI — `TEKSERP_STRICT=1` kırmızı):
//   §0 statik — künye Zod şeması `.strict()` ve `monitoringState`/damga alanı YOK (gövdeden yazılamaz);
//      router `requireDokumaEnabled` + `loom:spec-manage`; go-live `SIGNAL_NOT_ACCEPTED` mesajı "Faz 2"
//   §1 künye upsert: allowlist alanları yazılır, `monitoringState` girdisi 400/etkisiz; bakiye tarihsiz olamaz;
//      pasif makine 400
//   §2 OFF→SHADOW claim (ikinci 409 SPEC_NOT_OFF); OFF'tan go-live 409 SPEC_NOT_SHADOW
//   S2 ⭐ 14 mühürlü gölge karne → 409 SHADOW_TOO_SHORT "14/15"; 15 → sinyal kapısına düşer
//   S3' ⭐ sinyal kapısı FAIL-CLOSED: 15 karneyle go-live 409 SIGNAL_NOT_ACCEPTED (mesaj "Faz 2"), künye
//      SHADOW kalır, `acceptedAt` NULL — LIVE bugün erişilemez (beyanlı kapı)
//   §5 demote: LIVE olmayan künyede 409 SPEC_NOT_LIVE; gerekçe < 3 → 400. LIVE üretilemediği için
//      "LIVE→SHADOW sebepli, acceptedAt kalır" ayağı fikstürle (doğrudan LIVE yazılır — üretim yolu değil)
//   §6 guard: `baselineRunHours` dolu künye makine silmeyi 409 ile durdurur (`machineSpecBaselineCount`)
//   S1 (OFF ingest 403) · S3 (eksik sinyal listesi) · S5 (anomali) · S6 (kanal değişikliği) — ⏭ ÖLÇÜLEMEDİ
//
// NEGATİF SONDALAR (kırmızı görülerek, 2026-09-14):
//   · `goLive`den sinyal kapısı düşürülünce S3' ❌ (LIVE'a geçti) · `SHADOW_MIN_SHIFTS` 15→14 yapılınca S2 ❌
//   · upsert allowlist'e `monitoringState` eklenince §1c ❌ · guard `baselineRunHours: { not: null }` düşürülünce §6b ❌
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { demoteToShadow, goLive, measureGoLiveGates, startShadow, upsertMachineSpec } from "../src/services/machine-spec.service";
import { machineHardRemove } from "../src/services/helpers/guarded-hard-remove";
import { SHADOW_MIN_SHIFTS } from "../src/constants/loom-shift";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "yok");
const atlama = atlamaDefteri((m) => { fail++; console.error(`❌ ${m}`); });

const ek = Date.now().toString(36);
const ids = { station: "", machine: "", machineOff: "", machineBase: "", def: "", shifts: [] as string[], stats: [] as string[] };

async function main(): Promise<void> {
  console.log("\n=== Gölge mod — künye allowlist, OFF→SHADOW→LIVE kapıları, demote, bakiye guard'ı ===\n");
  const KOK = join(__dirname, "..");
  const route = readFileSync(join(KOK, "src/routes/machine-spec.routes.ts"), "utf8");
  const svc = readFileSync(join(KOK, "src/services/machine-spec.service.ts"), "utf8");
  check("§0a künye şeması `.strict()` ve `monitoringState`/`acceptedAt`/`demotedAt` anahtarı YOK", /upsertSchema[\s\S]*?\.strict\(\)/.test(route) && !/^\s*(monitoringState|acceptedAt|demotedAt)\s*:/m.test(route.slice(route.indexOf("upsertSchema"), route.indexOf(".strict()"))));
  check("§0b router `verifyToken → requireDokumaEnabled` + her uçta `loom:spec-manage`", /router\.use\(verifyToken,\s*requireDokumaEnabled\)/.test(route) && /const guard = requirePermission\("loom:spec-manage"\)/.test(route) && (route.match(/router\.(get|put|post)\("[^"]+",\s*guard,/g) ?? []).length === 5);
  check("§0c go-live sinyal kapısı 'Faz 2' beyanı taşır (çıkışsız değil, beyanlı kapı)", /SIGNAL_NOT_ACCEPTED/.test(svc) && /Faz 2/.test(svc));
  check("§0d SHADOW_MIN_SHIFTS = 15 (tasarım) ve şerhi bayrağa taşınmayı söylüyor", SHADOW_MIN_SHIFTS === 15 && /DAVRANIŞ BAYRAĞINA/.test(readFileSync(join(KOK, "src/constants/loom-shift.ts"), "utf8")));

  // ── fikstür ───────────────────────────────────────────────────────────────
  const st = await prisma.station.create({ data: { name: `TEST-SM-IST-${ek}`, code: `TEST-SM-S-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = st.id;
  const m = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-SM-TEZ-${ek}`, code: `TEST-SM-M-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machine = m.id;
  const mOff = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-SM-PASIF-${ek}`, code: `TEST-SM-M2-${ek}`.toUpperCase().slice(0, 32), isActive: false } });
  ids.machineOff = mOff.id;

  // ── §1 künye upsert ───────────────────────────────────────────────────────
  const u1 = await upsertMachineSpec(m.id, { shedType: "ARMUR", nominalUnitsPerMin: 550, notes: "TEST-SM" });
  check("§1a künye oluştu: OFF doğar, allowlist alanları yazıldı", u1.data.monitoringState === "OFF" && u1.data.nominalUnitsPerMin === 550 && u1.data.shedType === "ARMUR");
  const u2 = await upsertMachineSpec(m.id, { baselineRunHours: 1234.5 });
  check("§1b bakiye yazıldı ve tarihsiz kalmadı (baselineAt bugün)", Number(u2.data.baselineRunHours) === 1234.5 && u2.data.baselineAt !== null);
  const sahte = { monitoringState: "LIVE", acceptedAt: new Date(), nominalUnitsPerMin: 600 } as unknown as Parameters<typeof upsertMachineSpec>[1];
  const u3 = await upsertMachineSpec(m.id, sahte);
  check("§1c ⭐ gövdedeki `monitoringState`/`acceptedAt` YOK SAYILIR (allowlist), izleme OFF kaldı", u3.data.monitoringState === "OFF" && u3.data.acceptedAt === null && u3.data.nominalUnitsPerMin === 600);
  const e1 = await hata(() => upsertMachineSpec(mOff.id, { notes: "x" }));
  check("§1d pasif makineye künye 400 MACHINE_INACTIVE", kod(e1) === "MACHINE_INACTIVE", kod(e1));

  // ── §2 OFF→SHADOW ─────────────────────────────────────────────────────────
  const e2 = await hata(() => goLive(m.id));
  check("§2a OFF'tan go-live 409 SPEC_NOT_SHADOW", kod(e2) === "SPEC_NOT_SHADOW", kod(e2));
  const s1 = await startShadow(m.id);
  check("§2b OFF→SHADOW", s1.data.monitoringState === "SHADOW");
  const e2b = await hata(() => startShadow(m.id));
  check("§2c ikinci shadow claim 409 SPEC_NOT_OFF (taze durum SHADOW)", kod(e2b) === "SPEC_NOT_OFF" && e2b?.details?.monitoringState === "SHADOW", kod(e2b));

  // ── S2 gölge vardiya sayacı ───────────────────────────────────────────────
  const def = await prisma.shiftDefinition.create({ data: { code: `M${ek}`.toUpperCase().slice(0, 8), name: `TEST-SM vardiya ${ek}`, startMinute: 0, durationMinutes: 480 } });
  ids.def = def.id;
  const gun0 = Date.UTC(1994, 3, 4);
  const karne = async (i: number, monitoringState: "SHADOW" | "OFF", sealed: boolean) => {
    const day = new Date(gun0 + i * 86_400_000);
    const sh = await prisma.shiftInstance.create({ data: { shiftDefinitionId: def.id, factoryDayKey: day, startsAt: new Date(day.getTime() + 5 * 3600_000), endsAt: new Date(day.getTime() + 13 * 3600_000) } });
    ids.shifts.push(sh.id);
    const s = await prisma.machineShiftStat.create({ data: { machineId: m.id, shiftInstanceId: sh.id, factoryDay: day, stopThresholdSec: 20, source: "OPERATOR", monitoringState, ...(sealed ? { sealState: "SEALED", sealGeneration: 1, sealedAt: new Date() } : {}) } });
    ids.stats.push(s.id);
  };
  for (let i = 0; i < SHADOW_MIN_SHIFTS - 1; i++) await karne(i, "SHADOW", true);
  await karne(SHADOW_MIN_SHIFTS - 1, "SHADOW", false); // mühürsüz — sayılmaz
  await karne(SHADOW_MIN_SHIFTS, "OFF", true); // OFF donmuş — sayılmaz
  const g14 = await measureGoLiveGates(m.id);
  check("S2a sayaç yalnız MÜHÜRLÜ ∧ SHADOW donmuş karneyi sayar (14; mühürsüz ve OFF sayılmaz)", g14.sealedShadowShifts === SHADOW_MIN_SHIFTS - 1, String(g14.sealedShadowShifts));
  const eS2 = await hata(() => goLive(m.id));
  check("S2b ⭐ 14/15 → 409 SHADOW_TOO_SHORT", kod(eS2) === "SHADOW_TOO_SHORT" && /14\/15/.test(eS2?.message ?? ""), `${kod(eS2)} ${eS2?.message ?? ""}`);
  await karne(SHADOW_MIN_SHIFTS + 1, "SHADOW", true); // 15.
  check("S2c 15 mühürlü gölge karne", (await measureGoLiveGates(m.id)).sealedShadowShifts === SHADOW_MIN_SHIFTS);

  // ── S3' sinyal kapısı fail-closed ─────────────────────────────────────────
  const eS3 = await hata(() => goLive(m.id));
  check("S3' ⭐ 15 karneyle go-live 409 SIGNAL_NOT_ACCEPTED (kanal kabulü ölçülemez — Faz 2)", kod(eS3) === "SIGNAL_NOT_ACCEPTED" && /Faz 2/.test(eS3?.message ?? ""), `${kod(eS3)}`);
  const afterS3 = await prisma.machineSpec.findUniqueOrThrow({ where: { machineId: m.id } });
  check("S3'b künye SHADOW kaldı, acceptedAt NULL — LIVE bugün ERİŞİLEMEZ (beyanlı)", afterS3.monitoringState === "SHADOW" && afterS3.acceptedAt === null);
  atlama.atla("S1 OFF makineye ingest → 403", "ingest ucu (Faz 2) yok — ölçülecek yol yok", 1);
  atlama.atla("S3 eksik sinyal listesi ADIYLA", "`PeripheralSignal` tablosu Faz 2'de — liste boş döner, kapı fail-closed (S3' ölçtü)", 1);
  atlama.atla("S5 anomali oranı > eşik → 409 SHADOW_ANOMALY", "anomali kaynağı (`MachineCounterEvent`) Faz 2'de", 1);
  atlama.atla("S6 LIVE makinede kanal değişikliği → 409 CHANNEL_CHANGE_REQUIRES_SHADOW", "kanal (`PeripheralSignal`) yok; LIVE üretilemiyor", 1);

  // ── §5 demote ─────────────────────────────────────────────────────────────
  const e5 = await hata(() => demoteToShadow(m.id, "sebep"));
  check("§5a SHADOW künyede demote 409 SPEC_NOT_LIVE", kod(e5) === "SPEC_NOT_LIVE", kod(e5));
  // LIVE üretim yolundan üretilemez (S3'); ayağı ölçmek için fikstür LIVE yazar (üretim yolu DEĞİL, beyan).
  const kabul = new Date("1994-04-20T00:00:00.000Z");
  await prisma.machineSpec.update({ where: { machineId: m.id }, data: { monitoringState: "LIVE", acceptedAt: kabul } });
  const e5b = await hata(() => demoteToShadow(m.id, "ab"));
  check("§5b gerekçe < 3 → 400 DEMOTE_REASON_REQUIRED", kod(e5b) === "DEMOTE_REASON_REQUIRED", kod(e5b));
  const d = await demoteToShadow(m.id, "röle ters bağlanmış");
  check("§5c ⭐ LIVE→SHADOW sebepli; `acceptedAt` KALDI, demote ayrı damga", d.data.monitoringState === "SHADOW" && d.data.acceptedAt?.getTime() === kabul.getTime() && d.data.demotedAt !== null && d.data.demoteReason === "röle ters bağlanmış");

  // ── §6 bakiye guard'ı — başka izi olmayan makinede (yalnız künye + bakiye), handler sahte req/res ile ──
  const mBase = await prisma.machine.create({ data: { stationId: st.id, name: `TEST-SM-BAK-${ek}`, code: `TEST-SM-M3-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machineBase = mBase.id;
  await upsertMachineSpec(mBase.id, { baselineRunHours: 10 });
  let status = 0;
  let body: { data?: Record<string, number>; message?: string } = {};
  const res = { status(c: number) { status = c; return this; }, json(b: typeof body) { body = b; return this; } };
  await machineHardRemove({ params: { id: mBase.id }, user: undefined } as unknown as Parameters<typeof machineHardRemove>[0], res as unknown as Parameters<typeof machineHardRemove>[1], ((e: unknown) => { throw e; }) as Parameters<typeof machineHardRemove>[2]);
  check("§6a ⭐ bakiyesi dolu künye makine silmeyi 409 ile durdurur", status === 409, `${status} ${body.message?.slice(0, 70) ?? ""}`);
  check("§6b guard ADIYLA (`machineSpecBaselineCount`) ve sayı 1", body.data?.machineSpecBaselineCount === 1, JSON.stringify(body.data ?? {}));
  check("§6c makine SİLİNMEDİ", (await prisma.machine.count({ where: { id: mBase.id } })) === 1);
}

async function cleanup(): Promise<void> {
  try {
    if (ids.stats.length) await prisma.machineShiftStat.deleteMany({ where: { id: { in: ids.stats } } });
    if (ids.shifts.length) await prisma.shiftInstance.deleteMany({ where: { id: { in: ids.shifts } } });
    if (ids.def) await prisma.shiftDefinition.deleteMany({ where: { id: ids.def } });
    const mids = [ids.machine, ids.machineOff, ids.machineBase].filter(Boolean);
    await prisma.machineSpec.deleteMany({ where: { machineId: { in: mids } } });
    await prisma.machine.deleteMany({ where: { id: { in: mids } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

main()
  .catch((e) => { fail++; console.error("❌ Bekçi hata ile durdu:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlama.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
