// =============================================================================
// GÜNCELLEME POLİTİKASI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §2 · §3.1): portal → kurulum kolonları → kiranın
// `guncelleme` alanı (ALT imzalı; pencere fabrikanın dilimiyle MUTLAK aralık) · yoklamanın güncelleme raporu →
// kurulum durumu + defter (kayitId ile bir kez) · filo görünümü · backend/ indirme belirteci.
//   §1 saf: varsayılan = ONAYLI/pencere yok (bugünkü davranış) · pencere kuralı doğrulaması (OTOMATİK pencere ister,
//      gün listesi sıralanır/tekilleşir, saat biçimi) · aralıklar kiranın ömrüyle kesişir ve dilim fabrikadan (yoksa
//      varsayılan, bilinmeyen dilim → varsayılan)
//   §2 uçtan uca (gerçek sunucu + süreç içi portal): etkinleştirmede kira varsayılanı + backend/ belirteci · politika
//      ucu (200, defter satırı, işlem kimliği tekrarı aynı yanıt/tek satır, geçersiz gövde 400, izin) · sonraki kira
//      OTOMATİK + pencere + aralıklar · rapor → dilim/durum, sonuç defteri idempotent · sonraki kira fabrikanın dilimiyle
//      · filo ve kurulum ayrıntısı · DB CHECK ham yazımı reddeder
//   §3 BİLDİRİM (D7): tamamlanan deneme defter satırıyla AYNI tx'te bildirilir — geri dönüş (sebep + veri) ·
//      başarı · başarısızlık (müdahale) olayları kanal başına BİR satır; tekrar yoklama yeni satır doğurmaz; gövde
//      allowlist'te, raporun kodlu alanlarından (serbest metin yok); bildirim yazılamazsa defter satırı da yok,
//      sonraki yoklama ikisini birlikte yazar
// Koşum: npx tsx scripts/test_guncelleme_politikasi.ts   (yalnız *_test DB)
// =============================================================================
import { DOWNLOAD_PRODUCTS, ENDPOINTS, LeaseSchema, isoToMs, parseJws, type LeaseDoc } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { FACTORY_DEFAULT_TIME_ZONE, leaseUpdatePolicy, policyOf, validatePolicy } from "../src/services/update-policy.service";
import { NOTIFICATION_BODY_KEYS } from "../src/notifications/catalog";
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

const GUN = 86_400_000;

function kolonlar(ek: Partial<Parameters<typeof policyOf>[0]> = {}): Parameters<typeof policyOf>[0] {
  return {
    guncellemeKipi: "ONAYLI",
    guncellemePencereBaslangic: null,
    guncellemePencereBitis: null,
    guncellemePencereGunleri: [],
    guncellemeHedefSurum: null,
    saatDilimi: null,
    ...ek,
  };
}

function hataVar(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "ATILDI";
  }
}

function saf(): void {
  console.log("\n§1 saf — politika ↔ kira alanı");
  const t0 = Date.parse("2026-10-01T00:00:00.000Z");
  const v = leaseUpdatePolicy(kolonlar(), t0, t0 + 30 * GUN);
  kontrol("§1a varsayılan: ONAYLI · pencere yok · aralık yok · sabitleme yok (bugünkü davranış)", v.kip === "ONAYLI" && v.pencere === null && v.araliklar.length === 0 && v.hedefSurum === null);
  const oto = kolonlar({ guncellemeKipi: "OTOMATIK", guncellemePencereBaslangic: "02:00", guncellemePencereBitis: "05:00", guncellemePencereGunleri: [1, 2, 3, 4, 5, 6, 7] });
  const p = leaseUpdatePolicy(oto, t0, t0 + 30 * GUN);
  const kesisir = p.araliklar.every((a) => isoToMs(a.bitis) > t0 && isoToMs(a.baslangic) < t0 + 30 * GUN);
  kontrol("§1b OTOMATİK: pencere varsayılan dilimde, ~30 aralık, hepsi kira ömrüyle kesişir", p.pencere?.saatDilimi === FACTORY_DEFAULT_TIME_ZONE && p.araliklar.length >= 30 && kesisir, `${p.araliklar.length} aralık`);
  kontrol("§1c İstanbul 02:00 = 23:00Z (dilim gerçekten uygulanıyor)", p.araliklar.some((a) => a.baslangic.endsWith("T23:00:00.000Z")));
  const berlin = leaseUpdatePolicy({ ...oto, saatDilimi: "Europe/Berlin" }, t0, t0 + 30 * GUN);
  kontrol("§1d fabrikanın bildirdiği dilim kullanılır (Berlin 02:00 = 00:00Z yazın)", berlin.pencere?.saatDilimi === "Europe/Berlin" && berlin.araliklar.some((a) => a.baslangic.endsWith("T00:00:00.000Z")));
  const bozuk = leaseUpdatePolicy({ ...oto, saatDilimi: "Mars/Olympus" }, t0, t0 + 30 * GUN);
  kontrol("§1e bilinmeyen dilim → varsayılan dilim (kira yine geçerli)", bozuk.pencere?.saatDilimi === FACTORY_DEFAULT_TIME_ZONE);
  const kira = { v: 1, kiraId: crypto.randomUUID(), hakId: crypto.randomUUID(), hakSurum: 1, kurulumId: crypto.randomUUID(), kurulumAnahtarKimligi: `kur-${"A".repeat(43)}`,
    parmakIzi: { f1: null, f2: null, f3: null, f4: null, f5: null }, verilis: new Date(t0).toISOString(), bitis: new Date(t0 + 30 * GUN).toISOString(), sunucuSaati: new Date(t0).toISOString(),
    ekSureGun: 30, zorlama: false, gecerlilikBitis: null, yaptirim: { kademe: null, mesaj: null, kisitlamaTarihi: null, donmusModuller: [], guncellemeDonuk: false },
    yoklamaAraligiDk: 60, esitlemeAraligiDk: null, patronBulutBitis: null, devredildi: false, kanal: { kod: "k", guncelSurumler: {} }, altSertifika: "x.y.z", guncelleme: p };
  kontrol("§1f üretilen alan protokolün KİRA şemasından geçer", LeaseSchema.safeParse(kira).success);
  const tz = FACTORY_DEFAULT_TIME_ZONE;
  kontrol("§1g OTOMATİK pencereisiz → 400", hataVar(() => validatePolicy({ kip: "OTOMATIK", pencere: null, hedefSurum: null }, tz)) === "GOVDE_GECERSIZ");
  kontrol("§1h biçimsiz saat · başlangıç = bitiş · gün 8 → 400",
    hataVar(() => validatePolicy({ kip: "ONAYLI", pencere: { baslangic: "2:00", bitis: "05:00", gunler: [1] }, hedefSurum: null }, tz)) === "GOVDE_GECERSIZ" &&
    hataVar(() => validatePolicy({ kip: "ONAYLI", pencere: { baslangic: "02:00", bitis: "02:00", gunler: [1] }, hedefSurum: null }, tz)) === "GOVDE_GECERSIZ" &&
    hataVar(() => validatePolicy({ kip: "ONAYLI", pencere: { baslangic: "02:00", bitis: "05:00", gunler: [8] }, hedefSurum: null }, tz)) === "GOVDE_GECERSIZ");
  const n = validatePolicy({ kip: "OTOMATIK", pencere: { baslangic: "23:00", bitis: "04:00", gunler: [6, 1, 6] }, hedefSurum: "2.12.0" }, tz);
  kontrol("§1i gün listesi sıralanır ve tekilleşir; gece yarısını aşan pencere geçer", JSON.stringify(n.pencere?.gunler) === "[1,6]" && n.hedefSurum === "2.12.0");
}

function kiraOf(y: Yanit): LeaseDoc | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc) : null;
}

const RAPOR_SON = {
  kayitId: crypto.randomUUID(),
  hedefSurum: "2.12.1",
  kaynakSurum: "2.11.2",
  sonuc: "GERI_DONDU",
  kod: "SAGLIK_HATASI",
  baslangic: "2026-10-01T00:05:00.000Z",
  bitis: "2026-10-01T00:40:00.000Z",
  veriGeriYuklendi: true,
};

type Prisma = (typeof import("../src/lib/prisma"))["prisma"];
type Rapor = { saatDilimi: string; guncelleyici: unknown; bekleyen: unknown; son: typeof RAPOR_SON };

/** Bu kurulumun güncelleme bildirimi yazımını DÜŞÜRÜR (yalnız _test DB'si; adı bu bekçiye özgü). */
async function bildirimiPatlat(prisma: Prisma, kurulumDbId: string | null): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "bekci_gnc_bildirim_patlat" ON "bildirim"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "bekci_gnc_bildirim_patlat"()`);
  if (kurulumDbId === null) return;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "bekci_gnc_bildirim_patlat"() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW."kurulumId" = '${kurulumDbId}'::uuid AND NEW."olay"::text LIKE 'GUNCELLEME_%' THEN
        RAISE EXCEPTION 'bekci: guncelleme bildirimi dusuruldu';
      END IF;
      RETURN NEW;
    END $f$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "bekci_gnc_bildirim_patlat" BEFORE INSERT ON "bildirim" FOR EACH ROW EXECUTE FUNCTION "bekci_gnc_bildirim_patlat"()`);
}

async function bildirimler(prisma: Prisma, kurulumDbId: string, rapor: Rapor, yokla: (ek?: Record<string, unknown>) => Promise<unknown>): Promise<void> {
  console.log("\n§3 bildirim — tamamlanan deneme bir kez, defterle aynı tx'te");
  const satirlar = (olay: "GUNCELLEME_TAMAMLANDI" | "GUNCELLEME_GERI_DONDU" | "GUNCELLEME_BASARISIZ") =>
    prisma.bildirim.findMany({ where: { kurulumId: kurulumDbId, olay }, select: { kanal: true, govde: true, tekillikAnahtari: true, ilgiliKayit: true } });
  const geri = await satirlar("GUNCELLEME_GERI_DONDU");
  const g0 = (geri[0]?.govde ?? {}) as Record<string, string | null>;
  kontrol("§3a ⭐ geri dönüş → kanal başına BİR satır (iki yoklamaya rağmen), tekillik = kurulum + kayitId",
    geri.length === 2 && new Set(geri.map((x) => x.kanal)).size === 2 && geri.every((x) => x.tekillikAnahtari === `GUNCELLEME_GERI_DONDU:${kurulumDbId}:${RAPOR_SON.kayitId}` && x.ilgiliKayit === RAPOR_SON.kayitId), `${geri.length} satır`);
  kontrol("§3b ⭐ gövde: sürüm geçişi + sebep kodu + veri bayrağı; anahtarlar allowlist'te",
    g0.konu === "2.11.2 → 2.12.1" && (g0.referans ?? "").startsWith("SAGLIK_HATASI — ") && (g0.referans ?? "").includes("yedekten geri yüklendi") &&
      Object.keys(g0).every((key) => (NOTIFICATION_BODY_KEYS as readonly string[]).includes(key)), JSON.stringify(g0));

  const basarili = { ...RAPOR_SON, kayitId: crypto.randomUUID(), sonuc: "BASARILI", kod: null, veriGeriYuklendi: false, kaynakSurum: "2.11.2", hedefSurum: "2.12.2" };
  await yokla({ guncelleme: { ...rapor, son: basarili } });
  await yokla({ guncelleme: { ...rapor, son: basarili } });
  const tamam = await satirlar("GUNCELLEME_TAMAMLANDI");
  const t0 = (tamam[0]?.govde ?? {}) as Record<string, string | null>;
  kontrol("§3c başarı → 'Sunucu güncellendi' kanal başına bir satır, ayrıntı yok", tamam.length === 2 && t0.konu === "2.11.2 → 2.12.2" && t0.referans === null, `${tamam.length} satır`);

  const basarisiz = { ...RAPOR_SON, kayitId: crypto.randomUUID(), sonuc: "BASARISIZ", kod: "GERI_DONUS_HATASI", veriGeriYuklendi: false };
  await bildirimiPatlat(prisma, kurulumDbId);
  try {
    await yokla({ guncelleme: { ...rapor, son: basarisiz } });
  } finally {
    await bildirimiPatlat(prisma, null);
  }
  const defterYok = await prisma.kurulumKaydi.count({ where: { kurulumId: kurulumDbId, kaynakKayitId: basarisiz.kayitId } });
  kontrol("§3d ⭐ bildirim yazılamadı → defter satırı da YOK (aynı tx; yoklama yine de kira aldı)", defterYok === 0, `${defterYok} satır`);
  await yokla({ guncelleme: { ...rapor, son: basarisiz } });
  const hata = await satirlar("GUNCELLEME_BASARISIZ");
  const defterVar = await prisma.kurulumKaydi.count({ where: { kurulumId: kurulumDbId, kaynakKayitId: basarisiz.kayitId } });
  kontrol("§3e sonraki yoklama defter + bildirimi BİRLİKTE yazar; başarısızlık 'müdahale gerekiyor' der",
    defterVar === 1 && hata.length === 2 && ((hata[0]?.govde as Record<string, string | null>).referans ?? "").includes("müdahale gerekiyor"), `${defterVar} defter · ${hata.length} bildirim`);
  const metin = JSON.stringify(await prisma.bildirim.findMany({ where: { kurulumId: kurulumDbId }, select: { govde: true } }));
  kontrol("§3f gövdelerde serbest metin / yol yok (rapor yalnız kodlu alan taşır)", !metin.includes("serbest") && !metin.includes("C:\\") && !metin.includes("Europe/Berlin"));
}

async function uctanUca(temizlenecek: { kurulumlar: string[]; kidler: string[]; kullanicilar: string[] }): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  const ortam = await anahtarOrtamiKur();
  const sunucu = await sunucuBaslat(ortam);
  const portal = await portalSunuculariKur(ortam.ctx);
  try {
    console.log("\n§2 uçtan uca — portal → kira → rapor → filo");
    const k = await kurulumFiksturu(ortam.ctx, { kanal: "bekci-guncelleme" });
    temizlenecek.kurulumlar.push(k.kurulumDbId);
    const anahtar = kurulumAnahtariUret();
    temizlenecek.kidler.push(anahtar.kid);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId, amac: "etkinlestir", anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: ortam.f.parmakIzi }),
    });
    let kira = kiraOf(et);
    let uc = kira?.kiraId ?? null;
    kontrol("§2a etkinleştirme kirası varsayılan politikayı taşır (ONAYLI, pencere yok)", kira?.guncelleme?.kip === "ONAYLI" && kira.guncelleme.pencere === null, JSON.stringify(kira?.guncelleme));
    const onekler = ((et.json.indirmeBelirtecleri ?? []) as { yolOneki: string }[]).map((t) => t.yolOneki).sort();
    kontrol("§2b indirme belirteçleri backend/ önekini de kapsar", onekler.length === DOWNLOAD_PRODUCTS.length && onekler.includes(`/bekci-guncelleme/backend/`), onekler.join(","));
    const yokla = async (ek: Record<string, unknown> = {}): Promise<LeaseDoc | null> => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId, amac: "yokla", anahtar,
        govde: { ...yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi }), ...ek },
      });
      const l = kiraOf(y);
      if (l) uc = l.kiraId;
      return l;
    };

    const kul = await portalKullaniciAc(ortam.ctx, "SATICI_OPERATOR");
    temizlenecek.kullanicilar.push(kul.id);
    const giris = await portalGiris(portal.portal, "/portal/api", kul);
    const cerez = giris.cerez ?? "";
    const yol = `/portal/api/kurulumlar/${k.kurulumDbId}/guncelleme-politikasi`;
    const govde = { clientToken: crypto.randomUUID(), kip: "OTOMATIK", pencere: { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7] }, hedefSurum: null, sebep: "bekçi: gece penceresi" };
    const r1 = await portalIstek(portal.portal, yol, { govde, cerez });
    kontrol("§2c politika ucu → 200, değişti", r1.status === 200 && r1.veri.degisti === true, `${r1.status} ${r1.kod ?? ""}`);
    const r2 = await portalIstek(portal.portal, yol, { govde, cerez });
    const defter = await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: "GUNCELLEME_POLITIKASI" } });
    kontrol("§2d aynı işlem kimliği → aynı yanıt, defterde TEK satır", r2.status === 200 && r2.basliklar.get("idempotent-replay") === "true" && defter === 1, `${r2.status} replay=${r2.basliklar.get("idempotent-replay")} defter=${defter}`);
    const r3 = await portalIstek(portal.portal, yol, { govde: { ...govde, clientToken: crypto.randomUUID(), pencere: null }, cerez });
    kontrol("§2e OTOMATİK + pencere yok → 400 GOVDE_GECERSIZ", r3.status === 400 && r3.kod === "GOVDE_GECERSIZ", `${r3.status} ${r3.kod}`);
    const r4 = await portalIstek(portal.portal, yol, { govde: { ...govde, clientToken: crypto.randomUUID(), fazla: 1 }, cerez });
    kontrol("§2f gövdede tanınmayan anahtar → 400 (KATI)", r4.status === 400);
    const r5 = await portalIstek(portal.portal, yol, { govde: { ...govde, clientToken: crypto.randomUUID() } });
    kontrol("§2g oturumsuz → 401", r5.status === 401, String(r5.status));

    kira = await yokla();
    const g = kira?.guncelleme;
    kontrol("§2h sonraki kira OTOMATİK + pencere (varsayılan dilim) + aralıklar", g?.kip === "OTOMATIK" && g.pencere?.saatDilimi === FACTORY_DEFAULT_TIME_ZONE && (g.araliklar.length ?? 0) >= 28, JSON.stringify(g?.pencere));

    const rapor = { saatDilimi: "Europe/Berlin", guncelleyici: { durum: "CALISIYOR", surum: "1.0.0" }, bekleyen: { surum: "2.12.1", karar: "PENCERE_BEKLIYOR", neden: null }, son: RAPOR_SON };
    kira = await yokla({ guncelleme: rapor });
    const inst = await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } });
    kontrol("§2i rapor → kurulumun dilimi + durum kolonları", inst.saatDilimi === "Europe/Berlin" && (inst.sonGuncellemeRaporu as { guncelleyici?: { durum?: string } } | null)?.guncelleyici?.durum === "CALISIYOR" && inst.sonGuncellemeRaporuZamani !== null);
    await yokla({ guncelleme: rapor });
    const sonuclar = await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: "GUNCELLEME_GERI_DONDU", kaynakKayitId: RAPOR_SON.kayitId } });
    kontrol("§2j tamamlanan deneme deftere kayitId ile BİR KEZ (tekrar yoklama aynı satır)", sonuclar === 1, `${sonuclar} satır`);
    kira = await yokla();
    kontrol("§2k sonraki kira pencereyi FABRİKANIN diliminde basar", kira?.guncelleme?.pencere?.saatDilimi === "Europe/Berlin");
    const eskiGovde = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
      kurulumId: k.kurulumId, amac: "yokla", anahtar,
      govde: { ...yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: ortam.f.parmakIzi }), guncelleme: { ...rapor, serbest: "metin" } },
    });
    kontrol("§2l rapor KATI: tanınmayan alan → yoklama 400 (allowlist)", eskiGovde.status === 400, `${eskiGovde.status} ${eskiGovde.kod}`);

    const filo = await portalIstek(portal.portal, "/portal/api/filo", { cerez });
    const satir = (filo.json.data as { id: string; kuruluSurum: string | null; politika: { kip: string }; sonSonuc: { olay: string } | null }[] | undefined)?.find((x) => x.id === k.kurulumDbId);
    kontrol("§2m filo: kurulu sürüm (yoklamadan) · politika · son sonuç (defterden)", filo.status === 200 && satir?.kuruluSurum === "2.11.2" && satir.politika.kip === "OTOMATIK" && satir.sonSonuc?.olay === "GUNCELLEME_GERI_DONDU", JSON.stringify(satir).slice(0, 200));
    const detay = await portalIstek(portal.portal, `/portal/api/kurulumlar/${k.kurulumDbId}/guncelleme`, { cerez });
    const gd = detay.json.data as { politika?: { kip?: string }; saatDilimi?: string; gecmis?: { olay: string }[] } | undefined;
    kontrol("§2n kurulumun güncelleme görünümü: politika + dilim + geçmiş (politika ve sonuç satırları)", gd?.politika?.kip === "OTOMATIK" && gd.saatDilimi === "Europe/Berlin" && (gd.gecmis ?? []).some((x) => x.olay === "GUNCELLEME_POLITIKASI") && (gd.gecmis ?? []).some((x) => x.olay === "GUNCELLEME_GERI_DONDU"));

    let ham = "HATA_YOK";
    try {
      await prisma.kurulum.update({ where: { id: k.kurulumDbId }, data: { guncellemePencereBaslangic: null, guncellemePencereBitis: null, guncellemePencereGunleri: [] } });
    } catch {
      ham = "ATILDI";
    }
    kontrol("§2o DB CHECK: OTOMATİK kipte pencereyi silen ham yazım RED", ham === "ATILDI");
    const dondur = await portalIstek(portal.portal, yol, { govde: { clientToken: crypto.randomUUID(), kip: "DONDUR", pencere: null, hedefSurum: "2.11.2", sebep: "bekçi: dondur" }, cerez });
    kira = await yokla();
    kontrol("§2p DONDUR + sabitleme kiraya gider; pencere/aralık yok", dondur.status === 200 && kira?.guncelleme?.kip === "DONDUR" && kira.guncelleme.hedefSurum === "2.11.2" && kira.guncelleme.araliklar.length === 0);
    await bildirimler(prisma, k.kurulumDbId, rapor, yokla);
  } finally {
    await portal.kapat();
    await sunucu.durdur();
  }
}

async function main(): Promise<void> {
  hedefDbKapisi();
  saf();
  const temizlenecek = { kurulumlar: [] as string[], kidler: [] as string[], kullanicilar: [] as string[] };
  try {
    await uctanUca(temizlenecek);
  } finally {
    await temizleKurulumlar(temizlenecek.kurulumlar, temizlenecek.kidler);
    await temizlePortal({ kullanicilar: temizlenecek.kullanicilar });
    await kapat();
  }
  sonuc();
}

main().catch(async (e) => {
  console.error("❌ Bekçi çöktü:", e);
  await kapat();
  process.exit(1);
});
