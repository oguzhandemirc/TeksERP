// =============================================================================
// Bekçi: TAMBUR PARTİ NO VARSAYILANI + "müşteri parti" şablon alanı (Gülkesim 2026-11-10)
// Çalıştır: npx tsx scripts/test_tambur_parti_varsayilan.ts   (DB'li, _test DB)
// =============================================================================
//   §1 katalog: ROLL_RAW + ROLL_FINISHED'da `customerBatchNo` var, varsayılan şablonda KAPALI doğar
//   §2 alan zinciri: labelBatchNo (boşluk = yok) > deliveryNoteBatchNo; ikisi de yoksa present:false
//   §3 GERÇEK onay yolu: label-settings `deliveryNoteBatchNo` = gelen belge partisi (çocuk/torun atadan),
//      satırsız topta null; etiket yükünde anahtar yalnız satırlı topta
//   §4 ayar AÇIK: tamburda yazılan değer çocuğa yazılır ve alanda gelen belgeyi ezer · değersiz kesim null,
//      alan gelen belgeye düşer · PATCH label-texts "" ile temizlenir
//   §5 ayar KAPALI (bugünkü davranış): label-settings labelBatchEnabled=false · değerli kesim 400 · değersiz geçer
//   §6 kanvas basımı: "Parti" elemanı PPLB/ZPL çıktısında değerle basılır, değer yoksa basılmaz
// Negatif sonda (ölçüldü 2026-11-10): label-field-values'ta `customerBatchNo` dalı silinince §2/§4/§6 kırmızı;
// getTamburLabelSettings'te deliveryNoteBatchNo çözümü `null`a çevrilince §3 kırmızı.
// =============================================================================
import { LabelKind, RollStatus, type PrinterLanguage } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { buildDefaultFields, FIELD_CATALOG } from "../src/config/label-fields";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { mockPayload } from "../src/services/helpers/label-rawcode";
import { renderLabel } from "../src/services/helpers/label-renderer.registry";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { getTamburLabelSettings } from "../src/services/helpers/tambur-customer-settings.helper";
import { fixRollLabelTexts } from "../src/services/inventory/label-texts";
import { LabelService } from "../src/services/label.service";
import { TamburService } from "../src/services/tambur.service";
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
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}

const TAG = `TTPV${Date.now().toString(36).toUpperCase()}`;
const GB = "GB77";
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], rolls: [] as string[] };
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];
const tambur = new TamburService();
const labels = new LabelService();

async function main(): Promise<void> {
  console.log("§1 Katalog");
  for (const kind of [LabelKind.ROLL_RAW, LabelKind.ROLL_FINISHED]) {
    check(`§1 ${kind} kataloğunda customerBatchNo`, FIELD_CATALOG[kind].some((f) => f.key === "customerBatchNo"));
    check(`§1 ${kind} varsayılan şablonda KAPALI`, buildDefaultFields(kind).find((f) => f.key === "customerBatchNo")?.isVisible === false);
  }

  console.log("§2 Alan zinciri");
  const base = { ...mockPayload("ROLL_FINISHED" as never), labelBatchNo: null } as LabelPayload;
  const v = (p: Partial<LabelPayload>) => fieldDisplayValue({ ...base, ...p } as LabelPayload, "customerBatchNo");
  check("§2 etikete yazılan gelen belgeyi ezer", v({ labelBatchNo: "J1", deliveryNoteBatchNo: GB }).value === "J1");
  check("§2 yazılan yoksa gelen belge partisi", v({ deliveryNoteBatchNo: GB }).value === GB);
  check("§2 yalnız boşluk = yazılmamış", v({ labelBatchNo: "   ", deliveryNoteBatchNo: GB }).value === GB);
  check("§2 ikisi de yoksa present:false", !v({}).present);

  console.log("§3 Gerçek onay yolu");
  const actor = await testActorId();
  const mkCustomer = async (sfx: string, enabled: boolean) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${sfx}`, name: `${TAG} ${sfx}`, tamburLabelBatchEnabled: enabled }, select: { id: true } });
    made.customers.push(c.id);
    return c.id;
  };
  const ownerOn = await mkCustomer("ON", true);
  const ownerOff = await mkCustomer("OFF", false);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} süprem`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED]) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL] } } });
  const noteRoll = async (owner: string, sfx: string) => {
    const note = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner, senderText: `${TAG} GÖNDEREN`, customerBatchNo: ` ${GB} `,
      lines: [{ senderRollNo: `${TAG}-${sfx}`, meters: 120, weightKg: 25, itemText: "SULTAN", itemId: fabric.id }],
    }, actor);
    made.notes.push(note.id);
    await approveDeliveryNote(note.id, {}, actor);
    const line = await prisma.customerDeliveryNoteLine.findFirst({ where: { noteId: note.id }, select: { rollId: true } });
    return line!.rollId!;
  };
  const rootOn = await noteRoll(ownerOn, "R1");
  const rootOff = await noteRoll(ownerOff, "R2");
  const grade = await roleGrade("FIRST");
  const wh = await fixtureWarehouseId();
  // Test fikstürü — ata zinciri (Tambur çocuğu) ve gelen belgesiz top; üretim yazımı tambur servisinde.
  const fixtureRoll = async (sfx: string, parentRollId: string | null, ownerCustomerId: string) => {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-${sfx}`, itemId: fabric.id, initialQty: 60, currentQty: 60, status: RollStatus.WAREHOUSE, warehouseId: wh, qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, createdById: actor, parentRollId, ownerCustomerId }, select: { id: true } });
    made.rolls.push(r.id);
    return r.id;
  };
  const child = await fixtureRoll("C1", rootOn, ownerOn);
  const grand = await fixtureRoll("C2", child, ownerOn);
  const plain = await fixtureRoll("P", null, ownerOn);
  check("§3 ⭐ kök top: label-settings gelen belge partisi (kırpılmış)", (await getTamburLabelSettings({ rollId: rootOn })).deliveryNoteBatchNo === GB);
  check("§3 ⭐ torun top: atanın partisi", (await getTamburLabelSettings({ rollId: grand })).deliveryNoteBatchNo === GB);
  check("§3 satırsız top: null", (await getTamburLabelSettings({ rollId: plain })).deliveryNoteBatchNo === null);
  check("§3 topsuz okuma: null", (await getTamburLabelSettings({})).deliveryNoteBatchNo === null);
  const pChild = (await labels.getRollLabel(child)).data;
  check("§3 etiket yükü: çocukta deliveryNoteBatchNo", pChild.deliveryNoteBatchNo === GB, String(pChild.deliveryNoteBatchNo));
  const pPlain = (await labels.getRollLabel(plain)).data;
  check("§3 satırsız topta anahtar YOK (bayt-aynı)", !("deliveryNoteBatchNo" in pPlain));

  console.log("§4 Ayar açık — yaz / boş / temizle");
  const s = await getTamburLabelSettings({ rollId: rootOn });
  check("§4 label-settings labelBatchEnabled=true", s.labelBatchEnabled === true);
  const c1 = (await tambur.cutWarehouseRoll(rootOn, { cutLength: 10, labelBatchNo: " OP1 " }, actor)).data!.childRoll.id;
  made.rolls.push(c1);
  const lb = async (id: string) => (await prisma.roll.findUnique({ where: { id }, select: { labelBatchNo: true } }))?.labelBatchNo ?? null;
  check("§4 ⭐ tamburda yazılan değer çocuğa yazıldı", (await lb(c1)) === "OP1");
  const fv = async (id: string) => fieldDisplayValue((await labels.getRollLabel(id)).data, "customerBatchNo").value;
  check("§4 ⭐ şablon alanı yazılanı basar (gelen belgeyi ezer)", (await fv(c1)) === "OP1");
  const c2 = (await tambur.cutWarehouseRoll(rootOn, { cutLength: 10, labelBatchNo: null }, actor)).data!.childRoll.id;
  made.rolls.push(c2);
  check("§4 değersiz kesim → null", (await lb(c2)) === null);
  check("§4 ⭐ değersiz topta alan gelen belge partisine düşer", (await fv(c2)) === GB);
  await fixRollLabelTexts(c1, { labelBatchNo: "", reason: "test temizleme" }, actor);
  check("§4 ⭐ label-texts \"\" temizler", (await lb(c1)) === null);

  console.log("§5 Ayar kapalı — bugünkü davranış");
  const so = await getTamburLabelSettings({ rollId: rootOff });
  check("§5 label-settings labelBatchEnabled=false (alan tablette gizli)", so.labelBatchEnabled === false && so.deliveryNoteBatchNo === GB);
  check("§5 değerli kesim → 400 LABEL_BATCH_NOT_ENABLED", (await errCode(tambur.cutWarehouseRoll(rootOff, { cutLength: 10, labelBatchNo: "OP1" }, actor))) === "400:LABEL_BATCH_NOT_ENABLED");
  const c3 = (await tambur.cutWarehouseRoll(rootOff, { cutLength: 10 }, actor)).data!.childRoll.id;
  made.rolls.push(c3);
  check("§5 değersiz kesim geçer, null", (await lb(c3)) === null);

  console.log("§6 Kanvas basımı");
  const format = await resolveLabelFormat({ kind: LabelKind.ROLL_FINISHED });
  const variant = { widthMm: 100, heightMm: 50, elements: { v: 1, elements: [{ id: "p", type: "field", x: 3, y: 3, bind: "customerBatchNo", label: "Parti", font: "md" }] } };
  for (const lang of ["PPLB", "ZPL"] as const) {
    const render = async (payload: LabelPayload) => (await renderLabel(lang as PrinterLanguage, {
      payload: { ...payload, kind: LabelKind.ROLL_FINISHED } as LabelPayload, template: { id: "t", fields: [], rawCode: null } as never, variant: variant as never,
      barcodeSvg: "", qrSvg: "", copies: 1, format: { ...format, language: lang as PrinterLanguage },
    } as never)).content;
    check(`§6 ${lang} gelen belge partisi basılır`, (await render({ ...base, deliveryNoteBatchNo: GB } as LabelPayload)).includes(`Parti: ${GB}`));
    check(`§6 ${lang} yazılan parti basılır`, (await render({ ...base, labelBatchNo: "OP1", deliveryNoteBatchNo: GB } as LabelPayload)).includes("Parti: OP1"));
    check(`§6 ${lang} değer yoksa "Parti" basılmaz`, !(await render(base)).includes("Parti"));
  }
}

async function cleanup(): Promise<void> {
  const rootIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const all = [...made.rolls, ...rootIds];
  const kids = (await prisma.roll.findMany({ where: { parentRollId: { in: all } }, select: { id: true } })).map((r) => r.id);
  const ids = [...new Set([...kids, ...all])];
  for (const m of ["rollVariance", "rollOperation", "rollMovement", "rollProperty", "warehouseMovement", "rollCustomerCode"] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: ids } } }).catch(() => undefined);
  }
  await prisma.roll.updateMany({ where: { id: { in: ids } }, data: { parentRollId: null } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids } } });
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers] } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(() => undefined);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(() => undefined);
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
    await cleanup().catch((e) => console.log("  ⚠️ temizlik:", (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void run();
else void prisma.$disconnect();
