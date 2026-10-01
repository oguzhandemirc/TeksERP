// =============================================================================
// KİRA ZİNCİRİ — VM/konteyner kopyasına karşı asıl savunma (plan §4, protokol §13). Üç hâl:
//   (a) AYNI parmak izinden geride kalmış uç (snapshot geri alma) → uca "yakala", uyarı YOK
//   (b) 15 dk içinde aynı ucun ağ tekrarı → AYNI çocuk kira (idempotent, yeni satır yok)
//   (c) İKİ FARKLI parmak izi aynı ucu ileri taşıyor → ZINCIR_CATALI uyarısı; ilk pencerede yalnız
//       uyarı (kira verilir), ikinci pencerede sürerse EŞLEŞMEYEN tarafa kira yok (403
//       KIRA_VERILMEDI); sahip taraf hiç reddedilmez — asla anında durdurma.
// Ek: kabul edilen küme yalnız tek etkenlik değişimde kayar (çatal açıkken asla) · kabul edilen
// kümeyle ESLESMEDI (kopyalanan LICENSE_DIR) → uyarı, ikinci pencerede red; satıcı uyarıyı kapatıp
// kümeyi kabul edince (meşru donanım değişimi) kira döner · ardışık "yakala" → ayırt edilemeyen
// kopya uyarısı (yalnız uyarı) · D2s: sunulan kira bu kurulumun kira defterinde yoksa YABANCI_KIRA, raporlanan
// kip elindeki kiranın zorlamasıyla uyuşmuyorsa KIP_UYUSMAZ — ikisi de yalnız uyarı, kira yine verilir.
// Lisans v2 (L2-4): §9 K6 kapanış kirası — çatalın ikinci penceresinde kapanış kirasını anlayan (`odenmis-tarih`)
// eşleşmeyen tarafa 403 yerine İMZALI K3 (çapa = olayın ilk kapanış kirası + ek süre; tekrar yoklamada AYNI kira, yeni
// yaptırımda yeni kira ama AYNI tarih; uç ilerlemez) · §10 taşınmış anahtar ve iptal kurulum kapanışı (olay geç fark
// edilse de tam ek süre — aniden durmaz) ·
// §11 YABANCI_HAK (kimlik/sürüm defterde yok ya da bayt özeti tutmuyor; doğru özet susar) · §12 YEREL_MUDAHALE
// (sıra geriledi/sıfırlandı · lisans izi kayıp · belirsizlik · saat sapması; yeni neden başına bildirim; çatal tarafı
// sırayı yazamaz) + yetenek kaydı · §13 uzatma dosyası ucu (dosya yüklenmeden ebeveynle gelen → tekrar/olağan, yakala değil).
// Sunucu kısa kopya penceresiyle kalkar (KOPYA_PENCERE_SN=2) — ikinci pencere beklenerek ölçülür.
// ⭐ KALICI SONDA ✓K4 (her koşumda): sahip taraf ikinci pencerede de 200 alır (kapı "çatalda herkesi
//    reddet" diye kör olsaydı kırmızı) · pencere dolmadan eşleşmeyen taraf 200 alır (anında red yok) ·
//    olağan zincirde YABANCI_KIRA/KIP_UYUSMAZ DOĞMAZ · zorlama yeni açıldığında ESKİ kirayla gelen gözlem
//    kipi uyarı sayılmaz (beklenen kip sunulan kiradan) · kapanışı anlamayan istemci 403'ü alır (eski fabrika sıfır
//    fark) · sahip kapanıştan sonra da yaptırımsız kira alır · doğru HAK özeti uyarı doğurmaz · artan sıra uyarı
//    doğurmaz · uzatma dosyası ucu olmayan zincirde ebeveynle gelen YAKALA kalır.
// Koşum: npx tsx scripts/test_kira_zinciri.ts
// =============================================================================
import { DAY_MS, ENDPOINTS, digestFingerprint, jwsDigest, parseJws, type Fingerprint } from "../src/lisans-protokol";
import { HAM_PARMAK_IZI, kurulumAnahtariUret, type TestAnahtari } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kiraYuku,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  yoklamaGovdesi,
  type CalisanSunucu,
  type Yanit,
} from "./lib/test-ortam";

const PENCERE_SN = 2;
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function kiraOf(y: Yanit): { kiraId: string; parmakIzi: Fingerprint } | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as { kiraId: string; parmakIzi: Fingerprint }) : null;
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { closeCopyAlert } = await import("../src/services/installation-admin.service");
  const temizlenecek: string[] = [];
  const sunucu: CalisanSunucu = await sunucuBaslat(ortam, { KOPYA_PENCERE_SN: String(PENCERE_SN) });
  const fpA = f.parmakIzi;
  const fpB = digestFingerprint({ ...HAM_PARMAK_IZI, f2: "11111111-2222-3333-4444-555555555555", f3: "KLONDISK0001" }, f.tuz);
  const fpC = digestFingerprint({ ...HAM_PARMAK_IZI, f1: "{0a0b0c0d-0e0f-4a4b-9c9d-0e0f0a0b0c0d}", f2: "99999999-8888-7777-6666-555555555555", f3: "BASKADISK77" }, f.tuz);

  const etkinlestir = async (anahtar: TestAnahtari) => {
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const y = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar,
      govde: etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar, parmakIzi: fpA }),
    });
    const kira = kiraOf(y);
    if (!kira) throw new Error(`etkinleştirme ${y.status} ${y.kod}`);
    return { k, t0: kira.kiraId };
  };
  const yokla = (kurulumId: string, anahtar: TestAnahtari, sonKiraId: string | null, parmakIzi: Fingerprint) =>
    imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId, parmakIzi }) });
  type V2 = NonNullable<Parameters<typeof yoklamaGovdesi>[0]["v2"]>;
  const yoklaV2 = (kurulumId: string, anahtar: TestAnahtari, sonKiraId: string | null, parmakIzi: Fingerprint, v2: V2, hak: { hakId: string; surum: number; ozet?: string } | null = null) =>
    imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId, amac: "yokla", anahtar, govde: yoklamaGovdesi({ sonKiraId, parmakIzi, v2, hak }) });
  const P_YETENEK = { yetenekler: ["odenmis-tarih"] };
  const karar = async (kiraId: string | undefined) => (kiraId ? (await prisma.kira.findUnique({ where: { id: kiraId } }))?.karar : undefined);
  const ekSureMs = ctx.config.EK_SURE_GUN * DAY_MS;
  const yaptirimOf = (y: Yanit) => (y.status === 200 ? (kiraYuku(y.json).yaptirim ?? {}) : {}) as { kademe?: string | null; kisitlamaTarihi?: string | null };

  async function kapanisKopya(): Promise<void> {
    console.log("\n§9 K6 kapanış kirası — çatalın ikinci penceresi");
    const an = kurulumAnahtariUret();
    const { k: kk, t0: c0 } = await etkinlestir(an);
    const c1 = kiraOf(await yokla(kk.kurulumId, an, c0, fpA))!.kiraId;
    const ilk = await yoklaV2(kk.kurulumId, an, c0, fpB, P_YETENEK);
    kontrol("§9a ilk pencerede kapanışı anlayan klon da OLAĞAN kira alır (anında kapanış yok)", ilk.status === 200 && kiraYuku(ilk.json).kapanis === undefined && (await karar(kiraOf(ilk)?.kiraId)) === "CATAL");
    // Sahip yoklar (uç onda): klonun elindeki kira artık geride → çatal sürer.
    const sahip0 = kiraOf(await yoklaV2(kk.kurulumId, an, c1, fpA, P_YETENEK))!.kiraId;
    await bekle(PENCERE_SN * 1000 + 300);
    const ucOnce = (await prisma.kurulum.findUniqueOrThrow({ where: { id: kk.kurulumDbId } })).sonKiraId;
    const kap = await yoklaV2(kk.kurulumId, an, kiraOf(ilk)!.kiraId, fpB, P_YETENEK);
    const yuk = kap.status === 200 ? kiraYuku(kap.json) : {};
    const beklenen = kap.status === 200 ? new Date(Date.parse(String(yuk.verilis)) + ekSureMs).toISOString() : "?";
    kontrol(
      "§9b ⭐ ikinci pencere + `odenmis-tarih` → 200 İMZALI kapanış kirası: kapanis=KOPYA, K3 = ilk kapanışın verilişi + ek süre",
      kap.status === 200 && yuk.kapanis === "KOPYA" && yaptirimOf(kap).kademe === "K3" && yaptirimOf(kap).kisitlamaTarihi === beklenen,
      `${kap.status} ${kap.kod ?? ""} ${String(yaptirimOf(kap).kisitlamaTarihi)} ≟ ${beklenen}`,
    );
    const satir = typeof yuk.kiraId === "string" ? await prisma.kira.findUnique({ where: { id: yuk.kiraId } }) : null;
    const ucSonra = (await prisma.kurulum.findUniqueOrThrow({ where: { id: kk.kurulumDbId } })).sonKiraId;
    kontrol(
      "§9c kapanış kirası defterde KAPANIS/KOPYA, uç İLERLEMEDİ, klonun ölçtüğü küme, modül anahtarı ve bulut hakkı yok, HAK yanıtta",
      satir?.karar === "KAPANIS" && satir.kapanisNedeni === "KOPYA" && ucSonra === ucOnce && JSON.stringify(yuk.parmakIzi) === JSON.stringify(fpB) &&
        yuk.modulAnahtarlari === undefined && yuk.patronBulutBitis === null && typeof kap.json.hak === "string",
    );
    const kapId = typeof yuk.kiraId === "string" ? yuk.kiraId : kiraOf(ilk)!.kiraId;
    const sayi = await prisma.kira.count({ where: { kurulumId: kk.kurulumDbId } });
    const tekrar = await yoklaV2(kk.kurulumId, an, kapId, fpB, P_YETENEK);
    kontrol("§9d tekrar yoklama → AYNI kapanış kirası (yeni satır yok, tarih kaymaz)", tekrar.status === 200 && tekrar.json.kira === kap.json.kira && (await prisma.kira.count({ where: { kurulumId: kk.kurulumDbId } })) === sayi);
    const telemetri = await prisma.yoklama.findFirst({ where: { kurulumId: kk.kurulumDbId, sonuc: "KAPANIS_KOPYA" } });
    kontrol("§9e yoklama telemetrisi KAPANIS_KOPYA (kira kimliğiyle)", telemetri?.kiraId === yuk.kiraId);
    const eski = await yokla(kk.kurulumId, an, kapId, fpB);
    kontrol("§9f ✓K kapanışı anlamayan (eski) klon → bugünkü 403 KIRA_VERILMEDI (sıfır fark)", eski.status === 403 && eski.kod === "KIRA_VERILMEDI", `${eski.status} ${eski.kod}`);
    const { applySanction } = await import("../src/services/sanction.service");
    await applySanction({ installationDbId: kk.kurulumDbId, level: "K0", message: "bekçi mesajı", reason: "bekçi", actor: "bekci" });
    const yeni = await yoklaV2(kk.kurulumId, an, kapId, fpB, P_YETENEK);
    kontrol(
      "§9g yaptırım defteri değişti → YENİ kapanış kirası, kısıtlama tarihi AYNI (çapa olayda)",
      yeni.status === 200 && yeni.json.kira !== kap.json.kira && yaptirimOf(yeni).kisitlamaTarihi === beklenen && kiraYuku(yeni.json).kapanis === "KOPYA",
    );
    const sahip = await yoklaV2(kk.kurulumId, an, sahip0, fpA, P_YETENEK);
    kontrol("§9h ✓K sahip taraf kapanıştan sonra da olağan kira (kapanış K3'ü YOK)", sahip.status === 200 && kiraYuku(sahip.json).kapanis === undefined && yaptirimOf(sahip).kademe === "K0", `${sahip.status} ${String(yaptirimOf(sahip).kademe)}`);
  }

  async function kapanisTasimaIptal(): Promise<void> {
    console.log("\n§10 K6 kapanış kirası — taşınmış anahtar · iptal kurulum");
    const eskiAn = kurulumAnahtariUret();
    const { k: kt, t0: e0 } = await etkinlestir(eskiAn);
    const yeniAn = kurulumAnahtariUret();
    const inst = await prisma.kurulum.findUniqueOrThrow({ where: { id: kt.kurulumDbId } });
    // Onaylı taşımanın kurulum üzerindeki izi (etkinleştirmenin yazdığıyla aynı): eski anahtar emekli kaydı + anahtar değişimi.
    // Taşıma 40 gün ÖNCE onaylanmış, eski makine ancak şimdi yokluyor (olay geç fark edildi).
    await prisma.kurulumKaydi.create({
      data: {
        kurulumId: kt.kurulumDbId,
        olay: "TASINDI",
        anahtarKimligi: yeniAn.kid,
        acikAnahtar: yeniAn.x,
        eskiAnahtarKimligi: inst.anahtarKimligi,
        eskiAcikAnahtar: inst.acikAnahtar,
        yapan: "bekci",
        createdAt: new Date(Date.now() - 40 * DAY_MS),
      },
    });
    await prisma.kurulum.update({ where: { id: kt.kurulumDbId }, data: { anahtarKimligi: yeniAn.kid, acikAnahtar: yeniAn.x } });
    const eskiRed = await yokla(kt.kurulumId, eskiAn, e0, fpA);
    kontrol("§10a ✓K kapanışı anlamayan eski makine → bugünkü 403 KURULUM_IPTAL", eskiRed.status === 403 && eskiRed.kod === "KURULUM_IPTAL", `${eskiRed.status} ${eskiRed.kod}`);
    const oncesi = Date.now();
    const kapT = await yoklaV2(kt.kurulumId, eskiAn, e0, fpA, P_YETENEK);
    const kisitT = Date.parse(String(yaptirimOf(kapT).kisitlamaTarihi));
    kontrol(
      "§10b ⭐ taşınmış anahtar + `odenmis-tarih` → kapanış kirası TASIMA, K3 = ilk kapanışın verilişi + ek süre, kira ESKİ anahtara bağlı",
      kapT.status === 200 && kiraYuku(kapT.json).kapanis === "TASIMA" && kisitT === Date.parse(String(kiraYuku(kapT.json).verilis)) + ekSureMs &&
        kiraYuku(kapT.json).kurulumAnahtarKimligi === eskiAn.kid,
      `${kapT.status} ${kapT.kod ?? ""}`,
    );
    kontrol("§10b2 ✓K olay 40 gün önceydi ama fabrika ANİDEN durmaz: kısıtlama ilk kapanıştan TAM ek süre sonra", kisitT >= oncesi + ekSureMs, `${new Date(kisitT).toISOString()}`);
    const tekrarT = await yoklaV2(kt.kurulumId, eskiAn, String(kiraYuku(kapT.json).kiraId), fpA, P_YETENEK);
    kontrol("§10c tekrar → aynı kapanış kirası", tekrarT.json.kira === kapT.json.kira);

    const an = kurulumAnahtariUret();
    const { k: ki, t0: i0 } = await etkinlestir(an);
    const { cancelInstallation, reinstateInstallation } = await import("../src/services/installation-admin.service");
    await cancelInstallation({ installationDbId: ki.kurulumDbId, reason: "bekçi: sözleşme feshi", actor: "bekci" });
    const eskiI = await yokla(ki.kurulumId, an, i0, fpA);
    const kapI = await yoklaV2(ki.kurulumId, an, i0, fpA, P_YETENEK);
    kontrol(
      "§10d iptal kurulum: eski istemci 403 KURULUM_IPTAL; `odenmis-tarih` → kapanış IPTAL, K3 = ilk kapanışın verilişi + ek süre",
      eskiI.status === 403 && kapI.status === 200 && kiraYuku(kapI.json).kapanis === "IPTAL" &&
        Date.parse(String(yaptirimOf(kapI).kisitlamaTarihi)) === Date.parse(String(kiraYuku(kapI.json).verilis)) + ekSureMs,
      `${eskiI.status} ${kapI.status} ${kapI.kod ?? ""}`,
    );
    await reinstateInstallation({ installationDbId: ki.kurulumDbId, reason: "bekçi: yanlış iptal", actor: "bekci" });
    const geri = await yoklaV2(ki.kurulumId, an, i0, fpA, P_YETENEK);
    kontrol("§10e iptal geri alınınca olağan kira döner (kapanış yok)", geri.status === 200 && kiraYuku(geri.json).kapanis === undefined, `${geri.status} ${geri.kod ?? ""}`);
  }

  async function yabanciHak(): Promise<void> {
    console.log("\n§11 YABANCI_HAK — satıcı dışında basılmış HAK (yalnız uyarı)");
    const an = kurulumAnahtariUret();
    const { k: kh, t0: h0 } = await etkinlestir(an);
    const hak = await prisma.hak.findUniqueOrThrow({ where: { id: kh.hakId } });
    const belge = (await prisma.hakSurumu.findUniqueOrThrow({ where: { hakId_surum: { hakId: hak.id, surum: hak.guncelSurum } } })).belge;
    const say = () => prisma.kopyaUyarisi.count({ where: { kurulumId: kh.kurulumDbId, tur: "YABANCI_HAK" } });
    const dogru = await yoklaV2(kh.kurulumId, an, h0, fpA, {}, { hakId: hak.id, surum: hak.guncelSurum, ozet: jwsDigest(belge) });
    const eskiBicim = await yokla(kh.kurulumId, an, kiraOf(dogru)!.kiraId, fpA);
    kontrol("§11a ✓K doğru HAK (özetli) ve özet bildirmeyen eski fabrika → uyarı YOK, HAK yanıta konmaz", dogru.status === 200 && dogru.json.hak === null && eskiBicim.status === 200 && (await say()) === 0, `${String(dogru.json.hak).slice(0, 8)}`);
    const sahte = await yoklaV2(kh.kurulumId, an, kiraOf(eskiBicim)!.kiraId, fpA, {}, { hakId: hak.id, surum: hak.guncelSurum, ozet: "A".repeat(43) });
    kontrol("§11b ⭐ aynı kimlik + sürüm, YABANCI bayt özeti → 200 + YABANCI_HAK + gerçek HAK yanıtta (kira ona bağlı)", sahte.status === 200 && (await say()) === 1 && sahte.json.hak === belge && kiraYuku(sahte.json).hakOzeti === jwsDigest(belge));
    const bilinmeyen = await yoklaV2(kh.kurulumId, an, kiraOf(sahte)!.kiraId, fpA, {}, { hakId: "00000000-0000-4000-8000-0000000000aa", surum: 7 });
    const u = await prisma.kopyaUyarisi.findFirstOrThrow({ where: { kurulumId: kh.kurulumDbId, tur: "YABANCI_HAK" } });
    kontrol("§11c defterde olmayan HAK kimliği → aynı uyarının görülmesi arttı, kira yine verilir", bilinmeyen.status === 200 && u.gorulmeSayisi === 2);
    const bildirim = await prisma.bildirim.count({ where: { kurulumId: kh.kurulumDbId, olay: "KOPYA_SUPHESI" } });
    kontrol("§11d yeni uyarı başına KOPYA_SUPHESI bildirimi (iki kanal)", bildirim === 2, `${bildirim}`);
  }

  async function yerelMudahale(): Promise<void> {
    console.log("\n§12 YEREL_MUDAHALE — durum kaydı sırası, lisans izi, belirsizlik, saat sapması (yalnız uyarı)");
    const an = kurulumAnahtariUret();
    const { k: km, t0: m0 } = await etkinlestir(an);
    const durum = () => prisma.kurulum.findUniqueOrThrow({ where: { id: km.kurulumDbId }, select: { sonDurumSirasi: true, yetenekler: true } });
    const uyari = () => prisma.kopyaUyarisi.findFirst({ where: { kurulumId: km.kurulumDbId, tur: "YEREL_MUDAHALE", durum: "ACIK" } });
    const bildirimler = () => prisma.bildirim.findMany({ where: { kurulumId: km.kurulumDbId, olay: "YEREL_MUDAHALE_SUPHESI" } });
    const nedenler = async () => ((await uyari())?.ayrinti as { nedenler?: string[] } | null)?.nedenler ?? [];
    const kayit = { gecerli: true };
    const m1 = kiraOf(await yoklaV2(km.kurulumId, an, m0, fpA, { ...P_YETENEK, durumKaydi: { ...kayit, sira: 5 } }))!.kiraId;
    const m2y = await yoklaV2(km.kurulumId, an, m1, fpA, { ...P_YETENEK, durumKaydi: { ...kayit, sira: 9 } });
    const d9 = await durum();
    kontrol("§12a ✓K artan sıra uyarı doğurmaz; satıcı son sırayı (9) ve yetenekleri tutar", (await uyari()) === null && d9.sonDurumSirasi === 9 && d9.yetenekler.join() === "odenmis-tarih");
    const yetKaydi = await prisma.kurulumKaydi.count({ where: { kurulumId: km.kurulumDbId, olay: "YETENEKLER" } });
    kontrol("§12b yetenek kümesinin değişimi kurulum kaydında (bir kez)", yetKaydi === 1, `${yetKaydi}`);
    const m3y = await yoklaV2(km.kurulumId, an, kiraOf(m2y)!.kiraId, fpA, { ...P_YETENEK, durumKaydi: { ...kayit, sira: 3 } });
    const b1 = await bildirimler();
    kontrol(
      "§12c ⭐ sıra GERİLEDİ (9 → 3) → 200 + YEREL_MUDAHALE[SIRA_GERILEDI] + iki kanal bildirimi (referans etiketi)",
      m3y.status === 200 && (await nedenler()).join() === "SIRA_GERILEDI" && b1.length === 2 && b1.every((b) => String((b.govde as { referans?: string }).referans).startsWith("Durum kaydı sırası geriledi")),
      `${(await nedenler()).join()} · ${b1.length}`,
    );
    const m4y = await yoklaV2(km.kurulumId, an, kiraOf(m3y)!.kiraId, fpA, { ...P_YETENEK, durumKaydi: { gecerli: false, sira: null }, nedenler: ["LISANS_IZI_KAYIP"] });
    kontrol(
      "§12d K7 izleri silindi: kayıt yok + LISANS_IZI_KAYIP → yeni iki neden, yeni nedenler başına bildirim (2 → 6); kira yine verilir",
      m4y.status === 200 && (await nedenler()).join() === "SIRA_GERILEDI,SIRA_SIFIRLANDI,LISANS_IZI_KAYIP" && (await bildirimler()).length === 6,
      `${(await nedenler()).join()} · ${(await bildirimler()).length}`,
    );
    const m5y = await yoklaV2(km.kurulumId, an, kiraOf(m4y)!.kiraId, fpA, { ...P_YETENEK, nedenler: ["LISANS_IZI_KAYIP"] });
    kontrol("§12e süren neden yeni bildirim doğurmaz (6)", m5y.status === 200 && (await bildirimler()).length === 6);
    const m6y = await yoklaV2(km.kurulumId, an, kiraOf(m5y)!.kiraId, fpA, { ...P_YETENEK, belirsizlik: { birikenMs: 8 * DAY_MS, ilk: new Date().toISOString() }, saticiSapmaSn: 7200 });
    kontrol("§12f belirsizlik > 7 g ve saat sapması ≥ 1 sa → iki yeni neden (6 → 10)", m6y.status === 200 && (await nedenler()).includes("BELIRSIZLIK") && (await nedenler()).includes("SAAT_SAPMASI") && (await bildirimler()).length === 10);
    const kisa = await yoklaV2(km.kurulumId, an, kiraOf(m6y)!.kiraId, fpA, { ...P_YETENEK, belirsizlik: { birikenMs: 6 * DAY_MS, ilk: null }, saticiSapmaSn: 3599 });
    kontrol("§12g ✓K eşik altı belirsizlik (6 g) ve sapma (3599 sn) yeni neden doğurmaz", kisa.status === 200 && (await bildirimler()).length === 10);
    const eski = await yokla(km.kurulumId, an, kiraOf(kisa)!.kiraId, fpA);
    kontrol("§12h yeteneği bildirmeyen (eski sürüme dönen) fabrika → yetenekler boşalır (kayıt satırı)", eski.status === 200 && (await durum()).yetenekler.length === 0 && (await prisma.kurulumKaydi.count({ where: { kurulumId: km.kurulumDbId, olay: "YETENEKLER" } })) === 2);
    await yoklaV2(km.kurulumId, an, kiraOf(eski)!.kiraId, fpA, { ...P_YETENEK, durumKaydi: { ...kayit, sira: 20 } });
    const once = (await durum()).sonDurumSirasi;
    const klon = await yoklaV2(km.kurulumId, an, m0, fpB, { ...P_YETENEK, durumKaydi: { ...kayit, sira: 1 } });
    kontrol(
      "§12i ✓K çatal tarafı (klon, sıra 1) satıcının sırasını (20) YAZAMAZ ve yerel müdahale nedeni doğurmaz",
      klon.status === 200 && once === 20 && (await durum()).sonDurumSirasi === 20 && (await bildirimler()).length === 10,
      `${String(once)} → ${String((await durum()).sonDurumSirasi)}`,
    );
  }

  async function uzatmaDosyasiUcu(): Promise<void> {
    console.log("\n§13 uzatma dosyası ucu");
    const { decideChain } = await import("../src/services/lease-chain");
    const simdi = Date.now();
    const uc = { id: "u", previousId: "p", createdAtMs: simdi - 20 * 60_000, clientFingerprint: fpA };
    const kararSaf = (fromFile: boolean) => decideChain({ presentedLeaseId: "p", tip: { ...uc, fromFile }, measured: fpA, nowMs: simdi, repeatWindowMs: 900_000 });
    kontrol("§13a dosya ucu + ebeveynle gelen aynı makine (15 dk sonra) → NORMAL; ✓K dosya olmayan uçta YAKALA kalır", kararSaf(true) === "NORMAL" && kararSaf(false) === "CATCH_UP");
    const an = kurulumAnahtariUret();
    const { k: kd, t0: f0 } = await etkinlestir(an);
    const f1 = kiraOf(await yokla(kd.kurulumId, an, f0, fpA))!.kiraId;
    const { issueExtensionFileTx } = await import("../src/services/extension-file.service");
    const dosya = await prisma.$transaction((tx) => issueExtensionFileTx(tx, ctx, { installationDbId: kd.kurulumDbId, actor: "bekci", nowMs: Date.now() }));
    const dSatir = await prisma.kira.findUniqueOrThrow({ where: { id: dosya.kiraId } });
    const uc2 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: kd.kurulumDbId } })).sonKiraId;
    kontrol("§13b dosya kirası uçtaki kiranın çocuğu (DOSYA), uç ilerledi, kurulum kaydında", dSatir.karar === "DOSYA" && dSatir.oncekiKiraId === f1 && uc2 === dosya.kiraId && (await prisma.kurulumKaydi.count({ where: { kurulumId: kd.kurulumDbId, olay: "UZATMA_DOSYASI" } })) === 1);
    const yuklenmeden = await yokla(kd.kurulumId, an, f1, fpA);
    kontrol("§13c dosya yüklenmeden 15 dk içinde ebeveynle yoklama → dosyanın kirası (tekrar), yakala yok", yuklenmeden.status === 200 && yuklenmeden.json.kira === dosya.dosya.kira && (await prisma.kira.count({ where: { kurulumId: kd.kurulumDbId, karar: "YAKALA" } })) === 0);
    const yuklenince = await yokla(kd.kurulumId, an, dosya.kiraId, fpA);
    kontrol("§13d dosya yüklenip yoklanınca → NORMAL çocuk", yuklenince.status === 200 && (await karar(kiraOf(yuklenince)?.kiraId)) === "NORMAL");
    await prisma.kopyaUyarisi.create({ data: { kurulumId: kd.kurulumDbId, tur: "ZINCIR_CATALI", ilkGorulme: new Date(), sonGorulme: new Date(), digerParmakIzi: fpB } });
    let kod = "";
    try {
      await prisma.$transaction((tx) => issueExtensionFileTx(tx, ctx, { installationDbId: kd.kurulumDbId, actor: "bekci", nowMs: Date.now() }));
    } catch (err) {
      kod = String((err as { code?: string }).code);
    }
    kontrol("§13e açık zincir çatalında dosya verilmez → 409 DURUM_CAKISMASI", kod === "DURUM_CAKISMASI", kod);
  }

  try {
    const anahtar = kurulumAnahtariUret();
    const { k, t0 } = await etkinlestir(anahtar);

    console.log("\n§1 normal zincir");
    const t1 = kiraOf(await yokla(k.kurulumId, anahtar, t0, fpA))?.kiraId;
    const t2y = await yokla(k.kurulumId, anahtar, t1 ?? null, fpA);
    const t2 = kiraOf(t2y)?.kiraId;
    kontrol("§1a uçtan yoklama → NORMAL çocuk", (await karar(t1)) === "NORMAL" && (await karar(t2)) === "NORMAL");

    console.log("\n§2 (b) ağ tekrarı — 15 dk içinde aynı uç");
    const oncekiSayi = await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } });
    const tekrar = await yokla(k.kurulumId, anahtar, t1 ?? null, fpA);
    kontrol("§2a aynı çocuk kira döner (idempotent)", tekrar.status === 200 && tekrar.json.kira === t2y.json.kira, `${tekrar.status}`);
    kontrol("§2b yeni kira satırı YOK", (await prisma.kira.count({ where: { kurulumId: k.kurulumDbId } })) === oncekiSayi);
    const sonYoklama = await prisma.yoklama.findFirst({ where: { kurulumId: k.kurulumDbId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    kontrol("§2c yoklama telemetrisi sonucu TEKRAR", sonYoklama?.sonuc === "TEKRAR", sonYoklama?.sonuc);

    console.log("\n§3 (a) snapshot geri alma — aynı parmak izi, eski uç");
    const yakala = await yokla(k.kurulumId, anahtar, t0, fpA);
    const t3 = kiraOf(yakala)?.kiraId;
    const t3satir = t3 ? await prisma.kira.findUnique({ where: { id: t3 } }) : null;
    kontrol("§3a eski uçla yoklama → 200, YAKALA, ucun çocuğu", yakala.status === 200 && t3satir?.karar === "YAKALA" && t3satir.oncekiKiraId === t2);
    kontrol("§3b kopya uyarısı YOK", (await prisma.kopyaUyarisi.count({ where: { kurulumId: k.kurulumDbId } })) === 0);

    console.log("\n§4 (c) çatal — iki farklı makine aynı zinciri taşıyor");
    const kabulOnce = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).kabulEdilenParmakIzi;
    const klon1 = await yokla(k.kurulumId, anahtar, t0, fpB);
    const t4 = kiraOf(klon1);
    kontrol("§4a ✓K ilk pencere: eşleşmeyen taraf YİNE kira alır (anında red yok)", klon1.status === 200 && (await karar(t4?.kiraId)) === "CATAL", `${klon1.status} ${klon1.kod ?? ""}`);
    const uyari = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k.kurulumDbId, tur: "ZINCIR_CATALI", durum: "ACIK" } });
    kontrol("§4b ZINCIR_CATALI uyarısı açıldı", uyari !== null && JSON.stringify(uyari.digerParmakIzi) === JSON.stringify(fpB));
    const kabulSonra = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k.kurulumDbId } })).kabulEdilenParmakIzi;
    kontrol("§4c çatalda kabul edilen küme KAYMADI; klonun kirası sahibin kümesini taşır", JSON.stringify(kabulSonra) === JSON.stringify(kabulOnce) && JSON.stringify(t4?.parmakIzi) === JSON.stringify(fpA));
    const sahip1 = await yokla(k.kurulumId, anahtar, t3 ?? null, fpA);
    kontrol("§4d sahip taraf (geride kaldı) → 200", sahip1.status === 200, `${sahip1.status} ${sahip1.kod ?? ""}`);
    await bekle(PENCERE_SN * 1000 + 300);
    const klon2 = await yokla(k.kurulumId, anahtar, t4?.kiraId ?? null, fpB);
    kontrol("§4e ikinci pencere: eşleşmeyen taraf → 403 KIRA_VERILMEDI", klon2.status === 403 && klon2.kod === "KIRA_VERILMEDI", `${klon2.status} ${klon2.kod}`);
    const redSonrasi = await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: uyari!.id } });
    kontrol("§4f red uyarıya işlendi (redZamani, görülme sayısı)", redSonrasi.redZamani !== null && redSonrasi.gorulmeSayisi >= 3, `görülme ${redSonrasi.gorulmeSayisi}`);
    const redYoklama = await prisma.yoklama.findFirst({ where: { kurulumId: k.kurulumDbId, sonuc: "RED_KIRA_VERILMEDI" } });
    kontrol("§4g red yoklama telemetrisinde (kira yok)", redYoklama !== null && redYoklama.kiraId === null);
    const sahip2 = await yokla(k.kurulumId, anahtar, kiraOf(sahip1)?.kiraId ?? null, fpA);
    kontrol("§4h ✓K sahip taraf ikinci pencerede de → 200", sahip2.status === 200, `${sahip2.status} ${sahip2.kod ?? ""}`);

    console.log("\n§5 kabul edilen kümenin kayması");
    const tekEtken = digestFingerprint({ ...HAM_PARMAK_IZI, f3: "YENIDISK2027" }, f.tuz);
    const anahtar2 = kurulumAnahtariUret();
    const { k: k2, t0: s0 } = await etkinlestir(anahtar2);
    const s1y = await yokla(k2.kurulumId, anahtar2, s0, tekEtken);
    const s1 = kiraOf(s1y);
    const kabul2 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k2.kurulumDbId } })).kabulEdilenParmakIzi;
    kontrol("§5a tek etken değişti (disk) → küme kayar, kira yeni kümeyi taşır", JSON.stringify(kabul2) === JSON.stringify(tekEtken) && JSON.stringify(s1?.parmakIzi) === JSON.stringify(tekEtken));
    const s2y = await yokla(k2.kurulumId, anahtar2, s1?.kiraId ?? null, fpB);
    const kabul3 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k2.kurulumDbId } })).kabulEdilenParmakIzi;
    kontrol("§5b iki etken birden değişti → küme KAYMAZ (kira yine verilir)", s2y.status === 200 && JSON.stringify(kabul3) === JSON.stringify(tekEtken), `${s2y.status}`);

    console.log("\n§6 kopyalanan LICENSE_DIR — kabul edilen kümeyle ESLESMEDI");
    const anahtar3 = kurulumAnahtariUret();
    const { k: k3, t0: u0 } = await etkinlestir(anahtar3);
    const u1y = await yokla(k3.kurulumId, anahtar3, u0, fpC);
    const u1 = kiraOf(u1y);
    const uy = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k3.kurulumDbId, tur: "PARMAK_IZI_UYUSMAZ" } });
    kontrol("§6a ilk pencere: kira verilir (sahibin kümesiyle) + PARMAK_IZI_UYUSMAZ uyarısı", u1y.status === 200 && uy !== null && JSON.stringify(u1?.parmakIzi) === JSON.stringify(fpA));
    await bekle(PENCERE_SN * 1000 + 300);
    const u2y = await yokla(k3.kurulumId, anahtar3, u1?.kiraId ?? null, fpC);
    kontrol("§6b ikinci pencere: 403 KIRA_VERILMEDI", u2y.status === 403 && u2y.kod === "KIRA_VERILMEDI", `${u2y.status} ${u2y.kod}`);
    // Meşru donanım değişimi: satıcı uyarıyı kapatır ve ölçülen kümeyi kabul eder → kira döner.
    await closeCopyAlert({ alertId: uy!.id, acceptOtherFingerprint: true, reason: "anakart değişti — müşteriyle doğrulandı", actor: "bekci" });
    const u3y = await yokla(k3.kurulumId, anahtar3, u1?.kiraId ?? null, fpC);
    const kabul4 = (await prisma.kurulum.findUniqueOrThrow({ where: { id: k3.kurulumDbId } })).kabulEdilenParmakIzi;
    const kapandi = await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: uy!.id } });
    kontrol("§6c uyarı kapatılıp küme kabul edilince → 200, kabul edilen küme = yeni makine, uyarı KAPANDI", u3y.status === 200 && JSON.stringify(kabul4) === JSON.stringify(fpC) && kapandi.durum === "KAPANDI", `${u3y.status} ${u3y.kod ?? ""}`);
    let ikinciKapanis = "";
    try {
      await closeCopyAlert({ alertId: uy!.id, acceptOtherFingerprint: false, reason: "tekrar", actor: "bekci" });
    } catch (err) {
      ikinciKapanis = String((err as { status?: number }).status);
    }
    kontrol("§6d kapalı uyarı ikinci kez kapatılamaz → 409", ikinciKapanis === "409");

    console.log("\n§7 ardışık 'yakala' — ayırt edilemeyen kopya (yalnız uyarı)");
    const anahtar4 = kurulumAnahtariUret();
    const { k: k4, t0: v0 } = await etkinlestir(anahtar4);
    const v1 = kiraOf(await yokla(k4.kurulumId, anahtar4, v0, fpA))!.kiraId;
    kiraOf(await yokla(k4.kurulumId, anahtar4, v1, fpA));
    const y1 = await yokla(k4.kurulumId, anahtar4, v0, fpA);
    const y2 = await yokla(k4.kurulumId, anahtar4, v1, fpA);
    const y3 = await yokla(k4.kurulumId, anahtar4, v0, fpA);
    const yakalaSayisi = await prisma.kira.count({ where: { kurulumId: k4.kurulumDbId, karar: "YAKALA" } });
    const ayni = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k4.kurulumDbId, tur: "AYNI_PARMAK_IZI_TEKRAR" } });
    kontrol("§7a üç yakalama → AYNI_PARMAK_IZI_TEKRAR uyarısı, hiçbiri reddedilmedi", yakalaSayisi === 3 && ayni !== null && [y1, y2, y3].every((y) => y.status === 200), `yakala=${yakalaSayisi}`);

    console.log("\n§8 D2s — yabancı kira ve kip uyuşmazlığı (yalnız uyarı)");
    const d2sTurleri = ["YABANCI_KIRA", "KIP_UYUSMAZ"] as const;
    const olaganda = await prisma.kopyaUyarisi.count({ where: { kurulumId: { in: [k.kurulumDbId, k2.kurulumDbId, k4.kurulumDbId] }, tur: { in: [...d2sTurleri] } } });
    kontrol("§8a ✓K olağan zincirde (normal · tekrar · yakala · çatal) YABANCI_KIRA/KIP_UYUSMAZ yok", olaganda === 0, `${olaganda}`);
    const anahtar5 = kurulumAnahtariUret();
    const { k: k5, t0: w0 } = await etkinlestir(anahtar5);
    const yabanci = await yokla(k5.kurulumId, anahtar5, v1, fpA);
    const yabanciUyari = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k5.kurulumDbId, tur: "YABANCI_KIRA", durum: "ACIK" } });
    kontrol("§8b başka kurulumun kirasıyla yoklama → 200 (asla anında durdurma) + YABANCI_KIRA uyarısı", yabanci.status === 200 && yabanciUyari !== null, `${yabanci.status} ${yabanci.kod ?? ""}`);
    const uydurma = await yokla(k5.kurulumId, anahtar5, "00000000-0000-4000-8000-000000000000", fpA);
    const uyari2 = await prisma.kopyaUyarisi.findUniqueOrThrow({ where: { id: yabanciUyari!.id } });
    kontrol("§8c defterde hiç olmayan kira kimliği → 200, aynı uyarının görülme sayısı arttı", uydurma.status === 200 && uyari2.gorulmeSayisi === 2, `görülme ${uyari2.gorulmeSayisi}`);
    const kipli = (sonKiraId: string | null, kip: "gozlem" | "zorla") => {
      const govde = yoklamaGovdesi({ sonKiraId, parmakIzi: fpA });
      return imzaliPost(sunucu.genel, ENDPOINTS.POLL, { kurulumId: k5.kurulumId, amac: "yokla", anahtar: anahtar5, govde: { ...govde, durum: { ...govde.durum, kip } } });
    };
    const w1 = kiraOf(uydurma)!.kiraId;
    const zorlaRapor = await kipli(w1, "zorla");
    const kipUyari = await prisma.kopyaUyarisi.findFirst({ where: { kurulumId: k5.kurulumDbId, tur: "KIP_UYUSMAZ", durum: "ACIK" } });
    kontrol("§8d kirası gözlemken 'zorla' raporu → 200 + KIP_UYUSMAZ uyarısı", zorlaRapor.status === 200 && kipUyari !== null, `${zorlaRapor.status}`);
    await prisma.kopyaUyarisi.updateMany({ where: { kurulumId: k5.kurulumDbId, tur: "KIP_UYUSMAZ" }, data: { durum: "KAPANDI", kapanisZamani: new Date(), kapatan: "bekci" } });
    const { setEnforcement } = await import("../src/services/sanction.service");
    await setEnforcement({ installationDbId: k5.kurulumDbId, enforce: true, reason: "zorla kipine geçiş", actor: "bekci" });
    const w2y = await kipli(kiraOf(zorlaRapor)!.kiraId, "gozlem");
    const acikKip = () => prisma.kopyaUyarisi.count({ where: { kurulumId: k5.kurulumDbId, tur: "KIP_UYUSMAZ", durum: "ACIK" } });
    kontrol("§8e ✓K zorlama yeni açıldı: ESKİ (gözlem) kirayla gelen 'gozlem' raporu uyarı DEĞİL", w2y.status === 200 && (await acikKip()) === 0, `${w2y.status} açık=${await acikKip()}`);
    const w3y = await kipli(kiraOf(w2y)!.kiraId, "gozlem");
    kontrol("§8f elindeki kira ZORLA iken 'gozlem' raporu (kira/durum silinip varsayılana dönülmüş) → KIP_UYUSMAZ, kira yine verilir", w3y.status === 200 && (await acikKip()) === 1, `${w3y.status} açık=${await acikKip()}`);
    void w0;

    await kapanisKopya();
    await kapanisTasimaIptal();
    await yabanciHak();
    await yerelMudahale();
    await uzatmaDosyasiUcu();
  } finally {
    await sunucu.durdur();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
