// =============================================================================
// GÜNCELLEME DALGASI (F1a — docs/design/GUNCELLEYICI-SAGLAMLIK.md §6.2 · TK-13 · AK-2): grup içinde kademeli backend
// yayılımı, aşamalar ELLE; güncelleyici ve tel sözleşmesi DEĞİŞMEZ (var olan `hedefSurum` alanı).
//   §1 saf: kova belirlenimli ve 0–99 · üyelik aşamayla tekdüze (0 kimse, 3 herkes) · küçük grupta "en az bir kurulum"
//      · etkin hedef = min(sabitleme, tavan) · kira alanı tavanı taşır · güncelleyicinin VAR OLAN kararı tavanı
//      HEDEF_ULASILDI / HEDEF_DISI ile uygular (karar kodu değişmeden) · sayaç/uyarı eşikleri (≥ 2 ya da ≥ %10;
//      sonuç < %80 → ek onay)
//   §2 servis (DB): dalgasız grup tavansız (bugünkü davranış) · yalnız `genel`de açılır · aşama 0 = herkes yerleşik
//      sürümde (durdur) · ilerlet (atomik claim; yanlış beklenen 409; eşzamanlı iki karardan biri 409) · üyeler dalga
//      sürümünde, diğerleri yerleşikte · zil yalnız tavanı değişene · eşikte UYARI (dalga × aşama başına bir kez;
//      tarama tekrarı yeni satır doğurmaz) ama aşama/tavan DEĞİŞMEZ · uyarı açıkken ilerletme ek onay ister ·
//      geri çek 0 → herkes yerleşikte · defter satırları değişmez (tetikleyici) · DB CHECK aralık/yön seddi
//   §3 uçtan uca (gerçek sunucu + portal): etkinleşen kurulumun kirası tavanı taşır · portal uçları (aç · ilerlet ·
//      işlem kimliği tekrarı tek defter satırı · ek onay · izin/oturum) · yoklamanın GERI_DONDU raporu uyarıyı HEMEN yazar
// ⭐ KALICI SONDA ✓K (her koşumda): üyelik yüklemi küçük grupta tek kurulumu SEÇER (kör "kimse" değil) · eşik
//    karşılaştırıcısı tek hatada (20 kurulumda) SUSAR, ikincide ISIRIR.
// NEGATİF SONDA (dosya dışı, kod bozulup geri alındı): N1 `isWaveMember` "en az bir" kuralı silindi → §1c ❌ · N2 beklenen
//    aşama denetimi + claim WHERE'inden aşama çıkarıldı → §2g/§2h/§2i ❌ · N3 uyarı aşamayı 0'a çekti → §2m/§2o ❌ ·
//    N4 kira tavanı `leaseUpdatePolicy`ye geçirmedi → §3d/§3e/§3j ❌.
// Koşum: npx tsx scripts/test_guncelleme_dalgasi.ts   (yalnız *_test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { ENDPOINTS, LeaseSchema, decideUpdate, parseJws, type LeaseDoc, type ReleaseManifest } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { effectiveTarget, leaseUpdatePolicy } from "../src/services/update-policy.service";
import {
  WAVE_MAX_STAGE,
  entryStage,
  isWaveMember,
  tallyWave,
  waveBucket,
  type WaveInstallation,
  type WaveMemberRow,
} from "../src/services/update-wave.service";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  temizlePortal,
  yoklamaGovdesi,
  type Yanit,
} from "./lib/test-ortam";

const P = "2.12.0";
const N = "2.13.0";

function hataKodu(e: unknown): string {
  return (e as { code?: string }).code ?? "ATILDI";
}

async function hata(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return hataKodu(e);
  }
}

/** Kovası eşiğin ALTINDA olmayan n kurulum (küçük grup sondası). */
function kovasiBuyukler(n: number, alt: number): WaveInstallation[] {
  const out: WaveInstallation[] = [];
  while (out.length < n) {
    const k = randomUUID();
    if (waveBucket(k) >= alt) out.push({ id: randomUUID(), kurulumId: k });
  }
  return out;
}

const POLITIKA = { guncellemeKipi: "OTOMATIK" as const, guncellemePencereBaslangic: null, guncellemePencereBitis: null, guncellemePencereGunleri: [], guncellemeHedefSurum: null, saatDilimi: null };

function uye(sonuc: WaveMemberRow["sonuc"], dalgada = true, giris = 1): WaveMemberRow {
  return { id: randomUUID(), kurulumId: randomUUID(), kova: 0, girisAsamasi: giris, dalgada, kuruluSurum: null, sonuc, kaynak: null };
}

function saf(): void {
  console.log("\n§1 saf — kova · üyelik · tavan · karar · eşik");
  const ids = Array.from({ length: 2000 }, () => randomUUID());
  const kovalar = ids.map(waveBucket);
  const alt10 = kovalar.filter((b) => b < 10).length;
  kontrol("§1a kova belirlenimli, 0–99, %10'luk dilime ~%10 düşer", ids.every((k, i) => waveBucket(k) === kovalar[i]) && kovalar.every((b) => b >= 0 && b <= 99) && alt10 > 120 && alt10 < 280, `${alt10}/2000`);
  const kume = ids.slice(0, 300).map((k) => ({ id: k, kurulumId: k }));
  const say = (s: number) => kume.filter((i) => isWaveMember(i, s, kume)).length;
  const tekduze = kume.every((i) => [0, 1, 2].every((s) => !isWaveMember(i, s, kume) || isWaveMember(i, s + 1, kume)));
  kontrol("§1b aşama 0 kimse · 3 herkes · üyelik aşamayla tekdüze (dalgadan düşen yok)", say(0) === 0 && say(WAVE_MAX_STAGE) === kume.length && tekduze && say(1) < say(2), `${say(1)} → ${say(2)} → ${say(3)}`);
  const kucuk = kovasiBuyukler(3, 10);
  const secilen = kucuk.filter((i) => isWaveMember(i, 1, kucuk));
  const enKucuk = [...kucuk].sort((a, b) => waveBucket(a.kurulumId) - waveBucket(b.kurulumId) || (a.kurulumId < b.kurulumId ? -1 : 1))[0]!;
  kontrol("§1c ✓K küçük grup (eşik altında kimse yok): aşama 1'de TEK kurulum — en küçük kovalı", secilen.length === 1 && secilen[0]!.id === enKucuk.id && entryStage(enKucuk, kucuk) === 1);
  kontrol("§1d etkin hedef = min(sabitleme, tavan); ikisi de yoksa sınırsız",
    effectiveTarget(null, null) === null && effectiveTarget(null, P) === P && effectiveTarget("2.11.0", P) === "2.11.0" && effectiveTarget("2.14.0", P) === P && effectiveTarget(N, null) === N);
  const t0 = Date.parse("2026-10-08T00:00:00.000Z");
  const varsayilan = leaseUpdatePolicy({ ...POLITIKA, guncellemeKipi: "ONAYLI" }, t0, t0 + 86_400_000);
  const tavanli = leaseUpdatePolicy({ ...POLITIKA, guncellemeKipi: "ONAYLI" }, t0, t0 + 86_400_000, P);
  const sabitli = leaseUpdatePolicy({ ...POLITIKA, guncellemeKipi: "ONAYLI", guncellemeHedefSurum: "2.11.5" }, t0, t0 + 86_400_000, N);
  kontrol("§1e kira alanı: tavansız = bugünkü (hedef yok) · tavan → hedefSurum · sabitleme tavandan küçükse sabitleme", varsayilan.hedefSurum === null && tavanli.hedefSurum === P && sabitli.hedefSurum === "2.11.5");
  const aday = { surum: N, minKaynakSurum: null } as unknown as ReleaseManifest;
  const karar = (kurulu: string, hedef: string | null) =>
    decideUpdate({ politika: { kip: "OTOMATIK", pencere: null, araliklar: [], hedefSurum: hedef }, guncellemeDonuk: false, bakimBitisMs: null, kuruluSurum: kurulu, pg: null, aday, onay: null, nowMs: t0 });
  const ulasti = karar(P, P);
  const disi = karar("2.11.0", P);
  const dalgada = karar(P, N);
  kontrol("§1f güncelleyicinin VAR OLAN kararı: dalga dışı yerleşikte GUNCEL/HEDEF_ULASILDI · eskide UYGUN_DEGIL/HEDEF_DISI · dalgada hedef engeli yok",
    ulasti.karar === "GUNCEL" && ulasti.neden === "HEDEF_ULASILDI" && disi.karar === "UYGUN_DEGIL" && disi.neden === "HEDEF_DISI" && dalgada.neden !== "HEDEF_DISI" && dalgada.neden !== "HEDEF_ULASILDI",
    `${ulasti.neden} · ${disi.neden} · ${dalgada.karar}/${dalgada.neden}`);
  const yirmi = (hatali: number) => [...Array.from({ length: hatali }, () => uye("GERI_DONDU")), ...Array.from({ length: 20 - hatali }, () => uye("TAMAMLANDI"))];
  const bir = tallyWave(yirmi(1));
  const iki = tallyWave(yirmi(2));
  kontrol("§1g ✓K eşik: 20 kurulumda 1 hata SUSAR (%5 < %10), 2 hata ISIRIR (≥ 2)", !bir.uyariAcik && iki.uyariAcik && iki.hata === 2);
  const bes = tallyWave([uye("BASARISIZ"), uye("TAMAMLANDI"), uye("TAMAMLANDI"), uye("TAMAMLANDI"), uye("TAMAMLANDI")]);
  kontrol("§1h eşik: 5 kurulumda 1 başarısız = %20 → uyarı", bes.uyariAcik && bes.hata === 1);
  const sessiz = tallyWave([uye("TAMAMLANDI"), uye("BEKLIYOR"), uye("BEKLIYOR"), uye("TAMAMLANDI"), uye("TAMAMLANDI")]);
  const yeterli = tallyWave([uye("TAMAMLANDI"), uye("TAMAMLANDI"), uye("TAMAMLANDI"), uye("TAMAMLANDI"), uye("BEKLIYOR")]);
  kontrol("§1i sonuç bildiren < %80 → ilerletme ek onay ister; %80'de istemez; dalga boşken istemez",
    sessiz.ilerletmeEkOnayIster && sessiz.bildirimYuzdesi === 60 && !yeterli.ilerletmeEkOnayIster && !tallyWave([uye("BEKLIYOR", false, 2)]).ilerletmeEkOnayIster);
  const asamali = tallyWave([uye("TAMAMLANDI", true, 1), uye("GERI_DONDU", true, 2), uye("BEKLIYOR", false, 3)]);
  kontrol("§1j aşama başına sayaç (giriş aşamasına göre)", asamali.asamalar[0]!.TAMAMLANDI === 1 && asamali.asamalar[1]!.GERI_DONDU === 1 && asamali.asamalar[2]!.BEKLIYOR === 1 && asamali.dalgada.kurulum === 2);
}

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];

interface Temizlik {
  kurulumlar: string[];
  kidler: string[];
  kullanicilar: string[];
  dalgalar: string[];
}

async function temizleDalgalar(prisma: Prisma, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL satici.defter_temizlik = 'test'`);
    await tx.bildirim.deleteMany({ where: { ilgiliKayit: { in: [...ids] }, olay: "GUNCELLEME_DALGA_UYARI" } });
    await tx.guncellemeDalgasiKaydi.deleteMany({ where: { dalgaId: { in: [...ids] } } });
    await tx.guncellemeDalgasi.deleteMany({ where: { id: { in: [...ids] } } });
    await tx.denetim.deleteMany({ where: { varlikId: { in: [...ids] } } });
  });
}

/** Etkin kurulum (doğrudan servis + DB; kira/anahtar yok) — üyelik ve sayaç kümesi için. */
async function etkinKurulum(prisma: Prisma, kanal: string, tz: Temizlik): Promise<{ id: string; kurulumId: string }> {
  const svc = await import("../src/services/entitlement.service");
  const m = await svc.createCustomer({ name: `Dalga Bekçi ${randomUUID().slice(0, 8)}`, actor: "bekci" });
  const t = await svc.createSite({ customerId: m.id, name: "Merkez", actor: "bekci" });
  const k = await svc.createInstallation({ siteId: t.id, licenseClass: "URETIM", channelCode: kanal, actor: "bekci" });
  tz.kurulumlar.push(k.id);
  const x = randomUUID().replace(/-/g, "").padEnd(43, "A").slice(0, 43);
  const parmakIzi = { f1: null, f2: null, f3: null, f4: null, f5: null };
  await prisma.kurulum.update({ where: { id: k.id }, data: { durum: "ETKIN", etkinlesmeZamani: new Date(), acikAnahtar: x, anahtarKimligi: `kur-${x}`, kabulEdilenParmakIzi: parmakIzi } });
  return { id: k.id, kurulumId: k.kurulumId };
}

async function sonucYaz(prisma: Prisma, kurulumDbId: string, olay: "GUNCELLEME_GERI_DONDU" | "GUNCELLEME_BASARISIZ" | "GUNCELLEME_BASARILI", surum: string): Promise<void> {
  const kayitId = randomUUID();
  await prisma.kurulumKaydi.create({ data: { kurulumId: kurulumDbId, olay, yapan: "guncelleyici", kaynakKayitId: kayitId, ayrinti: { kayitId, hedefSurum: surum, kaynakSurum: P, sonuc: olay.replace("GUNCELLEME_", "") } } });
}

async function servis(prisma: Prisma, tz: Temizlik): Promise<void> {
  console.log("\n§2 servis — aç · aşama · tavan · uyarı (DB)");
  const w = { ...(await import("../src/services/update-wave.service")), ...(await import("../src/services/update-wave-view.service")) };
  const onceki = await prisma.guncellemeDalgasi.count({ where: { kanalKodu: "genel" } });
  kontrol("§2- ön koşul: genel grubunda kalıntı dalga yok", onceki === 0, `${onceki}`);
  const kurulumlar: { id: string; kurulumId: string }[] = [];
  for (let i = 0; i < 12; i++) kurulumlar.push(await etkinKurulum(prisma, "genel", tz));
  const oncu = await etkinKurulum(prisma, "oncu", tz);
  const tavan = async (k: { id: string; kurulumId: string }, kanal = "genel") => w.waveCeilingFor(prisma, { ...k, kanalKodu: kanal });
  kontrol("§2a dalgasız grup → tavan YOK (bugünkü davranış)", (await tavan(kurulumlar[0]!)) === null && (await tavan(oncu, "oncu")) === null);

  const ac = (g: { kanal?: string; surum?: string; onceki?: string | null; sebep?: string }) =>
    prisma.$transaction((tx) => w.openWaveTx(tx, { channelCode: g.kanal ?? "genel", version: g.surum ?? N, previousVersion: g.onceki === undefined ? P : g.onceki, reason: g.sebep ?? "bekçi: dalga", actor: "bekci" }));
  kontrol("§2b öncü grubunda dalga açılmaz (400) · gerekçesiz açılmaz (400) · önceki ≥ sürüm reddedilir (400)",
    (await hata(() => ac({ kanal: "oncu" }))) === "GOVDE_GECERSIZ" && (await hata(() => ac({ sebep: "  " }))) === "GOVDE_GECERSIZ" && (await hata(() => ac({ onceki: N }))) === "GOVDE_GECERSIZ");
  const dalga = await ac({});
  tz.dalgalar.push(dalga.id);
  const acilis = await prisma.guncellemeDalgasiKaydi.findMany({ where: { dalgaId: dalga.id } });
  kontrol("§2c açılış: aşama 0, yerleşik sürüm materyalize, defterde DALGA_ACILDI", dalga.asama === 0 && dalga.oncekiSurum === P && acilis.length === 1 && acilis[0]!.olay === "DALGA_ACILDI");
  kontrol("§2d aynı sürüm ikinci kez → 409 · eski sürümle yeni dalga → 409", (await hata(() => ac({}))) === "DURUM_CAKISMASI" && (await hata(() => ac({ surum: "2.12.5", onceki: "2.12.1" }))) === "DURUM_CAKISMASI");
  const tavanlar = async () => Promise.all(kurulumlar.map((k) => tavan(k)));
  kontrol("§2e ⭐ aşama 0 = DURDUR: gruptaki herkes yerleşik sürümde (tavan P)", (await tavanlar()).every((t) => t === P));
  kontrol("§2f öncü grubu etkilenmez", (await tavan(oncu, "oncu")) === null);

  const ilerlet = (beklenen: number, onay = false) =>
    prisma.$transaction((tx) => w.advanceWaveTx(tx, { waveId: dalga.id, expectedStage: beklenen, reason: "bekçi: ilerlet", actor: "bekci", confirmed: onay }));
  kontrol("§2g yanlış beklenen aşama → 409 (atomik claim)", (await hata(() => ilerlet(1))) === "DURUM_CAKISMASI");
  const yaris = await Promise.allSettled([ilerlet(0), ilerlet(0)]);
  const kazanan = yaris.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof ilerlet>>>[];
  const kaybeden = yaris.filter((r) => r.status === "rejected").map((r) => hataKodu((r as PromiseRejectedResult).reason));
  kontrol("§2h ⭐ eşzamanlı iki 'ilerlet' → biri geçer, diğeri 409; defterde tek ILERLETILDI", kazanan.length === 1 && kaybeden.join() === "DURUM_CAKISMASI" &&
    (await prisma.guncellemeDalgasiKaydi.count({ where: { dalgaId: dalga.id, olay: "ASAMA_ILERLETILDI" } })) === 1, kaybeden.join());
  const kume = kurulumlar.map((k) => ({ id: k.id, kurulumId: k.kurulumId }));
  const uyeler = kume.filter((k) => isWaveMember(k, 1, kume));
  const t1 = await tavanlar();
  const dogru = kurulumlar.every((k, i) => t1[i] === (uyeler.some((u) => u.id === k.id) ? N : P));
  kontrol("§2i aşama 1: üyeler dalga sürümünde, diğerleri yerleşikte; en az bir üye", uyeler.length >= 1 && dogru, `${uyeler.length}/12 üye`);
  kontrol("§2j zil yalnız tavanı değişenlere", kazanan[0]!.value.zil === uyeler.length, `${kazanan[0]!.value.zil} zil`);

  const yabanci = uyeler[0]!;
  await sonucYaz(prisma, yabanci.id, "GUNCELLEME_GERI_DONDU", N);
  await sonucYaz(prisma, kurulumlar.find((k) => !uyeler.some((u) => u.id === k.id))!.id, "GUNCELLEME_BASARISIZ", N);
  await sonucYaz(prisma, kurulumlar[11]!.id, "GUNCELLEME_GERI_DONDU", "2.99.0");
  const tarama = await import("../src/notifications/scanner");
  const cfg = { silentHours: 24 * 365, dueDays: 0, silentClasses: [] };
  const ilk = await tarama.scanTimedNotifications(cfg, Date.now());
  const uyari = await prisma.bildirim.findMany({ where: { olay: "GUNCELLEME_DALGA_UYARI", ilgiliKayit: dalga.id } });
  const govde = (uyari[0]?.govde ?? {}) as Record<string, string | null>;
  kontrol("§2k ⭐ eşik (2 sorunlu; başka sürümün hatası sayılmaz) → tarama UYARI yazar: kanal başına bir satır, dalga × aşama anahtarı",
    ilk.waveAlert === 2 && uyari.length === 2 && uyari.every((u) => u.tekillikAnahtari === `GUNCELLEME_DALGA_UYARI:${dalga.id}:1`) && (govde.referans ?? "").includes("DURMADI"), `${ilk.waveAlert} · ${govde.konu}`);
  const ikinci = await tarama.scanTimedNotifications(cfg, Date.now());
  const anlik = await w.evaluateWaveAlert("genel");
  kontrol("§2l tarama/anlık değerlendirme tekrarı yeni satır doğurmaz", ikinci.waveAlert === 0 && anlik === 0);
  const sonra = await prisma.guncellemeDalgasi.findUniqueOrThrow({ where: { id: dalga.id } });
  const t2 = await tavanlar();
  kontrol("§2m ⭐ uyarı DURDURMAZ: aşama ve tavanlar aynen (AK-2)", sonra.asama === 1 && t2.every((t, i) => t === t1[i]));
  const detay = await w.waveDetail(prisma, dalga.id);
  kontrol("§2n sayaç: hata 2, uyarı açık, ilerletme ek onay ister", detay.sayac.hata === 2 && detay.sayac.uyariAcik && detay.sayac.ilerletmeEkOnayIster && detay.uyeler.length === 12);
  kontrol("§2o uyarı açıkken onaysız ilerletme → 400 IKINCI_ONAY_GEREKLI (aşama değişmez)", (await hata(() => ilerlet(1))) === "IKINCI_ONAY_GEREKLI" &&
    (await prisma.guncellemeDalgasi.findUniqueOrThrow({ where: { id: dalga.id } })).asama === 1);
  const onayli = await ilerlet(1, true);
  kontrol("§2p onaylı ilerletme → aşama 2, defter satırı ek onayı ve kararın ölçüsünü taşır", onayli.dalga.asama === 2 && onayli.kayit.ekOnay && (onayli.kayit.ayrinti as { hata?: number } | null)?.hata === 2);

  const geri = (beklenen: number, hedef?: number) =>
    prisma.$transaction((tx) => w.retreatWaveTx(tx, { waveId: dalga.id, expectedStage: beklenen, targetStage: hedef, reason: "bekçi: durdur", actor: "bekci" }));
  kontrol("§2q geri çek: hedef ≥ şimdiki → 400", (await hata(() => geri(2, 2))) === "GOVDE_GECERSIZ");
  const dur = await geri(2, 0);
  kontrol("§2r ⭐ aşama 0'a geri çek = DURDUR: herkes yerleşikte; defterde GERI_CEKILDI 2 → 0", dur.dalga.asama === 0 && dur.kayit.olay === "ASAMA_GERI_CEKILDI" && (await tavanlar()).every((t) => t === P));
  kontrol("§2s aşama 0'da yeni uyarı yazılmaz", (await w.evaluateWaveAlert("genel")) === 0);

  let defter = "DEGISTI";
  try {
    await prisma.guncellemeDalgasiKaydi.updateMany({ where: { dalgaId: dalga.id }, data: { sebep: "elle" } });
  } catch {
    defter = "RED";
  }
  kontrol("§2t defter satırı değiştirilemez (tetikleyici)", defter === "RED");
  let aralik = "YAZILDI";
  try {
    await prisma.guncellemeDalgasi.update({ where: { id: dalga.id }, data: { asama: 4 } });
  } catch {
    aralik = "RED";
  }
  let yon = "YAZILDI";
  try {
    await prisma.guncellemeDalgasiKaydi.create({ data: { dalgaId: dalga.id, olay: "ASAMA_ILERLETILDI", oncekiAsama: 0, yeniAsama: 2, sebep: "atla", yapan: "bekci" } });
  } catch {
    yon = "RED";
  }
  kontrol("§2u DB CHECK: aşama 4 ve iki adım atlayan ilerletme ham yazımı RED", aralik === "RED" && yon === "RED");
  await temizleDalgalar(prisma, [dalga.id]);
  tz.dalgalar.splice(tz.dalgalar.indexOf(dalga.id), 1);
}

function kiraOf(y: Yanit): LeaseDoc | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc) : null;
}

async function uctanUca(prisma: Prisma, tz: Temizlik): Promise<void> {
  console.log("\n§3 uçtan uca — portal uçları · kira · yoklama raporu");
  const ortam = await anahtarOrtamiKur();
  const sunucu = await sunucuBaslat(ortam);
  const portal = await portalSunuculariKur(ortam.ctx);
  try {
    const k = await kurulumFiksturu(ortam.ctx, { kanal: "genel" });
    tz.kurulumlar.push(k.kurulumDbId);
    const kul = await portalKullaniciAc(ortam.ctx, "SATICI_OPERATOR");
    tz.kullanicilar.push(kul.id);
    const cerez = (await portalGiris(portal.portal, "/portal/api", kul)).cerez ?? "";
    const acGovde = { clientToken: randomUUID(), kanalKodu: "genel", surum: N, oncekiSurum: P, sebep: "bekçi: uçtan uca dalga" };
    const ac = await portalIstek(portal.portal, "/portal/api/guncelleme-dalgalari", { govde: acGovde, cerez });
    const dalgaId = (ac.veri as { id?: string } | undefined)?.id ?? "";
    if (dalgaId) tz.dalgalar.push(dalgaId);
    kontrol("§3a POST /guncelleme-dalgalari → 200, aşama 0", ac.status === 200 && (ac.veri as { asama?: number }).asama === 0, `${ac.status} ${ac.kod ?? ""}`);
    const tekrar = await portalIstek(portal.portal, "/portal/api/guncelleme-dalgalari", { govde: acGovde, cerez });
    kontrol("§3b aynı işlem kimliği → aynı yanıt (tekrar), tek dalga", tekrar.status === 200 && tekrar.basliklar.get("idempotent-replay") === "true" && (await prisma.guncellemeDalgasi.count({ where: { kanalKodu: "genel" } })) === 1);
    const oturumsuz = await portalIstek(portal.portal, "/portal/api/guncelleme-dalgalari", { govde: { ...acGovde, clientToken: randomUUID() } });
    kontrol("§3c oturumsuz → 401", oturumsuz.status === 401, String(oturumsuz.status));

    const anahtar = kurulumAnahtariUret();
    tz.kidler.push(anahtar.kid);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
    });
    const kira = kiraOf(et);
    kontrol("§3d ⭐ etkinleşen kurulumun kirası tavanı taşır (aşama 0 → hedefSurum = yerleşik) ve KİRA şemasından geçer",
      kira?.guncelleme?.hedefSurum === P && LeaseSchema.safeParse(kira).success, JSON.stringify(kira?.guncelleme ?? et.kod));
    let uc = kira?.kiraId ?? null;
    const yokla = async (ek: Record<string, unknown> = {}): Promise<LeaseDoc | null> => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k.kurulumId, amac: "yokla", anahtar, govde: { ...yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi }), ...ek } });
      const l = kiraOf(y);
      if (l) uc = l.kiraId;
      return l;
    };

    const ilerletYol = `/portal/api/guncelleme-dalgalari/${dalgaId}/ilerlet`;
    const adimlar: number[] = [];
    for (let a = 0; a < WAVE_MAX_STAGE; a++) {
      const r = await portalIstek(portal.portal, ilerletYol, { govde: { clientToken: randomUUID(), beklenenAsama: a, sebep: `bekçi: aşama ${a + 1}`, onay: true }, cerez });
      adimlar.push(r.status);
    }
    const sonKira = await yokla();
    kontrol("§3e üç ilerletme (her biri 200) → aşama 3: kira dalga sürümünü taşır", adimlar.every((s) => s === 200) && sonKira?.guncelleme?.hedefSurum === N, `${adimlar.join(",")} · ${sonKira?.guncelleme?.hedefSurum}`);
    const fazla = await portalIstek(portal.portal, ilerletYol, { govde: { clientToken: randomUUID(), beklenenAsama: 3, sebep: "bekçi: fazla" }, cerez });
    kontrol("§3f son aşamadan ileri → 409", fazla.status === 409, `${fazla.status} ${fazla.kod}`);

    const rapor = {
      saatDilimi: "Europe/Istanbul",
      guncelleyici: { durum: "CALISIYOR", surum: "1.0.0" },
      bekleyen: null,
      son: { kayitId: randomUUID(), hedefSurum: N, kaynakSurum: P, sonuc: "GERI_DONDU", kod: "SAGLIK_HATASI", baslangic: "2026-10-08T00:05:00.000Z", bitis: "2026-10-08T00:40:00.000Z", veriGeriYuklendi: false },
    };
    await yokla({ guncelleme: rapor });
    const uyari = await prisma.bildirim.count({ where: { olay: "GUNCELLEME_DALGA_UYARI", ilgiliKayit: dalgaId } });
    const dalga = await prisma.guncellemeDalgasi.findUniqueOrThrow({ where: { id: dalgaId } });
    kontrol("§3g ⭐ yoklamanın GERI_DONDU raporu uyarıyı HEMEN yazar (tarama beklenmez); aşama 3'te kalır", uyari === 2 && dalga.asama === 3, `${uyari} satır · aşama ${dalga.asama}`);
    const detay = await portalIstek(portal.portal, `/portal/api/guncelleme-dalgalari/${dalgaId}`, { cerez });
    const d = detay.json.data as { sayac?: { uyariAcik?: boolean; asamalar?: unknown[] }; gecmis?: unknown[] } | undefined;
    kontrol("§3h GET ayrıntı: sayaç (uyarı açık) + defter geçmişi (açılış + 3 ilerletme)", detay.status === 200 && d?.sayac?.uyariAcik === true && d.gecmis?.length === 4);
    const liste = await portalIstek(portal.portal, "/portal/api/guncelleme-dalgalari?kanal=genel", { cerez });
    kontrol("§3i GET liste: yürürlükteki dalga işaretli", liste.status === 200 && (liste.json.data as { id: string; yururlukte: boolean }[]).some((x) => x.id === dalgaId && x.yururlukte));
    const geri = await portalIstek(portal.portal, `/portal/api/guncelleme-dalgalari/${dalgaId}/geri-cek`, { govde: { clientToken: randomUUID(), beklenenAsama: 3, hedefAsama: 0, sebep: "bekçi: acil durdur" }, cerez });
    const durKira = await yokla();
    kontrol("§3j geri çek 3 → 0: sonraki kira yine yerleşik sürüm", geri.status === 200 && durKira?.guncelleme?.hedefSurum === P, `${geri.status} · ${durKira?.guncelleme?.hedefSurum}`);
  } finally {
    await portal.kapat();
    await sunucu.durdur();
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  saf();
  const { prisma } = await import("../src/lib/prisma");
  const tz: Temizlik = { kurulumlar: [], kidler: [], kullanicilar: [], dalgalar: [] };
  try {
    await servis(prisma, tz);
    await uctanUca(prisma, tz);
  } finally {
    await temizleDalgalar(prisma, tz.dalgalar);
    await temizleKurulumlar(tz.kurulumlar, tz.kidler);
    await temizlePortal({ kullanicilar: tz.kullanicilar });
    await kapat();
  }
  sonuc();
}

main().catch(async (e) => {
  console.error("❌ Bekçi çöktü:", e);
  await kapat();
  process.exit(1);
});
