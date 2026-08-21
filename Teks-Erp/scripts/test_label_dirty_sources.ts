// =============================================================================
// Test: ETİKET BAYAT KAYNAKLARI — kartelalık işareti (K3) + çuval içeriği/notu (D2)
// Çalıştır: npx tsx scripts/test_label_dirty_sources.ts
// =============================================================================
// KORUNAN İNVARİANT: "kâğıda basılan bir alan değiştiyse, basılı kâğıt bayattır."
// İki kaynak 2026-08-21'e kadar bu kuralın DIŞINDA kalmıştı:
//
//   K3 — `kartela.setRollMarkedForKartela`: kartelalık damgası (`kartelaMark`)
//        etikete basılıyor ama işaret değişince `Roll.labelDirty` yazılmıyordu →
//        üstünde "KARTELALIK" yazan top işaretten çıkarılınca kâğıt sessizce
//        yalan söylüyordu (ve tersi).
//   D2 — `shipping.markSackContentChangedTx` (eski adı `resetSackWeightsTx`):
//        içerik değişince yalnız brüt kg sıfırlanıyordu; çuval etiketindeki
//        `rollCount` / `lengthMeters` / `weightKg` sayıları bayat kalıyordu.
//        `setSackNotes` ise notu KOŞULLU bayatlatır — `sackNote` alanı şablona
//        sürüklenmedikçe (varsayılan: kapalı) not kâğıda hiç çıkmaz, koşulsuz
//        bayrak sahte "yeniden bas" uyarısı üretirdi.
//
// TERS YÖNDEKİ İNVARİANT DE ÖLÇÜLÜR (asıl kırılgan taraf): etiket HİÇ basılmamış
// topta bayrak YAZILMAZ — rozet enflasyonu gerçek uyarıyı da körleştirir.
//
// Kapsam dışı (bilinçli): SACK bağlam varsayılanının (`LabelContextDefault`)
// bulunduğu dal yalnız DB'de böyle bir atama YOKSA ölçülür — global atamayı test
// için değiştirmek canlıya benzeyen dev DB'sinde başka oturumların baskısını bozar.
// =============================================================================

import { RollStatus, RollEntrySource, LabelKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { KartelaService } from "../src/services/kartela.service";
import { ShippingService } from "../src/services/shipping.service";
import { CANVAS_SCHEMA_VERSION } from "../src/config/label-elements";

const kartela = new KartelaService();
const ship = new ShippingService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** DB'deki gerçek bayrak — servis yanıtına değil KOLONA bakar. */
const rollDirty = async (id: string): Promise<boolean> =>
  (await prisma.roll.findUnique({ where: { id }, select: { labelDirty: true } }))!.labelDirty;
const sackDirty = async (id: string): Promise<boolean> =>
  (await prisma.sack.findUnique({ where: { id }, select: { labelDirty: true } }))!.labelDirty;

/** Bayrağı temizle — her senaryo kendi başlangıç noktasını kurar. */
const clearRoll = (id: string) => prisma.roll.update({ where: { id }, data: { labelDirty: false } });
const clearSack = (id: string) => prisma.sack.update({ where: { id }, data: { labelDirty: false } });

/** Tek `field` elemanlı kanvas yerleşimi (readCanvasLayout'ın kabul ettiği en dar biçim). */
const layoutWith = (bind: string) => ({
  v: CANVAS_SCHEMA_VERSION,
  elements: [{ id: "e1", type: "field", x: 2, y: 2, bind, hMm: 3 }],
});

async function main(): Promise<void> {
  const ts = Date.now();
  const rollIds: string[] = [];
  const sackIds: string[] = [];
  const templateIds: string[] = [];
  const customerIds: string[] = [];

  const item = await prisma.item.create({
    data: { code: `TEST-LBLD-ITM-${ts}`, name: `TEST LBLD KUMAS ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });

  const makeRoll = async (opts: { printed: boolean; qty?: number }): Promise<{ id: string; barcode: string }> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-LBLD-${ts}-${rollIds.length + 1}`,
        itemId: item.id,
        width: 150,
        initialQty: opts.qty ?? 100,
        currentQty: opts.qty ?? 100,
        status: RollStatus.WAREHOUSE,
        qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.SUPPLIER_RECEIPT,
        labelPrintedAt: opts.printed ? new Date() : null,
        labelDirty: false,
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(r.id);
    return { id: r.id, barcode: r.barcode! };
  };

  try {
    // =========================================================================
    // K3 — KARTELALIK İŞARETİ
    // =========================================================================
    const printed = await makeRoll({ printed: true });

    // 1) İŞARETLE → bayat (etiket basılmıştı, damga eklendi)
    const r1 = await kartela.setRollMarkedForKartela(printed.id, true, undefined);
    check("K3-1a) işaretleme başarılı", (r1.data as { markedForKartela: boolean }).markedForKartela === true, r1.message);
    check("K3-1b) ⭐ basılı etiketli topta işaretleme BAYATLATTI", (await rollDirty(printed.id)) === true);

    // 2) İŞARETİ KALDIR → yine bayat (HER İKİ YÖN — damganın silinmesi de kâğıdı yalanlar)
    await clearRoll(printed.id);
    check("K3-2a) kontrol: bayrak temizlendi", (await rollDirty(printed.id)) === false);
    await kartela.setRollMarkedForKartela(printed.id, false, undefined);
    check("K3-2b) ⭐ işaretin KALDIRILMASI da bayatlattı (çift yön)", (await rollDirty(printed.id)) === true);

    // 3) HİÇ BASILMAMIŞ etiket → bayrak YAZILMAZ (sahte "yeniden bas" uyarısı yok)
    const unprinted = await makeRoll({ printed: false });
    await kartela.setRollMarkedForKartela(unprinted.id, true, undefined);
    const unprintedRow = await prisma.roll.findUnique({
      where: { id: unprinted.id },
      select: { labelDirty: true, markedForKartela: true },
    });
    check("K3-3a) işaret yazıldı", unprintedRow?.markedForKartela === true);
    check("K3-3b) ⭐ etiket hiç basılmamışsa bayrak YAZILMADI", unprintedRow?.labelDirty === false);

    // 4) AYNI DEĞER tekrar → "Değişiklik yok" + bayrağa DOKUNULMAZ (atomik claim)
    await clearRoll(printed.id);
    const same = await kartela.setRollMarkedForKartela(printed.id, false, undefined); // zaten false
    check("K3-4a) aynı değer → 'Değişiklik yok'", same.message === "Değişiklik yok", same.message);
    check("K3-4b) ⭐ no-op çağrı bayrağa DOKUNMADI", (await rollDirty(printed.id)) === false);

    // 5) Audit satırında labelDirty bilgisi var
    await kartela.setRollMarkedForKartela(printed.id, true, undefined);
    const audit = await prisma.systemLog.findFirst({
      where: { tableName: "ROLL", recordId: printed.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const nd = audit?.newData as { markedForKartela?: boolean; labelDirty?: boolean } | null;
    check("K3-5) audit newData labelDirty taşıyor", nd?.markedForKartela === true && nd?.labelDirty === true, JSON.stringify(nd));

    // =========================================================================
    // D2 — ÇUVAL İÇERİĞİ (top okut / çıkar)
    // =========================================================================
    const opened = await ship.openSack({});
    const sackA = (opened.data as { id: string }).id;
    sackIds.push(sackA);

    const scanRoll = await makeRoll({ printed: true, qty: 250 });
    await clearSack(sackA);
    await ship.scanIntoSack({ sackId: sackA, barcode: scanRoll.barcode }, undefined);
    check("D2-1) ⭐ çuvala top okutmak çuval etiketini bayatlattı", (await sackDirty(sackA)) === true);

    await clearSack(sackA);
    await ship.removeRollFromSack({ rollId: scanRoll.id }, undefined);
    check("D2-2) ⭐ topu çıkarmak da bayatlattı", (await sackDirty(sackA)) === true);

    // 3) Tartısız çuvalda da bayrak yazılır (kg koşulundan BAĞIMSIZ ikinci ifade —
    //    tek updateMany'ye indirilirse bu kontrol kırmızıya döner).
    const sackNoWeight = (await ship.openSack({})).data as { id: string };
    sackIds.push(sackNoWeight.id);
    await clearSack(sackNoWeight.id);
    const w = await prisma.sack.findUnique({ where: { id: sackNoWeight.id }, select: { weightKg: true } });
    await ship.scanIntoSack({ sackId: sackNoWeight.id, barcode: scanRoll.barcode }, undefined);
    check(
      "D2-3) ⭐ HİÇ TARTILMAMIŞ çuvalda da etiket bayatladı",
      w?.weightKg === null && (await sackDirty(sackNoWeight.id)) === true,
    );
    await ship.removeRollFromSack({ rollId: scanRoll.id }, undefined);

    // =========================================================================
    // D2 — ÇUVAL NOTU (KOŞULLU: `sackNote` şablonda görünüyorsa)
    // =========================================================================
    // Müşteri rotası kullanılır (bağlam varsayılanına DOKUNULMAZ): rota zincirin
    // ilk halkasıdır → sonuç ortamdaki global atamadan bağımsız/deterministiktir.
    const mkTemplate = async (name: string, bind: string): Promise<string> => {
      const t = await prisma.labelTemplate.create({
        data: {
          name,
          kind: LabelKind.SACK,
          fields: [],
          variants: { create: { name: "100x148", widthMm: 100, heightMm: 148, isPrimary: true, elements: layoutWith(bind) } },
        },
        select: { id: true },
      });
      templateIds.push(t.id);
      return t.id;
    };
    const withNote = await mkTemplate(`TEST-LBLD-SACK-NOT-${ts}`, "sackNote");
    const withoutNote = await mkTemplate(`TEST-LBLD-SACK-DUZ-${ts}`, "sackNo");

    const mkCustomer = async (code: string, templateId: string): Promise<string> => {
      const c = await prisma.customer.create({ data: { code, name: `TEST LBLD ${code}` }, select: { id: true } });
      customerIds.push(c.id);
      await prisma.customerTemplateRoute.create({ data: { customerId: c.id, kind: LabelKind.SACK, templateId } });
      return c.id;
    };
    const cusNote = await mkCustomer(`TEST-LBLD-CUS-N-${ts}`, withNote);
    const cusPlain = await mkCustomer(`TEST-LBLD-CUS-P-${ts}`, withoutNote);

    const sackNoteOn = (await ship.openSack({ customerId: cusNote })).data as { id: string };
    sackIds.push(sackNoteOn.id);
    await clearSack(sackNoteOn.id);
    const noteRes = await ship.setSackNotes(sackNoteOn.id, "Müşteri şikayet etti", undefined);
    check("D2-4a) ⭐ şablonda sackNote VAR → not değişimi bayatlattı", (await sackDirty(sackNoteOn.id)) === true);
    check("D2-4b) yanıt labelDirty döner", (noteRes.data as { labelDirty?: boolean }).labelDirty === true);

    // AYNI notu tekrar yaz → değişim yok → bayrak yazılmaz
    await clearSack(sackNoteOn.id);
    await ship.setSackNotes(sackNoteOn.id, "Müşteri şikayet etti", undefined);
    check("D2-5) ⭐ aynı not tekrar yazıldı → bayrak YAZILMADI", (await sackDirty(sackNoteOn.id)) === false);

    const sackNoteOff = (await ship.openSack({ customerId: cusPlain })).data as { id: string };
    sackIds.push(sackNoteOff.id);
    await clearSack(sackNoteOff.id);
    await ship.setSackNotes(sackNoteOff.id, "Bu not kâğıda çıkmıyor", undefined);
    check("D2-6) ⭐ şablonda sackNote YOK → bayrak YAZILMADI (sahte uyarı yok)", (await sackDirty(sackNoteOff.id)) === false);
    check("D2-6b) not yine de kaydedildi", (await prisma.sack.findUnique({ where: { id: sackNoteOff.id }, select: { notes: true } }))?.notes === "Bu not kâğıda çıkmıyor");

    // Şablon çözülemeyen dal — YALNIZ ortamda SACK bağlam varsayılanı yoksa ölçülür.
    const ctxDefault = await prisma.labelContextDefault.findUnique({ where: { kind: LabelKind.SACK }, select: { templateId: true } });
    if (!ctxDefault) {
      const sackNoTpl = (await ship.openSack({})).data as { id: string };
      sackIds.push(sackNoTpl.id);
      await clearSack(sackNoTpl.id);
      await ship.setSackNotes(sackNoTpl.id, "Müşterisiz çuval notu", undefined);
      check("D2-7) ⭐ şablon çözülemedi → bayrak YAZILMADI", (await sackDirty(sackNoTpl.id)) === false);
    } else {
      console.log("ℹ️  D2-7 atlandı: DB'de SACK bağlam varsayılanı var (global atamaya dokunulmaz).");
    }

    // Kontrol grubu: not yazımı İÇERİK guard'ını (touchWarehouseSackTx) hâlâ atlıyor —
    // D2 değişikliği o bilinçli istisnayı bozmadı (test_sack_notes 8b/9 ile aynı kural).
    check("D2-8) kontrol: not yazımı çuvalın kg'sine dokunmadı",
      (await prisma.sack.findUnique({ where: { id: sackNoteOn.id }, select: { weightKg: true } }))?.weightKg === null);
  } finally {
    // Cleanup — test kendi yarattığını siler (RESTRICT FK'lar sırayı dikte eder).
    if (sackIds.length) await prisma.roll.updateMany({ where: { sackId: { in: sackIds } }, data: { sackId: null } });
    if (rollIds.length) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (customerIds.length) {
      await prisma.customerTemplateRoute.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
    if (templateIds.length) await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
    await prisma.item.deleteMany({ where: { id: item.id } });
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
