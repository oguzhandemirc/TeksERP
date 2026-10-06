// =============================================================================
// EŞİTLEME İDEMPOTENCY + SIRA BEKÇİSİ — `POST /v1/esitle` (sözleşme §6), gerçek HTTP + imzalı istek:
//   §1 aynı paket (aynı gövde, yeni imza) → SAKLI yanıt birebir, ikinci etki yok (sürüm/satır/makbuz)
//      · aynı paketId başka gövde → 409 PAKET_KIMLIGI_CAKISTI · aynı imzalı başlık → 409 ISTEK_TEKRAR
//   §2 sürüm anı = ufuk: geç gelen ESKİ paket yeni veriyi ezemez, silinmiş satırı diriltemez
//   §3 filigran zinciri: örtüşme KABUL · boşluk → istenen TAM (FILIGRAN_KOPUK), kabul YOK
//   §4 TAM işaretle-süpür: son parça gelince pakette olmayan satır düşer; eksik parçada düşmez
//   §5 kapılar: alan sınıfı (kök satırda tutar) RET · bilinmeyen projeksiyon RET · gzip · gelecek ufuk
//      400 · eski sözleşme 400 · kurulum uyuşmazlığı 400 · TEST sınıfı 403 · abonelik bitti 403 ·
//      imzasız 401 · paket kilidi doluyken 409 PAKET_ISLENIYOR
//   §6 uzlaştırma: eşit küme istenen yok · farklı küme istenen TAM (UZLASTIRMA) · ANLIK yazımı
//   §7 (L2-1) İSTEK yol bağı: bütün uçlarda amaç `esitle` olduğu için imzalı `yol` isteği ucuna bağlar —
//      başka uç için imzalanmış istek 401 `ISTEK_YOL`, etki yok; yol taşımayan (eski fabrika) istek değişmez
// Koşum: npx tsx scripts/test_esitleme_idempotency.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { withTesis } from "../src/lib/tenant";
import { LOCK_NAMESPACES } from "../src/lib/locks";
import { girdi, imzali, kanonik, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, tesisUrl, type Ortam, type TestKurulumu } from "./lib/test-ortam";

type SyncBody = { kabul: { projeksiyon: string }[]; ret: { projeksiyon: string; kod: string }[]; istenen: { projeksiyon: string; neden: string }[]; sozlesmeUyarisi: unknown; ufukTarihi: Record<string, string> };

async function satir(o: Ortam, tesisId: string, projection: string, id: string) {
  return withTesis(o.goc, { tesisId, projections: [projection] }, (tx) =>
    tx.projectionRow.findUnique({ where: { tesisId_projection_recordId: { tesisId, projection, recordId: id } } }),
  );
}

const iso = (ms: number) => new Date(ms).toISOString();

async function idempotency(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§1 aynı paket → saklı yanıt, ikinci etki yok");
  const id = randomUUID();
  const ufuk = o.saat.simdi() - 120_000;
  const p = paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("urun", { yaz: [{ id, kod: "U1", ad: "Kumaş A" }], yeni: { t: iso(ufuk), k: "000000000001" } })] });
  const r1 = await imzali(o, k, "/v1/esitle", { govde: p });
  const once = await satir(o, k.tesisId, "urun", id);
  o.saat.ilerlet(1_000);
  const r2 = await imzali(o, k, "/v1/esitle", { govde: p });
  const sonra = await satir(o, k.tesisId, "urun", id);
  kontrol("§1a ilk paket 200 + kabul", r1.status === 200 && (r1.json as unknown as SyncBody).kabul.length === 1, `${r1.status}`);
  kontrol("§1b aynı paket tekrarı 200 + AYNI yanıt (anlamca birebir)", r2.status === 200 && kanonik(r2.json) === kanonik(r1.json));
  kontrol("§1c ikinci etki yok (updated_at değişmedi)", once !== null && sonra !== null && once.updatedAt.getTime() === sonra.updatedAt.getTime());
  const makbuz = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.packageReceipt.count({ where: { tesisId: k.tesisId, packageId: p.paketId } }));
  kontrol("§1d tek makbuz", makbuz === 1);
  const baska = { ...p, kayitlar: [girdi("urun", { yaz: [{ id, kod: "U1", ad: "DEĞİŞTİ" }], yeni: { t: iso(ufuk), k: "000000000001" } })] };
  const r3 = await imzali(o, k, "/v1/esitle", { govde: baska });
  kontrol("§1e aynı paketId başka gövde → 409 PAKET_KIMLIGI_CAKISTI", r3.status === 409 && r3.json.details?.code === "PAKET_KIMLIGI_CAKISTI");
  const r4 = await imzali(o, k, "/v1/esitle", { ham: r2.ham, baslik: r2.baslik });
  kontrol("§1f aynı imzalı başlık (nonce) → 409 ISTEK_TEKRAR", r4.status === 409 && r4.json.details?.code === "ISTEK_TEKRAR");
}

async function surumAni(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§2 sürüm anı = ufuk (eski paket ezemez)");
  const id = randomUUID();
  const t0 = o.saat.simdi() - 600_000;
  const yeni = paket(k, { ufuk: new Date(t0 + 300_000), kayitlar: [girdi("renk", { yaz: [{ id, kod: "R1", ad: "YENİ" }], yeni: { t: iso(t0 + 300_000), k: "000000000005" } })] });
  const eski = paket(k, { ufuk: new Date(t0), kayitlar: [girdi("renk", { yaz: [{ id, kod: "R1", ad: "ESKİ" }], yeni: { t: iso(t0), k: "000000000001" } })] });
  await imzali(o, k, "/v1/esitle", { govde: yeni });
  const r = await imzali(o, k, "/v1/esitle", { govde: eski });
  const s = await satir(o, k.tesisId, "renk", id);
  kontrol("§2a geç gelen eski paket yeni veriyi EZMEDİ", r.status === 200 && (s?.data as { ad?: string })?.ad === "YENİ", (s?.data as { ad?: string })?.ad);
  const sil = paket(k, { ufuk: new Date(t0 + 400_000), kayitlar: [girdi("renk", { sil: [{ id, neden: "SILINDI" }], onceki: { t: iso(t0 + 300_000), k: "000000000005" }, yeni: { t: iso(t0 + 400_000), k: "000000000006" } })] });
  await imzali(o, k, "/v1/esitle", { govde: sil });
  const dirilt = paket(k, { ufuk: new Date(t0 + 350_000), kayitlar: [girdi("renk", { yaz: [{ id, kod: "R1", ad: "HAYALET" }], yeni: { t: iso(t0 + 350_000), k: "000000000005" } })] });
  await imzali(o, k, "/v1/esitle", { govde: dirilt });
  const s2 = await satir(o, k.tesisId, "renk", id);
  kontrol("§2b silinmiş satırı eski paket DİRİLTEMEDİ (mezar taşı)", s2?.deletedAt !== null && (s2?.data as { ad?: string })?.ad === "YENİ");
}

async function filigran(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§3 filigran zinciri");
  const base = o.saat.simdi() - 900_000;
  const p1 = paket(k, { ufuk: new Date(base), kayitlar: [girdi("depo", { yaz: [{ id: randomUUID(), ad: "D1" }], yeni: { t: iso(base), k: "000000000010" } })] });
  const r1 = (await imzali(o, k, "/v1/esitle", { govde: p1 })).json as unknown as SyncBody;
  const ortusme = paket(k, { ufuk: new Date(base + 1000), kayitlar: [girdi("depo", { yaz: [{ id: randomUUID(), ad: "D2" }], onceki: { t: iso(base), k: "000000000009" }, yeni: { t: iso(base + 1000), k: "000000000011" } })] });
  const r2 = (await imzali(o, k, "/v1/esitle", { govde: ortusme })).json as unknown as SyncBody;
  const bosluk = paket(k, { ufuk: new Date(base + 2000), kayitlar: [girdi("depo", { yaz: [{ id: randomUUID(), ad: "D3" }], onceki: { t: iso(base + 1500), k: "000000000012" }, yeni: { t: iso(base + 2000), k: "000000000013" } })] });
  const r3 = (await imzali(o, k, "/v1/esitle", { govde: bosluk })).json as unknown as SyncBody;
  kontrol("§3a ilk girdi (önceki null) kabul", r1.kabul.some((x) => x.projeksiyon === "depo"));
  kontrol("§3b örtüşen önceki (≤ saklanan) kabul", r2.kabul.some((x) => x.projeksiyon === "depo"));
  kontrol("§3c boşluk → istenen TAM FILIGRAN_KOPUK, kabul YOK", r3.istenen.some((x) => x.projeksiyon === "depo" && x.neden === "FILIGRAN_KOPUK") && !r3.kabul.some((x) => x.projeksiyon === "depo"));
  const sayac = paket(k, { ufuk: new Date(base + 1000), kayitlar: [girdi("depo", { onceki: { t: iso(base + 1000), k: "000000000009" }, yeni: { t: iso(base + 1000), k: "000000000011" } })] });
  const r4 = (await imzali(o, k, "/v1/esitle", { govde: sayac })).json as unknown as SyncBody;
  kontrol("§3d sayaç eşitlik bozucusu SAYISAL karşılaştırılır (9 < 11 → kabul)", r4.kabul.some((x) => x.projeksiyon === "depo"));
}

async function tam(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§4 TAM işaretle-süpür");
  const eskiId = randomUUID();
  const kalanId = randomUUID();
  const t0 = o.saat.simdi() - 1_200_000;
  await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(t0), kayitlar: [girdi("istasyon", { yaz: [{ id: eskiId, ad: "Eski" }, { id: kalanId, ad: "Kalan" }], yeni: { t: iso(t0), k: "000000000001" } })] }) });
  const bas = t0 + 60_000;
  const parca1 = paket(k, { ufuk: new Date(bas), tur: "TAM", kayitlar: [girdi("istasyon", { yaz: [{ id: kalanId, ad: "Kalan" }], yeni: { t: iso(bas), k: "000000000001" }, tam: { parca: 1, toplamParca: 2, baslangic: iso(bas) } })] });
  await imzali(o, k, "/v1/esitle", { govde: parca1 });
  const araEski = await satir(o, k.tesisId, "istasyon", eskiId);
  kontrol("§4a eksik parçada süpürme YOK (eski satır canlı)", araEski !== null && araEski.deletedAt === null);
  const parca2 = paket(k, { ufuk: new Date(bas), tur: "TAM", kayitlar: [girdi("istasyon", { yaz: [{ id: randomUUID(), ad: "Yeni" }], yeni: { t: iso(bas), k: "000000000002" }, tam: { parca: 2, toplamParca: 2, baslangic: iso(bas) } })] });
  await imzali(o, k, "/v1/esitle", { govde: parca2 });
  const sonEski = await satir(o, k.tesisId, "istasyon", eskiId);
  const sonKalan = await satir(o, k.tesisId, "istasyon", kalanId);
  kontrol("§4b son parça: pakette olmayan satır DÜŞTÜ", sonEski?.deletedAt != null);
  kontrol("§4c pakette olan satır CANLI", sonKalan !== null && sonKalan.deletedAt === null);
  const uyusmaz = paket(k, { ufuk: new Date(bas), tur: "TAM", kayitlar: [girdi("istasyon", { yeni: { t: iso(bas), k: "000000000003" }, tam: { parca: 1, toplamParca: 5, baslangic: iso(bas) } })] });
  const r = (await imzali(o, k, "/v1/esitle", { govde: uyusmaz })).json as unknown as SyncBody;
  kontrol("§4d aynı TAM turunda toplam parça değişirse RET (TAM_PARCA_UYUSMAZ)", r.ret.some((x) => x.kod === "TAM_PARCA_UYUSMAZ"));
}

async function kapilar(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§5 kapılar");
  const ufuk = o.saat.simdi() - 30_000;
  const id = randomUUID();
  const sizinti = paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("siparis", { yaz: [{ id, siparisNo: "S1", tutar: "99.00" }], yeni: { t: iso(ufuk), k: "000000000001" } })] });
  const r1 = (await imzali(o, k, "/v1/esitle", { govde: sizinti })).json as unknown as SyncBody;
  kontrol("§5a kök satırda FINANS alanı (tutar) → RET ALAN_SINIFI_IHLALI ve SAKLANMADI", r1.ret.some((x) => x.kod === "ALAN_SINIFI_IHLALI") && (await satir(o, k.tesisId, "siparis", id)) === null);
  const bilinmez = (await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("maas-bordrosu", { yeni: { t: iso(ufuk), k: "000000000001" } })] }) })).json as unknown as SyncBody;
  kontrol("§5b bilinmeyen projeksiyon → RET PROJEKSIYON_BILINMIYOR", bilinmez.ret.some((x) => x.kod === "PROJEKSIYON_BILINMIYOR"));
  const gz = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("sube", { yaz: [{ id: randomUUID(), ad: "Şube" }], yeni: { t: iso(ufuk), k: "000000000001" } })] }), gzip: true });
  kontrol("§5c gzip gövde (özet SIKIŞTIRILMIŞ baytlardan) 200", gz.status === 200, `${gz.status}`);
  const gelecek = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() + 3_600_000) }) });
  kontrol("§5d gelecekteki ufuk → 400 (sürüm anı zehirlenmesin)", gelecek.status === 400 && gelecek.json.details?.code === "GOVDE_GECERSIZ");
  const eskiSoz = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), sozlesme: 0 }) });
  kontrol("§5e N−2 sözleşme → 400 SOZLESME_ESKI", eskiSoz.status === 400 && eskiSoz.json.details?.code === "SOZLESME_ESKI");
  const yeniSoz = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), sozlesme: 2 }) });
  kontrol("§5f tanınmayan (yeni) sözleşme → 400 SOZLESME_BILINMIYOR", yeniSoz.status === 400 && yeniSoz.json.details?.code === "SOZLESME_BILINMIYOR");
  const baskaKurulum = await imzali(o, k, "/v1/esitle", { govde: { ...paket(k, { ufuk: new Date(ufuk) }), kurulumId: randomUUID() } });
  kontrol("§5g gövdedeki kurulum imzalıyla uyuşmuyor → 400", baskaKurulum.status === 400);
  const fazlaAnahtar = await imzali(o, k, "/v1/esitle", { govde: { ...paket(k, { ufuk: new Date(ufuk) }), tesisId: k.tesisId } });
  kontrol("§5h tanınmayan zarf anahtarı (tesisId) → 400 GOVDE_GECERSIZ", fazlaAnahtar.status === 400 && fazlaAnahtar.json.details?.code === "GOVDE_GECERSIZ");
  const imzasiz = await fetch(`${o.adres}/v1/esitle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paket(k, { ufuk: new Date(ufuk) })) });
  kontrol("§5i imzasız istek → 401", imzasiz.status === 401);
  const test = await tesisKur(o, { sinif: "TEST" });
  const bitmis = await tesisKur(o, { bitis: new Date(o.saat.simdi() - 1000) });
  const haksiz = await tesisKur(o, { patronBulut: false });
  try {
    const t1 = await imzali(o, test, "/v1/esitle", { govde: paket(test, { ufuk: new Date(ufuk) }) });
    kontrol("§5j TEST sınıfı → 403 SINIF_GONDEREMEZ", t1.status === 403 && t1.json.details?.code === "SINIF_GONDEREMEZ");
    const t2 = await imzali(o, bitmis, "/v1/esitle", { govde: paket(bitmis, { ufuk: new Date(ufuk) }) });
    kontrol("§5k abonelik bitti → 403 PATRON_BULUT_KAPALI", t2.status === 403 && t2.json.details?.code === "PATRON_BULUT_KAPALI");
    const t3 = await imzali(o, haksiz, "/v1/esitle", { govde: paket(haksiz, { ufuk: new Date(ufuk) }) });
    kontrol("§5l patron-bulut modülü yok → 403 PATRON_BULUT_KAPALI", t3.status === 403 && t3.json.details?.code === "PATRON_BULUT_KAPALI");
  } finally {
    for (const x of [test, bitmis, haksiz]) await temizleTesis(o, x.tesisId);
  }
  const kilitci = new Client({ connectionString: tesisUrl(o, k.tesisId, "esitleme") });
  await kilitci.connect();
  try {
    await kilitci.query("BEGIN");
    await kilitci.query("SELECT pg_advisory_xact_lock($1::int4, hashtext($2))", [LOCK_NAMESPACES.PACKAGE, k.tesisId]);
    const dolu = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk) }) });
    kontrol("§5m paket kilidi doluyken → 409 PAKET_ISLENIYOR (beklemez)", dolu.status === 409 && dolu.json.details?.code === "PAKET_ISLENIYOR");
    await kilitci.query("ROLLBACK");
  } finally {
    await kilitci.end();
  }
}

async function uzlastirma(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§6 uzlaştırma + anlık");
  const ufuk = o.saat.simdi() - 20_000;
  const ids = [randomUUID(), randomUUID()].sort();
  await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("fason-firma", { yaz: ids.map((id) => ({ id, ad: id.slice(0, 4) })), yeni: { t: iso(ufuk), k: "000000000001" } })] }) });
  const md5 = (await import("node:crypto")).createHash("md5").update(ids.join(",")).digest("hex");
  const esit = (await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), tur: "UZLASTIRMA", uzlastirma: [{ projeksiyon: "fason-firma", adet: 2, ozet: md5, ufukTarihi: null }] }) })).json as unknown as SyncBody;
  kontrol("§6a eşit küme → istenen YOK", esit.istenen.length === 0, JSON.stringify(esit.istenen));
  const farkli = (await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), tur: "UZLASTIRMA", uzlastirma: [{ projeksiyon: "fason-firma", adet: 3, ozet: md5, ufukTarihi: null }] }) })).json as unknown as SyncBody;
  kontrol("§6b farklı küme → istenen TAM UZLASTIRMA", farkli.istenen.some((x) => x.projeksiyon === "fason-firma" && x.neden === "UZLASTIRMA"));
  const bos = (await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), tur: "UZLASTIRMA", uzlastirma: [{ projeksiyon: "banka", adet: 0, ozet: "d41d8cd98f00b204e9800998ecf8427e", ufukTarihi: null }] }) })).json as unknown as SyncBody;
  kontrol("§6b2 BOŞ küme md5('') ile eşit → istenen YOK (her gün TAM döngüsü yok)", bos.istenen.length === 0, JSON.stringify(bos.istenen));
  const eskiFatura = randomUUID();
  const yeniFatura = randomUUID();
  const kalemEski = randomUUID();
  const kalemYeni = randomUUID();
  await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), kayitlar: [
    girdi("fatura", { yaz: [{ id: eskiFatura, tarih: "2020-01-15T00:00:00.000Z" }, { id: yeniFatura, tarih: iso(ufuk) }], yeni: { t: iso(ufuk), k: "000000000001" } }),
    girdi("fatura-kalemi", { yaz: [{ id: kalemEski, faturaId: eskiFatura }, { id: kalemYeni, faturaId: yeniFatura }], yeni: { t: iso(ufuk), k: "000000000001" } }),
  ] }) });
  const kalemOzeti = (await import("node:crypto")).createHash("md5").update(kalemYeni).digest("hex");
  const ustten = (await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), tur: "UZLASTIRMA", uzlastirma: [{ projeksiyon: "fatura-kalemi", adet: 1, ozet: kalemOzeti, ufukTarihi: "2024-01-01T00:00:00.000Z" }] }) })).json as unknown as SyncBody;
  kontrol("§6b3 saklama tarihi ÜSTTEN gelen kalem (S23): ufuktan eski faturanın kalemi sayılmaz → istenen YOK", ustten.istenen.length === 0, JSON.stringify(ustten.istenen));
  const anlik = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), anliklar: [{ projeksiyon: "ozet.stok", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: { toplamMetre: "1234.50" } }] }) });
  const s = await satir(o, k.tesisId, "ozet.stok", "00000000-0000-0000-0000-000000000000");
  kontrol("§6c ANLIK kayıt tek satır olarak yazıldı", anlik.status === 200 && (s?.data as { toplamMetre?: string })?.toplamMetre === "1234.50");
  const yanlisTur = (await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(ufuk), anliklar: [{ projeksiyon: "siparis", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: {} }] }) })).json as unknown as SyncBody;
  kontrol("§6d KAYIT projeksiyonu anlık olarak gelirse RET PROJEKSIYON_TURU", yanlisTur.ret.some((x) => x.kod === "PROJEKSIYON_TURU"));
  kontrol("§6e yanıt saklama ufkunu taşır (siparis)", typeof esit.ufukTarihi.siparis === "string");
}

async function yolBagi(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§7 İSTEK yol bağı (L2-1)");
  const ufuk = o.saat.simdi() - 60_000;
  const p = () => paket(k, { ufuk: new Date(ufuk), kayitlar: [girdi("urun", { yaz: [{ id: randomUUID(), kod: "Y1", ad: "Yol" }], yeni: { t: iso(ufuk), k: "000000000901" } })] });
  const yanlis = p();
  const r1 = await imzali(o, k, "/v1/esitle", { govde: yanlis, imzaYolu: "/v1/gelen-kutusu/al" });
  const makbuz = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.packageReceipt.count({ where: { tesisId: k.tesisId, packageId: yanlis.paketId } }));
  kontrol("§7a ⭐ gelen kutusu ucu için imzalanmış istek eşitleme ucunda → 401 ISTEK_YOL, paket işlenmedi", r1.status === 401 && r1.json.details?.code === "ISTEK_YOL" && makbuz === 0, `${r1.status} ${r1.json.details?.code ?? ""} · makbuz ${makbuz}`);
  const r2 = await imzali(o, k, "/v1/esitle", { govde: p(), imzaYolu: "/v1/esitle" });
  kontrol("§7b kendi ucu için imzalanmış istek → 200", r2.status === 200, `${r2.status}`);
  const r3 = await imzali(o, k, "/v1/esitle", { govde: p() });
  kontrol("§7c yol taşımayan (eski fabrika) istek değişmeden → 200", r3.status === 200, `${r3.status}`);
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const k = await tesisKur(o);
  try {
    await idempotency(o, k);
    await surumAni(o, k);
    await filigran(o, k);
    await tam(o, k);
    await kapilar(o, k);
    await uzlastirma(o, k);
    await yolBagi(o, k);
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
