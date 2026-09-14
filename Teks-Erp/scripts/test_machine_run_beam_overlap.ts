// =============================================================================
// KOŞUM ↔ LEVENT PENCERESİ — `beamsMountedDuring` (Faz 3): "bu koşumda hangi leventler bağlıydı?"
// =============================================================================
// NEDEN: tezgah raporları koşum penceresine düşen leventleri makinenin DURUM kolonundan değil
// DEFTERDEN okur (MOUNTED satırı → ilk aktif kapatıcı). Çift levent (iki yuva), koşum ortası levent
// değişimi, geri alınmış bağlama (görünmez) ve `setupStartedAt` ile geriye çekilmiş bağlama burada
// GERÇEK DB'de ölçülür; tezgah kodunun bu SQL'i kopyalamadığı AST ile korunur (§0).
// NEGATİF SONDALAR (2026-09-14): SQL'de `NOT EXISTS (… reversesEventId = m.id)` düşürüldü → §2d
//   kırmızı (MOUNT_CANCEL'lı bağlama pencerede görünür) · `COALESCE(m."setupStartedAt", m."createdAt")`
//   → `m."createdAt"` → §2a kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Prisma, StationType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { cancelStatusEvent, dismountBeam, mountBeam } from "../src/services/warp-beam-mount.service";
import { beamsMountedDuring } from "../src/services/helpers/warp-beam-mount.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-LO-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });

function* tsFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

function statik(): void {
  console.log("── §0 Statik: koşum penceresi SQL'i TEK yerde ──");
  const kopya = [...tsFiles(path.join(ROOT, "src"))].filter((f) => !f.endsWith("helpers/warp-beam-mount.helper.ts") && /warp_beam_events m\b|m\.kind = 'MOUNTED'/.test(readFileSync(f, "utf8")));
  check("§0a `MOUNTED` pencere SQL'i helper dışında hiçbir kaynakta yeniden yazılmamış (AST tripwire)", kopya.length === 0, kopya.map((f) => path.relative(ROOT, f)).join(","));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== KOŞUM ↔ LEVENT PENCERESİ BEKÇİSİ ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, consumesWarpBeam: true }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  const beamIds: string[] = [];
  const sar = async () => {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: 100, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const H = 3_600_000;
  const now = Date.now();
  const ids = (rows: { beamId: string }[]) => rows.map((r) => r.beamId).sort();
  try {
    for (const key of FLAGS) await setFlag(key, true);
    console.log("\n── §1 Fikstür ──");
    const b1 = await sar();
    const b2 = await sar();
    const b3 = await sar();
    // b1: yuva 1, kurulum 2 saat önce başladı (geriye çekilmiş) → sökülür (T_d = şimdi).
    await mountBeam(b1, { machineId: loom.id, position: 1, setupStartedAt: new Date(now - 2 * H) });
    // b2: yuva 2, kurulum 1 saat önce; bağlı kalır (çift levent).
    await mountBeam(b2, { machineId: loom.id, position: 2, setupStartedAt: new Date(now - 1 * H) });
    const d1 = await dismountBeam(b1, {});
    const tD = (await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: b1, kind: "DISMOUNTED" }, select: { createdAt: true } })).createdAt;
    // b3: koşum ORTASI levent değişimi — b1'in yuvasına, şimdi.
    await mountBeam(b3, { machineId: loom.id, position: 1 });
    check("§1 fikstür: b1 söküldü, b2 bağlı, b3 b1'in yuvasında", d1.data.status === "READY" && (await prisma.warpBeam.count({ where: { currentMachineId: loom.id, status: "MOUNTED" } })) === 2);

    console.log("\n── §2 Pencereler ──");
    const w1 = await beamsMountedDuring(prisma, loom.id, new Date(now - 3 * H), new Date(now - 90 * 60_000));
    check("§2a [−3s, −1,5s): yalnız b1 (b2'nin kurulumu −1s'te başladı, b3 şimdi)", JSON.stringify(ids(w1)) === JSON.stringify([b1]), ids(w1).length + " satır");
    const w2 = await beamsMountedDuring(prisma, loom.id, new Date(now - 3 * H), new Date(now + 60_000));
    check("§2b ⭐ [−3s, +1dk): üçü de — b1 söküldüğü halde pencerede (mountedAt = setupStartedAt, dismountedAt = söküm anı)", JSON.stringify(ids(w2)) === JSON.stringify([b1, b2, b3].sort()) && w2.find((r) => r.beamId === b1)?.dismountedAt !== null && w2.find((r) => r.beamId === b2)?.dismountedAt === null, ids(w2).length + " satır");
    const w3 = await beamsMountedDuring(prisma, loom.id, new Date(tD.getTime() + 1), new Date(now + 60_000));
    check("§2c [söküm+1ms, +1dk): b1 dışarıda, b2 + b3 içeride (koşum ortası değişim)", JSON.stringify(ids(w3)) === JSON.stringify([b2, b3].sort()), ids(w3).join(","));
    const m3 = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: b3, kind: "MOUNTED" }, select: { id: true } });
    await cancelStatusEvent(b3, m3.id, `${TAG} yanlış yuva`);
    const w4 = await beamsMountedDuring(prisma, loom.id, new Date(now - 3 * H), new Date(now + 60_000));
    check("§2d ⭐ geri alınmış bağlama (MOUNT_CANCEL) pencerede GÖRÜNMEZ: b1 + b2", JSON.stringify(ids(w4)) === JSON.stringify([b1, b2].sort()), ids(w4).join(","));
    check("§2e sıralama mountedAt artan (b1 −2s, b2 −1s)", w4[0]?.beamId === b1 && w4[1]?.beamId === b2 && w4[0].mountPosition === 1 && w4[1].mountPosition === 2);
    const w5 = await beamsMountedDuring(prisma, loom.id, new Date(now + 2 * H), new Date(now + 3 * H));
    check("§2f gelecekte boş pencere → 0 satır (açık bağlama now()'a kadar sayılır, ötesine değil)", w5.length === 0);
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.delete({ where: { id: yarn.id } }).catch(() => undefined);
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.delete({ where: { id: loom.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: st.id } }).catch(() => undefined);
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
