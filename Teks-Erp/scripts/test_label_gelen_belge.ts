// =============================================================================
// TEST (hizmet ekseni E3): top etiketinde "müşteri belgesindeki kumaş/renk" — opt-in alan
// =============================================================================
//   §1 katalog: ROLL_RAW + ROLL_FINISHED'da deliveryNoteItemText/ColorText var, varsayılan şablonda KAPALI doğar
//   §2 GERÇEK onay yolu (createDeliveryNote → approveDeliveryNote): doğan topun etiket yükünde
//      deliveryNoteItemText = satırın itemText'i, deliveryNoteColorText = colorText
//   §3 Tambur çocuğu / torunu (parentRollId zinciri): atanın metni; toplu çözücü tek çağrıda karışık küme
//   §4 gelen belge satırı olmayan topta iki anahtar yükte YOK (payload bayt-aynı)
//   §5 alan şablonda KAPALIYKEN çıktı BAYT-AYNI: akış HTML (şablonsuz + varsayılan alanlar) · native akış
//      PPLA/PPLB/ZPL · kanvas (native + HTML); alan AÇIKKEN metin çıktıda (pozitif kontrol)
// Negatif sonda: roll-delivery-note-line.helper'da ata yürüyüşü (parentRollId adımı) kaldırılınca §3 kırmızı.
// Çalıştır: npx tsx scripts/test_label_gelen_belge.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { LabelKind, RollStatus, type LabelTemplate, type LabelTemplateVariant, type PrinterLanguage } from "@prisma/client";
import { buildDefaultFields, FIELD_CATALOG, type TemplateField } from "../src/config/label-fields";
import { buildRollLabelHtml } from "../src/services/helpers/label-html.helper";
import { renderLabel } from "../src/services/helpers/label-renderer.registry";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { flowTemplateToCanvas } from "../src/services/helpers/label-flow-to-canvas";
import { resolveDeliveryNoteLinesForRolls } from "../src/services/helpers/roll-delivery-note-line.helper";
import { LabelService } from "../src/services/label.service";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import type { LabelPayload } from "../src/types/label.types";
import { roleGrade } from "./fixture-quality-grade";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TLGB${Date.now().toString(36).toUpperCase()}`;
const KEYS = ["deliveryNoteItemText", "deliveryNoteColorText"] as const;
const ITEM_TEXT = "Süprem 30/1 MÜŞTERİ ADI";
const COLOR_TEXT = "Lacivert Özel";
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], fixtureRolls: [] as string[] };
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];

function withoutDeliveryNoteKeys(p: LabelPayload): LabelPayload {
  const copy = { ...p } as Record<string, unknown>;
  for (const k of KEYS) delete copy[k];
  return copy as unknown as LabelPayload;
}

async function main(): Promise<void> {
  console.log("§1 Katalog — opt-in alan");
  for (const kind of [LabelKind.ROLL_RAW, LabelKind.ROLL_FINISHED]) {
    for (const key of KEYS) {
      const def = FIELD_CATALOG[kind].find((f) => f.key === key);
      check(`§1 ${kind} kataloğunda ${key}`, !!def && def.type === "text", def?.defaultLabel ?? "yok");
      const dflt = buildDefaultFields(kind).find((f) => f.key === key);
      check(`§1 ${kind} ${key} varsayılan şablonda GÖRÜNMEZ doğar`, dflt?.isVisible === false, JSON.stringify(dflt));
    }
  }

  console.log("§2 Gerçek onay yolu");
  const actor = await testActorId();
  const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
  made.customers.push(owner.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} süprem`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  for (const [k, v] of [[SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL] } } });
  const note = await createDeliveryNote({
    sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} GÖNDEREN`,
    lines: [
      { senderRollNo: `${TAG}-R1`, meters: 120, weightKg: 25, itemText: ITEM_TEXT, itemId: fabric.id, colorText: COLOR_TEXT },
      { senderRollNo: `${TAG}-R2`, meters: 90, weightKg: 18, itemText: ITEM_TEXT, itemId: fabric.id },
    ],
  }, actor);
  made.notes.push(note.id);
  const approved = await approveDeliveryNote(note.id, {}, actor);
  check("§2 onay iki top doğurdu", approved.summary.entered === 2, JSON.stringify(approved.summary));
  const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: note.id }, orderBy: { lineNo: "asc" }, select: { rollId: true } });
  const [rollColored, rollNoColor] = lines.map((l) => l.rollId!);
  const svc = new LabelService();
  const pColored = (await svc.getRollLabel(rollColored)).data;
  check("§2 ⭐ deliveryNoteItemText = satırın itemText'i", pColored.deliveryNoteItemText === ITEM_TEXT, String(pColored.deliveryNoteItemText));
  check("§2 ⭐ deliveryNoteColorText = satırın colorText'i", pColored.deliveryNoteColorText === COLOR_TEXT, String(pColored.deliveryNoteColorText));
  const pNoColor = (await svc.getRollLabel(rollNoColor)).data;
  check("§2 rengi yazılmamış satır: kumaş adı var, renk anahtarı YOK", pNoColor.deliveryNoteItemText === ITEM_TEXT && !("deliveryNoteColorText" in pNoColor), JSON.stringify(Object.keys(pNoColor).filter((k) => k.startsWith("deliveryNote"))));

  console.log("§3 Tambur çocuğu (parentRollId zinciri)");
  const grade = await roleGrade("FIRST");
  const wh = await fixtureWarehouseId();
  const mkRoll = async (suffix: string, parentRollId: string | null) => {
    // Test fikstürü — Tambur bölmesinin ürettiği çocuk topun ata bağı; üretim yazımı tambur servisinde.
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-${suffix}`, itemId: fabric.id, initialQty: 60, currentQty: 60, status: RollStatus.STOCK, warehouseId: wh, qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, createdById: actor, parentRollId }, select: { id: true } });
    made.fixtureRolls.push(r.id);
    return r.id;
  };
  const child = await mkRoll("C1", rollColored);
  const grandChild = await mkRoll("C2", child);
  const plain = await mkRoll("P", null);
  const pChild = (await svc.getRollLabel(child)).data;
  check("§3 ⭐ çocuk top atanın kumaş/renk metnini taşır", pChild.deliveryNoteItemText === ITEM_TEXT && pChild.deliveryNoteColorText === COLOR_TEXT, `${pChild.deliveryNoteItemText} / ${pChild.deliveryNoteColorText}`);
  const pGrand = (await svc.getRollLabel(grandChild)).data;
  check("§3 ⭐ torun top (iki kat) atanın metnini taşır", pGrand.deliveryNoteItemText === ITEM_TEXT && pGrand.deliveryNoteColorText === COLOR_TEXT, `${pGrand.deliveryNoteItemText} / ${pGrand.deliveryNoteColorText}`);
  const bulk = await resolveDeliveryNoteLinesForRolls([rollColored, child, grandChild, plain]);
  check("§3 toplu çözücü: üç top çözülür, satırsız top haritada YOK", bulk.size === 3 && !bulk.has(plain), String(bulk.size));
  check("§3 kaynak top = satırın topu (en yakın ata)", [child, grandChild].every((id) => bulk.get(id)?.sourceRollId === rollColored));

  console.log("§4 Gelen belgesiz top");
  const pPlain = (await svc.getRollLabel(plain)).data;
  check("§4 ⭐ satırsız topta iki anahtar yükte YOK", KEYS.every((k) => !(k in pPlain)), JSON.stringify(Object.keys(pPlain).filter((k) => k.startsWith("deliveryNote"))));

  console.log("§5 Alan şablonda kapalıyken çıktı bayt-aynı");
  const stripped = withoutDeliveryNoteKeys(pColored);
  for (const kind of [LabelKind.ROLL_FINISHED, LabelKind.ROLL_RAW]) {
    const format = await resolveLabelFormat({ kind });
    const fieldsOff = buildDefaultFields(kind);
    const fieldsOn = fieldsOff.map((f) => ((KEYS as readonly string[]).includes(f.key) ? { ...f, isVisible: true } : f));
    // Kanvas sığma gerçeği: ROLL_FINISHED'ın varsayılan kümesi medyaya sığmaz, sondaki opt-in satırlar düşer —
    // kanvas pozitif kontrolü yalnız iki alanın açık olduğu kümeyle kurulur.
    const fieldsOnly = fieldsOff.map((f) => ({ ...f, isVisible: (KEYS as readonly string[]).includes(f.key) }));
    const flowTemplate = (fields: TemplateField[]) => ({ id: "t", kind, fields, rawCode: null, lineStepMm: null, qrScale: null, lengthBanner: null } as unknown as LabelTemplate);
    const html = (payload: LabelPayload, fields: TemplateField[] | null) =>
      buildRollLabelHtml({ payload: { ...payload, kind } as LabelPayload, template: fields ? flowTemplate(fields) : null, barcodeSvg: "", qrSvg: "", format });
    check(`§5 [${kind}] akış HTML şablonsuz: bayt-aynı`, html(pColored, null) === html(stripped, null));
    check(`§5 [${kind}] akış HTML varsayılan alanlar (kapalı): bayt-aynı`, html(pColored, fieldsOff) === html(stripped, fieldsOff));
    check(`§5 [${kind}] akış HTML alan açık: metin basılır (pozitif)`, html(pColored, fieldsOn).includes("Süprem 30/1") && html(pColored, fieldsOn).includes("Lacivert"));

    const canvasOf = (fields: TemplateField[]) => {
      const layout = flowTemplateToCanvas({ kind, fields, lineStepMm: null, qrScale: null, lengthBanner: null }, format);
      return { elements: layout, widthMm: format.widthMm, heightMm: format.heightMm } as unknown as LabelTemplateVariant;
    };
    for (const lang of ["PPLA", "PPLB", "ZPL", "RASTER_HTML"] as const) {
      const render = async (payload: LabelPayload, fields: TemplateField[], canvas: boolean) => (await renderLabel(lang as PrinterLanguage, {
        payload: { ...payload, kind } as LabelPayload, template: flowTemplate(fields), variant: canvas ? canvasOf(fields) : undefined,
        barcodeSvg: "<svg viewBox=\"0 0 10 10\"></svg>", qrSvg: "<svg viewBox=\"0 0 10 10\"></svg>", copies: 1,
        format: { ...format, language: lang as PrinterLanguage },
      } as never)).content;
      if (lang !== "RASTER_HTML") {
        check(`§5 [${kind}] native akış ${lang} kapalı: bayt-aynı`, (await render(pColored, fieldsOff, false)) === (await render(stripped, fieldsOff, false)));
      }
      check(`§5 [${kind}] kanvas ${lang} kapalı: bayt-aynı`, (await render(pColored, fieldsOff, true)) === (await render(stripped, fieldsOff, true)));
      // Pozitif kontrol: alan açıkken çıktı DEĞİŞİR — kapalı eşitliği "yol alanı hiç basmıyor" diye yeşil kalamaz.
      if (lang !== "RASTER_HTML") {
        check(`§5 [${kind}] native akış ${lang} alan açık: çıktı değişir`, (await render(pColored, fieldsOn, false)) !== (await render(stripped, fieldsOn, false)));
      }
      check(`§5 [${kind}] kanvas ${lang} alan açık: çıktı değişir`, (await render(pColored, fieldsOnly, true)) !== (await render(stripped, fieldsOnly, true)));
    }
  }
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  await prisma.roll.deleteMany({ where: { id: { in: made.fixtureRolls } } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
}

async function run(): Promise<void> {
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    await main();
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void run();
else void prisma.$disconnect();
