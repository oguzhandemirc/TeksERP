// =============================================================================
// HİZMET SONU BEKÇİSİ (Ek-6/A §4.1–4.5) — aşama tek kaynak (`service-lifecycle.ts`), saat ENJEKTE:
//   §1 saf aşama: sözleşme açık → ACIK · bitiş = en genç geçmiş bitiş · 90. gün sınırı (−1 ms SALT_OKUNUR,
//      tam 90 gün KAPALI) · tesis PASIF → bitiş şimdi · donmuş damga NULL bitişi taşır · DR devri hizmeti bitirmez
//   §2 damga: tek yazar kapanışta yazar (bitiş = kira bitişi), tekrar etkisiz, yeniden açılışta siler; ayak izi
//   §3 SALT_OKUNUR: oturum şeridi aşamayı taşır · okuma AÇIK · giriş AÇIK · gelen kutusu/rapor yazması 403 ·
//      fabrika kanalı 403 · tesis PASIF (abonelik sürerken) fabrika kanalını da kapatır
//   §4 KAPALI: 90. gün dolunca oturum 401 · giriş 403 HIZMET_KAPANDI · sınırdan 1 sn önce hâlâ açık
//   §5 dışa aktarma: yalnız hesap yöneticisi · manifest · JSON + CSV (BOM, başlık, formül öneki) · izinsiz alt
//      satır dökümde YOK · başka tesisin verisi YOK · alt satır/bilinmeyen küme 404 · anlık CSV 400 · sırsız
//      hesap görünümü · ayak izi DISA_AKTARIM · SALT_OKUNUR'da açık
//   §6 imha: ACIK'ta RED · SALT_OKUNUR'da talepsiz RED, talepli kuru koşum hiçbir şey silmez · KAPALI'da uygula →
//      tesis DB'si + rolleri düşer, yönlendirme kalkar, başka tesis dokunulmaz, tutanak MERKEZDE ve DEĞİŞTİRİLEMEZ,
//      destek kaydı merkeze kopya, ikinci uygula 409 · yarıda kalan imha aynı komutla tamamlanır
// Koşum: npx tsx scripts/test_hizmet_sonu.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { withTesis } from "../src/lib/tenant";
import { destroyFacility } from "../src/services/facility-destruction";
import { READ_ONLY_DAYS, refreshServiceEnd, serviceState, type ServiceFacts } from "../src/services/service-lifecycle";
import { setFacilityStatus } from "../src/services/vendor-admin.service";
import { TEST_PAROLASI, api, girdi, girisYap, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, tesisUrl, totpKodu, type Ortam, type TestKurulumu } from "./lib/test-ortam";

const GUN = 86_400_000;
const TUM_OKUMA = ["bulut:siparis:oku", "bulut:fiyat:oku", "bulut:cari:oku", "bulut:ozet:oku", "bulut:hesap:yonet", "bulut:siparis:yaz", "bulut:cari:yaz", "bulut:rapor:oku"];

function saf(): void {
  console.log("\n§1 saf aşama (tek kaynak)");
  const t0 = Date.UTC(2026, 9, 1);
  const kurulum = (bitis: number | null, g: Partial<{ active: boolean; modules: string[] }> = {}) => ({ active: g.active ?? true, modules: g.modules ?? ["patron-bulut"], cloudUntil: bitis === null ? null : new Date(bitis) });
  const f = (g: Partial<ServiceFacts>): ServiceFacts => ({ status: "AKTIF", serviceEndedAt: null, installations: [kurulum(t0 + GUN)], ...g });
  kontrol("§1a bitiş gelecekte → ACIK", serviceState(f({}), t0).phase === "ACIK");
  const bitti = serviceState(f({ installations: [kurulum(t0)] }), t0);
  kontrol("§1b bitiş = şimdi → SALT_OKUNUR, bitiş anı kira bitişi", bitti.phase === "SALT_OKUNUR" && bitti.endedAt?.getTime() === t0);
  const sinir = t0 + READ_ONLY_DAYS * GUN;
  kontrol("§1c 90. günden 1 ms önce SALT_OKUNUR (pozitif sınır)", serviceState(f({ installations: [kurulum(t0)] }), sinir - 1).phase === "SALT_OKUNUR");
  kontrol("§1d tam 90. gün KAPALI (negatif sınır)", serviceState(f({ installations: [kurulum(t0)] }), sinir).phase === "KAPALI");
  const iki = serviceState(f({ installations: [kurulum(t0 - 5 * GUN), kurulum(t0 - 2 * GUN)] }), t0);
  kontrol("§1e birden çok kurulum: bitiş = en genç geçmiş bitiş", iki.endedAt?.getTime() === t0 - 2 * GUN);
  const pasif = serviceState(f({ status: "PASIF" }), t0);
  kontrol("§1f tesis PASIF (abonelik sürerken) → SALT_OKUNUR, bitiş şimdi", pasif.phase === "SALT_OKUNUR" && pasif.endedAt?.getTime() === t0);
  const donmus = serviceState(f({ serviceEndedAt: new Date(t0 - 100 * GUN), installations: [kurulum(null, { modules: [] })] }), t0);
  kontrol("§1g hak düştü (bitiş NULL) → donmuş damga süreyi taşır (KAPALI)", donmus.phase === "KAPALI" && donmus.endedAt?.getTime() === t0 - 100 * GUN);
  kontrol("§1h damgasız hak düşmesi → bitiş şimdi (süre sayılmaya başlar)", serviceState(f({ installations: [kurulum(null, { modules: [] })] }), t0).endedAt?.getTime() === t0);
  kontrol("§1i pasif kurulum sözleşmeyi açık tutmaz", serviceState(f({ installations: [kurulum(t0 + GUN, { active: false })] }), t0).phase === "SALT_OKUNUR");
}

async function paketGonder(o: Ortam, k: TestKurulumu, ad: string): Promise<{ siparisId: string; cariId: string }> {
  const ufuk = new Date(o.saat.simdi() - 60_000);
  const w = { t: ufuk.toISOString(), k: "000000000001" };
  const siparisId = randomUUID();
  const cariId = randomUUID();
  const kayitlar = [
    girdi("siparis", { yaz: [{ id: siparisId, siparisNo: `S-${ad}`, durum: "ACIK", siparisTarihi: ufuk.toISOString() }], yeni: w }),
    girdi("siparis.finans", { yaz: [{ id: siparisId, tutar: "1250.50" }], yeni: w }),
    girdi("cari-kart", { yaz: [{ id: cariId, ad: `=HYPERLINK("x") ${ad}`, kod: `C-${ad}` }], yeni: w }),
    girdi("cari-kart.kisisel", { yaz: [{ id: cariId, yetkili: "Ayşe Yılmaz", telefon: "0555 000 00 00" }], yeni: w }),
  ];
  const anliklar = [{ projeksiyon: "ozet.siparis", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: { acikSiparis: 3 } }];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk, kayitlar, anliklar }) });
  if (r.status !== 200 || (r.json as unknown as { ret: unknown[] }).ret.length > 0) throw new Error(`fikstür paketi: ${r.status} ${JSON.stringify(r.json)}`);
  return { siparisId, cariId };
}

/** Ham bayt da döner: `Response.text()` UTF-8 BOM'unu yutar, BOM ölçümü baytla yapılır. */
async function indir(o: Ortam, belirtec: string, yol: string): Promise<{ status: number; text: string; bom: boolean; headers: Headers }> {
  const res = await fetch(`${o.adres}${yol}`, { headers: { Authorization: `Bearer ${belirtec}` } });
  const bytes = Buffer.from(await res.arrayBuffer());
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { status: res.status, text: bytes.subarray(bom ? 3 : 0).toString("utf8"), bom, headers: res.headers };
}

async function damga(o: Ortam, k: TestKurulumu): Promise<void> {
  console.log("\n§2 damga — tek yazar");
  const bitis = o.saat.simdi() + 2 * GUN;
  await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.installation.update({ where: { installationId: k.kurulumId }, data: { cloudUntil: new Date(bitis) } }));
  kontrol("§2a açıkken damga yazılmaz", (await refreshServiceEnd(o.ctx, k.tesisId, o.saat.simdi())) === null);
  o.saat.ayarla(bitis + 60_000);
  kontrol("§2b kapanınca DAMGALANDI", (await refreshServiceEnd(o.ctx, k.tesisId, o.saat.simdi())) === "DAMGALANDI");
  const f = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.facility.findUnique({ where: { tesisId: k.tesisId } }));
  kontrol("§2c damga = kira bitişi (gözlem anı değil)", f?.serviceEndedAt?.getTime() === bitis, f?.serviceEndedAt?.toISOString());
  kontrol("§2d tekrar tur etkisiz", (await refreshServiceEnd(o.ctx, k.tesisId, o.saat.simdi())) === null);
  const iz = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.accountAudit.count({ where: { tesisId: k.tesisId, event: "HIZMET_SONA_ERDI" } }));
  kontrol("§2e ayak izi HIZMET_SONA_ERDI (bir kez)", iz === 1);
}

async function saltOkunur(o: Ortam, k: TestKurulumu, yonetici: { belirtec: string; eposta: string; sir: string }): Promise<void> {
  console.log("\n§3 SALT_OKUNUR — okuma açık, yazma kapalı");
  const oturum = await api(o, "GET", "/api/oturum", { belirtec: yonetici.belirtec });
  const hizmet = (oturum.json.data as { hizmet: { asama: string; saltOkunurBitis: string } }).hizmet;
  kontrol("§3a oturum şeridi: aşama SALT_OKUNUR + salt okuma bitişi", hizmet.asama === "SALT_OKUNUR" && Date.parse(hizmet.saltOkunurBitis) > o.saat.simdi(), JSON.stringify(hizmet));
  const oku = await api(o, "GET", "/api/veri/siparis", { belirtec: yonetici.belirtec });
  kontrol("§3b veri okuma AÇIK", oku.status === 200 && (oku.json.data as { kayitlar: unknown[] }).kayitlar.length === 1);
  const yaz = await api(o, "POST", "/api/gelen-kutusu", { belirtec: yonetici.belirtec, govde: { mesajId: randomUUID(), tur: "CARI", govde: { ad: "Yeni Cari", roller: { musteri: true, tedarikci: false } } } });
  kontrol("§3c gelen kutusu yazması 403 PATRON_BULUT_KAPALI (aşama detayda)", yaz.status === 403 && yaz.json.details?.code === "PATRON_BULUT_KAPALI" && yaz.json.details?.asama === "SALT_OKUNUR", JSON.stringify(yaz.json.details));
  const rapor = await api(o, "POST", "/api/raporlar", { belirtec: yonetici.belirtec, govde: { clientToken: randomUUID(), raporAnahtari: "sales/order-intake", parametreler: {} } });
  kontrol("§3d rapor isteği 403", rapor.status === 403 && rapor.json.details?.code === "PATRON_BULUT_KAPALI");
  const fabrika = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() - 60_000) }) });
  kontrol("§3e fabrika kanalı 403 (eşitleme durdu)", fabrika.status === 403 && fabrika.json.details?.code === "PATRON_BULUT_KAPALI");
  const giris = await girisYap(o, yonetici).then(() => true, () => false);
  kontrol("§3f giriş AÇIK (salt okuma süresince)", giris);
}

async function pasifTesis(o: Ortam): Promise<void> {
  console.log("\n§3' tesis kapanışı (PASIF) abonelik sürerken");
  const k = await tesisKur(o);
  try {
    const h = await hesapKur(o, k.tesisId, TUM_OKUMA);
    const once = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() - 60_000) }) });
    kontrol("§3g kapanıştan önce fabrika kanalı açık (kontrol)", once.status === 200, String(once.status));
    await setFacilityStatus(o.goc, { tesisId: k.tesisId, status: "PASIF" });
    const sonra = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk: new Date(o.saat.simdi() - 30_000) }) });
    kontrol("§3h tesis PASIF → fabrika kanalı 403 (kira hâlâ geçerli olsa da)", sonra.status === 403 && sonra.json.details?.code === "PATRON_BULUT_KAPALI", String(sonra.status));
    const oturum = await api(o, "GET", "/api/oturum", { belirtec: h.belirtec });
    kontrol("§3i tesis PASIF → oturum salt okunur sürer (eskiden tamamen kapanıyordu)", oturum.status === 200 && (oturum.json.data as { hizmet: { asama: string } }).hizmet.asama === "SALT_OKUNUR");
  } finally {
    await temizleTesis(o, k.tesisId);
  }
}

async function kapali(o: Ortam, k: TestKurulumu, yonetici: { belirtec: string; eposta: string; sir: string }): Promise<void> {
  console.log("\n§4 KAPALI — 90. gün sınırı");
  const f = await withTesis(o.goc, { tesisId: k.tesisId }, (tx) => tx.facility.findUnique({ where: { tesisId: k.tesisId } }));
  const sinir = f!.serviceEndedAt!.getTime() + READ_ONLY_DAYS * GUN;
  // Oturumun kendi ömrü (30 gün) aşımı karıştırmasın: sınırdan hemen önce taze giriş (giriş saati 31 sn ilerletir).
  o.saat.ayarla(sinir - 60_000);
  const taze = await girisYap(o, yonetici);
  o.saat.ayarla(sinir - 1_000);
  const once = await api(o, "GET", "/api/oturum", { belirtec: taze });
  kontrol("§4a sınırdan 1 sn önce oturum AÇIK (pozitif)", once.status === 200, String(once.status));
  o.saat.ayarla(sinir);
  const sonra = await api(o, "GET", "/api/oturum", { belirtec: taze });
  kontrol("§4b tam 90. gün: oturum 401 (negatif)", sonra.status === 401 && sonra.json.details?.code === "OTURUM_YOK", String(sonra.status));
  const disa = await indir(o, taze, "/api/disa-aktar/siparis");
  kontrol("§4c KAPALI'da dışa aktarma da kapalı (401)", disa.status === 401);
  o.saat.ilerlet(31_000);
  const g = await api(o, "POST", "/api/oturum/ac", { govde: { eposta: yonetici.eposta, parola: TEST_PAROLASI, totp: totpKodu(yonetici.sir, o.saat.simdi()) } });
  kontrol("§4d giriş 403 HIZMET_KAPANDI", g.status === 403 && g.json.details?.code === "HIZMET_KAPANDI", `${g.status} ${g.json.details?.code}`);
}

async function disaAktarma(o: Ortam, a: TestKurulumu, ids: { siparisId: string }, yonetici: { belirtec: string }, sinirli: { belirtec: string }, digerAd: string): Promise<void> {
  console.log("\n§5 dışa aktarma");
  const m = await api(o, "GET", "/api/disa-aktar", { belirtec: yonetici.belirtec });
  const kumeler = (m.json.data as { kumeler: { ad: string; tur: string; adet: number; bicimler: string[] }[] }).kumeler;
  const ad = (x: string) => kumeler.find((k) => k.ad === x);
  kontrol("§5a manifest: siparis (1) · cari-kart · ozet.siparis yalnız JSON · bulut kümeleri", ad("siparis")?.adet === 1 && !!ad("cari-kart") && JSON.stringify(ad("ozet.siparis")?.bicimler) === '["json"]' && ["gelen-kutusu", "hesaplar", "hesap-denetimi"].every((x) => ad(x)?.tur === "BULUT"), kumeler.map((k) => `${k.ad}:${k.adet}`).join(" "));
  kontrol("§5b manifest alt satırı ayrı küme saymaz", !kumeler.some((k) => k.ad.includes(".finans") || k.ad.includes(".kisisel")));
  const json = await indir(o, yonetici.belirtec, "/api/disa-aktar/siparis?bicim=json");
  const govde = JSON.parse(json.text) as { kume: string; tesisId: string; kayitlar: { id: string; kayit: { siparisNo: string }; finans?: { tutar: string } }[] };
  kontrol("§5c JSON: tek kayıt + finans alt satırı (yetkili yönetici)", json.status === 200 && govde.kume === "siparis" && govde.kayitlar.length === 1 && govde.kayitlar[0]!.finans?.tutar === "1250.50" && govde.kayitlar[0]!.id === ids.siparisId);
  kontrol("§5d dosya olarak iner (Content-Disposition ek + no-store)", /attachment; filename="patron-.*-siparis-.*\.json"/.test(json.headers.get("content-disposition") ?? "") && json.headers.get("cache-control") === "no-store");
  const csv = await indir(o, yonetici.belirtec, "/api/disa-aktar/siparis?bicim=csv");
  const satirlar = csv.text.split("\r\n");
  kontrol("§5e CSV: BOM + başlık (id · alanlar · finans.* · surum) + 1 satır", csv.bom && satirlar[0] === "id,durum,siparisNo,siparisTarihi,finans.tutar,surum" && satirlar.filter((l) => l.length > 0).length === 2, satirlar[0]);
  const cari = await indir(o, yonetici.belirtec, "/api/disa-aktar/cari-kart?bicim=csv");
  kontrol("§5f CSV formül enjeksiyonu önlendi (= ile başlayan metin ' önekli)", cari.text.includes(`"'=HYPERLINK(""x"") `), cari.text.split("\r\n")[1]);
  const sinirliCsv = await indir(o, sinirli.belirtec, "/api/disa-aktar/siparis?bicim=csv");
  const sinirliJson = await indir(o, sinirli.belirtec, "/api/disa-aktar/siparis?bicim=json");
  kontrol("§5g fiyat izni olmayan yönetici: CSV'de finans.* YOK, JSON'da finans YOK (RLS)", sinirliCsv.status === 200 && !sinirliCsv.text.split("\r\n")[0]!.includes("finans.") && !sinirliJson.text.includes("1250.50"), sinirliCsv.text.split("\r\n")[0]);
  kontrol("§5h başka tesisin verisi dökümde YOK", !json.text.includes(digerAd) && !csv.text.includes(digerAd) && !cari.text.includes(digerAd));
  kontrol("§5i alt satır doğrudan istenemez (404)", (await indir(o, yonetici.belirtec, "/api/disa-aktar/siparis.finans")).status === 404);
  kontrol("§5j bilinmeyen küme 404", (await indir(o, yonetici.belirtec, "/api/disa-aktar/yok-boyle")).status === 404);
  kontrol("§5k anlık özet CSV istenemez (400)", (await indir(o, yonetici.belirtec, "/api/disa-aktar/ozet.siparis?bicim=csv")).status === 400);
  const anlik = JSON.parse((await indir(o, yonetici.belirtec, "/api/disa-aktar/ozet.siparis")).text) as { veri: { acikSiparis: number } };
  kontrol("§5l anlık özet JSON", anlik.veri.acikSiparis === 3);
  const hesaplar = await indir(o, yonetici.belirtec, "/api/disa-aktar/hesaplar?bicim=json");
  kontrol("§5m hesaplar sırsız (parola/TOTP/davet alanı yok)", hesaplar.status === 200 && !/password|totp|invite|parola|sirri|belirtec/i.test(hesaplar.text), hesaplar.text.slice(0, 120));
  const yetkisiz = await api(o, "GET", "/api/disa-aktar", { belirtec: (await hesapKur(o, a.tesisId, ["bulut:siparis:oku"])).belirtec });
  kontrol("§5n hesap yöneticisi olmayan 403", yetkisiz.status === 403 && yetkisiz.json.details?.code === "YETKISIZ");
  const iz = await withTesis(o.goc, { tesisId: a.tesisId }, (tx) => tx.accountAudit.count({ where: { tesisId: a.tesisId, event: "DISA_AKTARIM" } }));
  kontrol("§5o her tamamlanan döküm ayak izi (DISA_AKTARIM)", iz >= 6, String(iz));
}

async function imha(o: Ortam, a: TestKurulumu, b: TestKurulumu): Promise<void> {
  console.log("\n§6 imha (satıcı CLI servisi)");
  const red = async (fn: () => Promise<unknown>) => fn().then(() => "gecti", (e: Error & { code?: string }) => e.code ?? e.message);
  const merkez = o.goc.centralClient;
  kontrol("§6a hizmet ACIK iken imha RED — yazılı erken talep olsa BİLE (başka tesis)", (await red(() => destroyFacility(o.goc, { tesisId: b.tesisId, operator: "Bekçi", earlyRequestRef: "YAZI-ACIK", apply: false }, o.saat.simdi()))) === "DURUM_CAKISMASI");
  const saymaB = async () => withTesis(o.goc, { tesisId: b.tesisId }, async (tx) => (await tx.projectionRow.count({ where: { tesisId: b.tesisId } })) + (await tx.account.count({ where: { tesisId: b.tesisId } })));
  const bOnce = await saymaB();
  const f = await withTesis(o.goc, { tesisId: a.tesisId }, (tx) => tx.facility.findUnique({ where: { tesisId: a.tesisId } }));
  o.saat.ayarla(f!.serviceEndedAt!.getTime() + 10 * GUN);
  kontrol("§6b SALT_OKUNUR'da talepsiz imha RED", (await red(() => destroyFacility(o.goc, { tesisId: a.tesisId, operator: "Bekçi", apply: true }, o.saat.simdi()))) === "DURUM_CAKISMASI");
  const kuru = await destroyFacility(o.goc, { tesisId: a.tesisId, operator: "Bekçi", earlyRequestRef: "YAZI-2026-01", apply: false }, o.saat.simdi());
  const hala = await withTesis(o.goc, { tesisId: a.tesisId }, (tx) => tx.projectionRow.count({ where: { tesisId: a.tesisId } }));
  kontrol("§6c talepli KURU KOŞUM: sayar, silmez", !kuru.applied && (kuru.counts.projection_rows ?? 0) > 0 && hala === kuru.counts.projection_rows && kuru.reason === "ERKEN_TALEP");
  const destekId = randomUUID();
  await destekKaydi(tesisUrl(o, a.tesisId, "goc"), a.tesisId, destekId);
  o.saat.ayarla(f!.serviceEndedAt!.getTime() + READ_ONLY_DAYS * GUN);
  const db = o.goc.databaseFor(a.tesisId);
  const r = await destroyFacility(o.goc, { tesisId: a.tesisId, operator: "Bekçi Operatör", apply: true }, o.saat.simdi());
  const iz = await imhaIzi(o, a.tesisId, db);
  kontrol("§6d KAPALI'da uygula: tesis DB'si ve üç rolü YOK, durum IMHA_EDILDI, yönlendirme satırları silindi", r.applied && r.reason === "SURE_DOLDU" && iz.db === 0 && iz.rol === 0 && iz.durum === "IMHA_EDILDI" && iz.yon === 0, JSON.stringify(iz));
  const bulunamadi = await red(() => withTesis(o.app, { tesisId: a.tesisId }, (tx) => tx.facility.count()));
  const fabrika = await imzali(o, a, "/v1/esitle", { govde: paket(a, { ufuk: new Date(o.saat.simdi() - 60_000) }) });
  kontrol("§6d2 imha edilen tesis merkeze DÜŞMEZ: dizin önbelleği bayatken bile kiracı kapsamı 404 (bağlantı hatası değil), fabrika kanalı 4xx", bulunamadi === "BULUNAMADI" && fabrika.status >= 400 && fabrika.status < 500, `${bulunamadi} · ${fabrika.status}`);
  kontrol("§6e başka tesis dokunulmadı", (await saymaB()) === bOnce);
  const kayit = await merkez.facilityDestruction.findFirst({ where: { tesisId: a.tesisId } });
  kontrol("§6f imha kaydı MERKEZDE: neden · işleyen · sayılar · yedekten düşme (+35 gün)", kayit?.id === r.recordId && kayit.reason === "SURE_DOLDU" && kayit.operator === "Bekçi Operatör" && (kayit.deletedCounts as Record<string, number>).facilities === 1 && kayit.backupClearBy.getTime() === o.saat.simdi() + 35 * GUN);
  const c = new Client({ connectionString: process.env.GOC_DATABASE_URL!, options: "-c timezone=UTC" });
  await c.connect();
  try {
    const guncelle = await c.query("UPDATE facility_destructions SET operator = 'x' WHERE tesis_id = $1", [a.tesisId]).then(() => "gecti", (e: Error) => e.message);
    const sil = await c.query("DELETE FROM facility_destructions WHERE tesis_id = $1", [a.tesisId]).then(() => "gecti", (e: Error) => e.message);
    kontrol("§6g imha kaydı DEĞİŞTİRİLEMEZ ve SİLİNEMEZ (tablo sahibi dahil)", /değiştirilemez/.test(guncelle) && /değiştirilemez/.test(sil), `${guncelle.slice(0, 50)} | ${sil.slice(0, 50)}`);
  } finally {
    await c.end();
  }
  const destek = await merkez.supportAccess.findUnique({ where: { id: destekId } });
  kontrol("§6h destek erişim kaydı merkeze kopyalandı (SİLİNEMEZ kayıt imhada KALIR)", destek?.tesisId === a.tesisId && destek.ticket === "DESTEK-BEKCI");
  const ikinci = await red(() => destroyFacility(o.goc, { tesisId: a.tesisId, operator: "Bekçi", apply: true }, o.saat.simdi()));
  kontrol("§6i ikinci uygula 409, ikinci tutanak YOK", ikinci === "DURUM_CAKISMASI" && (await merkez.facilityDestruction.count({ where: { tesisId: a.tesisId } })) === 1, ikinci);
  await yaridaKalan(o);
}

/** Destek erişim kaydı (göç rolü doğrudan; `destek_ac` oturuma bağlı izin açar, burada yalnız satır gerekir). */
async function destekKaydi(url: string, tesisId: string, id: string): Promise<void> {
  const c = new Client({ connectionString: url, options: "-c timezone=UTC" });
  await c.connect();
  try {
    await c.query("SELECT set_config('app.tesis_id', $1, false)", [tesisId]);
    await c.query(
      "INSERT INTO support_access (id, tesis_id, db_user, pid, backend_start, ticket, reason, scope, expires_at, closed_at, close_reason) VALUES ($1, $2, 'bekci_destek', 1, now(), 'DESTEK-BEKCI', 'bekçi', 'siparis', now() + interval '1 hour', now(), 'KAPATILDI')",
      [id, tesisId],
    );
  } finally {
    await c.end();
  }
}

async function imhaIzi(o: Ortam, tesisId: string, db: string): Promise<{ db: number; rol: number; durum: string | undefined; yon: number }> {
  const merkez = o.goc.centralClient;
  const n = async (q: string, p: unknown[]) => (await merkez.$queryRawUnsafe<{ n: number }[]>(q, ...p))[0]!.n;
  return {
    db: await n("SELECT count(*)::int AS n FROM pg_database WHERE datname = $1", [db]),
    rol: await n("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ($1, $2, $3)", [`${db}_uyg`, `${db}_esit`, `${db}_destek`]),
    durum: (await merkez.facilityDatabase.findUnique({ where: { tesisId } }))?.status,
    yon: (await merkez.installationRoute.count({ where: { tesisId } })) + (await merkez.loginRoute.count({ where: { tesisId } })),
  };
}

/** §6j yarıda kalan imha (claim yazıldı, DB düşmedi): aynı komut planla tamamlar, tutanak plandaki kimlikle. */
async function yaridaKalan(o: Ortam): Promise<void> {
  const c = await tesisKur(o);
  try {
    const merkez = o.goc.centralClient;
    const recordId = randomUUID();
    const plan = { recordId, facilityName: "Yarıda", phase: "KAPALI", serviceEndedAt: new Date(o.saat.simdi() - GUN).toISOString(), readOnlyUntil: new Date(o.saat.simdi()).toISOString(), reason: "SURE_DOLDU", requestRef: null, operator: "Bekçi Yarıda", backupClearBy: new Date(o.saat.simdi() + 35 * GUN).toISOString(), counts: null };
    await merkez.facilityDatabase.updateMany({ where: { tesisId: c.tesisId, status: "HAZIR" }, data: { status: "IMHA_SURUYOR", destructionPlan: plan } });
    o.goc.invalidate(c.tesisId);
    const kuru = await destroyFacility(o.goc, { tesisId: c.tesisId, operator: "Başkası", apply: false }, o.saat.simdi());
    const db = o.goc.databaseFor(c.tesisId);
    const once = await imhaIzi(o, c.tesisId, db);
    kontrol("§6j1 yarıda kalan imhada kuru koşum hiçbir şey yapmaz", !kuru.applied && once.db === 1 && once.durum === "IMHA_SURUYOR", JSON.stringify(once));
    const r = await destroyFacility(o.goc, { tesisId: c.tesisId, operator: "Başkası", apply: true }, o.saat.simdi());
    const iz = await imhaIzi(o, c.tesisId, db);
    const kayit = await merkez.facilityDestruction.findMany({ where: { tesisId: c.tesisId } });
    kontrol("§6j2 aynı komut kaldığı yerden tamamlar (kapı yeniden sorulmaz; plan + plandaki kimlik)", r.applied && r.recordId === recordId && iz.db === 0 && iz.rol === 0 && iz.durum === "IMHA_EDILDI" && kayit.length === 1 && kayit[0]!.operator === "Bekçi Yarıda" && (kayit[0]!.deletedCounts as Record<string, number>).facilities === 1, JSON.stringify(iz));
  } finally {
    await temizleTesis(o, c.tesisId);
  }
}

async function main(): Promise<void> {
  saf();
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  try {
    const yonetici = await hesapKur(o, a.tesisId, TUM_OKUMA);
    const sinirli = await hesapKur(o, a.tesisId, ["bulut:siparis:oku", "bulut:hesap:yonet"]);
    const ids = await paketGonder(o, a, "tesisA");
    await paketGonder(o, b, "tesisB-GIZLI");
    const mesaj = await api(o, "POST", "/api/gelen-kutusu", { belirtec: yonetici.belirtec, govde: { mesajId: randomUUID(), tur: "CARI", govde: { ad: "Açıkken Cari", roller: { musteri: true, tedarikci: false } } } });
    kontrol("§0 hizmet açıkken gelen kutusu yazılır (kontrol)", mesaj.status === 201, String(mesaj.status));
    await disaAktarma(o, a, ids, yonetici, sinirli, "tesisB-GIZLI");
    await damga(o, a);
    await saltOkunur(o, a, yonetici);
    await pasifTesis(o);
    await imha(o, a, b);
    await kapali(o, b, await hesapKapaliIcin(o, b));
  } finally {
    await temizleTesis(o, a.tesisId);
    await temizleTesis(o, b.tesisId);
    await o.kapat();
  }
  sonuc();
}

/** B tesisini kapanışa götür (kira bitişi geçmiş + damga) ve bir yönetici oturumu aç. */
async function hesapKapaliIcin(o: Ortam, b: TestKurulumu) {
  const h = await hesapKur(o, b.tesisId, TUM_OKUMA);
  await withTesis(o.goc, { tesisId: b.tesisId }, (tx) => tx.installation.update({ where: { installationId: b.kurulumId }, data: { cloudUntil: new Date(o.saat.simdi() - 1_000) } }));
  await refreshServiceEnd(o.ctx, b.tesisId, o.saat.simdi());
  return h;
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
