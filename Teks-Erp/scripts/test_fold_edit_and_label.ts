// =============================================================================
// Test: KAT — panelden DÜZELTİLEBİLİR + ETİKETE BASILABİLİR (2026-08-13)
// Çalıştır: npx tsx scripts/test_fold_edit_and_label.ts
// =============================================================================
// İki saha isteğinin bekçisi:
//   (a) "düzelt diyaloğuna kat alanını ekle" — kesim yolunda istemci alanı
//       düşürdüğü için katsız doğmuş toplar vardı; tek düzeltme kapısı bu uç.
//   (b) "etiketlerde de kat tipi ekleyebilelim" — Etiket Stüdyosu'nda "Kat"
//       alanı sürüklenebilsin, baskıda değeri çıksın.
//
// Doğrulananlar:
//   §1 applyManualProperties KAT yazar; biçim farkı KANONİKLEŞTİRİLİR
//      ("6 kat" → "6-KAT"). Kanoniklik load-bearing: envanterin kat filtresi
//      ham değeri BULAMAZ ve hata/log çıkmaz (2026-08-04 notu).
//   §2 Alan GÖNDERİLMEZSE kata DOKUNULMAZ; `null` TEMİZLER (üçlü sözleşme).
//      Bu ayrım bozulursa renk düzelten operatör katı sessizce siler.
//   §3 Katalog DIŞI değer REDDEDİLİR (kolon serbest metin ama kapı katalogdur).
//   §4 Kat değişimi `labelDirty` işaretler — kat artık etikete basılıyor.
//   §5 `relabel-context` katı DÖNER (diyalog mevcut değeri seçili göstersin).
//   §6 Etiket YÜKÜ katı taşır ve alan KATALOĞDA (ROLL_RAW + ROLL_FINISHED).
//   §7 `fieldDisplayValue("foldType")` değeri basar; kat YOKSA present:false
//      (şablonda alan dursa bile baskıda atlanır — sackNote emsali).
//   §8 Kat etikete KODUYLA basılır (ada çevrilmez) — kod topun kimliği.
//
// Fixture kendi verisini üretir (ortam verisine bağımlı DEĞİL), finally'de siler.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { LabelService } from "../src/services/label.service";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { FIELD_CATALOG, getUnifiedKeys } from "../src/config/label-fields";
import { FOLD_PROPERTY_CODE } from "../src/services/helpers/fold-type";
import type { LabelPayload } from "../src/types/label.types";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

const inventory = new InventoryService();
const labels = new LabelService();

const foldOf = async (id: string): Promise<string | null> =>
  (await prisma.roll.findUnique({ where: { id }, select: { foldType: true } }))?.foldType ?? null;

async function main(): Promise<void> {
  const ts = Date.now();
  let itemId = "";
  const rollIds: string[] = [];
  const probeValueIds: string[] = [];
  let createdProperty = false;

  // Kat kataloğu — testin kendisi kurar. Gerçek "KAT" satırına DOKUNULMAZ:
  // varsa yalnız sonda değeri eklenir, yoksa satır kurulur ve sonunda silinir.
  let prop = await prisma.fabricProperty.findUnique({
    where: { code: FOLD_PROPERTY_CODE },
    select: { id: true },
  });
  if (!prop) {
    prop = await prisma.fabricProperty.create({
      data: { code: FOLD_PROPERTY_CODE, name: "Kat", valueType: "CHOICE" },
      select: { id: true },
    });
    createdProperty = true;
  }
  const propertyId = prop.id;
  for (const [code, name, sortOrder] of [["2-KAT", "2 Kat", 10], ["6-KAT", "6 Kat", 30]] as const) {
    const existing = await prisma.fabricPropertyValue.findFirst({ where: { propertyId, code } });
    if (!existing) {
      const v = await prisma.fabricPropertyValue.create({
        data: { propertyId, code, name, sortOrder },
        select: { id: true },
      });
      probeValueIds.push(v.id);
    }
  }

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-KATD-${ts}`, name: `TEST Kat Düzelt ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    itemId = item.id;

    const roll = await prisma.roll.create({
      data: {
        barcode: `TEST-KATD-R-${ts}`,
        itemId,
        status: RollStatus.WAREHOUSE, // serbest stok → sebep/yetki gerekmez
        initialQty: 100,
        currentQty: 100,
        qualityGrade: "1.KALITE",
        entrySource: "MANUAL_ENTRY",
        foldType: null, // ⭐ katsız doğmuş top — düzeltilecek olan durum
      },
      select: { id: true },
    });
    rollIds.push(roll.id);

    // ── §1 KAT YAZILIR + KANONİKLEŞİR ───────────────────────────────────────
    console.log("\n── §1 Düzelt: kat yazılır, biçim kanonikleşir ──");
    await inventory.applyManualProperties(roll.id, {
      colorId: null,
      propertyIds: [],
      foldType: "6 kat", // ⭐ serbest yazım — kanonik "6-KAT" olmalı
    });
    check(
      '⭐ "6 kat" → "6-KAT" kanonik yazıldı',
      (await foldOf(roll.id)) === "6-KAT",
      `kolon=${await foldOf(roll.id)} — ham geçseydi kat filtresi bu topu BULAMAZDI`,
    );

    // ── §2 ÜÇLÜ SÖZLEŞME: dokunma / temizle ─────────────────────────────────
    console.log("\n── §2 Alan yoksa DOKUNMA, null ise TEMİZLE ──");
    await inventory.applyManualProperties(roll.id, { colorId: null, propertyIds: [] });
    check(
      "⭐ alan GÖNDERİLMEYİNCE kat KORUNUR (renk düzeltmesi katı silmez)",
      (await foldOf(roll.id)) === "6-KAT",
      `kolon=${await foldOf(roll.id)}`,
    );
    await inventory.applyManualProperties(roll.id, {
      colorId: null,
      propertyIds: [],
      foldType: null,
    });
    check("null → kat TEMİZLENİR", (await foldOf(roll.id)) === null);
    // Geri yaz (sonraki bölümler dolu kat ister)
    await inventory.applyManualProperties(roll.id, {
      colorId: null,
      propertyIds: [],
      foldType: "6-KAT",
    });

    // ── §3 KATALOG DIŞI DEĞER REDDEDİLİR ────────────────────────────────────
    console.log("\n── §3 Katalog kapısı ──");
    await expectErr(
      "⭐ katalogda olmayan kat REDDEDİLİR",
      "geçerli bir kat değeri değil",
      () =>
        inventory.applyManualProperties(roll.id, {
          colorId: null,
          propertyIds: [],
          foldType: "99-KAT",
        }),
    );
    check(
      "reddedilen yazımdan sonra kolon DEĞİŞMEDİ",
      (await foldOf(roll.id)) === "6-KAT",
      `kolon=${await foldOf(roll.id)}`,
    );

    // ── §4 KAT DEĞİŞİMİ ETİKETİ BAYATLATIR ──────────────────────────────────
    console.log("\n── §4 labelDirty ──");
    await prisma.roll.update({ where: { id: roll.id }, data: { labelDirty: false } });
    await inventory.applyManualProperties(roll.id, {
      colorId: null,
      propertyIds: [],
      foldType: "2-KAT",
    });
    const afterFold = await prisma.roll.findUnique({
      where: { id: roll.id },
      select: { labelDirty: true, foldType: true },
    });
    check(
      "⭐ kat değişimi labelDirty=true yapar (kat artık etikete basılıyor)",
      afterFold?.labelDirty === true && afterFold.foldType === "2-KAT",
      `dirty=${afterFold?.labelDirty} kat=${afterFold?.foldType}`,
    );
    // Aynı değeri tekrar yazmak NO-OP olmalı — sahte bayatlama etiketi boşuna
    // "güncel değil" gösterir.
    await prisma.roll.update({ where: { id: roll.id }, data: { labelDirty: false } });
    await inventory.applyManualProperties(roll.id, {
      colorId: null,
      propertyIds: [],
      foldType: "2-KAT",
    });
    check(
      "aynı kat tekrar yazılınca labelDirty TETİKLENMEZ",
      (await prisma.roll.findUnique({ where: { id: roll.id }, select: { labelDirty: true } }))
        ?.labelDirty === false,
    );

    // ── §5 RELABEL-CONTEXT KATI DÖNER ───────────────────────────────────────
    console.log("\n── §5 Düzelt diyaloğunun bağlamı ──");
    const ctx = (await inventory.getRelabelContext({ rollId: roll.id })).data;
    check(
      "⭐ relabel-context foldType taşır (diyalog mevcut katı seçili gösterir)",
      ctx?.foldType === "2-KAT",
      `ctx.foldType=${ctx?.foldType} — alan dönmezse seçici HER AÇILIŞTA boş başlar`,
    );

    // ── §6 ETİKET KATALOĞU + YÜKÜ ───────────────────────────────────────────
    console.log("\n── §6 Etiket alanı katalogda ──");
    for (const kind of ["ROLL_RAW", "ROLL_FINISHED"] as const) {
      check(
        `${kind} kataloğunda "foldType" alanı var`,
        FIELD_CATALOG[kind].some((f) => f.key === "foldType"),
      );
    }
    check(
      "birleşik katalogda (Stüdyo paleti) foldType var",
      getUnifiedKeys().has("foldType"),
      "palet backend katalogundan besleniyor — burada yoksa sürüklenemez",
    );
    check(
      "çuval etiketinde foldType YOK (karışık içerik — tek kat sessizce yanlış olur)",
      !FIELD_CATALOG.SACK.some((f) => f.key === "foldType"),
    );

    const payload = (await labels.getRollLabel(roll.id)).data;
    check(
      "⭐ etiket yükü katı taşır",
      payload.foldType === "2-KAT",
      `payload.foldType=${payload.foldType}`,
    );

    // ── §7 DEĞER HARİTASI ───────────────────────────────────────────────────
    console.log("\n── §7 Render değeri (HTML + PPLA/PPLB/ZPL ortak) ──");
    const fv = fieldDisplayValue(payload, "foldType");
    check("değer basılır ve present=true", fv.value === "2-KAT" && fv.present, JSON.stringify(fv));
    const emptyFold = fieldDisplayValue({ ...payload, foldType: null }, "foldType");
    check(
      "⭐ kat YOKSA present=false (şablonda alan dursa bile baskıda atlanır)",
      !emptyFold.present,
      JSON.stringify(emptyFold),
    );

    // ── §8 KOD BASILIR, AD DEĞİL ────────────────────────────────────────────
    console.log("\n── §8 Etikette KOD basılır ──");
    const named = fieldDisplayValue({ ...payload, foldType: "6-KAT" } as LabelPayload, "foldType");
    check(
      "⭐ katalog KODU basılır, görünen ad değil",
      named.value === "6-KAT",
      `basılan="${named.value}" — ad basılsaydı ("6 Kat") kayıtla etiket ayrışırdı`,
    );
  } finally {
    if (rollIds.length) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
    await prisma.fabricPropertyValue.deleteMany({ where: { id: { in: probeValueIds } } }).catch(() => {});
    if (createdProperty) {
      await prisma.stationProperty.deleteMany({ where: { propertyId } }).catch(() => {});
      await prisma.fabricPropertyValue.deleteMany({ where: { propertyId } }).catch(() => {});
      await prisma.fabricProperty.delete({ where: { id: propertyId } }).catch(() => {});
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
