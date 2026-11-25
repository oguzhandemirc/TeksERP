// =============================================================================
// test_atki_kanal_hesap — atkı renk seçici kanalı (K6a) + atkı hesap paneli ucu (K4), GERÇEK DB
// Kabul: kanal 1..16 saklanır, boş = null; aynı kartta çift kanal 400 WEFT_CHANNEL_DUPLICATE, aralık dışı
// 400 WEFT_CHANNEL_INVALID; DB CHECK + unique ikinci sed; "yalnız bu kumaş için kopya" ve ürün penceresi
// taslağı kanalı taşır; tablet yükü kanalı taşır; sıra kodu güncellemesi kanalı silmez. Hesap ucu: elle boyda
// el hesabı (80 + 40 kg/1000 m) ve motorla (assembleCostInputTx → yarnUsagePerM) bayt-eşit; kumaş bağlamında
// boy YAPI'dan, fireli kg firesizden büyük; eksik veride missing[]. Fikstür `TEST-K6-<ts>`.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createWeftSpec, updateWeftSpec } from "../src/services/weft-spec.service";
import { forkWeftSpecForItem } from "../src/services/weft-spec-fork.service";
import { attachNewWeftSpecToItem } from "../src/services/weft-spec-draft.service";
import { calculateWeftNeed } from "../src/services/weft-calc.service";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { yarnUsagePerM } from "../src/services/helpers/fabric-cost.helper";
import { resolveEffectiveConstruction } from "../src/services/helpers/effective-construction.helper";
import { toTabletConstruction } from "../src/services/helpers/tablet-construction.helper";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: unknown } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: e.details?.code };
    return { status: 500, code: (e as { code?: string }).code };
  }
}

const TAG = `TEST-K6-${Date.now()}`;
const ids = { items: [] as string[], weft: [] as string[] };
const chans = async (id: string): Promise<Array<number | null>> =>
  (await prisma.weftSpecYarn.findMany({ where: { weftSpecId: id }, orderBy: { sortOrder: "asc" }, select: { colorChannel: true } })).map((y) => y.colorChannel);

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const mkItem = async (s: string, itemType: "YARN" | "FABRIC", den = 150): Promise<string> => {
    const r = await prisma.item.create({
      data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType, unit: itemType === "YARN" ? "KG" : "MT", ...(itemType === "YARN" ? { linearDensityDen: den } : {}) },
      select: { id: true },
    });
    ids.items.push(r.id);
    return r.id;
  };
  const y1 = await mkItem("Y1", "YARN", 150);
  const y2 = await mkItem("Y2", "YARN", 300);
  const y3 = await mkItem("Y3", "YARN", 150);

  console.log("§1 kanal yazımı ve doğrulama");
  const w = await createWeftSpec({ code: `${TAG}-W`, name: `${TAG} atkı`, picksPerCm: "20", sequenceCode: "A4 B1", yarns: [{ yarnItemId: y1, colorChannel: 3 }, { yarnItemId: y2 }] }, admin.id);
  ids.weft.push(w.id);
  check("§1a kanal saklandı, boş satır null", JSON.stringify(await chans(w.id)) === "[3,null]", JSON.stringify(await chans(w.id)));
  check("§1b okuma seçimi kanalı döner", w.yarns[0]!.colorChannel === 3 && w.yarns[1]!.colorChannel === null);
  const dup = await errOf(() => updateWeftSpec(w.id, { yarns: [{ yarnItemId: y1, colorChannel: 3 }, { yarnItemId: y2, colorChannel: 3 }] }, admin.id));
  check("§1c aynı kartta çift kanal → 400 WEFT_CHANNEL_DUPLICATE, kart değişmedi", dup?.status === 400 && dup.code === "WEFT_CHANNEL_DUPLICATE" && JSON.stringify(await chans(w.id)) === "[3,null]", JSON.stringify(dup));
  for (const bad of [0, 17, 2.5, "x"]) {
    const r = await errOf(() => updateWeftSpec(w.id, { yarns: [{ yarnItemId: y1, colorChannel: bad }, { yarnItemId: y2 }] }, admin.id));
    check(`§1d kanal ${JSON.stringify(bad)} → 400 WEFT_CHANNEL_INVALID`, r?.status === 400 && r.code === "WEFT_CHANNEL_INVALID", JSON.stringify(r));
  }
  await updateWeftSpec(w.id, { sequenceCode: "A2 B2" }, admin.id);
  check("§1e yalnız sıra kodu güncellemesi kanalı silmez", JSON.stringify(await chans(w.id)) === "[3,null]");
  await updateWeftSpec(w.id, { yarns: [{ yarnItemId: y1, colorChannel: 16 }, { yarnItemId: y2, colorChannel: 1 }] }, admin.id);
  check("§1f sınır değerler 1 ve 16 kabul", JSON.stringify(await chans(w.id)) === "[16,1]");

  console.log("§2 DB sedleri (servisi atlayan yazıcı)");
  const yarnRow = await prisma.weftSpecYarn.findFirstOrThrow({ where: { weftSpecId: w.id, sortOrder: 0 }, select: { id: true } });
  const ck = await errOf(() => prisma.$executeRawUnsafe(`UPDATE weft_spec_yarns SET "colorChannel" = 17 WHERE id = $1::uuid`, yarnRow.id));
  check("§2a CHECK: 17 reddedilir", ck !== null, JSON.stringify(ck));
  const uq = await errOf(() => prisma.$executeRawUnsafe(`UPDATE weft_spec_yarns SET "colorChannel" = 1 WHERE id = $1::uuid`, yarnRow.id));
  check("§2b unique: aynı kartta ikinci kanal 1 reddedilir", uq !== null, JSON.stringify(uq));

  console.log("§3 kopya ve taslak kanalı taşır");
  const [fa, fb] = [await mkItem("KA", "FABRIC"), await mkItem("KB", "FABRIC")];
  await prisma.item.updateMany({ where: { id: { in: [fa, fb] } }, data: { weftSpecId: w.id } });
  const fork = await forkWeftSpecForItem(w.id, { itemId: fa, code: `${TAG}-WA`, name: `${TAG} atkı KA` }, admin.id);
  ids.weft.push(fork.weftSpec.id);
  check("§3a kopya kanalları birebir taşıdı", JSON.stringify(await chans(fork.weftSpec.id)) === "[16,1]", JSON.stringify(await chans(fork.weftSpec.id)));
  const fc = await mkItem("KC", "FABRIC");
  const att = await attachNewWeftSpecToItem({ itemId: fc, expectedWeftSpecId: null, weft: { picksPerCm: "18", yarns: [{ yarnItemId: y1, picksInRepeat: 2, colorChannel: 5 }, { yarnItemId: y3, picksInRepeat: 1 }] } }, admin.id);
  ids.weft.push(att.weftSpec.id);
  check("§3b ürün penceresi taslağı kanalı yazdı", JSON.stringify(await chans(att.weftSpec.id)) === "[5,null]");
  const retry = (ch: number) => attachNewWeftSpecToItem({ itemId: fc, expectedWeftSpecId: null, weft: { picksPerCm: "18", yarns: [{ yarnItemId: y1, picksInRepeat: 2, colorChannel: ch }, { yarnItemId: y3, picksInRepeat: 1 }] } }, admin.id);
  const again = await retry(5).catch((e: unknown) => e);
  check("§3c aynı içerik tekrarı replay", (again as { replayed?: boolean }).replayed === true, String((again as Error).message ?? ""));
  const otherCh = await errOf(() => retry(6));
  check("§3d kanalı farklı tekrar replay SAYILMAZ (409 WEFT_SPEC_BINDING_CHANGED)", otherCh?.status === 409 && otherCh.code === "WEFT_SPEC_BINDING_CHANGED", JSON.stringify(otherCh));

  console.log("§4 tablet yükü");
  const c = await resolveEffectiveConstruction(prisma, fa, null);
  const dto = toTabletConstruction("00000000-0000-0000-0000-000000000000", c);
  check("§4a tablet atkı satırları kanalı taşır", JSON.stringify(dto?.weft?.yarns.map((y) => y.colorChannel)) === "[16,1]", JSON.stringify(dto?.weft?.yarns));

  console.log("§5 atkı hesap ucu (K4)");
  const manual = await calculateWeftNeed({ picksPerCm: 20, weftLengthCm: 300, sequenceCode: "A4 B1", yarns: [{ yarnItemId: y1 }, { yarnItemId: y2 }] });
  check("§5a el hesabı: A 80 kg, B 40 kg / 1000 m (firesiz)", manual.rows[0]!.netKg === 80 && manual.rows[1]!.netKg === 40 && manual.totalNetKg === 120, JSON.stringify(manual.rows.map((r) => r.netKg)));
  check("§5b boy kaynağı ELLE, pay %66,7/%33,3", manual.lengthSource === "ELLE" && manual.rows[0]!.sharePct === 66.7 && manual.rows[1]!.sharePct === 33.3);
  const fk = await mkItem("KK", "FABRIC");
  await prisma.item.update({ where: { id: fk }, data: { weftSpecId: w.id } });
  await prisma.costStructure.create({ data: { itemId: fk, weftLengthCm: 280, weftWastePct: 5 } });
  await updateWeftSpec(w.id, { sequenceCode: "A4 B1" }, admin.id);
  const ctx = await calculateWeftNeed({ itemId: fk, picksPerCm: 20, sequenceCode: "A4 B1", yarns: [{ yarnItemId: y1 }, { yarnItemId: y2 }] });
  const engine = yarnUsagePerM(await assembleCostInputTx(prisma, { itemId: fk }));
  const engineNet = yarnUsagePerM(await assembleCostInputTx(prisma, { itemId: fk }), { includeWaste: false });
  const kg = (d: { kgPerM: { mul(n: number): { toDecimalPlaces(n: number): { toString(): string } } } } | undefined) => (d ? Number(d.kgPerM.mul(1000).toDecimalPlaces(3).toString()) : null);
  check("§5c kumaş bağlamında boy YAPI (280 cm)", ctx.lengthSource === "YAPI" && ctx.lengthCm === 280, `${ctx.lengthSource} ${ctx.lengthCm}`);
  check("§5d fireli/firesiz kg motorla bayt-eşit (tek kaynak)", ctx.rows.every((r, i) => r.grossKg === kg(engine.weft[i]) && r.netKg === kg(engineNet.weft[i])), JSON.stringify([ctx.rows.map((r) => [r.netKg, r.grossKg]), engine.weft.map(kg)]));
  check("§5e fireli > firesiz, fire %5 KART zincirinden", ctx.rows.every((r) => r.grossKg! > r.netKg! && r.wastePct === 5 && r.wasteSource === "KART"));
  const noLen = await calculateWeftNeed({ picksPerCm: 20, yarns: [{ yarnItemId: y1, picksInRepeat: 1 }] });
  check("§5f kumaşsız + boysuz: kg '—', missing WEFT_LENGTH_MISSING", noLen.totalNetKg === null && noLen.missing.some((m) => m.code === "WEFT_LENGTH_MISSING"), JSON.stringify(noLen.missing));
  const badSeq = await calculateWeftNeed({ picksPerCm: 20, weftLengthCm: 300, sequenceCode: "A4 Z1", yarns: [{ yarnItemId: y1 }] });
  check("§5g okunamayan sıra kodu 400 değil missing", badSeq.missing.some((m) => m.code === "WEFT_SEQUENCE_INVALID") && badSeq.totalNetKg === null);
  const before = await prisma.weftSpecYarn.count({ where: { weftSpecId: w.id } });
  await calculateWeftNeed({ itemId: fk, picksPerCm: 25, weftLengthCm: 100, yarns: [{ yarnItemId: y3, picksInRepeat: 1 }] });
  const after = await prisma.weftSpec.findUniqueOrThrow({ where: { id: w.id }, select: { picksPerCm: true, _count: { select: { yarns: true } } } });
  check("§5h hesap ucu yazmaz (kart sıklığı + satırları aynı)", after.picksPerCm?.toString() === "20" && after._count.yarns === before);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  const extra = await prisma.weftSpec.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
  const weft = [...new Set([...ids.weft, ...extra.map((x) => x.id)])];
  await t(() => prisma.costStructure.deleteMany({ where: { itemId: { in: ids.items } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: ids.items } }, data: { weftSpecId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: weft } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: { in: weft } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
