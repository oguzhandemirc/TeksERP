// =============================================================================
// DEMO SEED — CARİ + SİPARİŞ DEFTERİ
// =============================================================================
// Sipariş defteri boşken YEDİ satış raporu birden boş açılır (Sipariş Girişi ·
// Termin · İptal · Talep Analizi · Açık Sipariş Karşılanma · Sevkiyat Karnesi ·
// İade Karnesi) ve Siparişler ekranı ürünün "sipariş yönetimi yok" izlenimini
// verir. Ölçüldü: bu veritabanında 0 sipariş vardı.
//
// ⚠️ TARİH GERİYE ALINABİLİR: `orderDate`/`deadline` servisin yazma
// beyaz listesindedir (`ORDER_HEADER_WRITABLE`). Statü ALINAMAZ — o
// `recomputeOrderStatus` ile SEVKİYATTAN türer; iptal ayrı uçtan yapılır.
//
// ⚠️ MÜŞTERİ ADLARI UYDURMADIR (gizlilik kararı). Katalog fabrikadan geldi,
// ticari taraf gelmedi.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { OrderService } from "../../src/services/order.service";
import { adim, say, not, demoToken, gunOnce, yayilmisGun, rastgele, sec } from "./_kit";

/** Sektörel ama UYDURMA alıcılar — gerçek müşteri adı kullanılmaz. */
const ALICILAR = [
  { code: "DF-MST-101", name: "Boğaziçi Perde Sanayi Ltd. Şti.", city: "İstanbul" },
  { code: "DF-MST-102", name: "Akdeniz Otelcilik Tedarik A.Ş.", city: "Antalya" },
  { code: "DF-MST-103", name: "Bursa Döşemelik Kumaş Ticaret", city: "Bursa" },
  { code: "DF-MST-104", name: "Kapadokya Ev Tekstili Ltd.", city: "Nevşehir" },
  { code: "DF-MST-105", name: "Ankara Mobilya Kumaşları A.Ş.", city: "Ankara" },
  { code: "DF-MST-106", name: "İzmir Dekorasyon Merkezi", city: "İzmir" },
  { code: "DF-MST-107", name: "Karadeniz Yapı Market Zinciri", city: "Trabzon" },
  { code: "DF-MST-108", name: "Çukurova Tekstil İhracat Ltd.", city: "Adana" },
  { code: "DF-MST-109", name: "Marmara Kontrakt Projeleri A.Ş.", city: "Kocaeli" },
  { code: "DF-MST-110", name: "Konya Ev Yaşam Mağazacılık", city: "Konya" },
  { code: "DF-MST-111", name: "Trakya Perde Toptan Ticaret", city: "Edirne" },
  { code: "DF-MST-112", name: "Gaziantep Halı ve Kumaş San.", city: "Gaziantep" },
];

// ⚠️ Asgari yapılandırma (bekçilerin kullandığı kalıp): liste/arama alanları bu
// seed'de kullanılmıyor, `nestedCreateFields: ["lines"]` ise KALEMLERİN aynı
// insert'te yazılması için ZORUNLU.
const orderService = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  searchFields: [],
  codeSearchFields: ["orderNumber"],
  dateFields: ["createdAt", "deadline"],
  nestedCreateFields: ["lines"],
});

/** Şehir → alan kodu; telefon GERÇEKÇİ ve KAYDA ÖZEL olsun diye. */
const ALAN_KODU: Record<string, string> = {
  İstanbul: "0212", Antalya: "0242", Bursa: "0224", Nevşehir: "0384", Ankara: "0312",
  İzmir: "0232", Konya: "0332", Gaziantep: "0342", Denizli: "0258", Kayseri: "0352",
  Adana: "0322", Trabzon: "0462", Eskişehir: "0222", Mersin: "0324", Samsun: "0362",
};

export async function carilerKur(): Promise<string[]> {
  adim("Cari — alıcılar");
  const ids: string[] = [];
  let sira = 0;
  for (const a of ALICILAR) {
    sira++;
    // ⚠️ TELEFON KAYDA ÖZEL OLMALI (2026-09-01, canlı demoda ölçüldü). Eskiden
    // hepsine `0212 000 00 00` yazılıyordu; Mükerrer Kayıtlar panelinin KİMLİK
    // kuralı (aynı telefon = aynı tüzel kişi) bunu haklı olarak yakalayıp
    // BİRBİRİYLE ALAKASIZ 12 firmayı tek "mükerrer" grubu olarak sunuyordu.
    // Müşteri o ekranı açtığında gördüğü ilk şey saçma bir grup oluyordu.
    // (Motor tarafı da sertleştirildi — yer tutucu bastırma — ama demo verisinin
    // kendisi de gerçekçi olmalı: alıcıların telefonu farklı olur.)
    const kod = ALAN_KODU[a.city] ?? "0212";
    const telefon = `${kod} ${String(300 + sira).padStart(3, "0")} ${String(10 + sira).padStart(2, "0")} ${String(20 + sira).padStart(2, "0")}`;
    const c = await prisma.customer.upsert({
      where: { code: a.code },
      update: { contactPhone: telefon },
      create: {
        code: a.code,
        name: a.name,
        city: a.city,
        country: "Türkiye",
        type: "CUSTOMER",
        contactName: "Satın Alma Birimi",
        contactPhone: telefon,
      },
      select: { id: true },
    });
    ids.push(c.id);
    say("alıcı cari");
  }
  // Mevcut (ticaret seed'inden gelen) alıcılar da havuza girer — sipariş defteri
  // tek bir ad kümesine sıkışmasın.
  const mevcut = await prisma.customer.findMany({
    where: { isActive: true, mergedIntoId: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
  });
  const havuz = [...new Set([...ids, ...mevcut.map((m) => m.id)])];
  console.log(`   alıcı havuzu: ${havuz.length}`);
  return havuz;
}

const ADET = 45;

export async function siparislerKur(alicilar: string[], itemIds: string[], colorIds: string[]): Promise<string[]> {
  adim(`Sipariş defteri (${ADET} sipariş, 5 aya yayılmış)`);
  if (alicilar.length === 0 || itemIds.length === 0) {
    not("Sipariş üretilemedi — alıcı ya da kumaş yok.");
    return [];
  }
  const r = rastgele(20260901);
  const olusan: string[] = [];

  for (let i = 0; i < ADET; i++) {
    const gun = yayilmisGun(i, ADET);
    const orderDate = gunOnce(gun);
    // Termin: bir kısmı GEÇMİŞ (geciken sipariş rozeti dolsun), bir kısmı ileri.
    const terminGun = gun - Math.round(20 + r() * 40);
    const deadline = gunOnce(terminGun);

    const satirSayisi = 1 + Math.floor(r() * 3);
    const lines = Array.from({ length: satirSayisi }, () => ({
      itemId: sec(itemIds, r),
      colorId: colorIds.length > 0 && r() > 0.15 ? sec(colorIds, r) : null,
      quantity: Math.round((200 + r() * 1800) / 10) * 10,
      width: r() > 0.5 ? 140 + Math.round(r() * 16) * 10 : null,
    }));

    // ⚠️ SİPARİŞ REPLAY'İ CACHED DÖNMEZ, HATA FIRLATIR ("Bu form daha önce
    // kaydedilmiş…") — fatura/tahsilat yollarından FARKLI. Bu yüzden idempotentlik
    // token'a değil ÖN SORGUYA dayanır; yoksa ikinci koşum 41 sahte uyarı basar.
    const token = demoToken(`order:${i}`);
    const varOlan = await prisma.order.findUnique({ where: { clientToken: token }, select: { id: true } });
    if (varOlan) {
      olusan.push(varOlan.id);
      continue;
    }

    try {
      const res = (await orderService.create(
        {
          customerId: sec(alicilar, r),
          orderDate: orderDate.toISOString(),
          deadline: deadline.toISOString(),
          lines,
          clientToken: token,
        },
        undefined,
      )) as { data?: { id?: string } };
      const id = res.data?.id;
      if (id) {
        olusan.push(id);
        say("sipariş");
      }
    } catch (e) {
      not(`Sipariş #${i} kurulamadı: ${(e as Error).message}`);
    }
  }

  // ── İPTALLER — Sipariş İptal raporunun TEK besleyicisi ────────────────────
  // ⚠️ İptal statüsü elle YAZILAMAZ (tek yazma noktası `recomputeOrderStatus` +
  // iptal ucu); gerçek yoldan geçilir ki defter ve sebep izi doğru doğsun.
  const iptalEdilecek = olusan.filter((_, i) => i % 9 === 4);
  const sebepler = ["Müşteri vazgeçti", "Fiyat anlaşması sağlanamadı", "Termin tutmadı"];
  let iptalNo = 0;
  for (const id of iptalEdilecek) {
    const mevcut = await prisma.order.findUnique({ where: { id }, select: { status: true } });
    if (mevcut?.status === "CANCELLED") continue; // ikinci koşum — zaten iptal
    try {
      // ⚠️ İş emri aksiyonu BOŞ: bu siparişler henüz üretime bağlanmadı.
      await orderService.cancelWithActions(id, [], undefined, {
        reasonText: sebepler[iptalNo++ % sebepler.length] as string,
      });
      say("iptal edilen sipariş");
    } catch (e) {
      not(`Sipariş iptali atlandı: ${(e as Error).message}`);
    }
  }

  console.log(`   sipariş=${olusan.length} · iptal=${iptalEdilecek.length}`);
  return olusan;
}
