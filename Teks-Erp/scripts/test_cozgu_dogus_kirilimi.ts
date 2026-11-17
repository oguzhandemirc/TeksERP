// =============================================================================
// ÇÖZGÜ DOĞUŞ KIRILIMI + OKUYUCU GÖÇÜ BEKÇİSİ — fason devere D2 (plan §4.2, S23 · S26 · S30)
// =============================================================================
// §1 tek iplikli kart (S26): WOUND gerçekleri bugünküyle bayt-aynı (`warpTheoreticalKg`, iplik denyesi) + TEK kırılım satırı.
// §2 çok iplikli kart (MONO, müşteri verisi 165 den × 5250 + 70 den × 5250, 2500 m): kırılım iki satır, WOUND
//    `theoreticalKg` = Σ satır, `endsCount` = Σ tel, `denier` = eşdeğer denye; DTO kg/m = Σ satır.
// §3 kart sonradan değişti (S23): kırılım ve WOUND değişmez.
// §4 içeride sarım + çok iplikli kart → 400 WARP_SPEC_MULTI_YARN_IN_HOUSE (S30); kalem bağı → 400.
// §5 maliyet: çok iplikli kartın kg/m'si = Σ satır, iplik başına ayrı WARP_YARN satırı; tek iplikte girdide `yarns` YOK.
// §6 tartıdan metre Σ kg/m ile · tablet bağlamı (çok iplikte denye null, kg/m dolu) · migration geri doldurması.
// DB'YE YAZAR: `TEST-CDK-<pid>` iplik/kart/levent; `finally`de FK sırasıyla silinir. Fasoncu kalıcı fixture'dan.
// Koşum: npx tsx scripts/run-all-tests.ts cozgu_dogus_kirilimi
//
// NEGATİF SONDA (2026-11-17 koşuldu, geri alındı):
//   · `writeWoundTx` içindeki `warpBeamEventYarn.createMany` kapatıldı → §1b, §2a, §2d, §3a, §6d kırmızı (5)
//   · `resolveWoundYarns` içinde S30 dalı (`lines.length > 1 && o.inHouse`) kaldırıldı → §4a kırmızı
//   · `warpKg` çok satır yerine yalnız ana ipliği okudu (`costWarpYarns` → `[w.yarn]`) → §5a/§5b kırmızı
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { Prisma, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { warpTheoreticalKg, warpYarnKgExact } from "../src/constants/warp-beam";
import { createWarpBeam, getWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { getWarpBeamTabletContext } from "../src/services/warp-beam-tablet.service";
import { warpLengthFromWeight } from "../src/services/helpers/warp-beam-mount.helper";
import { WARP_SPEC_YARN_DENIER_SELECT, warpSpecDenierLines, warpSpecKgPerMExact } from "../src/services/helpers/warp-spec-yarn.helper";
import { buildCostInput, type CostSources } from "../src/services/helpers/cost-assembler.helper";
import { yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { AppError } from "../src/utils/app-error";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const TAG = `TEST-CDK-${process.pid}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED];

async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    if (e instanceof AppError) return String((e.details as { code?: string } | undefined)?.code ?? e.statusCode);
    throw e;
  }
}

function backfillSql(beamId: string): string {
  const file = path.resolve(__dirname, "../prisma/migrations/20261117190000_warp_beam_event_yarns/migration.sql");
  const sql = fs.readFileSync(file, "utf8");
  const start = sql.lastIndexOf('INSERT INTO "warp_beam_event_yarns"');
  if (start < 0) throw new Error("geri doldurma INSERT'i bulunamadı");
  const stmt = sql.slice(start).replace(/;\s*$/, "").trim();
  if (!/NOT EXISTS/.test(stmt)) throw new Error("geri doldurma NOT EXISTS taşımıyor");
  return `${stmt} AND e."beamId" = '${beamId}'::uuid`;
}

/** Bellek içi maliyet kaynağı — kart DB'den (tek okuyucu select'iyle), parametreler sabit (take-up/fire 0). */
function costSrc(spec: Parameters<typeof warpSpecDenierLines>[0] & { id: string }): CostSources {
  const item = {
    id: "i1", code: "K1", name: "K1", itemType: "FABRIC", isActive: true, rawWidthCm: D(300),
    warpSpec: { ...spec, takeUpPct: D(0), wastePct: D(0), reedWidthCm: D(310) },
    weftSpec: null, costStructure: null,
  };
  return {
    items: new Map([["i1", item]]), params: { id: "p1", defaultTakeUpPct: D(5), defaultWarpWastePct: D(3), weftSelvedgeAllowanceCm: D(0) },
    prices: new Map(), rates: new Map(), asOf: new Date(), weavingMethod: "TEZGAH_SAATI", warpLayers: new Map(),
  } as unknown as CostSources;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== ÇÖZGÜ DOĞUŞ KIRILIMI BEKÇİSİ ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const sub = await ensureTestDyeHouse();
  const yA = await prisma.item.create({ data: { code: `${TAG}-A`, name: `${TAG} 165 TTM`, itemType: "YARN", unit: "KG", linearDensityDen: 165 }, select: { id: true } });
  const yB = await prisma.item.create({ data: { code: `${TAG}-B`, name: `${TAG} 70/800`, itemType: "YARN", unit: "KG", linearDensityDen: 70 }, select: { id: true } });
  const single = await prisma.warpSpec.create({ data: { code: `${TAG}-TEK`, name: `${TAG} tek`, yarnItemId: yB.id, endsCount: 7000 }, select: { id: true } });
  // Çok iplikli kart yazma yüzeyi D3'te açılır — burada satırlar doğrudan yazılır (plan D2 kabulü).
  const mono = await prisma.warpSpec.create({ data: { code: `${TAG}-MONO`, name: `${TAG} mono`, yarnItemId: yA.id, endsCount: 10500 }, select: { id: true } });
  await prisma.warpSpecYarn.createMany({ data: [{ warpSpecId: mono.id, yarnItemId: yA.id, endsCount: 5250, sortOrder: 0 }, { warpSpecId: mono.id, yarnItemId: yB.id, endsCount: 5250, sortOrder: 1 }] });
  const beamIds: string[] = [];
  const plan = async (specId: string, originKind: WarpBeamOrigin) => {
    const b = await createWarpBeam({ warpSpecId: specId, plannedLengthM: 2500, originKind, ...(originKind === WarpBeamOrigin.IN_HOUSE ? {} : { subcontractorId: sub.id }) });
    beamIds.push(b.data.id);
    return b.data.id;
  };
  try {
    for (const key of FLAGS) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });

    console.log("── §1 Tek iplikli kart (S26 bayt-aynı) ──");
    const b1 = await plan(single.id, WarpBeamOrigin.SUBCONTRACT);
    await windWarpBeam(b1, { lengthM: 2500, kgSource: WarpKgSource.THEORETICAL });
    const w1 = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: b1, kind: "WOUND" }, select: { endsCount: true, denier: true, theoreticalKg: true, yarns: { select: { yarnItemId: true, endsCount: true, denier: true, theoreticalKg: true } } } });
    const bugun = warpTheoreticalKg(7000, 70, 2500);
    check("§1a WOUND gerçekleri bugünkü formülle aynı (7000 tel · 70 den · 48,611 kg)", w1.endsCount === 7000 && D(w1.denier!).equals(70) && D(w1.theoreticalKg!).equals(bugun), `${String(w1.theoreticalKg)} ↔ ${bugun.toString()}`);
    check("§1b TEK kırılım satırı = WOUND gerçekleri", w1.yarns.length === 1 && w1.yarns[0]!.yarnItemId === yB.id && w1.yarns[0]!.endsCount === 7000 && D(w1.yarns[0]!.theoreticalKg).equals(bugun));

    console.log("\n── §2 Çok iplikli kart (MONO) ──");
    const b2 = await plan(mono.id, WarpBeamOrigin.SUBCONTRACT);
    const r2 = await windWarpBeam(b2, { lengthM: 2500, kgSource: WarpKgSource.THEORETICAL });
    const w2 = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: b2, kind: "WOUND" }, select: { id: true, endsCount: true, denier: true, theoreticalKg: true, yarns: { select: { yarnItemId: true, endsCount: true, denier: true, theoreticalKg: true } } } });
    const kA = w2.yarns.find((y) => y.yarnItemId === yA.id);
    const kB = w2.yarns.find((y) => y.yarnItemId === yB.id);
    check("§2a kırılım iki satır: 240,625 kg + 102,083 kg (S2 / 2 levent)", w2.yarns.length === 2 && !!kA && !!kB && D(kA.theoreticalKg).equals("240.625") && D(kB.theoreticalKg).equals("102.083"), w2.yarns.map((y) => String(y.theoreticalKg)).join(" + "));
    check("§2b WOUND: Σ tel 10500 · Σ kg 342,708 · eşdeğer denye 117,5", w2.endsCount === 10500 && D(w2.theoreticalKg!).equals("342.708") && D(w2.denier!).equals("117.5"), `${String(w2.endsCount)} · ${String(w2.theoreticalKg)} · ${String(w2.denier)}`);
    const dto = r2.data;
    const kgPerM = warpYarnKgExact(5250, 165, 1).plus(warpYarnKgExact(5250, 70, 1));
    check("§2c DTO: kart kg/m = Σ satır, eşdeğer denye ana iplikte, iki satır", dto.warpSpec.yarns.length === 2 && dto.warpSpec.kgPerM === Number(kgPerM) && dto.warpSpec.yarnItem.linearDensityDen === 117.5, `${String(dto.warpSpec.kgPerM)} ↔ ${kgPerM.toString()}`);
    check("§2d DTO wound.yarns iki satır (doğuş kırılımı)", dto.wound?.yarns.length === 2 && dto.wound.yarns.reduce((s, y) => s + y.theoreticalKg, 0).toFixed(3) === "342.708");
    check("§2e eski istemci ön hesabı (endsCount × denye × m) Σ ile aynı", warpTheoreticalKg(dto.warpSpec.endsCount, dto.warpSpec.yarnItem.linearDensityDen!, 2500).equals("342.708"));

    console.log("\n── §3 Kart sonradan değişti (S23) ──");
    await prisma.warpSpecYarn.updateMany({ where: { warpSpecId: mono.id, yarnItemId: yB.id }, data: { endsCount: 6000 } });
    await prisma.item.update({ where: { id: yA.id }, data: { linearDensityDen: 190 } });
    const g3 = await getWarpBeam(b2);
    check("§3a doğmuş leventin kırılımı ve kg'ı değişmedi", g3.data.wound?.theoreticalKg === 342.708 && g3.data.wound.yarns.map((y) => y.theoreticalKg).sort().join(",") === "102.083,240.625");
    check("§3b kart okuyucusu YENİ değeri görür (kopya ≠ canlı)", g3.data.warpSpec.yarns.find((y) => y.yarnItemId === yB.id)?.endsCount === 6000);
    await prisma.warpSpecYarn.updateMany({ where: { warpSpecId: mono.id, yarnItemId: yB.id }, data: { endsCount: 5250 } });
    await prisma.item.update({ where: { id: yA.id }, data: { linearDensityDen: 165 } });

    console.log("\n── §4 Kapılar (S30) ──");
    const b4 = await plan(mono.id, WarpBeamOrigin.IN_HOUSE);
    check("§4a ⭐ içeride sarım + çok iplikli kart → 400 WARP_SPEC_MULTI_YARN_IN_HOUSE", (await hataKodu(() => windWarpBeam(b4, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL }))) === "WARP_SPEC_MULTI_YARN_IN_HOUSE");
    const b5 = await plan(mono.id, WarpBeamOrigin.SUBCONTRACT);
    check("§4b çok iplikli kartta iplik kalemi bağı → 400 WARP_SPEC_MULTI_YARN_DISPATCH_ITEM", (await hataKodu(() => windWarpBeam(b5, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL, dispatchItemId: crypto.randomUUID() }))) === "WARP_SPEC_MULTI_YARN_DISPATCH_ITEM");
    const b6 = await plan(single.id, WarpBeamOrigin.IN_HOUSE);
    check("§4c tek iplikli kart içeride S30'a takılmaz (makinesiz → bugünkü 400 mesajı)", (await hataKodu(() => windWarpBeam(b6, { lengthM: 100, kgSource: WarpKgSource.THEORETICAL }))) === "400");

    console.log("\n── §5 Maliyet (çok iplikli kart kg/m = Σ) ──");
    const monoRow = await prisma.warpSpec.findUniqueOrThrow({ where: { id: mono.id }, select: { id: true, ...WARP_SPEC_YARN_DENIER_SELECT } });
    const singleRow = await prisma.warpSpec.findUniqueOrThrow({ where: { id: single.id }, select: { id: true, ...WARP_SPEC_YARN_DENIER_SELECT } });
    const inMono = buildCostInput(costSrc(monoRow), { itemId: "i1" });
    const uMono = yarnUsagePerM(inMono);
    check("§5a ⭐ kg/m = Σ satır (165×5250 + 70×5250)/9e6", uMono.warp?.kgPerM.equals(kgPerM) === true, `${uMono.warp?.kgPerM.toString()} ↔ ${kgPerM.toString()}`);
    check("§5b iplik başına kırılım (ihtiyaç planı iki ipliği ayrı görür)", uMono.warp?.yarns.length === 2 && uMono.warp.yarns.find((y) => y.yarnItemId === yB.id)?.kgPerM.equals(warpYarnKgExact(5250, 70, 1)) === true);
    const prices = new Map([[yA.id, { pricePerKg: D(5), currency: "TRY", createdAt: new Date() }], [yB.id, { pricePerKg: D(3), currency: "TRY", createdAt: new Date() }]]);
    const priced = buildCostInput({ ...costSrc(monoRow), prices } as unknown as CostSources, { itemId: "i1" });
    const yarnLinesOk = priced.warp?.yarns?.length === 2 && priced.warp.yarns.map((y) => y.price?.amount.toString()).join(",") === "5,3";
    check("§5c iplik başına fiyat girdide (her ipliğin WARP_YARN satırı kendi fiyatıyla)", yarnLinesOk);
    const inSingle = buildCostInput(costSrc(singleRow), { itemId: "i1" });
    check("§5d tek iplikli kartta girdide `yarns` anahtarı YOK (inputHash bayt-aynı)", !!inSingle.warp && !("yarns" in inSingle.warp) && yarnUsagePerM(inSingle).warp?.kgPerM.equals(warpYarnKgExact(7000, 70, 1)) === true);

    console.log("\n── §6 Tartı · tablet · geri doldurma ──");
    const kgm = warpSpecKgPerMExact(warpSpecDenierLines(monoRow))!;
    const m = warpLengthFromWeight(D("342.708").plus(50), 50, kgm);
    check("§6a tartıdan metre Σ kg/m ile (342,708 kg net → 2500 m)", m?.toDecimalPlaces(0).equals(2500) === true, m?.toString());
    const ctx = await getWarpBeamTabletContext();
    const tMono = ctx.data.warpSpecs.find((s) => s.id === mono.id);
    const tSingle = ctx.data.warpSpecs.find((s) => s.id === single.id);
    check("§6b tablet: çok iplikte denye null + kg/m dolu, tek iplikte denye bugünkü", tMono?.denier === null && tMono.yarnCount === 2 && tMono.kgPerM === Number(kgm) && tSingle?.denier === 70 && tSingle.yarnCount === 1);
    // Göç öncesi doğmuş WOUND benzetimi: b1'in WOUND'u yeni bir levente HAM yazılır (kırılımsız doğar; silme yok).
    const b0 = await plan(single.id, WarpBeamOrigin.SUBCONTRACT);
    const wSrc = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: b1, kind: "WOUND" } });
    const { id: _id, beamId: _beam, clientToken: _tok, createdAt: _at, ...wFacts } = wSrc;
    await prisma.warpBeamEvent.create({ data: { ...wFacts, beamId: b0 } });
    check("§6c0 ham WOUND kırılımsız doğar (geri doldurma öncesi)", (await prisma.warpBeamEventYarn.count({ where: { event: { beamId: b0 } } })) === 0);
    await prisma.$executeRawUnsafe(backfillSql(b0));
    await prisma.$executeRawUnsafe(backfillSql(b0));
    const bf = await prisma.warpBeamEventYarn.findMany({ where: { event: { beamId: b0 } }, select: { yarnItemId: true, endsCount: true, denier: true, theoreticalKg: true } });
    check("§6c migration geri doldurması: tek satır, olayın kopyası, iki koşum = fark yok", bf.length === 1 && bf[0]!.yarnItemId === yB.id && bf[0]!.endsCount === 7000 && D(bf[0]!.theoreticalKg).equals(bugun));
    const sayilar = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM warp_beam_events e WHERE e.kind = 'WOUND' AND NOT EXISTS (SELECT 1 FROM warp_beam_event_yarns y WHERE y."eventId" = e.id) AND e."beamId" = ANY($1::uuid[])`, beamIds);
    check("§6d bu bekçinin her WOUND'unda kırılım var (körlük zemini: ≥ 2 WOUND)", Number(sayilar[0]!.n) === 0 && (await prisma.warpBeamEvent.count({ where: { beamId: { in: beamIds }, kind: "WOUND" } })) >= 2);
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: [single.id, mono.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [yA.id, yB.id] } } });
    for (const key of FLAGS) {
      const f = foto.find((x) => x.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
