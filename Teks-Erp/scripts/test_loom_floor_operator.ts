// =============================================================================
// BEKÇİ — Tezgah Salonu D5: tezgahta AKTİF OPERATÖR (tablet oturumu)
// =============================================================================
// Sözleşme (tasarım TEZGAH-SALONU-SECIM-IS-VERME §D D5): `GET /api/loom-floor` tezgah başına `operator`
// ({ name, since } | null) taşır; kaynak `WorkSession` — açık VE hareketsizlik süresi dolmamış oturum
// (`liveSessionWhere`, tek yüklem `helpers/work-session.helper.ts`). Salon ucu YAZMAZ: süresi dolmuş
// oturumu kapatmaz (tembel IDLE kapatma `resolveActiveSession`/`sweepIdleSessions`in işi), yalnız saymaz.
//   §1 canlı oturum → operatörün adı (fullName, yoksa kullanıcı adı) + oturum başlangıcı
//   §2 kapanmış oturum → null · oturumsuz tezgah → null
//   §3 ⭐ süresi dolmuş (lastActivityAt eşikten eski) oturum → null VE okuma oturumu KAPATMAZ (endedAt hâlâ null)
//   §4 eşik 0 (kapalı) → açık her oturum canlı sayılır
//   §5 yapısal: salon oturumu helper'dan okur (kendi `workSession` sorgusu yok, `sweepIdleSessions` çağırmaz);
//      süpürme aynı eşik hesabını (`idleCutoff`) kullanır
// Global ayar yazar (`workSession.idleTimeoutMinutes`); bulduğu değere `finally`de döner (satırsızsa satırsız).
// Koşum: npx tsx scripts/run-all-tests.ts loom_floor_operator
//
// NEGATİF SONDALAR (2026-10-13, koşuldu, dosya md5 ile geri alındı):
//   ① `liveSessionWhere` hareketsizlik eşiğini bıraktı (yalnız endedAt null) → §3a + §5b ❌ ·
//   ② salon `sweepIdleSessions()` çağırdı (okurken kapattı) → §3b + §4 + §5a ❌
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { yorumlariSok } from "./lib/regime-gate-scan";
import { getLoomFloor } from "../src/services/loom-floor.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const ek = Date.now().toString(36).toUpperCase();
const ids = { station: "", looms: [] as string[], devices: [] as string[], users: [] as string[], sessions: [] as string[] };
const IDLE_KEY = SETTING_KEYS.WORK_SESSION_IDLE_TIMEOUT_MINUTES;
let ilkIdle: { found: boolean; value: unknown } = { found: false, value: null };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }
  const row = await prisma.systemSetting.findUnique({ where: { key: IDLE_KEY }, select: { value: true } });
  ilkIdle = { found: !!row, value: row?.value ?? null };
  await prisma.systemSetting.upsert({ where: { key: IDLE_KEY }, create: { key: IDLE_KEY, value: 60 }, update: { value: 60 } });

  const station = await prisma.station.create({ data: { name: `TEST-LFO-HOL-${ek}`, code: `TLFO-S-${ek}`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true } });
  ids.station = station.id;
  const tezgah = async (n: string) => {
    const m = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-LFO Tezgah ${n} ${ek}`, code: `TLFO-${ek}-${n}`.slice(0, 32), isActive: true }, select: { id: true } });
    ids.looms.push(m.id);
    return m.id;
  };
  const [A, B, C, D, E] = [await tezgah("A"), await tezgah("B"), await tezgah("C"), await tezgah("D"), await tezgah("E")];
  const kullanici = async (n: string, fullName: string | null) => {
    const u = await prisma.user.create({ data: { username: `test-lfo-${ek}-${n}`.toLowerCase(), passwordHash: "!", fullName: fullName ?? "", isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    return u.id;
  };
  const cihaz = async (n: string) => {
    const d = await prisma.device.create({ data: { deviceId: `test-lfo-${ek}-${n}`, name: `TEST-LFO Tablet ${n}`, status: "APPROVED", kind: "TABLET" }, select: { id: true } });
    ids.devices.push(d.id);
    return d.id;
  };
  const simdi = new Date();
  const oturum = async (machineId: string, userId: string, p: { endedAt?: Date; lastActivityAt?: Date; startedAt?: Date }) => {
    const s = await prisma.workSession.create({
      data: { userId, deviceId: await cihaz(machineId.slice(0, 8)), machineId, stationId: station.id, startedAt: p.startedAt ?? new Date(simdi.getTime() - 30 * 60_000), lastActivityAt: p.lastActivityAt ?? simdi, endedAt: p.endedAt ?? null, endReason: p.endedAt ? "LOGOUT" : null },
      select: { id: true, startedAt: true },
    });
    ids.sessions.push(s.id);
    return s;
  };
  const uAyse = await kullanici("ayse", "Ayşe Dokumacı");
  const uAdsiz = await kullanici("adsiz", null);
  const sA = await oturum(A, uAyse, {});
  await oturum(B, uAyse, { endedAt: new Date(simdi.getTime() - 5 * 60_000) });
  const sC = await oturum(C, uAdsiz, { lastActivityAt: new Date(simdi.getTime() - 2 * 3600_000) }); // eşik 60 dk → süresi dolmuş
  await oturum(E, uAdsiz, { lastActivityAt: new Date(simdi.getTime() - 5 * 60_000) });

  const op = async (id: string) => (await getLoomFloor(simdi)).data!.looms.find((l) => l.id === id)?.operator;

  // ── §1 ──
  const a = await op(A);
  check("§1a canlı oturum → operatörün adı (fullName)", a?.name === "Ayşe Dokumacı", JSON.stringify(a));
  check("§1b oturum başlangıcı `since`", a?.since?.getTime() === sA.startedAt.getTime());
  const e = await op(E);
  check("§1c fullName boşsa kullanıcı adı", e?.name === `test-lfo-${ek}-adsiz`.toLowerCase(), JSON.stringify(e));

  // ── §2 ──
  check("§2a kapanmış oturum → null", (await op(B)) === null);
  check("§2b oturumsuz tezgah → null", (await op(D)) === null);

  // ── §3 ──
  check("§3a ⭐ hareketsizlik süresi dolmuş oturum → null (canlı sayılmaz)", (await op(C)) === null);
  const cNow = await prisma.workSession.findUniqueOrThrow({ where: { id: sC.id }, select: { endedAt: true } });
  check("§3b ⭐ salon okuması oturumu KAPATMAZ (yazma yok — endedAt hâlâ null)", cNow.endedAt === null);

  // ── §4 ──
  await prisma.systemSetting.update({ where: { key: IDLE_KEY }, data: { value: 0 } });
  check("§4 eşik 0 (kapalı) → açık her oturum canlı: süresi 'dolmuş' C de görünür", (await op(C))?.name === `test-lfo-${ek}-adsiz`.toLowerCase());

  // ── §5 yapısal ──
  const kaynak = (f: string) => yorumlariSok(readFileSync(path.join(__dirname, "..", f), "utf8"));
  const salon = kaynak("src/services/loom-floor.service.ts");
  check("§5a ⭐ salon oturumu yalnız helper'dan okur: `liveMachineOperators` var, `workSession.` sorgusu ve `sweepIdleSessions` YOK",
    /liveMachineOperators\(/.test(salon) && !/\.workSession\./.test(salon) && !/sweepIdleSessions/.test(salon));
  const helper = kaynak("src/services/helpers/work-session.helper.ts");
  const sweep = helper.slice(helper.indexOf("export async function sweepIdleSessions"));
  check("§5b süpürme ve canlı yüklem AYNI eşik hesabından (`idleCutoff`)",
    /idleCutoff\(/.test(sweep.slice(0, sweep.indexOf("\n}\n"))) && /export function liveSessionWhere[\s\S]*?idleCutoff\(/.test(helper));
}

async function cleanup(): Promise<void> {
  try {
    if (ilkIdle.found) await prisma.systemSetting.update({ where: { key: IDLE_KEY }, data: { value: ilkIdle.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: IDLE_KEY } });
    await prisma.workSession.deleteMany({ where: { id: { in: ids.sessions } } });
    await prisma.device.deleteMany({ where: { id: { in: ids.devices } } });
    // Bekçi kullanıcısı sert silinmez (audit FK) — pasifleştirilir.
    await prisma.user.updateMany({ where: { id: { in: ids.users } }, data: { isActive: false } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.looms } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (err) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (err as Error).message);
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", err);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
