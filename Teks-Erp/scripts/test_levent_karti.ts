// =============================================================================
// LEVENT KARTI (A6) BEKÇİSİ — devere-levent S5 (GERÇEK DB, sunucusuz servis yolu)
// =============================================================================
// §1 çok iplikli kartta kırılım WOUND kopyasından: çözgü kartı sonradan değişse de kart satırları aynı.
// §2 iptal: hiç basılmamış iptal levent → 409 WARP_BEAM_CARD_CANCELLED · basılmış kart sarım iptalinde VOIDED (aynı tx).
// §3 iç belge: payload ve HTML'de ücret/fiyat yok.
// §4 levent etiketi payload'ı: eski anahtarlar bayt-aynı, S5 alanları (bodyNo, subcontractorName, deliveryNoteNo) yalnız EK.
// §5 printed-doc defteri: ilk okuma v1 dondurur; veri değişince v1 içeriği değişmez.
// §6 varsayılan levent etiket şablonu: bağlam varsayılanı yokken baskı girdisi kurulur (400 değil), ikinci çağrı yeni şablon doğurmaz.
// DB'YE YAZAR: `TEST-LK-<pid>` iplik/kart/levent; `finally`de FK sırasıyla silinir; levent bağlam varsayılanı birebir geri yüklenir.
// Koşum: npx tsx scripts/run-all-tests.ts levent_karti
//
// NEGATİF SONDA (2026-11-22 koşuldu, geri alındı):
//   · `applyWarpBeamEventTx` içindeki `voidWarpBeamCardTx` satırı kapatıldı → §2b kırmızı
//   · `buildLoomRenderInput` içindeki `ensureDefaultWarpBeamLabelTemplate` dalı kapatıldı → §6a kırmızı
// =============================================================================
import { LabelKind, Prisma, PrintedDocType, WarpBeamOrigin, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { cancelWound, windWarpBeam } from "../src/services/warp-beam-wind.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import "../src/services/warp-beam-card.service";
import { buildLoomRenderInput, loadWarpBeamLabelPayload } from "../src/services/helpers/label-loom-context.helper";
import { DEFAULT_WARP_BEAM_TEMPLATE_NAME } from "../src/services/helpers/label-default-warp-beam.helper";
import { AppError } from "../src/utils/app-error";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-LK-${process.pid}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED];
const CARD = PrintedDocType.WARP_BEAM_CARD;
/** S5 öncesi levent etiket payload anahtarları — bu küme ve değerleri değişmez. */
const OLD_LABEL_KEYS = ["itemName", "beamNo", "physicalBeamNo", "warpSpecCode", "warpSpecName", "plannedLengthM", "woundLengthM", "woundKg", "weavingOrderNumber", "woundAt"];
const NEW_LABEL_KEYS = ["bodyNo", "subcontractorName", "deliveryNoteNo"];

async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    if (e instanceof AppError) return String((e.details as { code?: string } | undefined)?.code ?? e.statusCode);
    throw e;
  }
}
type CardDoc = { header: Record<string, unknown>; yarns: Array<{ yarnCode: string; endsCount: number; kg: number }> };
const docOf = (r: { data: unknown }) => (r.data as { version: number; status: string; snapshot: { doc: CardDoc } });
const htmlOf = async (beamId: string) => ((await printedDocumentService.getHtml(CARD, beamId)).data?.html ?? "");

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== LEVENT KARTI BEKÇİSİ ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const prevDefault = await prisma.labelContextDefault.findUnique({ where: { kind: LabelKind.WARP_BEAM }, select: { templateId: true } });
  const sub = await ensureTestDyeHouse();
  const yA = await prisma.item.create({ data: { code: `${TAG}-A`, name: `${TAG} 165`, itemType: "YARN", unit: "KG", linearDensityDen: 165 }, select: { id: true } });
  const yB = await prisma.item.create({ data: { code: `${TAG}-B`, name: `${TAG} 70`, itemType: "YARN", unit: "KG", linearDensityDen: 70 }, select: { id: true } });
  const mono = await prisma.warpSpec.create({ data: { code: `${TAG}-MONO`, name: `${TAG} mono`, yarnItemId: yA.id, endsCount: 10500 }, select: { id: true } });
  await prisma.warpSpecYarn.createMany({ data: [{ warpSpecId: mono.id, yarnItemId: yA.id, endsCount: 5250, sortOrder: 0 }, { warpSpecId: mono.id, yarnItemId: yB.id, endsCount: 5250, sortOrder: 1 }] });
  const beamIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const wound = async () => {
    const b = await createWarpBeam({ warpSpecId: mono.id, plannedLengthM: 2500, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(b.data.id);
    await windWarpBeam(b.data.id, { lengthM: 2500, kgSource: WarpKgSource.THEORETICAL });
    return b.data.id;
  };
  try {
    for (const key of FLAGS) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });

    console.log("── §1 + §5 Kırılım WOUND kopyasından · v1 donar ──");
    const b1 = await wound();
    const v1 = docOf(await printedDocumentService.getCurrent(CARD, b1));
    const y = v1.snapshot.doc.yarns;
    check("§1a kart iki iplik satırı (5250 + 5250 tel), Σ kg 342,708", y.length === 2 && y.every((r) => r.endsCount === 5250) && Math.abs(y.reduce((s, r) => s + r.kg, 0) - 342.708) < 0.002, y.map((r) => `${r.yarnCode}:${r.kg}`).join(" + "));
    check("§5a ilk okuma v1 ACTIVE dondurur", v1.version === 1 && v1.status === "ACTIVE");
    await prisma.warpSpecYarn.updateMany({ where: { warpSpecId: mono.id, yarnItemId: yB.id }, data: { endsCount: 6000 } });
    await prisma.warpSpec.update({ where: { id: mono.id }, data: { name: `${TAG} yeni ad` } });
    const again = docOf(await printedDocumentService.getCurrent(CARD, b1));
    check("§5b veri değişince v1 aynı kalır (sürüm ilerlemez, ad eski)", again.version === 1 && again.snapshot.doc.header.warpSpecName === `${TAG} mono`);
    const b1b = await wound();
    const fresh = docOf(await printedDocumentService.getCurrent(CARD, b1b)).snapshot.doc.yarns;
    check("§1b kart değişti, SONRA sarılan leventin kartı yeni tel sayısını taşır (kopya sarım anında)", fresh.some((r) => r.endsCount === 6000));
    check("§1c ÖNCE sarılan leventin kartı değişmedi (WOUND kopyası)", (await htmlOf(b1)).includes("5.250") || (await htmlOf(b1)).includes("5250"));
    await prisma.warpSpecYarn.updateMany({ where: { warpSpecId: mono.id, yarnItemId: yB.id }, data: { endsCount: 5250 } });

    console.log("\n── §2 İptal ──");
    const b2 = await wound();
    await cancelWound(b2, "TEST iptal");
    check("§2a hiç basılmamış iptal levent → 409 WARP_BEAM_CARD_CANCELLED", (await hataKodu(() => printedDocumentService.getCurrent(CARD, b2))) === "WARP_BEAM_CARD_CANCELLED");
    const b3 = await wound();
    await printedDocumentService.getCurrent(CARD, b3);
    await cancelWound(b3, "TEST iptal basılı");
    const st = await prisma.printedDocument.findMany({ where: { docType: CARD, sourceId: b3 }, select: { status: true } });
    check("§2b ⭐ basılmış kart sarım iptalinde VOIDED (aynı tx)", st.length === 1 && st[0]!.status === "VOIDED", st.map((s) => s.status).join(","));
    const planned = await createWarpBeam({ warpSpecId: mono.id, plannedLengthM: 100, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: sub.id });
    beamIds.push(planned.data.id);
    check("§2c sarılmamış levent → 409 WARP_BEAM_CARD_NOT_WOUND", (await hataKodu(() => printedDocumentService.getCurrent(CARD, planned.data.id))) === "WARP_BEAM_CARD_NOT_WOUND");

    console.log("\n── §3 İç belge: ücret/fiyat yok ──");
    const html = await htmlOf(b1);
    const keys = JSON.stringify(v1.snapshot.doc);
    check("§3a payload'da fee/price/amount anahtarı yok", !/"[^"]*(fee|price|amount|currency)[^"]*"\s*:/i.test(keys));
    check("§3b HTML'de ücret/fiyat/para birimi yok", html.length > 500 && !/ücret|fiyat|₺|\bTRY\b|\bUSD\b/i.test(html));
    check("§3c HTML A6 sayfa boyu taşır", /size:\s*A6/i.test(html));

    console.log("\n── §4 Etiket payload'ı ──");
    const p = (await loadWarpBeamLabelPayload(b1)) as unknown as Record<string, unknown>;
    const db = await prisma.warpBeam.findUniqueOrThrow({ where: { id: b1 }, select: { beamNo: true, physicalBeamNo: true, plannedLengthM: true, warpSpec: { select: { code: true, name: true } } } });
    check("§4a eski anahtarların hepsi var, değerleri DB ile aynı", OLD_LABEL_KEYS.every((k) => k in p) && p.beamNo === db.beamNo && p.physicalBeamNo === db.physicalBeamNo && p.warpSpecCode === db.warpSpec.code && p.warpSpecName === db.warpSpec.name && p.plannedLengthM === Number(db.plannedLengthM) && p.woundLengthM === 2500);
    check("§4b S5 alanları EK: devereci adı dolu, gövdesiz leventte bodyNo null", NEW_LABEL_KEYS.every((k) => k in p) && typeof p.subcontractorName === "string" && p.bodyNo === null);

    console.log("\n── §6 Varsayılan levent etiket şablonu ──");
    await prisma.labelContextDefault.deleteMany({ where: { kind: LabelKind.WARP_BEAM } });
    const before = await prisma.labelTemplate.count({ where: { name: DEFAULT_WARP_BEAM_TEMPLATE_NAME } });
    const r6 = await hataKodu(() => buildLoomRenderInput(p as never, {}));
    const def = await prisma.labelContextDefault.findUnique({ where: { kind: LabelKind.WARP_BEAM }, select: { templateId: true } });
    // Yalnız bu koşumun DOĞURDUĞU şablon silinir; aynı adlı mevcut şablon yeniden kullanıldıysa dokunulmaz.
    if (def && before === 0) createdTemplateIds.push(def.templateId);
    check("§6a ⭐ bağlam varsayılanı yokken baskı girdisi kurulur (400 LABEL_TEMPLATE_MISSING değil)", r6 === "geçti" && !!def, r6);
    await buildLoomRenderInput(p as never, {});
    const after = await prisma.labelTemplate.count({ where: { name: DEFAULT_WARP_BEAM_TEMPLATE_NAME } });
    check("§6b ikinci baskı yeni şablon doğurmaz (en çok bir şablon eklendi; aynı adlı varsa o atandı)", after === Math.max(before, 1), `${before} → ${after}`);
  } finally {
    await prisma.labelContextDefault.deleteMany({ where: { kind: LabelKind.WARP_BEAM } });
    if (createdTemplateIds.length) {
      await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: createdTemplateIds } } });
      await prisma.labelTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
    }
    if (prevDefault) await prisma.labelContextDefault.create({ data: { kind: LabelKind.WARP_BEAM, templateId: prevDefault.templateId } });
    await prisma.printedDocument.deleteMany({ where: { docType: CARD, sourceId: { in: beamIds } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: mono.id } });
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
