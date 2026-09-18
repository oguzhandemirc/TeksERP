// =============================================================================
// LEVENT OTOMATİK TÜKETİM — devere Faz 4: tezgahtan doğan top (KK1 WEAVING + doff bağı) → CONSUMED(rollId)
// =============================================================================
// NEDEN: top KK1'de doğar (doff yazmaz); bayrak `devere.autoConsume` DEFAULT false = bugünkü davranış
// (KK1 yanıtı bayt bayt aynı — `warnings` bile yok). Açıkken: doff ANINDA tezgahta bağlı her levente
// AYRI satır (çift levent = iki satır, pay bölünmez), çözgü = kumaş ÷ (1 − takeUp), take-up NULL →
// çözgü = kumaş + uyarı, çok hatlı makine hat payı (kardeş hat topları toplamı = tam boy, çift sayım
// yok), kalan yetmezse kısmi + uyarı (KK1 engellenmez), top iptali → CONSUMED_CANCEL, SCRAP dokunmaz,
// restore → yeni CONSUMED, doff'suz WEAVING (fason) satır yok, sökülmüş levent doff anına göre düşer.
// NEGATİF SONDALAR (2026-09-15): `readDevereAutoConsume` sabit true → §1 bayt bayt kırmızı ·
//   `warpLengthFromFabric` take-up dalı düştü → §2b kırmızı · `beamsMountedDuring(… doffedAt, doffedAt)`
//   yerine `mountedBeamsOnMachineTx` → §6 kırmızı · `cancelConsumedForRollTx` çağrısı `!isScrap` şartsız → §5c kırmızı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar FOTOĞRAFINA döner.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, Prisma, RollEntrySource, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { dismountBeam, mountBeam } from "../src/services/warp-beam-mount.service";
import { warpLengthFromFabric } from "../src/services/warp-beam-auto-consume.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-AC-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
const kalan = async (id: string) => (await getWarpBeam(id)).data.remainingM;
const consumedOf = (rollId: string) => prisma.warpBeamEvent.findMany({ where: { rollId, kind: "CONSUMED" }, orderBy: { createdAt: "asc" }, select: { id: true, beamId: true, lengthM: true, fabricLengthM: true, lengthSource: true, mountPosition: true, reversal: { select: { id: true, kind: true } } } });
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

function statik(): void {
  console.log("── §0 Statik ──");
  check("§0a formül: 100 m kumaş, take-up %20 → 125 m çözgü; NULL → 100", warpLengthFromFabric(D(100), D(20)).equals(125) && warpLengthFromFabric(D(100), null).equals(100));
  const inv = readFileSync(path.join(ROOT, "src/services/inventory.service.ts"), "utf8");
  check("§0b KK1 doğuşu `autoConsumeForRollTx`i tx İÇİNDE, doff bağı varken çağırır", /if \(opts\?\.doffEventId\) \{\s*autoConsumeWarnings\.push\(\.\.\.\(await autoConsumeForRollTx\(tx,/.test(inv));
  check("§0c iptal yolu `cancelConsumedForRollTx`i YALNIZ !isScrap ile çağırır (SCRAP'ta çözgü gerçekten tüketildi)", /if \(!isScrap && r\.doffEventId\) await cancelConsumedForRollTx\(tx,/.test(inv));
  const svc = readFileSync(path.join(ROOT, "src/services/warp-beam-auto-consume.service.ts"), "utf8");
  check("§0d levent seçimi DEFTERDEN doff anında (`beamsMountedDuring(tx, machineId, doffedAt, doffedAt)`), 'şu an bağlı' değil", /beamsMountedDuring\(tx, doff\.machineId, doff\.doffedAt, doff\.doffedAt\)/.test(svc) && !/mountedBeamsOnMachineTx/.test(svc));
  check("§0e defter satırına update/delete YOK", !/warpBeamEvent\.(update|updateMany|delete|deleteMany|upsert)\(/.test(svc));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== LEVENT OTOMATİK TÜKETİM BEKÇİSİ (Faz 4) ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const stDv = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const stLoom = await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: `${TAG}-DK`.slice(0, 32), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } });
  const loom = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T1`, code: `${TAG}-T1`.slice(0, 32), warpBeamSlots: 2 }, select: { id: true } });
  const loom2 = await prisma.machine.create({ data: { stationId: stLoom.id, name: `${TAG}-T2`, code: `${TAG}-T2`.slice(0, 32), warpBeamSlots: 1, productionLineCount: 2 }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500, takeUpPct: 20 }, select: { id: true } });
  const specNull = await prisma.warpSpec.create({ data: { code: `${TAG}-CK0`, name: `${TAG} take-up yok`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });
  const inventory = new InventoryService();
  const beamIds: string[] = [];
  const rollIds: string[] = [];
  const sar = async (m: number, specId = spec.id) => {
    const p = await createWarpBeam({ warpSpecId: specId, plannedLengthM: m, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: m, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const doff = async (machineId: string, line = 1) => (await openDoff({ machineId, productionLineNo: line, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
  const top = async (doffEventId: string, m: number) => {
    const r = await inventory.createInitialEntry({ itemId: fabric.id, initialQty: m }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId });
    rollIds.push((r.data as { id: string }).id);
    // Helper'ın boş dönüşü SESSİZDİR (yalnız uyarı): kırmızıda "bayrak mı, saat mı, levent mi" ayrımı bu satırdan okunur.
    for (const w of r.warnings ?? []) if (/bağlı levent yoktu/.test(w)) console.log(`   ⚠ helper boş döndü: ${w}`);
    return r;
  };
  try {
    await setFlag(SETTING_KEYS.DEVERE_ENABLED, true);
    await setFlag(SETTING_KEYS.IPLIK_ENABLED, false);
    await setFlag(SETTING_KEYS.DOKUMA_ENABLED, true);
    await setFlag(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_AUTO_CONSUME } });

    console.log("\n── §1 Bayrak KAPALI (satır yok) = bugün, bayt bayt ──");
    const b1 = await sar(1000);
    const b2 = await sar(500, specNull.id);
    await mountBeam(b1, { machineId: loom.id, position: 1 });
    await mountBeam(b2, { machineId: loom.id, position: 2 });
    const d0 = await doff(loom.id);
    const r0 = await top(d0, 100);
    check("§1a ⭐ bayrak satırı YOK → top doğdu, CONSUMED satırı YOK, kalanlar aynı, yanıtta `warnings` anahtarı bile YOK", (await consumedOf((r0.data as { id: string }).id)).length === 0 && (await kalan(b1)) === 1000 && (await kalan(b2)) === 500 && !("warnings" in r0), JSON.stringify(Object.keys(r0)));
    await setFlag(SETTING_KEYS.DEVERE_AUTO_CONSUME, true);

    console.log("\n── §2 Açık: çift levent iki satır · take-up · NULL take-up ──");
    const d1 = await doff(loom.id);
    const r1 = await top(d1, 100);
    const rollA = (r1.data as { id: string }).id;
    const c1 = await consumedOf(rollA);
    const c1b1 = c1.find((c) => c.beamId === b1);
    const c1b2 = c1.find((c) => c.beamId === b2);
    check("§2a ⭐ iki bağlı levent → iki CONSUMED(rollId) satırı, yuva kopyalı, fabricLengthM = 100, ESTIMATED", c1.length === 2 && c1b1?.mountPosition === 1 && c1b2?.mountPosition === 2 && c1.every((c) => c.fabricLengthM?.equals(100) && c.lengthSource === "ESTIMATED"));
    check("§2b ⭐ take-up %20 → çözgü 125 m (kalan 875); NULL take-up → çözgü = kumaş 100 (kalan 400) + uyarı adıyla", c1b1?.lengthM?.equals(125) === true && c1b2?.lengthM?.equals(100) === true && (await kalan(b1)) === 875 && (await kalan(b2)) === 400 && (r1.warnings ?? []).some((w) => /take-up yok/.test(w)), `${c1b1?.lengthM} / ${c1b2?.lengthM}`);
    check("§2c yanıt başarılı, mesaj top doğuşu (uyarı KK1'i engellemedi)", r1.success === true && /Barkod/.test(r1.message ?? ""));

    console.log("\n── §3 Kalan yetmez: kısmi + uyarı, KK1 engellenmez ──");
    const d3 = await doff(loom.id);
    const r3 = await top(d3, 400);
    const c3 = await consumedOf((r3.data as { id: string }).id);
    const c3b2 = c3.find((c) => c.beamId === b2);
    check("§3a ⭐ b2 kalanı 400 < istenen 400 (take-up yok → 400) tam yeter; b1 875 ≥ 500 → tam; iki satır", c3.length === 2 && c3b2?.lengthM?.equals(400) === true && (await kalan(b2)) === 0);
    const d3b = await doff(loom.id);
    const r3b = await top(d3b, 10);
    const c3b = await consumedOf((r3b.data as { id: string }).id);
    check("§3b ⭐ b2 kalan 0 → satır YOK + uyarı 'kalan 0'; b1 yine düşer; top doğdu", c3b.length === 1 && c3b[0].beamId === b1 && (r3b.warnings ?? []).some((w) => /kalan 0/.test(w)) && r3b.success === true);
    const d3c = await doff(loom.id);
    const r3c = await top(d3c, 1000);
    const c3c = await consumedOf((r3c.data as { id: string }).id);
    const b1Left = (await kalan(b1));
    check("§3c ⭐ b1 kalanı yetmedi (istenen 1250) → kalana kadar yazıldı, kalan 0, uyarı 'yetmedi … açık'", c3c.find((c) => c.beamId === b1)?.lengthM?.lt(1250) === true && b1Left === 0 && (r3c.warnings ?? []).some((w) => /yetmedi/.test(w)));

    console.log("\n── §4 Fason WEAVING (doff yok) → satır yok ──");
    const rf = await inventory.createInitialEntry({ itemId: fabric.id, initialQty: 50 }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, skipKk1WeightPolicy: true });
    rollIds.push((rf.data as { id: string }).id);
    check("§4 doff bağı olmayan WEAVING top → CONSUMED yok, uyarı yok", (await consumedOf((rf.data as { id: string }).id)).length === 0 && !("warnings" in rf));

    console.log("\n── §5 Ters yol: iptal → CONSUMED_CANCEL · SCRAP dokunmaz · restore → yeni CONSUMED ──");
    const b3 = await sar(300);
    await dismountBeam(b1, {});
    await dismountBeam(b2, {});
    await mountBeam(b3, { machineId: loom.id, position: 1 });
    const d5 = await doff(loom.id);
    const r5 = await top(d5, 80);
    const roll5 = (r5.data as { id: string }).id;
    check("§5a tek levent → tek satır 100 m (80 ÷ 0,8), kalan 200", (await consumedOf(roll5)).length === 1 && (await kalan(b3)) === 200);
    await inventory.softDelete(roll5, undefined, { mode: "CANCEL", reason: `${TAG} yanlış giriş` });
    const c5 = await consumedOf(roll5);
    check("§5b ⭐ top İPTALİ → CONSUMED_CANCEL (ters bağ, rollId kopyalı), kalan 300'e döndü", c5[0]?.reversal?.kind === "CONSUMED_CANCEL" && (await kalan(b3)) === 300 && (await prisma.warpBeamEvent.count({ where: { rollId: roll5, kind: "CONSUMED_CANCEL" } })) === 1);
    await inventory.restoreCancelledRoll(roll5, undefined, { reason: `${TAG} geri` });
    const c5r = await consumedOf(roll5);
    check("§5c restore → YENİ CONSUMED (ileri yol), kalan yine 200; eski satır ve tersi duruyor", c5r.length === 2 && c5r.filter((c) => c.reversal == null).length === 1 && (await kalan(b3)) === 200);
    const d5s = await doff(loom.id);
    const r5s = await top(d5s, 40);
    const roll5s = (r5s.data as { id: string }).id;
    await inventory.softDelete(roll5s, undefined, { mode: "SCRAP", reason: `${TAG} yandı` });
    check("§5d ⭐ SCRAP → ters YAZILMAZ (çözgü gerçekten tüketildi), kalan 150", (await prisma.warpBeamEvent.count({ where: { rollId: roll5s, kind: "CONSUMED_CANCEL" } })) === 0 && (await kalan(b3)) === 150);

    console.log("\n── §6 Doff anı ↔ şu an: doff'tan SONRA sökülen levent yine düşer ──");
    const d6 = await doff(loom.id);
    await dismountBeam(b3, {});
    const r6 = await top(d6, 8);
    const c6 = await consumedOf((r6.data as { id: string }).id);
    check("§6 ⭐ KK1 sökümden sonra geldi → doff anında bağlı olan b3 düştü (10 m), kalan 140; READY leventte durum değişmedi", c6.length === 1 && c6[0].beamId === b3 && c6[0].lengthM?.equals(10) === true && (await kalan(b3)) === 140 && (await prisma.warpBeam.findUniqueOrThrow({ where: { id: b3 }, select: { status: true } })).status === WarpBeamStatus.READY);

    console.log("\n── §7 Çok hatlı makine: hat payı, kardeş toplar toplamı = tam boy ──");
    const b4 = await sar(1000);
    await mountBeam(b4, { machineId: loom2.id, position: 1 });
    const d7a = await doff(loom2.id, 1);
    const d7b = await doff(loom2.id, 2);
    const r7a = await top(d7a, 100);
    const r7b = await top(d7b, 100);
    const c7 = [...(await consumedOf((r7a.data as { id: string }).id)), ...(await consumedOf((r7b.data as { id: string }).id))];
    check("§7 ⭐ 2 hat: her top 100 ÷ 2 = 50 m kumaş → 62,5 m çözgü; iki top toplamı 125 = tam boy (çift sayım yok), uyarı 'hat payı'", c7.length === 2 && c7.every((c) => c.fabricLengthM?.equals(50) && c.lengthM?.equals(62.5)) && (await kalan(b4)) === 875 && (r7a.warnings ?? []).some((w) => /hat payı/.test(w)));

    console.log("\n── §8 Beyansız doff damgası DB SAATİNDEN: Node saati 5 sn geride olsa da takma→indirme sırası bozulmaz ──");
    // Takma satırının `createdAt`i DB saatidir; beyansız `doffedAt` Node saatinden gelirse iki saat karşılaştırılır ve
    // Node'un geride kaldığı her ms'de "indirme takmadan önce" görünür → helper boş döner (bir CI treninde 11 kırmızı).
    const b8 = await sar(600);
    await mountBeam(b8, { machineId: loom.id, position: 1 }); // tek hatlı tezgah; yuva 1 §6'da boşaldı (b3 söküldü)
    const RealDate = Date;
    const KAYMA_MS = -5_000;
    class KaymisDate extends RealDate {
      constructor(...args: unknown[]) { if (args.length === 0) super(RealDate.now() + KAYMA_MS); else super(...(args as [number])); }
      static override now(): number { return RealDate.now() + KAYMA_MS; }
    }
    let d8: string;
    let dbNowBefore: Date;
    let dbNowAfter: Date;
    globalThis.Date = KaymisDate as DateConstructor;
    try {
      dbNowBefore = (await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now -- tz-ok: DB saati okuması, damgayla aynı kaynak`)[0]!.now;
      d8 = await doff(loom.id);
      dbNowAfter = (await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now -- tz-ok: DB saati okuması, damgayla aynı kaynak`)[0]!.now;
    } finally {
      globalThis.Date = RealDate;
    }
    const doff8 = await prisma.doffEvent.findUniqueOrThrow({ where: { id: d8 }, select: { doffedAt: true } });
    const damgaDbAraliginda = doff8.doffedAt.getTime() >= dbNowBefore.getTime() - 1_000 && doff8.doffedAt.getTime() <= dbNowAfter.getTime() + 1_000;
    check("§8a ⭐ beyansız doffedAt DB saatinden (Node 5 sn geride iken bile DB `now()` aralığında)", damgaDbAraliginda, `doffedAt=${doff8.doffedAt.toISOString()} db=[${dbNowBefore.toISOString()} … ${dbNowAfter.toISOString()}]`);
    const r8 = await top(d8, 60);
    const c8 = (await consumedOf((r8.data as { id: string }).id)).filter((c) => c.beamId === b8);
    check("§8b ⭐ Node saati geride olsa da CONSUMED yazıldı (takma DB saatinde < indirme DB saatinde)", c8.length === 1 && (await kalan(b8)) === 525, `consumed=${c8.length} kalan=${await kalan(b8)}`);
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: [loom.id, loom2.id] } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: [spec.id, specNull.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, fabric.id] } } });
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: { in: [loom.id, loom2.id] } } });
    await prisma.station.deleteMany({ where: { id: { in: [stDv.id, stLoom.id] } } });
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
