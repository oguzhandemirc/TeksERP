// =============================================================================
// BEKLEME YAŞI — levent ve gövde "kaç gündür bu durumda" (devere S4; GERÇEK DB, sunucusuz servis bekçisi)
// =============================================================================
//   §0 saf: fabrika günü sınırı (`constants/time.ts`) — gün başı 0 gün, bir ms öncesi 1 gün; eşik = gün başı
//   §0e TEK boğaz: LIFO yüklemi `ACTIVE_FORWARD_STATUS_EVENT_WHERE` hem `activeForwardStatusEventTx`te hem yaş helper'ında
//   §1 levent: geri alınan son durum olayı (MOUNTED → iptal) yaşı önceki olaya (WOUND, 20 gün) döndürür
//   §2 gövde: geri alınan elle geçiş (RETURN_EMPTY → geri al) yaşı REGISTER'a (40 gün) döndürür
//   §3 `minAgeDays` liste + cursor + özet AYNI where (levent `staleFull`, gövde `staleOut`)
//   §4 sorgu sayısı sayfa boyundan bağımsız (1 satır = 3 satır)
// NEGATİF SONDA: helper'daki `reversal: null` (geri alma süzgeci) kaldırılınca §1b kırmızı (2026-11-22).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// Olay damgaları fikstürde GERİYE çekilir (geçmişte sarılmış levent benzetimi) — yalnız kendi `TAG`li satırları.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { Prisma, StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { factoryDayStart } from "../src/constants/time";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam, listWarpBeams } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { cancelStatusEvent, mountBeam } from "../src/services/warp-beam-mount.service";
import { createBeamBody } from "../src/services/beam-body/write";
import { listBeamBodies, type BeamBodyListParams } from "../src/services/beam-body/read";
import { applyBeamBodyTransition, undoBeamBodyEvent } from "../src/services/beam-body/transition";
import { statusAgeCutoff, toStatusAge } from "../src/services/helpers/status-age.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TSTBY${process.pid}`;
const DAY = 86_400_000;
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_BEAM_BODY_MODE, SETTING_KEYS.DEVERE_AUTO_CONSUME] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

// Sorgu sayacı: pg havuzunun bütün istemcileri `pg.Client` örneğidir (emsal test_kursun_adim_sayac).
let counting = false;
let queryCount = 0;
const origQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: unknown, ...args: unknown[]) {
  if (counting) queryCount++;
  return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof origQuery;
async function measure(fn: () => Promise<unknown>): Promise<number> {
  await fn();
  queryCount = 0;
  counting = true;
  try {
    await fn();
  } finally {
    counting = false;
  }
  return queryCount;
}

function staticChecks(): void {
  const now = new Date("2026-08-01T10:00:00Z");
  const start = factoryDayStart(now);
  check("§0a gün başı → 0 gün", toStatusAge(start, now).statusAgeDays === 0);
  check("§0b gün başından 1 ms önce → 1 gün (fabrika takvimi, saat farkı değil)", toStatusAge(new Date(start.getTime() - 1), now).statusAgeDays === 1);
  check("§0c 3 gün önce aynı saat → 3 gün", toStatusAge(new Date(now.getTime() - 3 * DAY), now).statusAgeDays === 3);
  check("§0d eşik(1) = bugünün başı · eşik(2) = dünün başı", statusAgeCutoff(1, now).getTime() === start.getTime() && statusAgeCutoff(2, now).getTime() === factoryDayStart(new Date(now.getTime() - DAY)).getTime());
  const src = (f: string) => readFileSync(path.join(__dirname, "..", "src/services/helpers", f), "utf8");
  const mount = src("warp-beam-mount.helper.ts");
  const age = src("status-age.helper.ts");
  check(
    "§0e TEK boğaz: LIFO parçası helper'da tanımlı, activeForwardStatusEventTx + yaş helper'ı onu okur (kopya yüklem yok)",
    /export const ACTIVE_FORWARD_STATUS_EVENT_WHERE =/.test(mount) && /beamId, \.\.\.ACTIVE_FORWARD_STATUS_EVENT_WHERE/.test(mount) && (age.match(/\.\.\.ACTIVE_FORWARD_STATUS_EVENT_WHERE/g) ?? []).length >= 2 && !/reversal:\s*null/.test(age) && /\.\.\.BEAM_BODY_EFFECTIVE_EVENT_WHERE/.test(age),
  );
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== BEKLEME YAŞI (devere S4) ===");
  staticChecks();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const W = await fixtureWarehouseId();
  const beamIds: string[] = [];
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  const st = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 1 }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  /** Sarılmış levent; doğuşu ve WOUND olayı `days` gün geriye çekilir. */
  const sar = async (days: number) => {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 500, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 500, kgSource: WarpKgSource.THEORETICAL });
    if (days > 0) {
      await prisma.warpBeam.update({ where: { id: p.data.id }, data: { createdAt: ago(days) } });
      await prisma.warpBeamEvent.updateMany({ where: { beamId: p.data.id }, data: { createdAt: ago(days) } });
    }
    return p.data.id;
  };
  const beamList = (extra: { minAgeDays?: number; cursor?: string | null; limit?: number } = {}) => listWarpBeams({ warpSpecId: spec.id, ...extra }, now);
  const bodyParams = (extra: Partial<BeamBodyListParams> = {}): BeamBodyListParams => ({
    owner: [], ownerCustomerId: null, status: [], subcontractorId: null, machineId: null, warehouseId: null, active: "all", search: TAG, limit: 50, ...extra,
  });
  try {
    for (const [k, v] of [[SETTING_KEYS.DEVERE_ENABLED, "true"], [SETTING_KEYS.DOKUMA_ENABLED, "true"], [SETTING_KEYS.DEVERE_MOUNT_TRACKING, "true"],
      [SETTING_KEYS.DEVERE_BEAM_BODY_MODE, "OPTIONAL"], [SETTING_KEYS.DEVERE_AUTO_CONSUME, "false"]] as const) await setSetting(k, v);

    // ── §1 levent: geri alınan son olay ───────────────────────────────────
    const A = await sar(20);
    const B = await sar(20);
    const C = await sar(0);
    const age0 = (await beamList()).data.find((r) => r.id === A);
    check("§1a WOUND 20 gün önce → statusAgeDays 20, statusSince = WOUND anı", age0?.statusAgeDays === 20 && age0.statusSince?.getTime() === ago(20).getTime(), `${age0?.statusAgeDays}`);
    await mountBeam(A, { machineId: loom.id, position: 1 });
    const mounted = (await beamList()).data.find((r) => r.id === A);
    const mountEv = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: A, kind: "MOUNTED" }, select: { id: true } });
    await cancelStatusEvent(A, mountEv.id, `${TAG} yanlış tezgah`);
    const back = (await beamList()).data.find((r) => r.id === A);
    check("§1b ⭐ takma 0 gün → takma geri alınınca yaş yine WOUND'dan 20 gün", mounted?.statusAgeDays === 0 && back?.status === "READY" && back.statusAgeDays === 20, `takılı=${mounted?.statusAgeDays} · geri=${back?.status}/${back?.statusAgeDays}`);
    const fresh = (await beamList()).data.find((r) => r.id === C);
    check("§1c bugün sarılan → 0 gün", fresh?.statusAgeDays === 0, `${fresh?.statusAgeDays}`);

    // ── §3a levent minAgeDays: liste + cursor + özet ─────────────────────
    const all = await beamList();
    const m15 = await beamList({ minAgeDays: 15 });
    const m25 = await beamList({ minAgeDays: 25 });
    const ids15 = m15.data.map((r) => r.id).sort();
    check("§3a minAgeDays=15 → yalnız 20 günlük A + B (C ve geri alınan takma süzgeçte doğru)", ids15.join() === [A, B].sort().join(), ids15.join());
    check("§3b minAgeDays=25 → boş · özet 0", m25.data.length === 0 && m25.summary?.staleFull === 0, `${m25.data.length}/${m25.summary?.staleFull}`);
    check("§3c özet staleFull (14+ gün READY) süzgeçsiz 2, minAgeDays=15 ile de 2 (aynı where)", all.summary?.staleFull === 2 && m15.summary?.staleFull === 2 && all.summary.staleFullDays === 14, `${all.summary?.staleFull}/${m15.summary?.staleFull}`);
    const p1 = await beamList({ minAgeDays: 15, limit: 1 });
    const p2 = await beamList({ minAgeDays: 15, limit: 1, cursor: p1.pagination.nextCursor });
    check("§3d cursor aynı where: limit 1 → iki sayfa A/B, C hiç gelmez, ikinci sayfada özet yok", p1.data.length === 1 && p2.data.length === 1 && !p2.pagination.hasMore && [p1.data[0]!.id, p2.data[0]!.id].sort().join() === [A, B].sort().join() && p2.summary === undefined, `${p1.data[0]?.id}/${p2.data[0]?.id}`);

    // ── §2 gövde: geri alınan elle geçiş ──────────────────────────────────
    const mkBody = async (no: string, days: number) => {
      const b = (await createBeamBody({ clientToken: randomUUID(), bodyNo: `${TAG}-${no}`, owner: { kind: "OURS" }, initialStatus: "AT_SUBCONTRACTOR", subcontractorId: sub.id }, U)).data;
      if (days > 0) {
        await prisma.beamBody.update({ where: { id: b.id }, data: { createdAt: ago(days) } });
        await prisma.beamBodyEvent.updateMany({ where: { bodyId: b.id }, data: { createdAt: ago(days) } });
      }
      return b.id;
    };
    const G1 = await mkBody("1", 40);
    const G2 = await mkBody("2", 40);
    await mkBody("3", 0);
    await applyBeamBodyTransition(G1, { kind: "RETURN_EMPTY", warehouseId: W }, U);
    const ret = (await listBeamBodies(bodyParams(), now)).data.find((r) => r.id === G1);
    const retEv = await prisma.beamBodyEvent.findFirstOrThrow({ where: { bodyId: G1, kind: "RETURN_EMPTY" }, select: { id: true } });
    await undoBeamBodyEvent(G1, retEv.id, `${TAG} yanlış`, U);
    const g1 = (await listBeamBodies(bodyParams(), now)).data.find((r) => r.id === G1);
    check("§2a ⭐ iade 0 gün → iade geri alınınca yaş REGISTER'dan 40 gün, statusSince ISO", ret?.statusAgeDays === 0 && g1?.status === "AT_SUBCONTRACTOR" && g1.statusAgeDays === 40 && g1.statusSince === ago(40).toISOString(), `iade=${ret?.statusAgeDays} · geri=${g1?.status}/${g1?.statusAgeDays}`);

    // ── §3e gövde minAgeDays: liste + cursor + özet ─────────────────────
    const b0 = await listBeamBodies(bodyParams(), now);
    const b30 = await listBeamBodies(bodyParams({ minAgeDays: 30 }), now);
    check("§3e gövde minAgeDays=30 → G1 + G2 (bugünkü yok) · özet count 2", b30.data.map((r) => r.id).sort().join() === [G1, G2].sort().join() && b30.summary.count === 2, `${b30.data.length}/${b30.summary.count}`);
    check("§3f özet staleOut (30+ gün dışarıda) süzgeçsiz 2 / minAgeDays=30 ile 2 / minAgeDays=50 ile 0", b0.summary.staleOut === 2 && b30.summary.staleOut === 2 && (await listBeamBodies(bodyParams({ minAgeDays: 50 }), now)).summary.staleOut === 0 && b0.summary.staleOutDays === 30, `${b0.summary.staleOut}/${b30.summary.staleOut}`);
    const q1 = await listBeamBodies(bodyParams({ minAgeDays: 30, limit: 1 }), now);
    const q2 = await listBeamBodies(bodyParams({ minAgeDays: 30, limit: 1, cursor: q1.nextCursor ?? undefined }), now);
    check("§3g gövde cursor aynı where: limit 1 → iki sayfa G1/G2, son sayfa nextCursor null", q1.data.length === 1 && q2.data.length === 1 && q2.nextCursor === null && [q1.data[0]!.id, q2.data[0]!.id].sort().join() === [G1, G2].sort().join());

    // ── §4 sorgu sayısı sayfa boyundan bağımsız ───────────────────────────
    const beam1 = await measure(() => beamList({ limit: 1 }));
    const beam3 = await measure(() => beamList({ limit: 3 }));
    check("§4a levent listesi: 1 satır ve 3 satır sayfada sorgu sayısı eşit", beam1 === beam3 && beam1 > 0, `${beam1} / ${beam3}`);
    const body1 = await measure(() => listBeamBodies(bodyParams({ limit: 1 }), now));
    const body3 = await measure(() => listBeamBodies(bodyParams({ limit: 3 }), now));
    check("§4b gövde listesi: 1 satır ve 3 satır sayfada sorgu sayısı eşit", body1 === body3 && body1 > 0, `${body1} / ${body3}`);
  } finally {
    const bodies = await prisma.beamBody.findMany({ where: { bodyNo: { startsWith: TAG } }, select: { id: true } });
    const ids = bodies.map((x) => x.id);
    const evIds = (await prisma.warpBeamEvent.findMany({ where: { beamId: { in: beamIds } }, select: { id: true } })).map((e) => e.id);
    const bevIds = (await prisma.beamBodyEvent.findMany({ where: { bodyId: { in: ids } }, select: { id: true } })).map((e) => e.id);
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids }, reversesId: { not: null } } });
    await prisma.beamBodyEvent.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBodyMachine.deleteMany({ where: { bodyId: { in: ids } } });
    await prisma.beamBody.deleteMany({ where: { id: { in: ids } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: beamIds } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...beamIds, ...evIds, ...ids, ...bevIds] } } });
    await prisma.warpSpec.deleteMany({ where: { id: spec.id } });
    await prisma.item.deleteMany({ where: { id: yarn.id } });
    await prisma.machine.deleteMany({ where: { id: loom.id } });
    await prisma.station.deleteMany({ where: { id: st.id } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
      if (f) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: f.value as Prisma.InputJsonValue }, update: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
