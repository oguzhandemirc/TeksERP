// =============================================================================
// Test: Çuval bölme (splitSack) + müşteri değişiminde etiket bayatlaması
// Çalıştır: npx tsx scripts/test_sack_split_and_relabel.ts
//
// A) splitSack — seçili topları YENİ çuvala ayır (atomik)
//   A1. Yeni çuval doğar, seçilenler taşınır, kaynakta kalanlar kalır
//   A2. Yeni çuval kaynağın müşteri/şubesini devralır
//   A3. İKİ çuvalın brüt tartısı SIFIRLANIR (bayat kg irsaliyeye gitmesin)
//   A4. Tüm toplar seçilirse → 400 (kaynak boş kalmaz; "bölme" değil)
//   A5. Boş seçim → 400
//   A6. Sevkiyattaki çuval → 409
//   A7. Başka çuvalın topu seçilirse taşınmaz (atomik claim `sackId` filtresi)
//
// B) Müşteri değişimi → etiket bayat mı?
//   B1. ⭐ İki müşteri de rotasız (müşteriye özel şablon YOK) → labelDirty DOKUNULMAZ
//       (gereksiz "yeniden bas" uyarısı operatörü körleştirir)
//   B2. ⭐ Yeni müşterinin ROLL_FINISHED rotası VAR → renkli toplar işaretlenir
//   B3. Kind ayrımı: rotası olmayan kind'ın topu işaretlenMEZ
//   B4. Aynı müşteriye yeniden atama → no-op (0)
// =============================================================================

// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `markSackContentChangedTx` gövdesi koşulsuz `return`e çevrildi (içerik
//    değişince kg sıfırlama + `labelDirty` damgası öldü) -> 1 kontrol KIRMIZI.
//    Geri alındığında yeşil.
import { LabelKind, RollStatus, RollEntrySource, ShipmentStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { AppError } from "../src/utils/app-error";

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
  check(label, code === status, `beklenen ${status}, gelen ${code ?? "(hata YOK)"}${msg ? ` · "${msg.slice(0, 60)}"` : ""}`);
}

const sackOf = async (id: string) =>
  (await prisma.sack.findUnique({
    where: { id },
    select: { sackNo: true, customerId: true, branchId: true, weightKg: true, weighedAt: true, _count: { select: { rolls: true } } },
  }))!;
const dirtyOf = async (id: string) =>
  (await prisma.roll.findUnique({ where: { id }, select: { labelDirty: true } }))!.labelDirty;

async function main(): Promise<void> {
  const ts = Date.now();
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!item) throw new Error("Seed Item bulunamadı — önce `npm run seed`");
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } });
  if (!color) throw new Error("Seed Color bulunamadı");

  const custA = await prisma.customer.create({ data: { code: `TST-SPL-A-${ts}`, name: `SPLIT A ${ts}` }, select: { id: true } });
  const custB = await prisma.customer.create({ data: { code: `TST-SPL-B-${ts}`, name: `SPLIT B ${ts}` }, select: { id: true } });
  const brA = await prisma.customerBranch.create({ data: { customerId: custA.id, code: "SA1", name: "A Şube" }, select: { id: true } });

  const rollIds: string[] = [];
  const sackIds: string[] = [];
  let shipmentId: string | null = null;
  let templateId: string | null = null;
  let routeId: string | null = null;
  let sackTemplateId: string | null = null;
  let sackRouteId: string | null = null;

  const makeRoll = async (qty: number, colored: boolean): Promise<{ id: string; barcode: string }> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-SPL-${ts}-${Math.floor(Math.random() * 1e9)}`,
        itemId: item.id, colorId: colored ? color.id : null, width: 141,
        initialQty: qty, currentQty: qty, status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      },
      select: { id: true, barcode: true },
    });
    rollIds.push(r.id);
    return { id: r.id, barcode: r.barcode! };
  };

  try {
    // ── A) splitSack ────────────────────────────────────────────────────────
    const openedA = await ship.openSack({ customerId: custA.id, branchId: brA.id });
    const srcId = (openedA.data as { id: string }).id;
    sackIds.push(srcId);
    const r1 = await makeRoll(100, true);
    const r2 = await makeRoll(50, true);
    const r3 = await makeRoll(30, false);
    for (const r of [r1, r2, r3]) await ship.scanIntoSack({ sackId: srcId, barcode: r.barcode });
    await ship.weighSack({ sackId: srcId, weightKg: 55.5 });

    await expectErr("A5) boş seçim → 400", () => ship.splitSack({ sackId: srcId, rollIds: [] }), 400);
    await expectErr(
      "A4) tüm toplar seçili → 400 (kaynak boş kalmaz)",
      () => ship.splitSack({ sackId: srcId, rollIds: [r1.id, r2.id, r3.id] }),
      400,
    );

    const res = await ship.splitSack({ sackId: srcId, rollIds: [r1.id, r2.id] });
    const out = res.data as { sackId: string; sackNo: string; moved: number };
    sackIds.push(out.sackId);
    check("A1) yeni çuval doğdu + 2 top taşındı", out.moved === 2 && !!out.sackNo, `${out.sackNo}, moved=${out.moved}`);

    const src = await sackOf(srcId);
    const dst = await sackOf(out.sackId);
    check("A1b) kaynakta 1 top kaldı, yenisinde 2", src._count.rolls === 1 && dst._count.rolls === 2, `${src._count.rolls}/${dst._count.rolls}`);
    check("A2) yeni çuval müşteri+şubeyi devraldı", dst.customerId === custA.id && dst.branchId === brA.id);
    check("A3) ⭐ kaynağın tartısı SIFIRLANDI", src.weightKg === null && src.weighedAt === null);
    check("A3b) yeni çuval tartısız doğdu", dst.weightKg === null);
    check("A2b) yeni çuval kodu CV formatında", /^CV\d{10}$/.test(dst.sackNo), dst.sackNo);

    // A7) başka çuvalın topu seçilirse taşınmaz (sackId filtresi) — r1 artık yeni çuvalda.
    const strayRes = await ship.splitSack({ sackId: out.sackId, rollIds: [r1.id, r3.id] });
    const stray = strayRes.data as { sackId: string; moved: number };
    sackIds.push(stray.sackId);
    check("A7) yabancı top (r3, kaynakta değil) taşınmadı — yalnız 1 top", stray.moved === 1, `moved=${stray.moved}`);
    check("A7b) r3 hâlâ ilk çuvalda", (await prisma.roll.findUnique({ where: { id: r3.id }, select: { sackId: true } }))!.sackId === srcId);

    // A6) sevkiyattaki çuval → 409
    const sh = await prisma.shipment.create({
      data: { shipmentNo: `TST-SPL-S-${ts}`, customerId: custA.id, status: ShipmentStatus.PLANNED },
      select: { id: true },
    });
    shipmentId = sh.id;
    await prisma.sack.update({ where: { id: srcId }, data: { shipmentId: sh.id, seq: 1 } });
    await expectErr("A6) sevkiyattaki çuval → 409", () => ship.splitSack({ sackId: srcId, rollIds: [r3.id] }), 409);
    await prisma.sack.update({ where: { id: srcId }, data: { shipmentId: null, seq: null } });

    // ── B) Müşteri değişimi → etiket bayat mı? ──────────────────────────────
    const openedB = await ship.openSack({ customerId: custA.id });
    const relabelSackId = (openedB.data as { id: string }).id;
    sackIds.push(relabelSackId);
    const c1 = await makeRoll(40, true);  // renkli → ROLL_FINISHED
    const c2 = await makeRoll(20, false); // renksiz → ROLL_RAW
    for (const r of [c1, c2]) await ship.scanIntoSack({ sackId: relabelSackId, barcode: r.barcode });
    await prisma.roll.updateMany({ where: { id: { in: [c1.id, c2.id] } }, data: { labelDirty: false } });
    // 2026-08-21 (D2): çuvala top okutmak artık ÇUVALIN etiketini de bayatlatır
    // (`markSackContentChangedTx`) — B bölümü yalnız müşteri-rotası etkisini ölçer,
    // bu yüzden kurulumda çuval bayrağı da sıfırlanır.
    await prisma.sack.update({ where: { id: relabelSackId }, data: { labelDirty: false } });

    // B1) İki müşteri de rotasız → hiçbir şey işaretlenmez.
    const noRoute = await ship.reassignSackCustomer(relabelSackId, { customerId: custB.id });
    check(
      "B1) ⭐ müşteriye özel şablon YOKken labelDirty DOKUNULMADI",
      (noRoute.data as { labelsStale: number }).labelsStale === 0 &&
        !(await dirtyOf(c1.id)) &&
        !(await dirtyOf(c2.id)),
      `labelsStale=${(noRoute.data as { labelsStale: number }).labelsStale}`,
    );

    // B4) Aynı müşteriye yeniden atama → no-op.
    const same = await ship.reassignSackCustomer(relabelSackId, { customerId: custB.id });
    check("B4) aynı müşteriye yeniden atama → 0", (same.data as { labelsStale: number }).labelsStale === 0);

    // B2/B3) B müşterisine ROLL_FINISHED rotası tanımla → yalnız RENKLİ top işaretlenir.
    const tpl = await prisma.labelTemplate.create({
      data: { name: `TST-SPL-TPL-${ts}`, kind: LabelKind.ROLL_FINISHED, fields: [] },
      select: { id: true },
    });
    templateId = tpl.id;
    const route = await prisma.customerTemplateRoute.create({
      data: { customerId: custA.id, kind: LabelKind.ROLL_FINISHED, templateId: tpl.id },
      select: { id: true },
    });
    routeId = route.id;

    // B (rotasız) → A (ROLL_FINISHED rotalı): şablon DEĞİŞİR → renkli top bayat.
    const withRoute = await ship.reassignSackCustomer(relabelSackId, { customerId: custA.id });
    const staleN = (withRoute.data as { labelsStale: number }).labelsStale;
    check("B2) ⭐ müşteriye özel şablon VARken renkli top işaretlendi", staleN === 1 && (await dirtyOf(c1.id)), `labelsStale=${staleN}`);
    check("B3) rotası olmayan kind (renksiz/ROLL_RAW) işaretlenMEDİ", !(await dirtyOf(c2.id)));
    check("B2b) mesaj operatörü yönlendiriyor", /yeniden basılmalı/.test(withRoute.message ?? ""), withRoute.message ?? "");

    // ── B5-B8) ÇUVALIN KENDİ etiketi (Sack.labelDirty) ───────────────────────
    // Çuval etiketi de müşteriye özel şablona çözülebiliyor (SACK rotası
    // 2026-07-30'da canlandırıldı) → müşteri değişimi ÇUVAL etiketini de bayatlatır.
    // Toplarınkinden AYRI nesne: ayrı bayrak, ayrı baskı yolu.
    const sackDirty = async () =>
      (await prisma.sack.findUnique({ where: { id: relabelSackId }, select: { labelDirty: true } }))!.labelDirty;
    check("B5) ROLL rotası çuvalın kendi etiketini ETKİLEMEDİ", !(await sackDirty()));

    // A müşterisine SACK rotası tanımla → B'ye (rotasız) geçişte çuval etiketi bayat.
    const sackTpl = await prisma.labelTemplate.create({
      data: { name: `TST-SPL-SACKTPL-${ts}`, kind: LabelKind.SACK, fields: [] },
      select: { id: true },
    });
    sackTemplateId = sackTpl.id;
    const sackRoute = await prisma.customerTemplateRoute.create({
      data: { customerId: custA.id, kind: LabelKind.SACK, templateId: sackTpl.id },
      select: { id: true },
    });
    sackRouteId = sackRoute.id;
    // Şu an çuval A'da (yukarıdaki atama) → B'ye geçir: SACK şablonu A'da var, B'de yok.
    await ship.reassignSackCustomer(relabelSackId, { customerId: custB.id });
    check("B6) ⭐ SACK rotası değişince ÇUVALIN etiketi bayat işaretlendi", await sackDirty());

    // Baskı bayrağı temizler (recordSackPrintEvent) — Roll emsali.
    const { LabelService: LS } = await import("../src/services/label.service");
    await new LS().recordSackPrintEvent(relabelSackId);
    check("B7) ⭐ çuval etiketi basılınca bayrak TEMİZLENDİ", !(await sackDirty()));

    // Aynı müşteriye yeniden atama → şablon değişmiyor → DOKUNULMAZ.
    await ship.reassignSackCustomer(relabelSackId, { customerId: custB.id });
    check("B8) şablon değişmeyen atama çuval etiketini bayatlatMADI", !(await sackDirty()));

    // ── C) ⭐ TOPLU BASKI müşteri bağlamı — tuzağın kapandığı assert ──────────
    // Şablon çözümü ön-yükleme haritasından geliyor (customerTemplateByKey). Hedef
    // müşteri o haritaya tohumlanmazsa baskı SESSİZCE varsayılan şablona düşer.
    // A'nın şablonuna ayırt edici bir metin koyup çıktıda arıyoruz.
    const MARKER = "MUSTERI-A-SABLON";
    await prisma.labelTemplateVariant.create({
      data: {
        templateId: tpl.id,
        name: "100x70", widthMm: 100, heightMm: 70, isPrimary: true,
        elements: {
          v: 1,
          elements: [
            { id: "e1", type: "code128", x: 4, y: 4, wMm: 60, hMm: 14 },
            { id: "e2", type: "text", x: 4, y: 24, text: MARKER },
            { id: "e3", type: "field", x: 4, y: 32, bind: "barcode", label: "Barkod" },
          ],
        },
      },
    });

    const { LabelService } = await import("../src/services/label.service");
    const labels = new LabelService();

    // customerId VERİLMEZ → top kendi snapshot'ıyla (müşterisiz) → varsayılan şablon.
    const plain = (await labels.getBulkRollLabelsHtml([c1.id], {})).data.html;
    check("C1) customerId'siz toplu baskı A'nın şablonunu KULLANMAZ (mevcut davranış)", !plain.includes(MARKER));

    // customerId = A → A'nın ROLL_FINISHED rotası devreye girmeli.
    const forA = (await labels.getBulkRollLabelsHtml([c1.id], { customerId: custA.id })).data.html;
    check(
      "C2) ⭐ customerId ile toplu baskı MÜŞTERİYE ÖZEL şablonu kullandı (sessiz varsayılana düşmedi)",
      forA.includes(MARKER),
      forA.includes(MARKER) ? "" : "çıktıda marker YOK → preload'a tohumlama kırık",
    );

    // C3) Rotası olmayan kind (renksiz top / ROLL_RAW) etkilenmemeli.
    const rawForA = (await labels.getBulkRollLabelsHtml([c2.id], { customerId: custA.id })).data.html;
    check("C3) rotası olmayan kind (ROLL_RAW) müşteri şablonuna KAYMADI", !rawForA.includes(MARKER));
  } finally {
    if (routeId) await prisma.customerTemplateRoute.deleteMany({ where: { id: routeId } });
    if (sackRouteId) await prisma.customerTemplateRoute.deleteMany({ where: { id: sackRouteId } });
    if (templateId) await prisma.labelTemplate.deleteMany({ where: { id: templateId } });
    if (sackTemplateId) await prisma.labelTemplate.deleteMany({ where: { id: sackTemplateId } });
    if (sackIds.length) await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
    if (rollIds.length) await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
    if (rollIds.length) await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (shipmentId) await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    await prisma.customerBranch.deleteMany({ where: { id: brA.id } });
    await prisma.customer.deleteMany({ where: { id: { in: [custA.id, custB.id] } } });
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
