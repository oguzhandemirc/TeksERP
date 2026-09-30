// =============================================================================
// İMZA PAROLASI KAPISI (D11) — kök ve bayi parolası portal formundan gelir ve tek başına lisans imzalar.
//   §1 kullanıcı başına ardışık 5 yanlış parola → 6. deneme DOĞRU parolayla bile 429 IMZA_PAROLASI_KILITLI;
//      kilit parola imza alt sürecine GİTMEDEN verilir (sürüm yazılmaz); her başarısız deneme denetim satırı
//      (IMZA_PAROLASI_BASARISIZ) + kilit satırı (IMZA_PAROLASI_KILITLENDI); parola hiçbir satıra girmez
//   §2 kilit süresi dolunca doğru parola imzalar; sayaç sıfır
//   §3 sayaç ARDIŞIK hatayı sayar: araya giren başarılı imza sıfırlar (4 hata kilitlemez)
//   §4 portaldaki her imza hazırlığı (kök ve bayi) kapıdan geçer — rota tablosunda sarılmamış hazırlık yok
//   §5 imza alt süreci semaforu: eşzamanlı alt süreç yapılandırılan slotu (1–2) aşmaz; kuyruk tavanı
//      aşılınca yeni istek beklemez, 429 HIZ_SINIRI alır
//   §6 aynı kullanıcının EŞZAMANLI denemeleri sıraya girer: 8 paralel yanlış parolanın tam 5'i denetlenir,
//      kalanı kilide takılır (sıra olmasaydı hepsi kilit denetimini birlikte geçip 8 tahmin yaptırırdı)
//   §7 imza KAPSAMI (tek boğaz `signWithWrappedKey`, anahtar türü DOSYADAN): kapsamsız kök imzası 500 · ERİŞİM ve
//      GENEL'den kök imzası 404 · TAILNET ve CLI geçer · bayi anahtarı yalnız GENEL/CLI; reddedilen parola hiçbir
//      sürece YAZILMAZ ve Buffer'ı sıfırlanır
// ⭐ KALICI SONDA ✓K5 (her koşumda): kilit öncesi 5 deneme GERÇEKTEN parola denetler (400, 429 değil) ·
//    araya giren başarı kilidi önler · 2 slotta iki imza GERÇEKTEN aynı anda koşar (slot kör değil) ·
//    eşzamanlı denemelerin 5'i gerçekten denetlenir (kilit körü körüne herkesi reddetmez) · TAILNET kapsamında kök
//    imzası GERÇEKTEN imzalar ve GENEL'de bayi anahtarı kapsamı geçer (§7 reddi kör RED değil).
// Koşum: npx tsx scripts/test_imza_parolasi.ts   (kendi _test DB'si)
// =============================================================================
import type { Socket } from "node:net";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { TYP } from "../src/lisans-protokol";
import { passwordBuffer, wrapPrivateKey, writeKeyFileExclusive } from "../src/keys/key-files";
import { runAsCli, runInScope, type ScopeOrigin } from "../src/lib/request-scope";
import { sertifikaYuku } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  SATICI_KOKU,
  TEST_KOK_PAROLASI,
  anahtarOrtamiKur,
  hedefDbKapisi,
  kapat,
  kontrol,
  kurulumFiksturu,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizleKurulumlar,
  temizlePortal,
} from "./lib/test-ortam";

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { signWithWrappedKey, setSignerConcurrency, signerSlotsInUse, spawnSignerProcess } = await import("../src/keys/signer");
  const temizlenecek: string[] = [];
  const kullanicilar: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  try {
    const yonetici = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici.id);
    const cerez = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici)).cerez!;
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const surumle = (parola: string) =>
      portalIstek(sunucu.tailnet, `/portal/api/haklar/${k.hakId}/surum`, { cerez, govde: { clientToken: randomUUID(), kokParolasi: parola, sebep: "imza kapısı bekçisi" } });
    const surum = async () => (await prisma.hak.findUniqueOrThrow({ where: { id: k.hakId } })).guncelSurum;
    const YANLIS = "yanlis-kok-parolasi-bekci";

    console.log("\n§1 ardışık 5 yanlış → kilit");
    const durumlar: string[] = [];
    for (let i = 0; i < 5; i++) {
      const y = await surumle(YANLIS);
      durumlar.push(`${y.status}:${y.kod}`);
    }
    kontrol("§1a ✓K kilide dek her deneme GERÇEKTEN denetlenir → 5 × 400 IMZA_PAROLASI_HATALI", durumlar.every((d) => d === "400:IMZA_PAROLASI_HATALI"), durumlar.join(","));
    const surumOnce = await surum();
    const kilitli = await surumle(TEST_KOK_PAROLASI);
    kontrol("§1b 6. deneme DOĞRU parolayla bile → 429 IMZA_PAROLASI_KILITLI, sürüm yazılmadı", kilitli.status === 429 && kilitli.kod === "IMZA_PAROLASI_KILITLI" && (await surum()) === surumOnce, `${kilitli.status} ${kilitli.kod}`);
    const satir = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id } });
    const kilitDk = satir.imzaKilitBitis ? (satir.imzaKilitBitis.getTime() - Date.now()) / 60_000 : 0;
    kontrol("§1c kilit ~15 dk, sayaç sıfırlandı; GİRİŞ kilidi değil (portal okunur)", kilitDk > 14 && kilitDk <= 15 && satir.imzaBasarisiz === 0 && satir.kilitBitis === null, kilitDk.toFixed(1));
    const okuma = await portalIstek(sunucu.tailnet, `/portal/api/haklar/${k.hakId}`, { cerez });
    kontrol("§1d imza kilidinde portal okumaya devam eder (200)", okuma.status === 200, `${okuma.status}`);
    const denetim = await prisma.denetim.findMany({ where: { varlikId: yonetici.id, olay: { in: ["IMZA_PAROLASI_BASARISIZ", "IMZA_PAROLASI_KILITLENDI"] } } });
    const metin = JSON.stringify(denetim);
    kontrol(
      "§1e denetim: 5 başarısız deneme + 1 kilit satırı; parola hiçbirinde yok",
      denetim.filter((d) => d.olay === "IMZA_PAROLASI_BASARISIZ").length === 5 && denetim.filter((d) => d.olay === "IMZA_PAROLASI_KILITLENDI").length === 1 && !metin.includes(YANLIS) && !metin.includes(TEST_KOK_PAROLASI),
      `${denetim.length} satır`,
    );

    console.log("\n§2 kilit bitince");
    await prisma.portalKullanici.update({ where: { id: yonetici.id }, data: { imzaKilitBitis: new Date(Date.now() - 1_000) } });
    const acildi = await surumle(TEST_KOK_PAROLASI);
    kontrol("§2a kilit süresi dolunca doğru parola → 201, yeni sürüm", acildi.status === 201 && (await surum()) === surumOnce + 1, `${acildi.status} ${acildi.kod ?? ""}`);

    console.log("\n§3 ardışık sayım");
    for (let i = 0; i < 2; i++) await surumle(YANLIS);
    const basari = await surumle(TEST_KOK_PAROLASI);
    const sifir = (await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id } })).imzaBasarisiz;
    const dortHata: number[] = [];
    for (let i = 0; i < 4; i++) dortHata.push((await surumle(YANLIS)).status);
    const sonDurum = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: yonetici.id } });
    kontrol(
      "§3a ✓K başarılı imza sayacı sıfırlar; ardından 4 hata KİLİTLEMEZ (hepsi 400)",
      basari.status === 201 && sifir === 0 && dortHata.every((d) => d === 400) && sonDurum.imzaBasarisiz === 4 && (sonDurum.imzaKilitBitis === null || sonDurum.imzaKilitBitis.getTime() < Date.now()),
      `${basari.status} sayaç ${sifir} → ${dortHata.join(",")} (${sonDurum.imzaBasarisiz})`,
    );

    console.log("\n§4 portaldaki her imza hazırlığı kapıdan geçer");
    const httpDizin = path.join(SATICI_KOKU, "src", "http");
    let hazirlik = 0;
    let sarili = 0;
    for (const dosya of readdirSync(httpDizin).filter((d) => d.endsWith(".ts"))) {
      const kaynak = readFileSync(path.join(httpDizin, dosya), "utf8");
      hazirlik += (kaynak.match(/\bprepare(Dealer)?EntitlementVersion\(/g) ?? []).length;
      sarili += (kaynak.match(/withSigningPasswordGuard\([^]*?\bprepare(Dealer)?EntitlementVersion\(/g) ?? []).length;
    }
    kontrol("§4a rota katmanındaki imza hazırlıklarının hepsi withSigningPasswordGuard içinde (kök + bayi)", hazirlik >= 2 && sarili === hazirlik, `${sarili}/${hazirlik}`);

    console.log("\n§5 imza alt süreci semaforu");
    const kokDosyasi = path.join(ortam.dizin, `${f.kok.kid}.kok.json`);
    const imzala = () =>
      runAsCli(() => signWithWrappedKey({ keyFile: kokDosyasi, typ: TYP.SERTIFIKA, payload: sertifikaYuku(f, f.alt, "ALT") as unknown as Record<string, unknown>, password: passwordBuffer(TEST_KOK_PAROLASI) }));
    const olc = async (adet: number): Promise<{ enCok: number; hepsi: boolean }> => {
      let enCok = 0;
      let bitti = false;
      const gozcu = (async () => {
        while (!bitti) {
          enCok = Math.max(enCok, signerSlotsInUse());
          await bekle(5);
        }
      })();
      const sonuclar = await Promise.allSettled(Array.from({ length: adet }, () => imzala()));
      bitti = true;
      await gozcu;
      return { enCok, hepsi: sonuclar.every((r) => r.status === "fulfilled") };
    };
    setSignerConcurrency(1);
    const tek = await olc(3);
    kontrol("§5a tek slot: 3 eşzamanlı imza tamamlanır, aynı anda en çok 1 alt süreç", tek.hepsi && tek.enCok === 1, `en çok ${tek.enCok}`);
    setSignerConcurrency(2);
    const cift = await olc(4);
    kontrol("§5b ✓K iki slot: aynı anda GERÇEKTEN 2 alt süreç, 2'yi aşmaz", cift.hepsi && cift.enCok === 2, `en çok ${cift.enCok}`);
    setSignerConcurrency(1);
    const tasma = await Promise.allSettled(Array.from({ length: 10 }, () => imzala()));
    const red = tasma.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason as { code?: string; status?: number });
    kontrol(
      "§5c kuyruk tavanı (1 çalışan + 8 bekleyen) aşılınca yeni istek 429 HIZ_SINIRI",
      red.length === 1 && red[0]!.status === 429 && red[0]!.code === "HIZ_SINIRI" && tasma.filter((r) => r.status === "fulfilled").length === 9,
      `${red.length} red ${red.map((r) => r.code).join(",")}`,
    );

    console.log("\n§6 eşzamanlı denemeler eşiği aşamaz (kullanıcı başına sıra)");
    const yonetici2 = await portalKullaniciAc(ctx, "SATICI_YONETICI");
    kullanicilar.push(yonetici2.id);
    const cerez2 = (await portalGiris(sunucu.tailnet, "/portal/api", yonetici2)).cerez!;
    const paralel = await Promise.all(
      Array.from({ length: 8 }, () =>
        portalIstek(sunucu.tailnet, `/portal/api/haklar/${k.hakId}/surum`, { cerez: cerez2, govde: { clientToken: randomUUID(), kokParolasi: YANLIS, sebep: "eşzamanlı tahmin" } }),
      ),
    );
    const denendi = paralel.filter((y) => y.status === 400 && y.kod === "IMZA_PAROLASI_HATALI").length;
    const kilitlendi = paralel.filter((y) => y.status === 429 && y.kod === "IMZA_PAROLASI_KILITLI").length;
    const basarisizSatir = await prisma.denetim.count({ where: { varlikId: yonetici2.id, olay: "IMZA_PAROLASI_BASARISIZ" } });
    kontrol(
      "§6a ✓K aynı kullanıcının 8 eşzamanlı yanlış denemesi → tam 5'i parola denetler (400), kalan 3'ü kilide takılır (429); denetimde 5 satır",
      denendi === 5 && kilitlendi === 3 && basarisizSatir === 5,
      `${denendi}×400 ${kilitlendi}×429 · denetim ${basarisizSatir}`,
    );

    console.log("\n§7 imza kapsamı — tek boğaz, anahtar türü dosyadan");
    const kokYolu = path.join(ortam.dizin, `${f.kok.kid}.kok.json`);
    const bayiYolu = path.join(ortam.dizin, "bayi-sonda-2099.bayi.json");
    writeKeyFileExclusive(bayiYolu, await wrapPrivateKey({ tur: "tekserp-bayi-anahtar", kid: "bayi-sonda-2099", siniflar: ["URETIM"] }, generateKeyPairSync("ed25519").privateKey, passwordBuffer("bayi-sonda-parolasi")));
    const yuk = sertifikaYuku(f, f.alt, "ALT") as unknown as Record<string, unknown>;
    /** Kapsam altında imza dener; kukla alt sürece YAZILAN bayt sayısı ve parola Buffer'ının sonu ölçülür. */
    const dene = async (keyFile: string, parola: string, kapsam: ScopeOrigin | null): Promise<{ sonuc: string; yazilan: number; sifir: boolean }> => {
      const kukla = spawnSignerProcess();
      const buf = passwordBuffer(parola);
      const is = () => signWithWrappedKey({ keyFile, typ: TYP.SERTIFIKA, payload: yuk, password: buf, child: kukla });
      let sonuc = "GECTI";
      try {
        await (kapsam === null ? is() : runInScope(kapsam, is, kapsam === "ERISIM" ? "sonda@ornek.test" : undefined));
      } catch (err) {
        const e = err as { status?: number; code?: string; message?: string };
        sonuc = e.status !== undefined ? `${e.status} ${e.code}` : `HATA ${e.message ?? ""}`;
      }
      const yazilan = (kukla.stdin as Socket | null)?.bytesWritten ?? -1;
      kukla.kill();
      return { sonuc, yazilan, sifir: buf.every((b) => b === 0) };
    };
    const kapsamsiz = await dene(kokYolu, TEST_KOK_PAROLASI, null);
    kontrol("§7a ⭐ kapsamsız kök imzası RED 500; parola hiçbir sürece yazılmadı, Buffer sıfırlandı", kapsamsiz.sonuc === "500 SUNUCU_HATASI" && kapsamsiz.yazilan === 0 && kapsamsiz.sifir, JSON.stringify(kapsamsiz));
    const erisimden = await dene(kokYolu, TEST_KOK_PAROLASI, "ERISIM");
    const genelden = await dene(kokYolu, TEST_KOK_PAROLASI, "GENEL");
    kontrol(
      "§7b ⭐ ERİŞİM'den ve GENEL'den kök imzası 404; parola alt sürece yazılmadı",
      erisimden.sonuc === "404 BULUNAMADI" && genelden.sonuc === "404 BULUNAMADI" && erisimden.yazilan === 0 && genelden.yazilan === 0 && erisimden.sifir && genelden.sifir,
      `${erisimden.sonuc} / ${genelden.sonuc}`,
    );
    const tailnetten = await dene(kokYolu, TEST_KOK_PAROLASI, "TAILNET");
    const cliden = await dene(kokYolu, TEST_KOK_PAROLASI, "CLI");
    kontrol("§7c ✓K TAILNET ve CLI kapsamında kök imzası GERÇEKTEN imzalar (parola alt sürece gitti)", tailnetten.sonuc === "GECTI" && cliden.sonuc === "GECTI" && tailnetten.yazilan > 0, `${tailnetten.sonuc}/${cliden.sonuc} · ${tailnetten.yazilan} bayt`);
    const bayiTailnet = await dene(bayiYolu, "bayi-sonda-parolasi", "TAILNET");
    const bayiGenel = await dene(bayiYolu, "bayi-sonda-parolasi", "GENEL");
    kontrol(
      "§7d tür DOSYADAN: bayi anahtarı TAILNET'te 404; GENEL'de kapsamı GEÇER (alt süreç sertifikayı kendi kuralıyla reddeder)",
      bayiTailnet.sonuc === "404 BULUNAMADI" && bayiTailnet.yazilan === 0 && bayiGenel.sonuc.startsWith("HATA İmza reddedildi (YETKISIZ)") && bayiGenel.yazilan > 0,
      `${bayiTailnet.sonuc} / ${bayiGenel.sonuc.slice(0, 60)}`,
    );
  } finally {
    setSignerConcurrency(1);
    await sunucu.kapat();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
    await temizlePortal({ kullanicilar });
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
