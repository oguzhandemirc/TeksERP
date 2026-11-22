// =============================================================================
// test_desen_karti_servis — desen kartı + atkı sıra kodu + varyant atkı değişimi + etkin yapı
// (Seyitoğlu SY-A2, GERÇEK DB). Kabul (§16.1): varyantlı fikstürde etkin atkı satırları el
// hesabına eşit; kart replace'i varyant sırasını yok edince 409 `WEFT_OVERRIDE_ORPHAN` + liste.
// Bugünkü davranış: sıra kodsuz atkı kartı elle adetle aynen yazılır; yapısız ürünün etkin
// yapısı boştur. Fikstür `TEST-SYA2-<ts>`; temizlik `finally`de FK sırasıyla.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { expandWeftSequence, parseWeftSequence } from "../src/services/helpers/weft-sequence.helper";
import { resolveEffectiveConstruction } from "../src/services/helpers/effective-construction.helper";
import { weavingOrderConstruction, weavingOrderTabletConstruction } from "../src/services/helpers/tablet-construction.helper";
import { buildWeaveCardView, renderWeavingOrderWeaveCard } from "../src/services/weave-card.service";
import { frameBlocks, renderWeaveDesignCardHtml } from "../src/services/document-render/weave-design-card.html";
import { createWeftSpec, updateWeftSpec } from "../src/services/weft-spec.service";
import { createWeaveDesign, deactivateWeaveDesign, getWeaveDesign, listWeaveDesigns, updateWeaveDesign } from "../src/services/weave-design.service";
import { replaceItemWarpLayers, replaceRecipeWeftOverrides } from "../src/services/item-construction.service";
import { itemService } from "../src/routes/item.routes";
import { productRecipeService } from "../src/routes/product-recipe.routes";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: unknown; details: Record<string, unknown> } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: e.details?.code, details: (e.details ?? {}) as Record<string, unknown> };
    const p = e as { code?: string };
    return { status: p.code === "P2002" ? 409 : 500, code: p.code, details: {} };
  }
}

const TAG = `TEST-SYA2-${Date.now()}`;
const ids = { items: [] as string[], warp: [] as string[], weft: [] as string[], design: [] as string[], recipe: [] as string[], wo: [] as string[] };

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const yarn = async (s: string): Promise<string> => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} İPLİK ${s}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    ids.items.push(r.id);
    return r.id;
  };
  const [y1, y2, y3, y4] = [await yarn("Y1"), await yarn("Y2"), await yarn("Y3"), await yarn("Y4")];

  console.log("§0 sıra kodu ayrıştırıcı (saf)");
  const p = parseWeftSequence(" a4 b1  A4 c1 ", 3);
  check("§0a A4 B1 A4 C1 → A=8 B=1 C=1", JSON.stringify(p.picksBySortOrder) === "[8,1,1]" && p.normalized === "A4 B1 A4 C1", JSON.stringify(p));
  check("§0b eksik harf 400 WEFT_SEQUENCE_LETTER_MISSING", (await errOf(async () => parseWeftSequence("A4 B1", 3)))?.code === "WEFT_SEQUENCE_LETTER_MISSING");
  check("§0c kartta olmayan harf 400 WEFT_SEQUENCE_LETTER_UNKNOWN", (await errOf(async () => parseWeftSequence("A1 D1", 3)))?.code === "WEFT_SEQUENCE_LETTER_UNKNOWN");

  console.log("§1 atkı kartı: sıra kodundan türetim + bugünkü elle adet");
  const w1 = await createWeftSpec({ code: `${TAG}-W1`, name: `${TAG} atkı 1`, picksPerCm: "20", sequenceCode: "a4 b1 a4 c1", yarns: [{ yarnItemId: y1 }, { yarnItemId: y2 }, { yarnItemId: y3 }] }, admin.id);
  ids.weft.push(w1.id);
  check("§1a adetler koddan türedi (8·1·1) ve kod normalize", w1.yarns.map((y) => y.picksInRepeat).join() === "8,1,1" && w1.sequenceCode === "A4 B1 A4 C1");
  const mis = await errOf(() => createWeftSpec({ code: `${TAG}-WX`, name: `${TAG} atkı x`, sequenceCode: "A4 B1", yarns: [{ yarnItemId: y1, picksInRepeat: 5 }, { yarnItemId: y2 }] }, admin.id));
  check("§1b gövde adedi koddan farklı → 400 WEFT_SEQUENCE_MISMATCH", mis?.status === 400 && mis.code === "WEFT_SEQUENCE_MISMATCH", JSON.stringify(mis));
  const w0 = await createWeftSpec({ code: `${TAG}-W0`, name: `${TAG} atkı 0`, yarns: [{ yarnItemId: y1, picksInRepeat: 3 }] }, admin.id);
  ids.weft.push(w0.id);
  check("§1c sıra kodsuz kart elle adetle (bugün)", w0.sequenceCode === null && w0.yarns[0]?.picksInRepeat === 3);
  check("§1d sıra kodsuz kartta adet eksik → 400", (await errOf(() => createWeftSpec({ code: `${TAG}-WY`, name: `${TAG} atkı y`, yarns: [{ yarnItemId: y1 }] }, admin.id)))?.status === 400);
  const w1b = await updateWeftSpec(w1.id, { sequenceCode: "A2 B2 C1" }, admin.id);
  check("§1e yalnız kod güncellenince satırlar yeniden türedi (2·2·1, iplikler aynı)", w1b.yarns.map((y) => `${y.yarnItemId === [y1, y2, y3][y.sortOrder]}:${y.picksInRepeat}`).join() === "true:2,true:2,true:1");

  console.log("§2 desen kartı");
  const d = await createWeaveDesign({ code: `${TAG}-D`, name: `${TAG} BALIK`, kind: "DOBBY", familyLabel: "BALIK", frameCount: 2, repeatCm: "1", liftPlan: [[1, 0], [0, 1], [1, 0], [0, 1], [1, 1]], loomFileName: "D2057.DOP" }, admin.id);
  ids.design.push(d.id);
  check("§2a desen kartı yaratıldı (ızgara 5×2)", Array.isArray(d.liftPlan) && (d.liftPlan as unknown[]).length === 5);
  check("§2b aynı kod → 409 WEAVE_DESIGN_DUPLICATE", (await errOf(() => createWeaveDesign({ code: `${TAG}-D`, name: `${TAG} başka`, kind: "PLAIN" }, admin.id)))?.code === "WEAVE_DESIGN_DUPLICATE");
  check("§2c ızgarada 0/1 dışı → 400 LIFT_PLAN_INVALID", (await errOf(() => createWeaveDesign({ code: `${TAG}-DX`, name: `${TAG} dx`, kind: "PLAIN", liftPlan: [[2]] }, admin.id)))?.code === "LIFT_PLAN_INVALID");
  const list = await listWeaveDesigns({ search: TAG });
  check("§2d liste ızgarayı taşımaz", list.length === 1 && !("liftPlan" in list[0]!));

  console.log("§3 ürün + varyant");
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  ids.items.push(fabric.id);
  const ground = await prisma.warpSpec.create({ data: { code: `${TAG}-CZ`, name: `${TAG} zemin`, yarnItemId: y1, endsCount: 5250, takeUpPct: "8" }, select: { id: true } });
  const leno = await prisma.warpSpec.create({ data: { code: `${TAG}-CD`, name: `${TAG} döner`, yarnItemId: y2, endsCount: 2720, takeUpPct: "14" }, select: { id: true } });
  ids.warp.push(ground.id, leno.id);
  await itemService.update(fabric.id, { warpSpecId: ground.id, weftSpecId: w1.id, weaveDesignId: d.id }, admin.id);
  const bound = await prisma.item.findUniqueOrThrow({ where: { id: fabric.id }, select: { weaveDesignId: true, weftSpecId: true } });
  check("§3a ürüne desen + atkı kartı genel güncellemeyle bağlandı", bound.weaveDesignId === d.id && bound.weftSpecId === w1.id);
  const r1 = await prisma.productRecipe.create({ data: { code: `${TAG}-R1`, name: `${TAG} V01 BEYAZ`, itemId: fabric.id }, select: { id: true } });
  const r2 = await prisma.productRecipe.create({ data: { code: `${TAG}-R2`, name: `${TAG} V02 SIM`, itemId: fabric.id }, select: { id: true } });
  ids.recipe.push(r1.id, r2.id);
  await productRecipeService.update(r1.id, { variantCode: " v01 " }, admin.id);
  check("§3b varyant kodu kırpılıp büyütüldü", (await prisma.productRecipe.findUniqueOrThrow({ where: { id: r1.id }, select: { variantCode: true } })).variantCode === "V01");
  check("§3c aynı üründe aynı varyant kodu → 409", (await errOf(() => productRecipeService.update(r2.id, { variantCode: "V01" }, admin.id)))?.status === 409);
  await productRecipeService.update(r2.id, { variantCode: "V02" }, admin.id);

  console.log("§4 etkin yapı = el hesabı");
  const eff = await replaceRecipeWeftOverrides(r2.id, [{ weftSortOrder: 2, yarnItemId: y4 }], admin.id);
  const rows = (e: typeof eff): string => (e.weft?.yarns ?? []).map((y) => `${y.letter}:${y.yarnItem.id === y1 ? "Y1" : y.yarnItem.id === y2 ? "Y2" : y.yarnItem.id === y3 ? "Y3" : "Y4"}:${y.picksInRepeat}`).join(" ");
  check("§4a V02 etkin atkı = A:Y1:2 B:Y2:2 C:Y4:1 (C değişti, pay aynı)", rows(eff) === "A:Y1:2 B:Y2:2 C:Y4:1", rows(eff));
  check("§4b değişen satır kartın özgün ipliğini taşır", eff.weft?.yarns[2]?.cardYarnItem?.id === y3 && eff.weft?.yarns[0]?.cardYarnItem === null);
  const plain = await resolveEffectiveConstruction(prisma, fabric.id, r1.id);
  check("§4c V01 (değişimsiz) = kart (A:Y1:2 B:Y2:2 C:Y3:1)", rows(plain) === "A:Y1:2 B:Y2:2 C:Y3:1" && plain.variantCode === "V01", rows(plain));
  check("§4d Σ rapordaki atkı = 5", eff.weft?.picksInRepeatTotal === 5);
  check("§4e desen boyu 1 cm × sıklık 20 ≠ 5 → REPEAT_PICKS_MISMATCH uyarısı", eff.warnings.some((w) => w.code === "REPEAT_PICKS_MISMATCH"));
  check("§4f ızgara 5 atkı = Σ 5 → LIFT_PLAN_PICKS_MISMATCH yok; 2 çerçeve ≤ 2", !eff.warnings.some((w) => w.code === "LIFT_PLAN_PICKS_MISMATCH" || w.code === "LIFT_PLAN_FRAMES_EXCEED"));
  check("§4g kartta olmayan sıra → 400 WEFT_OVERRIDE_SORT_UNKNOWN", (await errOf(() => replaceRecipeWeftOverrides(r1.id, [{ weftSortOrder: 5, yarnItemId: y4 }], admin.id)))?.code === "WEFT_OVERRIDE_SORT_UNKNOWN");
  check("§4h başka ürünün varyantı → 400 RECIPE_ITEM_MISMATCH", (await errOf(() => resolveEffectiveConstruction(prisma, y1, r1.id)))?.code === "RECIPE_ITEM_MISMATCH");

  console.log("§5 WEFT_OVERRIDE_ORPHAN seddi");
  const orphan = await errOf(() => updateWeftSpec(w1.id, { sequenceCode: null, yarns: [{ yarnItemId: y1, picksInRepeat: 2 }, { yarnItemId: y2, picksInRepeat: 2 }] }, admin.id));
  const list5 = (orphan?.details.orphans ?? []) as Array<{ recipeId: string; variantCode: string | null; weftSortOrder: number }>;
  check("§5a kart replace'i C sırasını yok edince 409 WEFT_OVERRIDE_ORPHAN", orphan?.status === 409 && orphan.code === "WEFT_OVERRIDE_ORPHAN", JSON.stringify(orphan?.code));
  check("§5b liste etkilenen varyantı (V02, sıra 2) taşır, V01 yok", list5.length === 1 && list5[0]!.recipeId === r2.id && list5[0]!.variantCode === "V02" && list5[0]!.weftSortOrder === 2, JSON.stringify(list5));
  const after5 = await prisma.weftSpecYarn.count({ where: { weftSpecId: w1.id } });
  const seq5 = (await prisma.weftSpec.findUniqueOrThrow({ where: { id: w1.id }, select: { sequenceCode: true } })).sequenceCode;
  check("§5c tx geri alındı (kart 3 satır, sıra kodu duruyor)", after5 === 3 && seq5 === "A2 B2 C1");
  const sw = await errOf(() => itemService.update(fabric.id, { weftSpecId: w0.id }, admin.id));
  check("§5d ürün 1 satırlı karta geçerken de 409 WEFT_OVERRIDE_ORPHAN", sw?.code === "WEFT_OVERRIDE_ORPHAN");
  const ok5 = await updateWeftSpec(w1.id, { yarns: [{ yarnItemId: y1 }, { yarnItemId: y3 }, { yarnItemId: y2 }] }, admin.id);
  check("§5e sıra korunan replace geçer (adet koddan)", ok5.yarns.length === 3 && ok5.yarns.map((y) => y.picksInRepeat).join() === "2,2,1");

  const fabric2 = await prisma.item.create({ data: { code: `${TAG}-KM2`, name: `${TAG} KUMAŞ 2`, itemType: "FABRIC", weftSpecId: w1.id }, select: { id: true } });
  ids.items.push(fabric2.id);
  const mv = await errOf(() => productRecipeService.update(r2.id, { itemId: fabric2.id }, admin.id));
  const moved = (await prisma.productRecipe.findUniqueOrThrow({ where: { id: r2.id }, select: { itemId: true } })).itemId;
  check("§5f değişimli varyant başka ürüne taşınınca 409 WEFT_OVERRIDE_ORPHAN, reçete yerinde", mv?.code === "WEFT_OVERRIDE_ORPHAN" && moved === fabric.id, JSON.stringify(mv?.code));
  await productRecipeService.update(r2.id, { itemId: fabric.id, name: `${TAG} V02 SIM` }, admin.id);
  check("§5g aynı ürünle PATCH geçer; değişimsiz varyant taşınabilir", (await errOf(() => productRecipeService.update(r1.id, { itemId: fabric2.id }, admin.id))) === null);
  await productRecipeService.update(r1.id, { itemId: fabric.id }, admin.id);

  console.log("§6 desen kartı canlı referans + çözgü katmanı");
  const inUse = await errOf(() => deactivateWeaveDesign(d.id, admin.id));
  check("§6a aktif ürün bağlıyken pasif → 409 WEAVE_DESIGN_IN_USE + ürün listesi", inUse?.code === "WEAVE_DESIGN_IN_USE" && (inUse.details.items as Array<{ id: string }>).some((i) => i.id === fabric.id));
  check("§6b desen kartı aktif kaldı", (await getWeaveDesign(d.id)).isActive === true);
  check("§6c zeminle aynı katman → 400 WARP_LAYER_DUPLICATES_GROUND", (await errOf(() => replaceItemWarpLayers(fabric.id, [{ warpSpecId: ground.id, role: "LENO" }], admin.id)))?.code === "WARP_LAYER_DUPLICATES_GROUND");
  const lay = await replaceItemWarpLayers(fabric.id, [{ warpSpecId: leno.id, role: "LENO" }], admin.id);
  check("§6d döner katman yazıldı, sarım varsayılanı SEPARATE_BEAM", lay.warpLayers.length === 1 && lay.warpLayers[0]!.beamMode === "SEPARATE_BEAM" && lay.groundWarp?.id === ground.id);

  console.log("§8 seçici sütunu + döner çerçeve + desen kartı basımı + iş emri sabitleme (dilim b)");
  check("§8a seçici açılımı A2 C1 B1 → [1,1,3,2]", JSON.stringify(expandWeftSequence("A2 C1 B1", 3, 512)) === "[1,1,3,2]");
  check("§8b bozuk/boş kod → null (ekran düşmez)", expandWeftSequence("A2 Q1", 3, 512) === null && expandWeftSequence(null, 3, 512) === null);
  check("§8c tavanı aşan açılım → null", expandWeftSequence("A9 B9 C9", 3, 20) === null);
  const seqEff = await resolveEffectiveConstruction(prisma, fabric.id, null);
  check("§8d etkin yapı pickSequence = kod açılımı (A2 B2 C1)", JSON.stringify(seqEff.weft?.pickSequence) === "[1,1,2,2,3]", JSON.stringify(seqEff.weft?.pickSequence));
  check("§8e eski kayıt döner çerçevesiz ([])", JSON.stringify(seqEff.weaveDesign?.lenoFrames) === "[]");
  check("§8f döner çerçeve aralık dışı → 400 LENO_FRAMES_INVALID", (await errOf(() => updateWeaveDesign(d.id, { lenoFrames: [0] }, admin.id)))?.code === "LENO_FRAMES_INVALID");
  check("§8g yinelenen döner çerçeve → 400", (await errOf(() => updateWeaveDesign(d.id, { lenoFrames: [2, 2] }, admin.id)))?.code === "LENO_FRAMES_INVALID");
  const dl = await updateWeaveDesign(d.id, { lenoFrames: [2, 1] }, admin.id);
  check("§8h döner çerçeve sıralı yazıldı [1,2]", JSON.stringify(dl.lenoFrames) === "[1,2]");
  const view = await buildWeaveCardView(fabric.id, new Date("2026-11-21T09:00:00Z"));
  const html = renderWeaveDesignCardHtml(view);
  check("§8i basım: desen no = kumaş kodu, sıklık 20, varyant V02 değişimi", html.includes(`DESEN NO : ${TAG}-KM`) && html.includes("20 ATKI/CM") && view.variants.some((v) => v.variantCode === "V02" && v.swaps[0]?.no === 3));
  const xCount = (html.match(/<td class="c[^"]*">X<\/td>/g) ?? []).length;
  check("§8j basım: X adedi = ızgaradaki 1'ler (6) + seçici (5)", xCount === 11, String(xCount));
  check("§8k basım: döner çerçeve sütunları işaretli + ayrık blok", (html.match(/<th class="leno">/g) ?? []).length === 2 && frameBlocks(4, new Set([1, 2])).length === 2);
  const esc = renderWeaveDesignCardHtml({ ...view, itemName: "<script>x</script>" });
  check("§8l basım: metin kaçışlı", !esc.includes("<script>x") && esc.includes("&lt;script&gt;"));
  // Devere/levent S8: tahar düzeni notu — boş = bugünkü basım (bayt-aynı), dolu = "TAHAR" satırı, 300 tavanı.
  // Bugünkü basımda çözgü bloğunun son satırını doğrudan sıklık satırı izler; boş not araya bayt koymaz.
  check("§8p tahar boş: alan null, basım tahar satırsız (çözgü → sıklık arası bayt-aynı)",
    view.design?.drawingInNote === null && !html.includes("TAHAR") && html.includes(`</div>\n<div class="kv"><b>ATKI SIKLIĞI :</b>`));
  const tooLong = await errOf(() => updateWeaveDesign(d.id, { drawingInNote: "x".repeat(301) }, admin.id));
  check("§8q tahar 301 karakter → 400", tooLong?.status === 400, JSON.stringify(tooLong));
  const dn = await updateWeaveDesign(d.id, { drawingInNote: "  1-2-3-4 düz, kenar 2'li <döner> 1-2  " }, admin.id);
  check("§8r tahar kırpılıp yazıldı", dn.drawingInNote === "1-2-3-4 düz, kenar 2'li <döner> 1-2");
  const tHtml = renderWeaveDesignCardHtml(await buildWeaveCardView(fabric.id, new Date("2026-11-21T09:00:00Z")));
  const tLine = /<b>TAHAR :<\/b> ([^<]*)<\/div>/.exec(tHtml)?.[1] ?? "";
  check("§8s tahar dolu: basımda kaçışlı TAHAR satırı", tLine.startsWith("1-2-3-4 düz, kenar 2") && tLine.endsWith("&lt;döner&gt; 1-2"), tLine);
  check("§8t tahar 300 karakter sınırda geçer; boş metin null'a döner",
    (await updateWeaveDesign(d.id, { drawingInNote: "y".repeat(300) }, admin.id)).drawingInNote?.length === 300
    && (await updateWeaveDesign(d.id, { drawingInNote: "   " }, admin.id)).drawingInNote === null);
  const pinned = await resolveEffectiveConstruction(prisma, fabric.id, null, { weftSpecId: w0.id, weaveDesignId: null });
  check("§8m sabitleme: iş emrinin atkı kartı ürünün kartının yerine geçer; desen ürünün", pinned.weft?.weftSpecId === w0.id && pinned.weaveDesign?.id === d.id);
  const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-WO`, itemId: fabric.id, executionKind: "IN_HOUSE", weftSpecId: w0.id, weaveDesignId: d.id }, select: { id: true } });
  ids.wo.push(wo.id);
  const tab = await weavingOrderTabletConstruction(wo.id);
  check("§8n tablet iş kartı iş emrinin KENDİ atkı kartını gösterir (W0, ürün W1'de)", tab?.weft?.code === `${TAG}-W0`, String(tab?.weft?.code));
  const woLegacy = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-WO2`, itemId: fabric.id, executionKind: "IN_HOUSE" }, select: { id: true } });
  ids.wo.push(woLegacy.id);
  check("§8o seçimsiz (eski) iş emri ürünün güncel kartına düşer", (await weavingOrderTabletConstruction(woLegacy.id))?.weft?.code === `${TAG}-W1`);

  console.log("§9 kart görseli (2026-11-22): çözgü dizilim açılımı + kumaş görünümü + iş emri desen kartı");
  check("§9a dizilim notu yok → endsSequence null; gösterim alanları seçili", seqEff.groundWarp?.endsSequence === null && seqEff.groundWarp !== null && "endsPerDent" in seqEff.groundWarp && "selvedgeEnds" in seqEff.groundWarp && "reedNo" in seqEff.groundWarp);
  await prisma.warpSpec.update({ where: { id: ground.id }, data: { sequenceNote: "3A" } });
  const seqWarp = (await resolveEffectiveConstruction(prisma, fabric.id, null)).groundWarp?.endsSequence;
  check("§9b '3A' × 5250 tel → rapor [1,1,1], 1750 tekrar, artık 0, kartla uyumlu", JSON.stringify(seqWarp?.repeat) === "[1,1,1]" && seqWarp?.repeatCount === 1750 && seqWarp.remainder === 0 && seqWarp.matchesYarnEnds, JSON.stringify(seqWarp));
  check("§9c ürün kartı: bütün çerçeveler döner → kumaş görünümü bloğu yok (basım bugünkü gibi)", !tHtml.includes("KUMAŞ GÖRÜNÜMÜ") && !tHtml.includes("İş emri:"));
  const d2 = await createWeaveDesign({ code: `${TAG}-D2`, name: `${TAG} DİMİ`, kind: "DOBBY", frameCount: 3, liftPlan: [[1, 1, 0], [0, 1, 1], [1, 0, 1]] }, admin.id);
  const d3 = await createWeaveDesign({ code: `${TAG}-D3`, name: `${TAG} DÖNER`, kind: "LENO", frameCount: 3, liftPlan: [[1, 0, 1], [0, 1, 1]], lenoFrames: [1] }, admin.id);
  ids.design.push(d2.id, d3.id);
  const wo3 = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-WO3`, itemId: fabric.id, executionKind: "IN_HOUSE", weaveDesignId: d2.id }, select: { id: true } });
  const wo4 = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-WO4`, itemId: fabric.id, executionKind: "IN_HOUSE", weaveDesignId: d3.id }, select: { id: true } });
  ids.wo.push(wo3.id, wo4.id);
  const oc = await weavingOrderConstruction(wo3.id);
  check("§9d iş emri yapısı: pin'li desen (ürün D'de, iş emri D2) + iş emri no", oc.construction.weaveDesign?.id === d2.id && oc.weavingOrderNumber === `${TAG}-WO3`);
  const oHtml = await renderWeavingOrderWeaveCard(wo3.id);
  check("§9e iş emri kartı: iş emrinin deseni + iş emri no basılır", oHtml.includes(`Örgü: <b>${TAG}-D2</b>`) && oHtml.includes(`İş emri: <b>${TAG}-WO3</b>`));
  check("§9f iş emri kartı: kumaş görünümü SVG'si + düz tahar etiketi", oHtml.includes("KUMAŞ GÖRÜNÜMÜ") && oHtml.includes(`<svg class="fab"`) && oHtml.includes("düz tahar varsayıldı, 3 zemin çerçevesi"));
  const oX = (oHtml.match(/<td class="c[^"]*">X<\/td>/g) ?? []).length;
  check("§9g kumaş görünümü armür X'lerine karışmaz (6 kalkık + seçici 5 atkı)", oX === 6 + 5, String(oX));
  const lHtml = await renderWeavingOrderWeaveCard(wo4.id);
  check("§9h LENO desen: kumaş görünümü çizilmez, açıklama basılır", lHtml.includes("kumaş görünümü çizilmez") && !lHtml.includes(`<svg class="fab"`));

  console.log("§7 yapısız ürün (bugün): etkin yapı boş");
  const bare = await resolveEffectiveConstruction(prisma, y1, null);
  check("§7a katman/atkı/desen/uyarı yok", bare.warpLayers.length === 0 && bare.weft === null && bare.weaveDesign === null && bare.groundWarp === null && bare.warnings.length === 0);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: ids.wo } } }));
  await t(() => prisma.productRecipeWeftYarn.deleteMany({ where: { recipeId: { in: ids.recipe } } }));
  await t(() => prisma.productRecipe.deleteMany({ where: { id: { in: ids.recipe } } }));
  await t(() => prisma.itemWarpLayer.deleteMany({ where: { itemId: { in: ids.items } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: ids.items } }, data: { warpSpecId: null, weftSpecId: null, weaveDesignId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: ids.weft } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: { in: ids.weft } } }));
  await t(() => prisma.warpSpec.deleteMany({ where: { id: { in: ids.warp } } }));
  await t(() => prisma.weaveDesign.deleteMany({ where: { id: { in: ids.design } } }));
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
