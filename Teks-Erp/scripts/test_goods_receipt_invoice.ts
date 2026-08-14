// =============================================================================
// BEKÇİ — MAL KABUL → ALIŞ FATURASI KÖPRÜSÜ
// =============================================================================
// Çalıştırma: npx tsx scripts/test_goods_receipt_invoice.ts
//
// NEDEN: Alım-satım firmasının her mal girişi bir alış faturasıyla eşleşir.
// Köprü olmazsa muhasebeci 20 kalemlik fişi satır satır ELLE yeniden yazar —
// hem zaman kaybı hem de her yeniden yazımda bir rakam kayma riski.
//
// ÖLÇÜLENLER:
//   §1 Fiyat topa YAZILIYOR (Roll.purchasePrice) ve fiş para birimi saklanıyor
//   §2 ⭐ SATIRLAR GRUPLANIYOR: 20 top → 20 satır DEĞİL; gruplama anahtarı
//      ürün+renk+FİYAT (farklı fiyatlı aynı kumaş AYRI satır — ortalama fiyat
//      uydurmak yok)
//   §3 ⭐ İPTAL EDİLMİŞ top faturaya GİRMEZ ("bu mal hiç gelmedi")
//   §4 Miktar initialQty (fatura mal kabul ANINI belgeler; sonraki kesim
//      tedarikçiye borcu değiştirmez)
//   §5 Bir fiş → tek aktif fatura (409 + anlamlı mesaj); iptalden sonra serbest
//   §6 Tedarikçisiz / iptal edilmiş fiş reddedilir
//   §7 Fatura para birimi ve tedarikçisi fişten gelir
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { invoiceService } from "../src/services/invoice.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { D } from "../src/services/helpers/finance.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-GRI-${Date.now()}`;
const startedAt = Date.now();
let createdRateId: string | null = null;
const receiptIds: string[] = [];
const invoiceIds: string[] = [];
const cariIds: string[] = [];
let supplierId: string | null = null;
/** §9 fixture'ı — testin KENDİ yarattığı YARN kalemi (temizlikte silinir). */
let yarnItemId: string | null = null;

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

async function main(): Promise<void> {
  console.log("=== Mal kabul → alış faturası bekçisi ===\n");

  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok.");
  const item = await prisma.item.findFirstOrThrow({ where: { isActive: true }, select: { id: true, name: true } });
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true, name: true } });

  const supplier = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Tedarikçi`, type: "SUPPLIER" },
    select: { id: true },
  });
  supplierId = supplier.id;

  // ── §1 FİYAT + PARA BİRİMİ ──────────────────────────────────────────────
  // Aynı kumaştan İKİ FARKLI FİYATLI parti + (varsa) renkli bir satır.
  const created = await goodsReceiptService.create(
    {
      warehouseId: wh.id,
      supplierId: supplier.id,
      deliveryNoteNo: `${TAG}-IRS`,
      currency: "USD",
      lines: [
        { itemId: item.id, initialQty: 500, unitPrice: 3.5, clientToken: crypto.randomUUID() },
        { itemId: item.id, initialQty: 500, unitPrice: 3.5, clientToken: crypto.randomUUID() },
        // Farklı fiyatlı parti — faturada AYRI satır olmalı (gruplama anahtarı
        // fiyatı içeriyor mu ölçen tek satır).
        { itemId: item.id, initialQty: 300, unitPrice: 4.25, clientToken: crypto.randomUUID() },
        // Bu iptal edilecek — faturaya girmemeli.
        { itemId: item.id, initialQty: 100, unitPrice: 9.99, clientToken: crypto.randomUUID() },
        ...(color
          ? [{ itemId: item.id, colorId: color.id, initialQty: 200, unitPrice: 3.5, clientToken: crypto.randomUUID() }]
          : []),
      ],
    },
    undefined,
  );
  const receipt = created.data as { id: string; receiptNo: string };
  receiptIds.push(receipt.id);

  // ⚠️ KUR FİXTURE'I TESTİN KENDİSİNE AİT. Bekçi ilk yazımda ortamda BUGÜNE
  // ait bir USD kuru bulunmasına güveniyordu (CLAUDE.md'nin açıkça yasakladığı
  // "ortamdaki veriye bağımlı olma" hatası): yazıldığı gün geçti, ertesi gün
  // `resolveExchangeRate` null döndü ve fatura onayı 400 verdi. Ürün davranışı
  // DOĞRU — kur uydurmuyor; kırılan şey fixture'dı.
  // Bugünün TARİHİ (saat değil) anahtar: kolon `@db.Date`.
  const rateDay = new Date();
  rateDay.setUTCHours(0, 0, 0, 0);
  const rateFixture = await prisma.exchangeRate.upsert({
    where: { rateDate_currency: { rateDate: rateDay, currency: "USD" } },
    // ⚠️ Var olan kuru EZMEZ: aynı gün gerçek kur girilmişse (ya da TCMB
    // çekmişse) onu değiştirmek başka testlerin/ekranların rakamını sessizce
    // kaydırırdı. Yoksa yaratır, varsa aynen kullanır.
    update: {},
    create: { rateDate: rateDay, currency: "USD", rate: "40.000000", source: "MANUAL" },
    select: { id: true, createdAt: true },
  });
  // Temizlikte YALNIZ kendi yarattığımızı sileriz (üsttekiyle aynı gerekçe).
  createdRateId = rateFixture.createdAt.getTime() >= startedAt ? rateFixture.id : null;

  const row = await prisma.goodsReceipt.findUniqueOrThrow({
    where: { id: receipt.id },
    select: { currency: true, rolls: { select: { purchasePrice: true, initialQty: true } } },
  });
  check("§1a Fiş para birimi saklandı", row.currency === "USD", `currency=${row.currency}`);
  check(
    "§1b Fiyat TOPA yazıldı",
    row.rolls.every((r) => r.purchasePrice !== null),
    `fiyatlı=${row.rolls.filter((r) => r.purchasePrice !== null).length}/${row.rolls.length}`,
  );

  // ── §3 İPTAL EDİLMİŞ TOP (faturadan önce bir topu iptal et) ─────────────
  const victim = await prisma.roll.findFirstOrThrow({
    where: { goodsReceiptId: receipt.id, purchasePrice: 9.99 },
    select: { id: true },
  });
  await prisma.roll.update({ where: { id: victim.id }, data: { status: RollStatus.CANCELLED } });

  // ── §2 GRUPLAMA ─────────────────────────────────────────────────────────
  const draft = await invoiceService.createDraftFromGoodsReceipt(receipt.id);
  invoiceIds.push(draft.data.id);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: draft.data.id },
    select: {
      currency: true,
      cariId: true,
      externalNo: true,
      lines: { select: { description: true, qty: true, unitPrice: true }, orderBy: { lineNo: "asc" } },
    },
  });
  cariIds.push(inv.cariId);

  // 3.5 renksiz + 4.25 renksiz + (varsa) 3.5 renkli; 9.99 iptal edildi.
  const expectedLines = color ? 3 : 2;
  check(
    "§2a ⭐ Satırlar GRUPLANDI (top sayısı kadar satır YOK)",
    inv.lines.length === expectedLines,
    `satır=${inv.lines.length} (beklenen ${expectedLines}), top=${row.rolls.length}`,
  );
  const plain = inv.lines.find((l) => !l.description.includes("·") && D(l.unitPrice).equals(3.5));
  check("§2b Aynı fiyatlı iki parti TEK satırda toplandı", plain ? D(plain.qty).equals(1000) : false, `qty=${plain?.qty}`);
  check("§2c Fiyat korundu", plain ? D(plain.unitPrice).equals(3.5) : false, `fiyat=${plain?.unitPrice}`);

  // ── §3 doğrulama ────────────────────────────────────────────────────────
  // ⭐ Gruplama anahtarı FİYATI içeriyor mu — farklı fiyatlı parti AYRI satır.
  // (Fixture bu satırı ölçebilsin diye 4.25'lik top İPTAL EDİLMİYOR; iptal
  // kontrolü ayrı bir fiyatla (9.99) yapılıyor. İlk yazımda ikisi aynı topa
  // yüklenmişti ve negatif sonda yeşil kalıyordu — kör kontrol.)
  const other = inv.lines.find((l) => D(l.unitPrice).equals(4.25));
  check("§2d ⭐ FARKLI FİYATLI parti AYRI satır (ortalama uydurulmuyor)", Boolean(other), `qty=${other?.qty}`);
  check(
    "§3 ⭐ İptal edilmiş top faturaya GİRMEDİ",
    !inv.lines.some((l) => D(l.unitPrice).equals(9.99)),
    "9.99 fiyatlı satır yok",
  );

  // ── §4 initialQty ───────────────────────────────────────────────────────
  // Faturadan SONRA bir topun currentQty'sini düşür — fatura değişmemeli.
  const shrink = await prisma.roll.findFirstOrThrow({
    where: { goodsReceiptId: receipt.id, status: { not: RollStatus.CANCELLED } },
    select: { id: true },
  });
  await prisma.roll.update({ where: { id: shrink.id }, data: { currentQty: 1 } });
  const draft2Err = await expectError(() => invoiceService.createDraftFromGoodsReceipt(receipt.id));
  check("§5a İKİNCİ fatura REDDEDİLDİ", /zaten bir fatura var/i.test(draft2Err), draft2Err.slice(0, 70));
  check("§5b Mesaj mevcut belgeyi ADIYLA söylüyor", draft2Err.includes(draft.data.docNo));

  // ── §5 iptalden sonra serbest ───────────────────────────────────────────
  await invoiceService.cancel(draft.data.id, "bekçi");
  const redraft = await invoiceService.createDraftFromGoodsReceipt(receipt.id);
  invoiceIds.push(redraft.data.id);
  const inv2 = await prisma.invoice.findUniqueOrThrow({
    where: { id: redraft.data.id },
    select: { lines: { select: { qty: true, unitPrice: true } } },
  });
  check("§5c İptalden SONRA yeniden faturalanabiliyor", Boolean(redraft.data.id));
  const plain2 = inv2.lines.find((l) => D(l.unitPrice).equals(3.5) && D(l.qty).gt(500));
  check(
    "§4 ⭐ Miktar initialQty (kesim tedarikçiye borcu değiştirmedi)",
    plain2 ? D(plain2.qty).equals(1000) : false,
    `qty=${plain2?.qty} (currentQty düşürüldü ama fatura 1000 kaldı)`,
  );

  // ── §7 KAYNAK ALANLARI ──────────────────────────────────────────────────
  check("§7a Fatura para birimi FİŞTEN geldi", inv.currency === "USD");
  check("§7b Tedarikçi irsaliye no'su externalNo'ya taşındı", inv.externalNo === `${TAG}-IRS`, `${inv.externalNo}`);

  // ── §6 REDLER ───────────────────────────────────────────────────────────
  const noSupplier = await goodsReceiptService.create(
    {
      warehouseId: wh.id,
      lines: [{ itemId: item.id, initialQty: 10, clientToken: crypto.randomUUID() }],
    },
    undefined,
  );
  const nsId = (noSupplier.data as { id: string }).id;
  receiptIds.push(nsId);
  const nsErr = await expectError(() => invoiceService.createDraftFromGoodsReceipt(nsId));
  check("§6a Tedarikçisiz fiş REDDEDİLDİ", /tedarikçi seçilmemiş/i.test(nsErr), nsErr.slice(0, 60));

  await goodsReceiptService.cancel(nsId, "bekçi", undefined);
  const cancelledErr = await expectError(() => invoiceService.createDraftFromGoodsReceipt(nsId));
  check("§6b İptal edilmiş fiş REDDEDİLDİ", /iptal edilmiş/i.test(cancelledErr), cancelledErr.slice(0, 60));

  // ── §8 ⭐ FATURALANMIŞ FİŞ İPTAL EDİLEMEZ (2026-08-14 denetim, KRİTİK) ────
  // §6b guard'ın BİR yönünü ölçüyordu ("iptal edilmiş fişten fatura kesilemez").
  // TERS YÖN korunmuyordu: faturası kesilmiş fiş serbestçe iptal edilebiliyor,
  // fatura ayakta kalıyordu. Ölçülen sonuç: `confirm` kaynak fişi hiç okumadığı
  // için onay geçiyor ve tedarikçi carisine HİÇ GELMEMİŞ mal için borç yazılıyor
  // — belge donuyor, hata da log da çıkmıyor.
  {
    const r = await goodsReceiptService.create(
      {
        warehouseId: wh.id,
        supplierId: supplier.id,
        currency: "USD",
        lines: [{ itemId: item.id, initialQty: 40, unitPrice: 2, clientToken: crypto.randomUUID() }],
      },
      undefined,
    );
    const rid = (r.data as { id: string }).id;
    receiptIds.push(rid);
    const dr = await invoiceService.createDraftFromGoodsReceipt(rid);
    invoiceIds.push(dr.data.id);

    const blocked = await expectError(() => goodsReceiptService.cancel(rid, "bekçi", undefined));
    check("§8a ⭐ TASLAK faturası olan fiş iptal EDİLEMEDİ", /iptal edilemez/i.test(blocked), blocked.slice(0, 80));
    check("§8b Mesaj faturayı ADIYLA söylüyor", blocked.includes(dr.data.docNo), dr.data.docNo);
    // ⚠️ "önce faturayı iptal edin" yol göstermesi load-bearing: çıkmaz bir
    // 409, kullanıcıyı destek hattına gönderir.
    check("§8c Mesaj ÇIKIŞ YOLUNU söylüyor", /faturayı iptal/i.test(blocked));

    await invoiceService.cancel(dr.data.id, "bekçi", undefined);
    const after = await goodsReceiptService.cancel(rid, "bekçi", undefined);
    check("§8d Fatura iptal edilince fiş İPTAL EDİLEBİLİYOR (çıkmaz yok)", after.success === true);

    // İkinci hat: guard'dan ÖNCE doğmuş faturalar için `confirm` de kaynağı okur.
    // Fişi ELLE iptal ederek (servis guard'ını atlayarak) tam o durumu kurar.
    const r2 = await goodsReceiptService.create(
      {
        warehouseId: wh.id,
        supplierId: supplier.id,
        currency: "USD",
        lines: [{ itemId: item.id, initialQty: 25, unitPrice: 2, clientToken: crypto.randomUUID() }],
      },
      undefined,
    );
    const rid2 = (r2.data as { id: string }).id;
    receiptIds.push(rid2);
    const dr2 = await invoiceService.createDraftFromGoodsReceipt(rid2);
    invoiceIds.push(dr2.data.id);
    await prisma.goodsReceipt.update({ where: { id: rid2 }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const confErr = await expectError(() => invoiceService.confirm(dr2.data.id, undefined));
    check(
      "§8e ⭐ Kaynağı İPTAL EDİLMİŞ fatura ONAYLANAMADI (ikinci hat)",
      /İPTAL EDİLMİŞ/i.test(confErr),
      confErr.slice(0, 80),
    );
  }

  // ── §9 ⭐ İPLİK SATIRI FATURAYA GİRER (2026-08-14 denetim, KRİTİK) ────────
  // Eskiden taslak YALNIZ `rolls` okuyordu: karma fişte iplik ne satır ne uyarı
  // olarak görünüyor, tedarikçinin gerçek faturası ipliği içerdiği için ERP'deki
  // fatura O KADAR EKSİK onaylanıyordu (cari borç eksik, iplik depoda ama
  // karşılığında yükümlülük yok). İplik-ONLY fişte ise bağlı fatura kesmenin
  // HİÇBİR yolu yoktu.
  {
    // ⚠️ FIXTURE'I TEST KENDİSİ YARATIR. İlk yazımda ortamdaki bir YARN
    // kalemine güveniliyordu ve dev DB'sinde hiç yoktu → §9'un TAMAMI atlandı,
    // yani iki KRİTİK düzeltmenin yarısı ölçüsüz kaldı. CLAUDE.md'nin açık
    // kuralı: "Ortamdaki veriye BAĞIMLI OLMA — fixture'ı test kendisi yaratır"
    // (dolu dev DB'sinde geçer, TEMİZ CI DB'sinde düşerdi; burada tersi oldu).
    const yarnItem = await prisma.item.create({
      data: { code: `${TAG}-YARN`, name: `${TAG} İplik`, itemType: "YARN", unit: "KG" },
      select: { id: true, name: true },
    });
    yarnItemId = yarnItem.id;
    {
      // (a) KARMA fiş: kumaş + iplik
      const mixed = await goodsReceiptService.create(
        {
          warehouseId: wh.id,
          supplierId: supplier.id,
          currency: "USD",
          lines: [
            { itemId: item.id, initialQty: 120, unitPrice: 3, clientToken: crypto.randomUUID() },
            { itemId: yarnItem.id, initialQty: 500, clientToken: crypto.randomUUID() },
          ],
        },
        undefined,
      );
      const mid = (mixed.data as { id: string }).id;
      receiptIds.push(mid);
      const mdraft = await invoiceService.createDraftFromGoodsReceipt(mid);
      invoiceIds.push(mdraft.data.id);
      const mlines = await prisma.invoiceLine.findMany({
        where: { invoiceId: mdraft.data.id },
        select: { itemId: true, qty: true, unit: true },
      });
      const yline = mlines.find((l) => l.itemId === yarnItem.id);
      check("§9a ⭐ KARMA fişte iplik satırı faturaya GİRDİ", Boolean(yline), `satır=${mlines.length}`);
      check("§9b İplik miktarı kg olarak taşındı", yline ? D(yline.qty).equals(500) : false, `qty=${yline?.qty}`);
      // ⚠️ Birim SABİT "kg": `Item.unit` farklı olabilir ve ona güvenmek
      // deftere kg yazıp faturaya metre basmak demekti.
      check("§9c İplik satırının birimi kg", yline?.unit === "kg", `unit=${yline?.unit}`);
      check("§9d Kumaş satırı da duruyor (iplik onu EZMEDİ)", mlines.some((l) => l.itemId === item.id));

      // (b) İPLİK-ONLY fiş: eskiden "faturalanacak top yok" ile 400 alıyordu
      const yonly = await goodsReceiptService.create(
        {
          warehouseId: wh.id,
          supplierId: supplier.id,
          currency: "USD",
          lines: [{ itemId: yarnItem.id, initialQty: 300, clientToken: crypto.randomUUID() }],
        },
        undefined,
      );
      const yid = (yonly.data as { id: string }).id;
      receiptIds.push(yid);
      const ydraft = await invoiceService.createDraftFromGoodsReceipt(yid);
      invoiceIds.push(ydraft.data.id);
      const ylines = await prisma.invoiceLine.findMany({
        where: { invoiceId: ydraft.data.id },
        select: { itemId: true, qty: true },
      });
      check("§9e ⭐ İPLİK-ONLY fiş faturalanabildi (eskiden çıkmazdı)", ylines.length === 1, `satır=${ylines.length}`);
      check("§9f Miktar doğru", ylines[0] ? D(ylines[0].qty).equals(300) : false, `qty=${ylines[0]?.qty}`);
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Kur fixture'ı: yalnız BU koşumda doğduysa silinir (ortamdaki gerçek kura
    // dokunulmaz — başka test/ekran onu okuyor olabilir).
    if (createdRateId) await prisma.exchangeRate.deleteMany({ where: { id: createdRateId } });
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    if (cariIds.length > 0) {
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (receiptIds.length > 0) {
      const rolls = await prisma.roll.findMany({
        where: { goodsReceiptId: { in: receiptIds } },
        select: { id: true },
      });
      const rollIds = rolls.map((r) => r.id);
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
      // ⚠️ İplik hareketleri fişe FK ile bağlı (RESTRICT değil ama sıra önemli:
      // stok satırı hareketleri toplayan mutabakat bekçisinin (§27/§28) artık
      // veri görmemesi için ikisi de silinir).
      await prisma.yarnMovement.deleteMany({ where: { goodsReceiptId: { in: receiptIds } } });
      await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    }
    if (yarnItemId) {
      await prisma.yarnStock.deleteMany({ where: { itemId: yarnItemId } });
      await prisma.yarnMovement.deleteMany({ where: { itemId: yarnItemId } });
      await prisma.itemPrice.deleteMany({ where: { itemId: yarnItemId } });
      await prisma.item.deleteMany({ where: { id: yarnItemId } });
    }
    if (supplierId) await prisma.customer.deleteMany({ where: { id: supplierId } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
