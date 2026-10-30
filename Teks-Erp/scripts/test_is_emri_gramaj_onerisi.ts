// =============================================================================
// TEST (H9b): iş emri hedef kurşun gramajı ÖNERİSİ — gelen belgeden (DALGA2 §3 md. 2 · OCR F1.2)
// =============================================================================
//   Zincir: İE → canlı topları (whereRollsOfWorkOrder) → en yakın atanın gelen belge satırı → işlem metni →
//   H9 çözücüsü (suggestProcess: sözlük, sonra kalıp). Yüzey: GET /api/work-orders/:id/process-summary
//   yanıtında `deliveryNoteGramaj` (servis düzeyinde ölçülür; uç mevcut, izni workorder:read).
//   §1 saf birleştirme: tek değer → öneri · çelişki → öneri yok + liste · çözülmeyen metin = çelişki · boş → null
//   §2 ⭐ 3 top aynı belgeden "41 GR" → öneri 41 gr, kapsama 3/3
//   §3 ⭐ iki topun işlem metni farklı gramaj → öneri YOK, liste iki kalem
//   §4 ⭐ Tambur çocuğu atanın satırını taşır (başlık metni yedeği) + kısmi kapsama aynı değer → öneri, 2/3
//   §5 PROCESS sözlüğü kalıptan önce (gramajsız metin onayda öğrenilmiş çeşide çözülür)
//   §5b ⭐ D4-D1 özellik gruplu: kurşun + brode deseni ayrı gruplarda (`variants`); iki desende birleşmeyen toplar → brode önerisi yok
//   §6 ⭐ gelen belgesiz İE → alan null
//   §7 ⭐ modül kapalı → anahtar YOK, yanıt bayt-aynı (açık yanıttan anahtar çıkarılmış hâli)
//   §8 ⭐ öneri okuması hiçbir tabloya yazmaz (İE hedefi, sözlük, audit sayımları değişmez)
// Negatif sonda: workorder-gramaj-suggestion.service.ts `mergeGramajSuggestions`te `entries.length === 1`
// şartı gevşetilince (en kalabalık grup öneri olur) §1 ve §3 kırmızı.
// Çalıştır: npx tsx scripts/test_is_emri_gramaj_onerisi.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { loadKursunGramajOptions } from "../src/services/helpers/kursun-bypass-gramaj.helper";
import { getWorkOrderProcessSummary } from "../src/services/workorder-target-value.service";
import { mergeGramajSuggestions } from "../src/services/workorder-gramaj-suggestion.service";
import type { ProcessSuggestion } from "../src/services/gelen-belge-eslestirme.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { roleGrade } from "./fixture-quality-grade";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
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

// Etiket YALNIZ harftir: işlem metninin sonuna eklendiği için rakamlı parça
// ('…648G') gramaj kalıbı gibi okunup öneriyi bozuyordu (CI'da ara sıra suggested=null).
const TAG = `TSTIGO${[...Date.now().toString(26)].map((c) => String.fromCharCode(65 + parseInt(c, 26))).join("")}`;
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], props: [] as string[], flags: [] as string[], fixtureRolls: [] as string[], wos: [] as string[], kursunCreated: null as string | null };
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];

function section1(): void {
  console.log("§1 Saf birleştirme");
  const sug = (id: string | null, text: string | null): { processText: string | null; suggestion: ProcessSuggestion } => ({
    processText: text,
    suggestion: { rawText: text, suggested: id ? { id, name: `${id} gr` } : null, source: id ? "PATTERN" : "NONE" },
  });
  const one = mergeGramajSuggestions(3, [sug("50", "50 GR"), sug("50", "KURŞUN 50GR"), sug("50", "50 GR")]);
  check("§1 tek değer → öneri + kapsama 3/3", one?.suggested?.valueId === "50" && one.coveredRollCount === 3 && one.rollCount === 3 && one.entries.length === 1, JSON.stringify(one));
  const clash = mergeGramajSuggestions(3, [sug("50", "50 GR"), sug("50", "50 GR"), sug("25", "25 GR")]);
  check("§1 ⭐ çelişki (2×50, 1×25) → öneri YOK, liste iki kalem", clash?.suggested === null && clash.entries.length === 2 && clash.entries[0]?.rollCount === 2, JSON.stringify(clash));
  const unresolved = mergeGramajSuggestions(2, [sug("50", "50 GR"), sug(null, "ÖZEL APRE")]);
  check("§1 çözülmeyen metin çelişki sayılır → öneri YOK", unresolved?.suggested === null && unresolved.entries.length === 2, JSON.stringify(unresolved));
  const none = mergeGramajSuggestions(2, [sug(null, "APRE"), sug(null, "APRE")]);
  check("§1 hepsi çözülmeyen tek metin → öneri YOK, liste bir kalem", none?.suggested === null && none.entries.length === 1);
  check("§1 kapsanan top yok → null", mergeGramajSuggestions(4, []) === null);
}

async function main(): Promise<void> {
  section1();
  // Boot uzlaştırması taze test DB'sinde koşmamış olabilir (emsal test_barcode_free_flow).
  await ensureDefaultWarehouse();
  const actor = await testActorId();
  const kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  const kursunId = kursun?.id ?? (await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${TAG}`, valueType: "FLAG" }, select: { id: true } })).id;
  if (!kursun) made.kursunCreated = kursunId;
  // Ortamdan bağımsızlık: 41/79 gr başka aktif çeşitte yoksa kalıp tek adaylıdır.
  const env = await loadKursunGramajOptions();
  check("zemin: ortamda başka 41/79 gr çeşidi yok", !env.some((o) => /\b(41|79) ?gr\b/i.test(o.name)), env.map((o) => o.name).join(","));
  const gramaj = await prisma.fabricProperty.create({
    data: { code: `${TAG}-GR`.slice(0, 32), name: `TEST gramaj ${TAG}`, valueType: "CHOICE", variantOfPropertyId: kursunId, values: { create: [{ code: `${TAG}41`, name: "41 gr", sortOrder: 1 }, { code: `${TAG}79`, name: "79 gr", sortOrder: 2 }] } },
    select: { id: true, values: { select: { id: true, name: true } } },
  });
  made.props.push(gramaj.id);
  const v41 = gramaj.values.find((v) => v.name === "41 gr")!.id;
  const v79 = gramaj.values.find((v) => v.name === "79 gr")!.id;

  const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
  made.customers.push(owner.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} süprem`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  for (const [k, v] of [[SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL] } } });

  let seq = 0;
  const noteRolls = async (header: string | null, lineTexts: Array<string | null>, processChoices?: Array<{ lineId: null; valueId: string }>) => {
    const n = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} GÖNDEREN`, processText: header,
      lines: lineTexts.map((t) => ({ senderRollNo: `${TAG}-${++seq}`, meters: 100, itemId: fabric.id, processText: t })),
    }, actor);
    made.notes.push(n.id);
    await approveDeliveryNote(n.id, processChoices ? { processChoices } : {}, actor);
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n.id }, orderBy: { lineNo: "asc" }, select: { rollId: true } });
    return lines.map((l) => l.rollId!);
  };
  const grade = await roleGrade("FIRST");
  const wh = await fixtureWarehouseId();
  const mkRoll = async (suffix: string, parentRollId: string | null) => {
    // Test fikstürü — Tambur bölmesinin ürettiği çocuk top (ata bağı) ya da gelen belgesiz top.
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-${suffix}`, itemId: fabric.id, initialQty: 60, currentQty: 60, status: RollStatus.STOCK, warehouseId: wh, qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, createdById: actor, parentRollId }, select: { id: true } });
    made.fixtureRolls.push(r.id);
    return r.id;
  };
  let woSeq = 0;
  const mkWorkOrder = async (rollIds: string[]) => {
    woSeq++;
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO${woSeq}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric.id }, select: { id: true } });
    made.wos.push(wo.id);
    const b = await prisma.batch.create({ data: { batchNumber: `${TAG}-B${woSeq}`, workOrderId: wo.id }, select: { id: true } });
    // Fikstür: topların partiye bağı (üretimde parti ekleme servisinin yazdığı bağ).
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { batchId: b.id } });
    return wo.id;
  };
  const read = async (woId: string) => (await getWorkOrderProcessSummary(woId)).data;

  console.log("§2 Aynı gramaj, üç top");
  const woSame = await mkWorkOrder(await noteRolls(null, [`KURŞUN 41 GR ${TAG}`, `KURŞUN 41 GR ${TAG}`, `KURŞUN 41GR ${TAG}`]));
  const s2 = (await read(woSame)).deliveryNoteGramaj;
  check("§2 ⭐ öneri 41 gr, kapsama 3/3", s2?.suggested?.valueId === v41 && s2.coveredRollCount === 3 && s2.rollCount === 3, JSON.stringify(s2));
  check("§2 yalnız-kurşun katalog: `variants` anahtarı YOK (H9b yanıtı bayt-aynı, D4-D1)", !!s2 && !("variants" in s2), Object.keys(s2 ?? {}).join(","));

  console.log("§3 Çelişen gramaj");
  const woClash = await mkWorkOrder(await noteRolls(null, [`KURŞUN 41 GR ${TAG}`, `KURŞUN 79 GR ${TAG}`]));
  const s3 = (await read(woClash)).deliveryNoteGramaj;
  check("§3 ⭐ öneri YOK + liste (41 ve 79)", s3?.suggested === null && s3.entries.length === 2 && [v41, v79].every((v) => s3.entries.some((e) => e.valueId === v)), JSON.stringify(s3));

  console.log("§4 Tambur çocuğu + kısmi kapsama");
  const [parent] = await noteRolls(`KURŞUN 41 GR ${TAG}`, [null]);
  // Fikstür: ata Tambur'da bölündü (ölü statü) ve İE partisine bağlı — K18 dışlaması çift saymayı önlemeli.
  await prisma.roll.updateMany({ where: { id: parent! }, data: { status: RollStatus.TAMBUR_CONSUMED } });
  const woChild = await mkWorkOrder([parent!, await mkRoll("C1", parent!), await mkRoll("C2", parent!), await mkRoll("P1", null)]);
  const s4 = (await read(woChild)).deliveryNoteGramaj;
  check("§4 ⭐ çocuk toplar atanın satırını (başlık metni) taşır → 41 gr", s4?.suggested?.valueId === v41, JSON.stringify(s4));
  check("§4 ⭐ kısmi kapsama 2/3 (gelen belgesiz top kapsam dışı; TAMBUR_CONSUMED ata sayılmaz)", s4?.coveredRollCount === 2 && s4.rollCount === 3, `${s4?.coveredRollCount}/${s4?.rollCount}`);

  console.log("§5 Sözlük kalıptan önce");
  const ALIAS_TEXT = `ÖZEL APRE ${TAG}`;
  const learned = await noteRolls(ALIAS_TEXT, [null], [{ lineId: null, valueId: v79 }]);
  const woAlias = await mkWorkOrder(learned);
  const s5 = (await read(woAlias)).deliveryNoteGramaj;
  check("§5 gramajsız metin onayda öğrenilen sözlükle 79 gr", s5?.suggested?.valueId === v79, JSON.stringify(s5));

  console.log("§5b Özellik gruplu öneri — brode deseni (D4-D1)");
  const brFlag = await prisma.fabricProperty.create({ data: { code: `${TAG}-BR`.slice(0, 32), name: `TEST Brode ${TAG}`, valueType: "FLAG" }, select: { id: true } });
  made.flags.push(brFlag.id);
  const desen = await prisma.fabricProperty.create({
    data: { code: `${TAG}-BD`.slice(0, 32), name: "Brode deseni", valueType: "CHOICE", variantOfPropertyId: brFlag.id, values: { create: [{ code: "D12", name: "Desen D12" }, { code: "D15", name: "Desen D15" }] } },
    select: { id: true, values: { select: { id: true, code: true } } },
  });
  made.props.push(desen.id);
  const d12 = desen.values.find((v) => v.code === "D12")!.id;
  const woBrode = await mkWorkOrder(await noteRolls(null, [`KURŞUN 41 GR BRODE D12 ${TAG}`, `BRODE DESEN D12 KURŞUN 41GR ${TAG}`]));
  const s5b = (await read(woBrode)).deliveryNoteGramaj;
  const br = s5b?.variants?.find((v) => v.propertyId === desen.id);
  check("§5b ⭐ kurşun 41 gr + brode D12 ayrı gruplarda önerilir", s5b?.suggested?.valueId === v41 && br?.suggested?.valueId === d12 && br.propertyName === "Brode deseni", JSON.stringify(s5b));
  const woBrodeClash = await mkWorkOrder(await noteRolls(null, [`BRODE D12 ${TAG}`, `BRODE D15 ${TAG}`]));
  const s5c = (await read(woBrodeClash)).deliveryNoteGramaj?.variants?.find((v) => v.propertyId === desen.id);
  check("§5b ⭐ toplar iki desende birleşmiyor → brode önerisi YOK + liste", s5c?.suggested === null && s5c.entries.length === 2, JSON.stringify(s5c));
  // Sonraki bölümler yalnız-kurşun kataloğu ölçer: brode özelliği pasife (katalogdan düşer).
  await prisma.fabricProperty.update({ where: { id: desen.id }, data: { isActive: false } });

  console.log("§6 Gelen belgesiz İE");
  const woPlain = await mkWorkOrder([await mkRoll("P2", null), await mkRoll("P3", null)]);
  const d6 = await read(woPlain);
  check("§6 ⭐ alan null (anahtar var, değer boş)", "deliveryNoteGramaj" in d6 && d6.deliveryNoteGramaj === null, JSON.stringify(d6.deliveryNoteGramaj));

  console.log("§8 Okuma hiçbir tabloya yazmaz (§7'den önce ölçülür)");
  const ids = [woSame, woClash, woChild, woAlias, woPlain];
  const snap = async () => JSON.stringify([
    await prisma.workOrderTargetValue.findMany({ where: { workOrderId: { in: ids } }, select: { id: true, valueId: true, revokedAt: true }, orderBy: { id: "asc" } }),
    await prisma.deliveryNoteAlias.findMany({ select: { id: true, hitCount: true, targetId: true, updatedAt: true }, orderBy: { id: "asc" } }),
    await prisma.systemLog.count(),
    await prisma.workOrder.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
  ]);
  const before = await snap();
  for (const id of ids) await read(id);
  check("§8 ⭐ İE hedefi · PROCESS sözlüğü · audit · İE satırı değişmedi", (await snap()) === before);

  console.log("§7 Modül kapalı → bayt-aynı");
  const on = await getWorkOrderProcessSummary(woSame);
  await prisma.systemSetting.update({ where: { key: SETTING_KEYS.GELEN_BELGE_ENABLED }, data: { value: false } });
  const off = await getWorkOrderProcessSummary(woSame);
  check("§7 ⭐ modül kapalı: anahtar YOK", !("deliveryNoteGramaj" in off.data), JSON.stringify(Object.keys(off.data)));
  const { deliveryNoteGramaj: _drop, ...onWithout } = on.data;
  check("§7 ⭐ yanıt bayt-aynı (açık yanıt − anahtar)", JSON.stringify(off) === JSON.stringify({ ...on, data: onWithout }));
  await prisma.systemSetting.update({ where: { key: SETTING_KEYS.GELEN_BELGE_ENABLED }, data: { value: true } });
  await prisma.systemSetting.update({ where: { key: SETTING_KEYS.EMANET_ENABLED }, data: { value: false } });
  check("§7 ön koşul emanet kapalı → anahtar YOK", !("deliveryNoteGramaj" in (await getWorkOrderProcessSummary(woSame)).data));
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
  await prisma.batch.deleteMany({ where: { workOrderId: { in: made.wos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: made.wos } } });
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.props } } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.flags } } });
  if (made.kursunCreated) await prisma.fabricProperty.deleteMany({ where: { id: made.kursunCreated } });
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
