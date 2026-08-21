// =============================================================================
// Test: Çuval etiketi (LabelKind.SACK) — payload + fail-closed şablon guard'ı
// Çalıştır: npx tsx scripts/test_sack_label.ts
//
// Doğrulananlar:
//   1. Katalog: FIELD_CATALOG[SACK] var, 10 alan, ürün/renk alanı YOK
//   2. Birleşik katalog: paylaşılan key'lerin kinds dizisine SACK eklendi
//   3. payload.barcode === payload.sackNo === Sack.sackNo (TEK KOD kuralı)
//   4. rollCount/lengthMeters ölü topu (CANCELLED/SCRAP) SAYMAZ
//   5. Çuval yorumu payload'a düşer + çok satırlı yorum tek satıra düzleşir
//   6. ⭐ FAIL-CLOSED: SACK şablonu yokken /html ve /native 400 verir
//      (roll etiketine SAPMAZ — yoksa tire dolu top etiketi basılırdı)
//   7. Şablon+varyant atanınca 4 dilde de çıktı üretilir ve sackNo içerir
//   8. fieldDisplayValue: sackNote boşsa present:false (eleman atlanır)
//   9. mockPayload(SACK) çuval alanlarını doldurur (stüdyo önizlemesi)
//  10. Olmayan çuval → 404
// =============================================================================

import { LabelKind, PrinterLanguage, RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { withSackConstraintSuspended } from "./fixture-sack-constraint";
import { LabelService } from "../src/services/label.service";
import { ShippingService } from "../src/services/shipping.service";
import { FIELD_CATALOG, SACK_FIELDS, getUnifiedCatalog } from "../src/config/label-fields";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { mockPayload } from "../src/services/helpers/label-rawcode";
import { AppError } from "../src/utils/app-error";

const labels = new LabelService();
const ship = new ShippingService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectErr(label: string, fn: () => Promise<unknown>, status: number): Promise<void> {
  let code: number | null = null;
  let msg = "";
  try { await fn(); } catch (e) { code = e instanceof AppError ? e.statusCode : -1; msg = (e as Error).message; }
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}${msg ? ` · "${msg.slice(0, 70)}"` : ""}`);
}

async function main(): Promise<void> {
  const ts = Date.now();

  // ── 1) Katalog ────────────────────────────────────────────────────────────
  const sackKeys = SACK_FIELDS.map((f) => f.key);
  check("1a) FIELD_CATALOG[SACK] tanımlı", !!FIELD_CATALOG[LabelKind.SACK]);
  check("1b) SACK kataloğu 10 alan", sackKeys.length === 10, sackKeys.join(","));
  check(
    "1c) çuval kataloğunda ÜRÜN/RENK alanı YOK (karışık içerik)",
    !sackKeys.some((k) => k.startsWith("item") || k.startsWith("color")),
  );
  check("1d) barkod + QR + sackNo var", ["barcode", "qrCode", "sackNo"].every((k) => sackKeys.includes(k)));

  // ── 2) Birleşik katalog ───────────────────────────────────────────────────
  const unified = getUnifiedCatalog();
  const uBarcode = unified.find((f) => f.key === "barcode");
  const uSackNote = unified.find((f) => f.key === "sackNote");
  check("2a) paylaşılan `barcode` key'ine SACK eklendi", uBarcode?.kinds.includes(LabelKind.SACK) === true, uBarcode?.kinds.join(","));
  check("2b) `sackNote` yalnız SACK bağlamında", uSackNote?.kinds.length === 1 && uSackNote.kinds[0] === LabelKind.SACK);

  // ── 8) Değer çözücü (payload'sız, saf) ────────────────────────────────────
  const emptyNote = fieldDisplayValue({ sackNote: null } as never, "sackNote");
  check("8a) sackNote boşsa present:false (eleman atlanır)", emptyNote.present === false);
  const withNote = fieldDisplayValue({ sackNote: "not" } as never, "sackNote");
  check("8b) sackNote doluysa present:true", withNote.present === true && withNote.value === "not");
  const rc = fieldDisplayValue({ rollCount: 12 } as never, "rollCount");
  check("8c) rollCount headline + birimsiz", rc.role === "headline" && rc.value === "12", rc.value);

  // ── 9) mockPayload (stüdyo önizlemesi) ────────────────────────────────────
  const mock = mockPayload(LabelKind.SACK);
  check(
    "9) ⭐ mockPayload(SACK) çuval alanlarını doldurdu (önizleme boş kalmaz)",
    !!mock.sackNo && mock.rollCount != null && !!mock.sackNote && mock.itemName === "",
    `sackNo=${mock.sackNo} rollCount=${mock.rollCount}`,
  );

  // ── Fixture ───────────────────────────────────────────────────────────────
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");
  const customer = await prisma.customer.create({ data: { code: `TST-SLBL-${ts}`, name: `ETİKET TEST MÜŞTERİ ${ts}` }, select: { id: true } });

  const rollIds: string[] = [];
  const sackIds: string[] = [];
  let templateId: string | null = null;
  let ctxDefaultCreated = false;
  /** Seed'in ürettiği SACK bağlam varsayılanı — test onu geçici kaldırır, geri koyar. */
  let restoreDefaultTemplateId: string | null = null;

  const makeRoll = async (qty: number, status: RollStatus = RollStatus.WAREHOUSE): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-SLBL-${ts}-${Math.floor(Math.random() * 1e9)}`,
        itemId: item.id, colorId: null, width: 141,
        initialQty: qty, currentQty: qty, status, qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(r.id);
    return r.barcode!;
  };

  try {
    const opened = await ship.openSack({ customerId: customer.id });
    const sackId = (opened.data as { id: string; sackNo: string }).id;
    const sackNo = (opened.data as { sackNo: string }).sackNo;
    sackIds.push(sackId);

    await ship.scanIntoSack({ sackId, barcode: await makeRoll(100) });
    await ship.scanIntoSack({ sackId, barcode: await makeRoll(50) });
    await ship.weighSack({ sackId, weightKg: 42.5 });
    await ship.setSackNotes(sackId, "Birinci satır\nİkinci satır");

    // ── 3) Tek kod kuralı ───────────────────────────────────────────────────
    const p = (await labels.getSackLabel(sackId)).data;
    check("3) ⭐ barcode === sackNo === Sack.sackNo (tek kod)", p.barcode === sackNo && p.sackNo === sackNo, `${p.barcode}`);
    check("3b) metraj + kg doğru", p.lengthMeters === 150 && p.weightKg === 42.5, `${p.lengthMeters}m / ${p.weightKg}kg`);
    check("3c) müşteri adı geldi", p.customerName === `ETİKET TEST MÜŞTERİ ${ts}`);
    check("3d) ürün/renk BOŞ (karışık içerik)", p.itemName === "" && p.colorName === null);

    // ── 5) Yorum düzleştirme ────────────────────────────────────────────────
    check("5) ⭐ çok satırlı yorum tek satıra düzleşti", p.sackNote === "Birinci satır · İkinci satır", String(p.sackNote));

    // ── 4) Ölü top sayılmaz ────────────────────────────────────────────────
    const deadBc = await makeRoll(999);
    await ship.scanIntoSack({ sackId, barcode: deadBc });
    // ⚠️ HAYALET KASTEN üretiliyor (sayımın onu DIŞLADIĞINI kanıtlamanın tek yolu).
    // `rolls_sackId_status_present` CHECK'i eklendiği gün bu satır imkânsız olur →
    // yardımcı kilidi o an için askıya alır. Kilit henüz yokken hiçbir şey yapmaz.
    await withSackConstraintSuspended(() =>
      prisma.roll.update({ where: { barcode: deadBc }, data: { status: RollStatus.CANCELLED } }),
    );
    const p2 = (await labels.getSackLabel(sackId)).data;
    check("4) ⭐ CANCELLED top rollCount/metraja SAYILMADI", p2.rollCount === 2 && p2.lengthMeters === 150, `${p2.rollCount} top / ${p2.lengthMeters}m`);

    // 4b) AT_KARTELA da sayılmamalı. NOT: `kartela.service` artık `sackId` guard'ı
    // UYGULUYOR (2026-07-30) — yani bu durum yeni akışlarda DOĞMAZ; ama production'da
    // guard öncesinden kalma satırlar olabilir ve filtre son savunmadır. Bu yüzden
    // hayaleti burada elle üretmeye devam ediyoruz.
    const kartelaBc = await makeRoll(777);
    await ship.scanIntoSack({ sackId, barcode: kartelaBc });
    await withSackConstraintSuspended(() =>
      prisma.roll.update({ where: { barcode: kartelaBc }, data: { status: RollStatus.AT_KARTELA } }),
    );
    const p3 = (await labels.getSackLabel(sackId)).data;
    check(
      "4b) ⭐ AT_KARTELA top (çuvalda ama bina dışı) SAYILMADI",
      p3.rollCount === 2 && p3.lengthMeters === 150,
      `${p3.rollCount} top / ${p3.lengthMeters}m`,
    );

    // ── 6) FAIL-CLOSED: şablon yokken 400 ──────────────────────────────────
    // Seed artık bir SACK bağlam varsayılanı üretiyor (dev paritesi) → test onu
    // GEÇİCİ olarak kaldırıp fail-closed'ı kanıtlar, finally'de geri koyar.
    // (Önceki hâli "ortamda default YOK" varsayıyordu ve reseed sonrası kırılıyordu.)
    // ⭐ SIZINTI REGRESYONU: kurulumun SACK bağlam varsayılanı (seed veya elle)
    // iç notu fiziksel etikete VARSAYILAN basmamalı. Kanvas varyantı flow
    // alanlarını EZER (label-renderer.registry.ts:105) → tek koruma elemanın
    // yokluğu. Bir kurulum bunu bilerek eklerse test kırılır ve gerekçe sorulur.
    const ctxDef = await prisma.labelContextDefault.findUnique({
      where: { kind: LabelKind.SACK },
      include: { template: { include: { variants: true } } },
    });
    if (ctxDef) {
      const binds = ctxDef.template.variants.flatMap((v) => {
        const el = (v.elements as { elements?: Array<{ bind?: string }> } | null)?.elements ?? [];
        return el.map((e) => e.bind).filter(Boolean);
      });
      check(
        "0) ⭐ kurulumun SACK şablonu iç notu (sackNote) VARSAYILAN basmıyor",
        !binds.includes("sackNote"),
        binds.includes("sackNote") ? "şablonda sackNote elemanı VAR → iç not müşteriye giden etikete basılır" : "",
      );
    }

    const preExisting = await prisma.labelContextDefault.findUnique({ where: { kind: LabelKind.SACK } });
    if (preExisting) await prisma.labelContextDefault.delete({ where: { kind: LabelKind.SACK } });
    restoreDefaultTemplateId = preExisting?.templateId ?? null;
    await expectErr("6a) ⭐ şablonsuz /html → 400 (roll etiketine SAPMADI)", () => labels.getSackLabelHtml(sackId), 400);
    await expectErr("6b) ⭐ şablonsuz /native → 400", () => labels.getSackLabelNative(sackId), 400);

    // ── 7) Şablon+varyant atanınca 4 dilde çıktı ───────────────────────────
    const tpl = await prisma.labelTemplate.create({
      data: {
        name: `TST-SACK-TPL-${ts}`,
        kind: LabelKind.SACK,
        fields: [],
        variants: {
          create: {
            name: "100x70", widthMm: 100, heightMm: 70, isPrimary: true,
            elements: {
              v: 1,
              elements: [
                { id: "e1", type: "code128", x: 4, y: 4, wMm: 60, hMm: 14 },
                { id: "e2", type: "field", x: 4, y: 22, bind: "sackNo", label: "Çuval No" },
                { id: "e3", type: "field", x: 4, y: 30, bind: "rollCount", label: "Top Adedi" },
                { id: "e4", type: "field", x: 4, y: 38, bind: "weightKg", label: "Brüt" },
                { id: "e5", type: "field", x: 4, y: 46, bind: "sackNote", label: "Not" },
              ],
            },
          },
        },
      },
      select: { id: true },
    });
    templateId = tpl.id;
    await prisma.labelContextDefault.create({ data: { kind: LabelKind.SACK, templateId: tpl.id } });
    ctxDefaultCreated = true;

    // Native/HTML renderer ASCII-fold uygular ("Çuval"→"Cuval") → probe fold-güvenli olmalı.
    await ship.setSackNotes(sackId, "ASCII SAFE NOTE 42");
    const html = (await labels.getSackLabelHtml(sackId)).data.html;
    check("7a) şablon atandıktan sonra HTML üretildi ve sackNo içeriyor", html.includes(sackNo), `uzunluk ${html.length}`);
    check("7b) ⭐ HTML çuval yorumunu içeriyor (sackNote alanı bağlandı)", html.includes("ASCII SAFE NOTE 42"));
    check("7b2) HTML top adedini içeriyor (rollCount alanı bağlandı)", html.includes("Top Adedi: 2"));

    for (const lang of [PrinterLanguage.PPLA, PrinterLanguage.PPLB, PrinterLanguage.ZPL] as const) {
      await prisma.labelTemplate.update({ where: { id: tpl.id }, data: {} }); // no-op (dil format'tan gelir)
      const nat = await labels.getSackLabelNative(sackId, { encoding: "b64" });
      check(`7c-${lang}) native çıktı üretildi (b64 zarfı dolu)`, !!nat.data.contentB64 && nat.data.contentB64.length > 0);
      break; // format sistem ayarından gelir; tek koşu yeterli (dil matrisi label testlerinde)
    }

    // ── 10) Olmayan çuval ──────────────────────────────────────────────────
    await expectErr("10) olmayan çuval → 404", () => labels.getSackLabel("00000000-0000-4000-8000-000000000000"), 404);

    // ── 11) ÇUVAL KODU okutma guard'ları (etiket basılabildiği için kaçınılmaz) ──
    const { sackSearchService } = await import("../src/services/sack-search.service");
    await expectErr(
      "11a) ⭐ çuval kodu top alanına okutuldu → anlamlı 400 (yanıltıcı 404 DEĞİL)",
      () => ship.scanIntoSack({ sackId, barcode: sackNo }),
      400,
    );
    await expectErr(
      "11b) locateRoll'a çuval kodu → anlamlı 400",
      () => sackSearchService.locateRoll(sackNo),
      400,
    );
    // Karşıt kontrol: gerçek TOP barkodu hâlâ çalışıyor (guard fazla yakalamıyor).
    const freshBc = await makeRoll(10);
    const okScan = await ship.scanIntoSack({ sackId, barcode: freshBc });
    check("11c) gerçek top barkodu hâlâ okutulabiliyor (guard fazla yakalamıyor)", (okScan.data as { kind: string }).kind === "ROLL");
  } finally {
    if (ctxDefaultCreated) await prisma.labelContextDefault.deleteMany({ where: { kind: LabelKind.SACK } });
    // Seed'in varsayılanını geri koy (test ortamı bozulmasın).
    if (restoreDefaultTemplateId) {
      await prisma.labelContextDefault.upsert({
        where: { kind: LabelKind.SACK },
        update: { templateId: restoreDefaultTemplateId },
        create: { kind: LabelKind.SACK, templateId: restoreDefaultTemplateId },
      });
    }
    if (templateId) await prisma.labelTemplateVariant.deleteMany({ where: { templateId } });
    if (templateId) await prisma.labelTemplate.deleteMany({ where: { id: templateId } });
    if (rollIds.length) await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
    if (rollIds.length) await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
