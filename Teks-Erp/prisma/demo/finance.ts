// =============================================================================
// DEMO SEED — ÖN MUHASEBE DERİNLİĞİ (fatura · tahsilat · kasa)
// =============================================================================
// Kullanıcı kararı: "müşteri yarın cari/fatura/çek/kasa görecek… uçtan uca
// gerçekçi olmalı ve hata vermemeli". Ticaret seed'i 4 fatura + 1 tahsilat
// üretiyor; bu, muhasebe modülünü inceleyecek biri için "kurulmuş ama
// kullanılmamış" görünür ve Yaşlandırma / KDV / Kur Farkı raporları neredeyse
// boş açılır.
//
// ⚠️ HEPSİ GERÇEK SERVİS YOLUNDAN: `CariTransaction` / `CariBalance` /
// `PaymentAllocation` zinciri elle yazılırsa mutabakat bekçileri (§21-§25)
// kırmızı verir — ve haklı olarak: defterle bakiye ayrışmış olur.
//
// ⚠️ TARİH: `issueDate` ve `txnDate` servis girdisindedir ve BELGE NUMARASI da
// ondan türer (`nextInvoiceNo(tx, type, issueDate)`) — geri tarihleme gerçek.
// Dönem MÜHRÜ 2 ay öncesini kapatıyor; bu yüzden yazımlar mühürden SONRAsına
// (son 30 gün) sıkıştırılır.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { invoiceService } from "../../src/services/invoice.service";
import { paymentService } from "../../src/services/payment.service";
import { paymentAllocationService } from "../../src/services/payment-allocation.service";
import { adim, say, not, demoToken, gunOnce, rastgele, sec } from "./_kit";

const FATURA = 34;
const TAHSILAT = 26;

/**
 * YAZIM PENCERESİ — dönem MÜHRÜ nedeniyle dar.
 *
 * ⚠️ `seed-ticaret-demo` 2 ay öncesinin sonunu mühürlüyor (ölçüldü: 31.07.2026).
 * Mühürlü döneme yazım 409 verir ("… KAPALI dönemine düşüyor") ve bu DOĞRU
 * davranıştır — kapanmış fotoğraf değişmez. Bu yüzden fatura/tahsilat son 30
 * güne sıkışır; mührü geriye çekmek demo uğruna bir muhasebe kuralını gevşetmek
 * olurdu.
 */
const PENCERE_GUN = 30;

export async function finansKur(): Promise<void> {
  adim(`Ön muhasebe — ${FATURA} fatura · ${TAHSILAT} tahsilat/ödeme`);

  const musteriler = await prisma.customer.findMany({
    where: { isActive: true, mergedIntoId: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
  });
  const kalemler = await prisma.item.findMany({
    where: { itemType: "FABRIC", isActive: true },
    select: { id: true, name: true },
    take: 40,
  });
  if (musteriler.length === 0 || kalemler.length === 0) {
    not("Fatura için müşteri/kumaş yok.");
    return;
  }

  const r = rastgele(31415);
  const faturalar: Array<{ id: string; musteriId: string; tutar: number; gun: number }> = [];

  for (let i = 0; i < FATURA; i++) {
    const token = demoToken(`invoice:${i}`);
    const varOlan = await prisma.invoice.findUnique({
      where: { clientToken: token },
      select: { id: true, cariId: true, grandTotal: true },
    });
    if (varOlan) continue;

    // ⚠️ Mühürlü döneme yazmamak için pencere DAR (bkz. PENCERE_GUN).
    const gun = 2 + Math.floor(r() * (PENCERE_GUN - 3));
    const musteriId = sec(musteriler, r).id;
    const satirSayisi = 1 + Math.floor(r() * 3);
    const lines = Array.from({ length: satirSayisi }, () => {
      const k = sec(kalemler, r);
      const qty = Math.round((100 + r() * 900) / 10) * 10;
      const price = Math.round((45 + r() * 180) * 100) / 100;
      return { itemId: k.id, description: k.name, qty, unitPrice: price, vatRate: 20 };
    });
    const tutar = lines.reduce((t, l) => t + l.qty * l.unitPrice * 1.2, 0);

    try {
      const res = await invoiceService.createDraft(
        {
          type: "SALES",
          customerId: musteriId,
          issueDate: gunOnce(gun),
          currency: "TRY",
          lines,
          clientToken: token,
        } as never,
        undefined,
      );
      const id = res.data?.id;
      if (!id) continue;
      say("fatura (taslak)");

      // %78 ONAYLA — taslak kalanlar "Taslak" sekmesini doldursun.
      if (r() < 0.78) {
        await invoiceService.confirm(id, undefined);
        say("fatura (onaylı)");
        faturalar.push({ id, musteriId, tutar, gun });
      }
    } catch (e) {
      not(`Fatura #${i} kurulamadı: ${(e as Error).message}`);
    }
  }

  // ⚠️ TAHSİLAT HEDEFLERİ SORGUDAN KURULUR, döngüden DEĞİL. İdempotentlik
  // atlaması (`varOlan → continue`) yüzünden ikinci koşumda `faturalar` dizisi
  // neredeyse boş kalıyor ve tahsilat sayısı 26'dan 9'a düşüyordu (ölçüldü).
  // Kaynak: bu seed'in yazdığı ONAYLI faturaların tamamı.
  if (faturalar.length < TAHSILAT) {
    const onayli = await prisma.invoice.findMany({
      where: { status: "CONFIRMED", type: "SALES", clientToken: { not: null } },
      select: { id: true, cariId: true, grandTotal: true, issueDate: true },
      orderBy: { issueDate: "desc" },
      take: TAHSILAT * 2,
    });
    const cariler = await prisma.cariAccount.findMany({
      where: { id: { in: onayli.map((o) => o.cariId) } },
      select: { id: true, customerId: true },
    });
    const cariMusteri = new Map(cariler.map((c) => [c.id, c.customerId]));
    const bugun = Date.now();
    for (const o of onayli) {
      const musteriId = cariMusteri.get(o.cariId);
      if (!musteriId) continue;
      if (faturalar.some((f) => f.id === o.id)) continue;
      faturalar.push({
        id: o.id,
        musteriId,
        tutar: Number(o.grandTotal),
        gun: Math.max(1, Math.round((bugun - o.issueDate.getTime()) / 86_400_000)),
      });
    }
  }

  // ── TAHSİLATLAR ───────────────────────────────────────────────────────────
  // ⚠️ BİLİNÇLİ EKSİK KAPAMA: bazı faturalar KISMİ kapatılır, bazıları hiç
  // kapatılmaz. Hepsi kapanırsa Yaşlandırma raporu BOŞ çıkar ve "vadesi geçen
  // alacak" kavramı demoda hiç görünmez — kullanıcı kararı ("ölçülü problem").
  // ⚠️ PARA BİRİMİ EŞLEŞMELİ: USD hesaba TRY tahsilat yazılamaz (servis reddeder,
  // haklı olarak). İlk aktif hesabı almak 26 tahsilatın çoğunu düşürdü — TRY
  // hesap AÇIKÇA seçilir.
  const kasa = await prisma.cashBox.findFirst({
    where: { isActive: true, currency: "TRY" },
    select: { id: true },
  });
  const banka = await prisma.bankAccount.findFirst({
    where: { isActive: true, currency: "TRY" },
    select: { id: true },
  });
  if (!kasa && !banka) {
    not("Kasa/banka hesabı yok — tahsilat kurulamaz.");
    return;
  }

  for (let i = 0; i < TAHSILAT; i++) {
    const token = demoToken(`payment:${i}`);
    const varOlan = await prisma.payment.findUnique({
      where: { clientToken: token },
      select: { id: true },
    });
    if (varOlan) continue;

    const hedef = faturalar[i % Math.max(1, faturalar.length)];
    if (!hedef) break;
    const nakit = r() < 0.45;
    // Kısmi kapama: tutarın %40-%100'ü.
    const oran = 0.4 + r() * 0.6;
    const tutar = Math.round(hedef.tutar * oran * 100) / 100;
    if (tutar <= 0) continue;

    try {
      await paymentService.create(
        {
          direction: "IN",
          method: nakit ? "CASH" : "BANK_TRANSFER",
          customerId: hedef.musteriId,
          amount: tutar,
          currency: "TRY",
          // Tahsilat faturadan SONRA olur — aksi hâli defterde tuhaf görünür.
          // ⚠️ AÇIK PENCEREYE SIKIŞTIRILIR: hedef fatura mühürlü dönemden
          // gelmiş olabilir (ticaret seed'inin eski faturaları); tarihi ondan
          // türetmek 409 "KAPALI döneme düşüyor" verir.
          paymentDate: gunOnce(
            Math.min(PENCERE_GUN - 2, Math.max(1, hedef.gun - 1 - Math.floor(r() * 8))),
          ),
          cashBoxId: nakit ? kasa?.id ?? null : null,
          bankAccountId: nakit ? null : banka?.id ?? kasa?.id ?? null,
          reference: `Havale/EFT ${1000 + i}`,
          clientToken: token,
        },
        undefined,
      );
      say("tahsilat");
    } catch (e) {
      not(`Tahsilat #${i} kurulamadı: ${(e as Error).message}`);
    }
  }

  // ── DÖVİZLİ ZİNCİR — Kur Farkı raporunun TEK besleyicisi ─────────────────
  // ⚠️ Rapor, faturanın kesildiği gün ile tahsilatın yapıldığı gün arasındaki
  // KUR FARKINDAN doğar. Aynı gün kesilip aynı gün kapanan dövizli bir belge
  // rapora 0,00 yazar ve ekran "çalışmıyor" görünür. Bu yüzden fatura ve
  // tahsilat BİLEREK farklı günlere konur (kur tarihçesi zaten 120 günlük).
  await dovizliZincir(musteriler, kalemler, r);

  const f = await prisma.invoice.count();
  const p = await prisma.payment.count();
  console.log(`   toplam fatura=${f} · tahsilat/ödeme=${p}`);
}


/**
 * Dövizli fatura → FARKLI GÜNDE dövizli tahsilat → tahsis.
 *
 * ⚠️ TAHSİS AÇIKÇA YAPILIR: otomatik FIFO kapama bayrağı bu kurulumda kapalı
 * olabilir; kur farkı satırı `PaymentAllocation` olmadan DOĞMAZ (raporun çıpası
 * tahsis kaydıdır).
 */
async function dovizliZincir(
  musteriler: Array<{ id: string }>,
  kalemler: Array<{ id: string; name: string }>,
  r: () => number,
): Promise<void> {
  const bankaUsd = await prisma.bankAccount.findFirst({
    where: { isActive: true, currency: "USD" },
    select: { id: true },
  });
  if (!bankaUsd || musteriler.length === 0 || kalemler.length === 0) {
    not("USD banka hesabı yok — Kur Farkı raporu boş kalacak.");
    return;
  }

  for (let i = 0; i < 6; i++) {
    const fToken = demoToken(`fx-invoice:${i}`);
    const pToken = demoToken(`fx-payment:${i}`);
    const zatenVar = await prisma.invoice.findUnique({ where: { clientToken: fToken }, select: { id: true } });
    if (zatenVar) continue;

    const musteriId = sec(musteriler, r).id;
    const faturaGun = 8 + i * 3;          // fatura ESKİ
    const tahsilatGun = Math.max(1, faturaGun - 5 - i); // tahsilat SONRA → kur değişmiş
    const k = sec(kalemler, r);
    const qty = 100 + Math.round(r() * 400);
    const price = Math.round((12 + r() * 20) * 100) / 100;

    try {
      const inv = await invoiceService.createDraft(
        {
          type: "SALES",
          customerId: musteriId,
          issueDate: gunOnce(faturaGun),
          currency: "USD",
          lines: [{ itemId: k.id, description: k.name, qty, unitPrice: price, vatRate: 20 }],
          clientToken: fToken,
        } as never,
        undefined,
      );
      const invoiceId = inv.data?.id;
      if (!invoiceId) continue;
      await invoiceService.confirm(invoiceId, undefined);

      const tutar = Math.round(qty * price * 1.2 * 100) / 100;
      const pay = await paymentService.create(
        {
          direction: "IN",
          method: "BANK_TRANSFER",
          customerId: musteriId,
          amount: tutar,
          currency: "USD",
          paymentDate: gunOnce(tahsilatGun),
          bankAccountId: bankaUsd.id,
          reference: `USD havale ${i + 1}`,
          clientToken: pToken,
        },
        undefined,
      );
      const paymentId = pay.data?.id;
      if (!paymentId) continue;

      await paymentAllocationService.allocate(
        { invoiceId, paymentId, amount: tutar },
        undefined,
      );
      say("dövizli kapama (kur farkı)");
    } catch (e) {
      not(`Dövizli zincir #${i} kurulamadı: ${(e as Error).message}`);
    }
  }
}
