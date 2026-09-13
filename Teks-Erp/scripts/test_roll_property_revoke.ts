// =============================================================================
// BEKÇİ — ÖZELLİK PİVOTU GERİ ALINIR, SİLİNMEZ (③a, OZELLIK-PIVOT-SURUMLEME-PLAN)
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_property_revoke
// =============================================================================
// NEDEN: `RollProperty`/`WorkOrderTargetProperty` sil-yaz ile değiştiriliyordu;
// "top hangi özellikteydi" geçmişi yoktu ve tabletten her renk/en düzeltmesi
// bayrakları siliyordu. Damgaya geçince okuyan tek bir yol süzgeci unutursa
// damgalı özellik "aktif" sayılır — kapsama uyarısı susar, çocuğa iki değer
// miras kalır, hata da log da çıkmaz. Asıl risk OKURLARDIR (B-4a dersi).
//
// ÖLÇÜLENLER (Faz 1 — şema + helper + okur turu)
//   §1 Geri alma satırı SİLMEZ; üç damga dolu, `createdAt`/`valueId` değişmez;
//      zaten damgalı satıra ikinci damga DOKUNMAZ
//   §2 ⭐ PARTIAL UNIQUE: damgalı satır dururken aynı çift YENİDEN yazılabilir
//   §3 ⭐ İKİ AKTİF satır yazılamaz — sed görevde (P2002)
//   §4 Aktif okuma damgalıyı GÖRMEZ: top detayı · düzeltme bağlamı (echo yolu) ·
//      liste `properties` · iş emri detayı · iş emri kilit yardımcısı
//   §13 AST + tip denetleyicisi: her okuma çağrısı, ilişki süzgeci/iç içe okuma
//      ve ham SQL aktif yüklemi taşır ya da gerekçeli istisnadır; Faz 2c/2d'nin
//      kapatacağı SİLME siteleri ADIYLA beyanlıdır ve kapanınca beyanın düşmesi
//      zorunludur (ölü beklenti kırmızı)
// =============================================================================
import { join } from "node:path";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import {
  ACTIVE_ROLL_PROPERTY,
  ACTIVE_TARGET_PROPERTY,
  revokeRollProperties,
  revokeTargetProperties,
} from "../src/services/helpers/property-revoke.helper";
import { InventoryService } from "../src/services/inventory.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { computeWorkOrderLocks } from "../src/services/helpers/workorder-locks.helper";
import { aktifYuklemTara } from "./revoke-ast-tarama";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ts0 = Date.now();
const TAG = `TEST-RPR-${ts0}`;
const PROP_FLAG = "TEST-RPR-FLAG";
const PROP_CHOICE = "TEST-RPR-CHOICE";
const rollIds: string[] = [];
const woIds: string[] = [];
let itemId = "";
let propIds: string[] = [];

async function main(): Promise<void> {
  console.log("\n=== Özellik pivotu: geri alınır, silinmez ===\n");
  const admin = await ensureTestAdmin();
  const inv = new InventoryService();
  const wos = new WorkOrderService();

  // Fikstür İŞ ANAHTARIYLA (code) — ortamda aranmaz.
  const flag = await prisma.fabricProperty.upsert({
    where: { code: PROP_FLAG },
    create: { code: PROP_FLAG, name: "TEST RPR bayrak", valueType: "FLAG" },
    update: {}, select: { id: true },
  });
  const choice = await prisma.fabricProperty.upsert({
    where: { code: PROP_CHOICE },
    create: { code: PROP_CHOICE, name: "TEST RPR seçim", valueType: "CHOICE" },
    update: {}, select: { id: true },
  });
  propIds = [flag.id, choice.id];
  const v50 = await prisma.fabricPropertyValue.upsert({
    where: { propertyId_code: { propertyId: choice.id, code: "50GR" } },
    create: { propertyId: choice.id, code: "50GR", name: "50 gr" },
    update: {}, select: { id: true },
  });
  const v25 = await prisma.fabricPropertyValue.upsert({
    where: { propertyId_code: { propertyId: choice.id, code: "25GR" } },
    create: { propertyId: choice.id, code: "25GR", name: "25 gr" },
    update: {}, select: { id: true },
  });
  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const roll = await prisma.roll.create({
    data: { barcode: TAG, itemId, status: RollStatus.WAREHOUSE, initialQty: 100, currentQty: 100, entrySource: "MANUAL_ENTRY" },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await prisma.rollProperty.createMany({
    data: [{ rollId: roll.id, propertyId: flag.id }, { rollId: roll.id, propertyId: choice.id, valueId: v50.id }],
  });

  // ── §1 ────────────────────────────────────────────────────────────────────
  console.log("── §1 Geri alma SİLMEZ ──");
  const before = await prisma.rollProperty.findFirstOrThrow({ where: { rollId: roll.id, propertyId: choice.id }, select: { id: true, createdAt: true, valueId: true } });
  const n1 = await prisma.$transaction((tx) => revokeRollProperties(tx, { rollIds: [roll.id], propertyIds: [choice.id], reason: "bekçi §1", userId: admin.id }));
  const after = await prisma.rollProperty.findUniqueOrThrow({ where: { id: before.id } });
  check("§1 revoke 1 satır damgaladı, satır DURUYOR", n1 === 1 && after !== null, `n=${n1}`);
  check("§1 üç damga dolu (revokedAt · revokedById · revokeReason)", after.revokedAt !== null && after.revokedById === admin.id && after.revokeReason === "bekçi §1");
  check("§1 ileri kayıt değişmedi (createdAt · valueId)", after.createdAt.getTime() === before.createdAt.getTime() && after.valueId === before.valueId);
  const n1b = await prisma.$transaction((tx) => revokeRollProperties(tx, { rollIds: [roll.id], propertyIds: [choice.id], reason: "ikinci", userId: admin.id }));
  const after2 = await prisma.rollProperty.findUniqueOrThrow({ where: { id: before.id }, select: { revokeReason: true } });
  check("§1 zaten damgalı satıra ikinci damga DOKUNMADI (0 satır, sebep aynı)", n1b === 0 && after2.revokeReason === "bekçi §1");
  check("§1 dokunulmayan bayrak satırı AKTİF kaldı", (await prisma.rollProperty.count({ where: { rollId: roll.id, propertyId: flag.id, ...ACTIVE_ROLL_PROPERTY } })) === 1);

  // ── §2 / §3 ───────────────────────────────────────────────────────────────
  console.log("── §2/§3 Partial unique ──");
  let err2: unknown = null;
  try {
    await prisma.rollProperty.create({ data: { rollId: roll.id, propertyId: choice.id, valueId: v25.id } });
  } catch (e) { err2 = e; }
  check("§2 ⭐ damgalı satır dururken aynı çift YENİDEN yazıldı (partial unique)", err2 === null, err2 instanceof Error ? err2.message.split("\n")[0] : "");
  const aktifSecim = await prisma.rollProperty.findMany({ where: { rollId: roll.id, propertyId: choice.id, ...ACTIVE_ROLL_PROPERTY }, select: { valueId: true } });
  check("§2 1 aktif (25GR) + 1 damgalı (50GR) = toplam 2", aktifSecim.length === 1 && aktifSecim[0]!.valueId === v25.id && (await prisma.rollProperty.count({ where: { rollId: roll.id, propertyId: choice.id } })) === 2);
  let err3: unknown = null;
  try {
    await prisma.rollProperty.create({ data: { rollId: roll.id, propertyId: choice.id, valueId: v50.id } });
  } catch (e) { err3 = e; }
  check("§3 ⭐ İKİ AKTİF satır yazılamadı — sed görevde (P2002)", err3 instanceof Prisma.PrismaClientKnownRequestError && err3.code === "P2002", err3 instanceof Error ? err3.message.split("\n")[0] : "hata yok");

  // ── §4 ────────────────────────────────────────────────────────────────────
  console.log("── §4 Aktif okuma damgalıyı görmez ──");
  const detay = (await inv.findRollById(roll.id)).data as unknown as { properties: { propertyId: string; valueId: string | null; revokedAt?: unknown }[] };
  check("§4a top detayı 2 aktif satır (bayrak + 25GR), damgalı YOK", detay.properties.length === 2 && detay.properties.every((p) => p.propertyId !== choice.id || p.valueId === v25.id), `n=${detay.properties.length}`);
  check("§4a detay damga kolonu SIZDIRMIYOR (select, include değil)", detay.properties.every((p) => !("revokedAt" in p)));
  const ctx = (await inv.getRelabelContext({ rollId: roll.id })).data as unknown as { propertyIds?: string[]; properties?: { id: string }[] };
  const ctxIds = ctx.propertyIds ?? ctx.properties?.map((p) => p.id) ?? [];
  check("§4b düzeltme bağlamı (echo yolu) damgalı id döndürmüyor — 2 id", ctxIds.length === 2, JSON.stringify(ctxIds.length));
  const liste = await prisma.roll.findMany({ where: { id: roll.id }, select: { properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true } } } });
  check("§4c liste `properties` 2 aktif", liste[0]!.properties.length === 2);

  // İş emri hedefi: aktif + damgalı, detay/kilit yalnız aktifi görür.
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: TAG, type: "STOCK_PRODUCTION", status: "PLANNED", targetQuantity: 100, targetItemId: itemId,
      targetProperties: { create: [{ propertyId: flag.id }, { propertyId: choice.id }] } },
    select: { id: true },
  });
  woIds.push(wo.id);
  const nT = await prisma.$transaction((tx) => revokeTargetProperties(tx, { workOrderId: wo.id, propertyIds: [choice.id], reason: "bekçi §4", userId: admin.id }));
  check("§4d hedef damgası 1 satır, satır DURUYOR", nT === 1 && (await prisma.workOrderTargetProperty.count({ where: { workOrderId: wo.id } })) === 2);
  const woDetay = (await wos.findById(wo.id)).data as { targetProperties: { propertyId: string }[] };
  check("§4d iş emri detayı yalnız AKTİF hedefi döner (1)", woDetay.targetProperties.length === 1 && woDetay.targetProperties[0]!.propertyId === flag.id, `n=${woDetay.targetProperties.length}`);
  const locks = await computeWorkOrderLocks(prisma, wo.id);
  check("§4e kilit yardımcısı damgalı hedefi kilitli SAYMAZ", !locks.lockedPropertyIds.includes(choice.id), JSON.stringify(locks.lockedPropertyIds));
  let errT: unknown = null;
  try { await prisma.workOrderTargetProperty.create({ data: { workOrderId: wo.id, propertyId: choice.id } }); } catch (e) { errT = e; }
  check("§4f hedefte de damgalı dururken aynı çift yeniden yazıldı (partial unique)", errT === null, errT instanceof Error ? errT.message.split("\n")[0] : "");

  astKontrolleri();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

// -----------------------------------------------------------------------------
// §13 — AST + tip denetleyicisi (`revoke-ast-tarama.ts`)
// -----------------------------------------------------------------------------
/**
 * Faz 2'nin kapatacağı YAZAR siteleri — adıyla. 2c (inventory FLAG replace) ve 2d
 * (workorder replace/updateTargetProperties) indikçe bu küme BOŞALIR; boşalmadan kalan
 * giriş "ölü beklenti" olarak KIRMIZI verir. Kapsamını beyan etmeyen kapı sessiz
 * kalırdı; bu küme kapsam beyanıdır, muafiyet değil. (Y1 upsert Faz 1 ile aynı
 * commit'te kapandı: partial unique altında `upsert` 42P10 ile ÖLÜR — ölçüldü.)
 */
const BEKLENEN_YAZAR_CAGRI_IHLALI = new Set<string>([]);
const BEKLENEN_SILME_DOSYALARI = new Set<string>([
  "src/services/inventory.service.ts", // Y5 → Faz 2c
  "src/services/workorder.service.ts", // Y7/Y8/Y9 → Faz 2d
]);
/** "Bu özellik HİÇ kullanıldı mı" sorusunu soran yüzeyler — tarihsel satır da kanıttır. */
const BEKLENEN_ISTISNA_DOSYALARI = new Set<string>([
  "src/services/fabric-property.service.ts", // tip dönüşümü kilidi (O24 · T15)
]);

function astKontrolleri(): void {
  const kok = join(__dirname, "..");
  const helper = join("src", "services", "helpers", "property-revoke.helper.ts");
  const sonuc = aktifYuklemTara(kok, [
    { delegate: "rollProperty", model: "RollProperty", sabit: "ACTIVE_ROLL_PROPERTY", tablo: "roll_properties", helper },
    { delegate: "workOrderTargetProperty", model: "WorkOrderTargetProperty", sabit: "ACTIVE_TARGET_PROPERTY", tablo: "work_order_target_properties", helper },
  ]);
  // Zeminler BU tablolar için ölçüldü (2026-09-14): rollProperty çağrı 8 · ilişki 20;
  // workOrderTargetProperty çağrı 1 · ilişki 14; ham SQL iki tabloda da 0 (=== 0, >= değil).
  const zemin = { rollProperty: { cagri: 7, iliski: 18 }, workOrderTargetProperty: { cagri: 1, iliski: 12 } } as const;
  const tumIstisna: string[] = [];
  const tumSilme: string[] = [];
  const tumYazarIhlal: string[] = [];
  for (const [delegate, r] of sonuc) {
    const z = zemin[delegate as keyof typeof zemin];
    tumIstisna.push(...r.istisnalar);
    tumSilme.push(...r.silme);
    // Yazar ihlali (upsert) beklenen kümedeyse okur ihlali sayılmaz; kalan her şey ihlaldir.
    const cagriIhlalOkur = r.cagriIhlal.filter((y) => !BEKLENEN_YAZAR_CAGRI_IHLALI.has(y.replace(/:\d+ /, " ")));
    tumYazarIhlal.push(...r.cagriIhlal.filter((y) => BEKLENEN_YAZAR_CAGRI_IHLALI.has(y.replace(/:\d+ /, " "))));
    check(
      `§13a ${delegate}: her okuma/güncelleme çağrısı aktif yüklemi taşır ya da gerekçeli istisnadır`,
      r.cagriSayisi >= z.cagri && cagriIhlalOkur.length === 0,
      `çağrı=${r.cagriSayisi}${cagriIhlalOkur.length ? " İHLAL: " + cagriIhlalOkur.join(", ") : ""}`,
    );
    check(
      `§13b ${delegate}: her ilişki süzgeci / iç içe okuması aktif yüklemi taşır (every YOK)`,
      r.iliskiSayisi >= z.iliski && r.iliskiIhlal.length === 0,
      `ilişki=${r.iliskiSayisi}${r.iliskiIhlal.length ? " İHLAL: " + r.iliskiIhlal.join(", ") : ""}`,
    );
    check(`§13c ${delegate}: ham SQL başvurusu YOK (=== 0; varsa süzgeç ister)`, r.sqlSayisi === 0 && r.sqlIhlal.length === 0, `sql=${r.sqlSayisi}`);
  }
  const silmeDosyalari = new Set(tumSilme.map((y) => y.split(":")[0]));
  const beklenmeyenSilme = [...silmeDosyalari].filter((d) => !BEKLENEN_SILME_DOSYALARI.has(d));
  const oluSilme = [...BEKLENEN_SILME_DOSYALARI].filter((d) => !silmeDosyalari.has(d));
  check(
    "§13d silme siteleri BEYANLI kümeyle birebir (Faz 2c/2d kapatınca beyan DÜŞER — ölü beklenti kırmızı)",
    beklenmeyenSilme.length === 0 && oluSilme.length === 0,
    `silme=${tumSilme.length} beklenmeyen=[${beklenmeyenSilme.join(", ")}] ölü=[${oluSilme.join(", ")}]`,
  );
  const yazarKume = new Set(tumYazarIhlal.map((y) => y.replace(/:\d+ /, " ")));
  const oluYazar = [...BEKLENEN_YAZAR_CAGRI_IHLALI].filter((y) => !yazarKume.has(y));
  check("§13e yazar-çağrı beyanı (upsert) hâlâ gerçek — Faz 2a kapatınca beyan DÜŞER", oluYazar.length === 0, `ölü=[${oluYazar.join(", ")}]`);
  console.log(`   istisnalar (${tumIstisna.length}): ${tumIstisna.join(", ") || "—"}`);
  const istisnaDosyalari = new Set(tumIstisna.map((y) => y.split(":")[0]));
  const beklenmeyen = [...istisnaDosyalari].filter((d) => !BEKLENEN_ISTISNA_DOSYALARI.has(d));
  const olu = [...BEKLENEN_ISTISNA_DOSYALARI].filter((d) => !istisnaDosyalari.has(d));
  check("§13f istisna kümesi iki yönlü: sessiz yeni muaf yok, ölü muaf yok; iki istisna da o dosyada (O24 + T15)",
    beklenmeyen.length === 0 && olu.length === 0 && tumIstisna.length === 2,
    `beklenmeyen=[${beklenmeyen.join(", ")}] ölü=[${olu.join(", ")}] n=${tumIstisna.length}`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (woIds.length) {
      await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    if (propIds.length) {
      await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: propIds } } });
      await prisma.fabricProperty.deleteMany({ where: { id: { in: propIds } } });
    }
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
