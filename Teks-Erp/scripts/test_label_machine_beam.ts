// =============================================================================
// TEST: Tezgah (MACHINE) + levent (WARP_BEAM) etiketi — dokuma manuel veri S1b
// Çalıştır: npx tsx scripts/test_label_machine_beam.ts
// =============================================================================
// Sözleşme (docs/design/DOKUMA-MANUEL-PLAN.md § S1b, D3, D12):
//   §1 payload barkod = Machine.code / WarpBeam.beamNo (tek kod; ayrı barkod kolonu yok)
//   §2 şablon atanmamış → 400 (fail-closed, ROLL şablonuna SAPMAZ)
//   §3 copies=3 → 3 etiket · 200 → 200 (emit tavanı 100 aşıldı) · 201/0 → 400 ·
//      native 150 → ≤100'lük iki iş (^PQ100 + ^PQ50)
//   §4 `machineCode`/`beamNo` bağlamayan şablon analyzeContextFit'e UYMAZ + atanamaz
//   §5 dokuma istasyonunda olmayan makine → 400 MACHINE_NOT_LOOM
//   §6 pasif tezgah → 409 MACHINE_INACTIVE
//   §7 eski panel katalog süzgeci: `kinds=all` yoksa yeni bağlam görünmez
//
// NEGATİF SONDA (2026-10-21, md5 ile geri alındı):
//   S1 label-context-fit.ts IDENTITY_BIND MACHINE satırı silindi → §4 KIRMIZI (8 geçti, 4 başarısız)
//   S2 resolveBatchCopies tavan koşulu (`copies > MAX`) kaldırıldı → §3 KIRMIZI (27 geçti, 2 başarısız)
// Fixture `TST-S1B-` önekli; yalnız kendi yarattığını siler (audit izi kalır — defter).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";
import { LabelTemplateService } from "../src/services/label-template.service";
import { analyzeContextFit } from "../src/services/helpers/label-context-fit";
import { AppError } from "../src/utils/app-error";
import { LabelKind } from "@prisma/client";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
const codeOf = (e: unknown) => (e instanceof AppError ? (e.details as { code?: string } | undefined)?.code : undefined);
const statusOf = (e: unknown) => (e instanceof AppError ? e.statusCode : 0);
async function errOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
}
const countLabels = (html: string) => (html.match(/class="label"/g) ?? []).length;

const TS = Date.now().toString().slice(-7);
const P = `TST-S1B-${TS}`;
const labels = new LabelService();
const templates = new LabelTemplateService();

let ADMIN = "";
const ids = { stations: [] as string[], machines: [] as string[], templates: [] as string[], items: [] as string[] };
let specId = "";
let beamId = "";
let peripheralId = "";
const prevDefaults = new Map<LabelKind, string | null>();

/** Kanvas varyantlı şablon — zorunlu barkod elemanı + verilen bind'ler. */
async function makeTemplate(name: string, kind: LabelKind, binds: string[]): Promise<string> {
  const created = (await templates.create({ name: `${P} ${name}`, kind }, ADMIN)) as unknown as { data: { id: string } };
  const id = created.data.id;
  ids.templates.push(id);
  const elements = [
    { id: "bc1", type: "code128", xMm: 4, yMm: 4, wMm: 60, hMm: 12 },
    ...binds.map((b, i) => ({ id: `f${i}`, type: "field", bind: b, xMm: 4, yMm: 20 + i * 6, hMm: 4 })),
  ];
  const v = await prisma.labelTemplateVariant.findFirst({ where: { templateId: id }, select: { id: true } });
  if (v) await prisma.labelTemplateVariant.update({ where: { id: v.id }, data: { elements: { v: 1, elements } } });
  else
    await prisma.labelTemplateVariant.create({
      data: { templateId: id, name: "Varsayılan", widthMm: 100, heightMm: 60, isPrimary: true, elements: { v: 1, elements } },
    });
  return id;
}

async function makeStation(suffix: string, kind: "WEAVING" | "TAMBUR"): Promise<string> {
  const s = await prisma.station.create({
    data: { code: `${P}-${suffix}`.slice(0, 32), name: `${P} ${suffix}`, type: "INTERNAL", kind },
    select: { id: true },
  });
  ids.stations.push(s.id);
  return s.id;
}

async function makeMachine(stationId: string, suffix: string, isActive = true): Promise<{ id: string; code: string }> {
  const m = await prisma.machine.create({
    data: { stationId, code: `TZ${TS}${suffix}`.slice(0, 32), name: `${P} Tezgah ${suffix}`, isActive },
    select: { id: true, code: true },
  });
  ids.machines.push(m.id);
  return m;
}

async function setup(): Promise<{ loom: { id: string; code: string }; beamNo: string }> {
  ADMIN = await testActorId();
  for (const k of [LabelKind.MACHINE, LabelKind.WARP_BEAM]) {
    const d = await prisma.labelContextDefault.findUnique({ where: { kind: k }, select: { templateId: true } });
    prevDefaults.set(k, d?.templateId ?? null);
    if (d) await prisma.labelContextDefault.delete({ where: { kind: k } });
  }
  const weaving = await makeStation("DOKUMA", "WEAVING");
  const loom = await makeMachine(weaving, "A");
  const yarn = await prisma.item.create({ data: { code: `${P}-IP`, name: `${P} İplik`, itemType: "YARN" }, select: { id: true } });
  ids.items.push(yarn.id);
  specId = (
    await prisma.warpSpec.create({ data: { code: `${P}-CZ`.slice(0, 32), name: `${P} Çözgü`, yarnItemId: yarn.id, endsCount: 3200 }, select: { id: true } })
  ).id;
  const beam = await prisma.warpBeam.create({
    data: { beamNo: `LV${TS}`, warpSpecId: specId, plannedLengthM: 1500, physicalBeamNo: "G-27" },
    select: { id: true, beamNo: true },
  });
  beamId = beam.id;
  peripheralId = (
    await prisma.peripheralDevice.create({
      data: { code: `${P}-YZ`, name: `${P} ZPL yazıcı`, kind: "LABEL_PRINTER", connectionType: "NETWORK_TCP", languageOverride: "ZPL" },
      select: { id: true },
    })
  ).id;
  return { loom, beamNo: beam.beamNo };
}

async function run(): Promise<void> {
  const { loom, beamNo } = await setup();

  console.log("\n=== §1 payload barkod = Machine.code / beamNo ===");
  const mp = (await labels.getMachineLabel(loom.id)).data;
  check("tezgah barkodu = Machine.code", mp.barcode === loom.code, mp.barcode);
  check("machineCode = Machine.code · kind MACHINE", mp.machineCode === loom.code && mp.kind === LabelKind.MACHINE);
  check("stationName dolu", (mp.stationName ?? "").includes("DOKUMA"));
  const bp = (await labels.getWarpBeamLabel(beamId)).data;
  check("levent barkodu = beamNo", bp.barcode === beamNo && bp.beamNo === beamNo, bp.barcode);
  check("sarılmamış levent: plan 1500, sarım metresi boş", bp.plannedLengthM === 1500 && bp.woundLengthM == null);

  console.log("\n=== §2 şablon atanmamış → 400 (fail-closed) ===");
  let e = await errOf(() => labels.getMachineLabelHtml(loom.id));
  check("tezgah şablonsuz 400", statusOf(e) === 400 && codeOf(e) === "LABEL_TEMPLATE_MISSING", (e as Error)?.message?.slice(0, 80));
  e = await errOf(() => labels.getWarpBeamLabelNative(beamId));
  check("levent şablonsuz native 400", statusOf(e) === 400);

  console.log("\n=== §4 kimlik alanını bağlamayan şablon uymaz ===");
  const noId = await makeTemplate("kimliksiz", LabelKind.MACHINE, ["machineName", "stationName"]);
  const tplRow = await prisma.labelTemplate.findUniqueOrThrow({ where: { id: noId }, select: { name: true, variants: true } });
  const fit = analyzeContextFit(tplRow, LabelKind.MACHINE);
  check("analyzeContextFit(MACHINE, machineCode'suz) uymaz", !fit.ok && fit.reason === "missing-identity");
  check('mesaj "Tezgah Kodu"nu adıyla söylüyor', !fit.ok && fit.message.includes("Tezgah Kodu"));
  e = await errOf(() => templates.setContextDefault(LabelKind.MACHINE, noId, ADMIN));
  check("setContextDefault(MACHINE, kimliksiz) 400", statusOf(e) === 400);
  const beamNoId = await makeTemplate("levent kimliksiz", LabelKind.WARP_BEAM, ["warpSpecName"]);
  const bRow = await prisma.labelTemplate.findUniqueOrThrow({ where: { id: beamNoId }, select: { name: true, variants: true } });
  const bFit = analyzeContextFit(bRow, LabelKind.WARP_BEAM);
  check("analyzeContextFit(WARP_BEAM, beamNo'suz) uymaz", !bFit.ok && bFit.message.includes("Levent No"));
  // Baskı anı son savunma: bağlam varsayılanı arkadan (raw) bozulursa da 400.
  await prisma.labelContextDefault.create({ data: { kind: LabelKind.MACHINE, templateId: noId } });
  e = await errOf(() => labels.getMachineLabelHtml(loom.id));
  check("baskı anı: kimliksiz bağlam varsayılanı 400", statusOf(e) === 400 && /『.+』/.test((e as Error).message));
  await prisma.labelContextDefault.delete({ where: { kind: LabelKind.MACHINE } });

  const good = await makeTemplate("tezgah", LabelKind.MACHINE, ["machineCode", "machineName", "stationName"]);
  await templates.setContextDefault(LabelKind.MACHINE, good, ADMIN);
  const bGood = await makeTemplate("levent", LabelKind.WARP_BEAM, ["beamNo", "warpSpecCode", "plannedLengthM", "woundLengthM"]);
  await templates.setContextDefault(LabelKind.WARP_BEAM, bGood, ADMIN);
  const g = analyzeContextFit(await prisma.labelTemplate.findUniqueOrThrow({ where: { id: good }, select: { name: true, variants: true } }), LabelKind.MACHINE);
  check("machineCode bağlayan şablon uyar", g.ok);

  console.log("\n=== §3 kopya: 1-200, üstü/altı 400 ===");
  const one = await labels.getMachineLabelHtml(loom.id);
  check("copies yok → 1 etiket · kod basılı", countLabels(one.data.html) === 1 && one.data.html.includes(loom.code));
  const three = await labels.getMachineLabelHtml(loom.id, { copies: 3 });
  check("copies=3 → 3 etiket", countLabels(three.data.html) === 3, `sayfa=${countLabels(three.data.html)}`);
  const max = await labels.getMachineLabelHtml(loom.id, { copies: 200 });
  check("copies=200 → 200 etiket (emit tavanı 100 aşıldı)", countLabels(max.data.html) === 200, `sayfa=${countLabels(max.data.html)}`);
  e = await errOf(() => labels.getMachineLabelHtml(loom.id, { copies: 201 }));
  check("copies=201 → 400 LABEL_COPIES_RANGE", statusOf(e) === 400 && codeOf(e) === "LABEL_COPIES_RANGE");
  e = await errOf(() => labels.getMachineLabelHtml(loom.id, { copies: 0 }));
  check("copies=0 → 400", statusOf(e) === 400);
  e = await errOf(() => labels.getMachineLabelHtml(loom.id, { copies: Number.NaN }));
  check("copies=sayı değil → 400", statusOf(e) === 400);
  const bHtml = await labels.getWarpBeamLabelHtml(beamId, { copies: 2 });
  check("levent copies=2 → 2 etiket · beamNo basılı", countLabels(bHtml.data.html) === 2 && bHtml.data.html.includes(beamNo));
  const nat = await labels.getMachineLabelNative(loom.id, { copies: 150, peripheralId });
  const pq = nat.data.content.match(/\^PQ\d+/g) ?? [];
  check("native ZPL 150 → ^PQ100 + ^PQ50, count 150", pq.join(",") === "^PQ100,^PQ50" && nat.data.count === 150, pq.join(","));
  e = await errOf(() => labels.recordMachinePrintEvent(loom.id, ADMIN, 201));
  check("print-event copies=201 → 400", statusOf(e) === 400);
  const ev = await labels.recordMachinePrintEvent(loom.id, ADMIN, 3);
  check("print-event izi kaydedildi", ev.success === true);

  console.log("\n=== §5 dokuma dışı makine → 400 MACHINE_NOT_LOOM ===");
  const tambur = await makeStation("TAMBUR", "TAMBUR");
  const notLoom = await makeMachine(tambur, "T");
  e = await errOf(() => labels.getMachineLabelHtml(notLoom.id));
  check("dokuma dışı 400 MACHINE_NOT_LOOM", statusOf(e) === 400 && codeOf(e) === "MACHINE_NOT_LOOM");
  e = await errOf(() => labels.getMachineLabel(notLoom.id));
  check("payload ucu da 400", statusOf(e) === 400);

  console.log("\n=== §6 pasif tezgah → 409 MACHINE_INACTIVE ===");
  const weaving = ids.stations[0]!;
  const passive = await makeMachine(weaving, "P", false);
  e = await errOf(() => labels.getMachineLabelHtml(passive.id, { copies: 2 }));
  check("pasif tezgah 409 MACHINE_INACTIVE", statusOf(e) === 409 && codeOf(e) === "MACHINE_INACTIVE");
  e = await errOf(() => labels.recordMachinePrintEvent(passive.id, ADMIN));
  check("pasif tezgah baskı izi de 409", statusOf(e) === 409);

  console.log("\n=== §7 eski panel katalog süzgeci ===");
  const legacy = templates.getUnifiedCatalogResponse().data.fields;
  const all = templates.getUnifiedCatalogResponse(true).data.fields;
  const hasNew = (fs: typeof all) => fs.some((f) => f.kinds.some((k) => k === LabelKind.MACHINE || k === LabelKind.WARP_BEAM));
  check("parametresiz katalogda MACHINE/WARP_BEAM YOK", !hasNew(legacy) && !legacy.some((f) => f.key === "machineCode"));
  check("kinds=all katalogda var (machineCode, beamNo)", hasNew(all) && all.some((f) => f.key === "beamNo"));
}

async function teardown(): Promise<void> {
  for (const [k, prev] of prevDefaults) {
    await prisma.labelContextDefault.deleteMany({ where: { kind: k } });
    if (prev) await prisma.labelContextDefault.create({ data: { kind: k, templateId: prev } });
  }
  if (peripheralId) await prisma.peripheralDevice.deleteMany({ where: { id: peripheralId } });
  if (beamId) await prisma.warpBeam.deleteMany({ where: { id: beamId } });
  if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
  await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: ids.templates } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: ids.templates } } });
}

run()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await teardown().catch((e) => {
      console.error("teardown hatası:", e);
      fail++;
    });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
