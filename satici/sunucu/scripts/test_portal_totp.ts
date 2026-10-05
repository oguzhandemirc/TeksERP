// =============================================================================
// PORTAL — TOTP ZORUNLULUĞU. TOTP'siz oturum YOKTUR: giriş tek adımdır (kullanıcı adı + parola +
// TOTP), eksik/yanlış/tekrar oynatılmış kod oturum açmaz; hata iletisi tek (hangi faktörün tutmadığı
// sızmaz); ardışık başarısızlık hesabı süreli kilitler ve KİLİTLİ hesap BİLİNMEYEN hesapla aynı yanıtı
// alır (kilit hesabın varlığını sızdırmaz). Sır DB'de sarılı (AAD kullanıcıya bağlı);
// kurulum sırrı yalnız açılış yanıtında bir kez (saklanan tekrar yanıtında yok). Çerez httpOnly +
// SameSite=Strict + yol sınırlı. TOTP sıfırlanınca açık oturumlar kapanır.
// Ölçüm gerçek HTTP ile (süreç içi iki dinleyici, kendi `_test` DB'si).
// İlk yönetici yalnız CLI'dan doğar (parola stdin/TTY; argv RED) ve portala girebilir.
// Kullanıcı adı tekil: ön okuma da, ön okumayı geçen eşzamanlı açılışın UNIQUE ihlali de (P2002)
// AYNI 409 KULLANICI_ADI_KULLANIMDA'ya iner — 500 değil.
// ⭐ KALICI SONDA ✓K3 (her koşumda): (1) aynı adımın kodu reddedilirken SONRAKİ adımın kodu kabul
//    edilir — tekrar kilidi adım bazlı, körü körüne ret değil · (2) doğru üçlü 200 verir (her şeyi
//    reddeden bir kapı "401" yeşili veremez) · (3) tekillik ihlali hedefi `kullaniciAdi`da tutar, `id`de
//    TUTMAZ (hedef okuyucusu her P2002'yi aynı sanmıyor).
// Koşum: npx tsx scripts/test_portal_totp.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  SATICI_KOKU,
  anahtarOrtamiKur,
  hedefDbKapisi,
  kapat,
  kontrol,
  portalGiris,
  portalIstek,
  portalKullaniciAc,
  portalSunuculariKur,
  sonuc,
  temizlePortal,
  totpKodu,
  type PortalKimlik,
} from "./lib/test-ortam";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur(Date.now(), { PORTAL_GIRIS_ESIGI: "3", PORTAL_KILIT_DK: "15", PORTAL_GIRIS_HIZ_DK: "1000" });
  const { ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { base32Encode, hotp, verifyTotp } = await import("../src/portal/totp");
  const kullanicilar: string[] = [];
  const sunucu = await portalSunuculariKur(ctx);
  const ac = async (rol: PortalKimlik["rol"]) => {
    const k = await portalKullaniciAc(ctx, rol);
    kullanicilar.push(k.id);
    return k;
  };
  try {
    console.log("\n§0 RFC 6238 test vektörleri (SHA1, son 6 hane)");
    const rfc = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    const vektorler: [number, string][] = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    const sapan = vektorler.filter(([t, kod]) => hotp(rfc, Math.floor(t / 30)) !== kod).map(([t]) => t);
    kontrol("§0 beş RFC vektörü tutar", sapan.length === 0, sapan.join(","));

    console.log("\n§1 TOTP'siz giriş YOK");
    const k = await ac("SATICI_YONETICI");
    const yol = "/portal/api/oturum/ac";
    const eksik = await portalIstek(sunucu.portal, yol, { govde: { kullaniciAdi: k.kullaniciAdi, parola: k.parola } });
    kontrol("§1a totp alanı olmadan → 400 (şema: alan zorunlu)", eksik.status === 400 && eksik.kod === "GOVDE_GECERSIZ", `${eksik.status} ${eksik.kod}`);
    const bos = await portalIstek(sunucu.portal, yol, { govde: { kullaniciAdi: k.kullaniciAdi, parola: k.parola, totp: "" } });
    kontrol("§1b boş totp → 400", bos.status === 400, `${bos.status}`);
    const baskaSir = base32Encode(Buffer.from(randomUUID()));
    const yanlisKod = await portalGiris(sunucu.portal, "/portal/api", k, { totp: hotp(baskaSir, Math.floor(Date.now() / 30_000)) });
    kontrol("§1c doğru parola + YANLIŞ kod → 401 GIRIS_BASARISIZ, çerez yok", yanlisKod.status === 401 && yanlisKod.kod === "GIRIS_BASARISIZ" && yanlisKod.setCookie === null, `${yanlisKod.status} ${yanlisKod.kod}`);
    const yanlisParola = await portalGiris(sunucu.portal, "/portal/api", k, { parola: "yanlis-parola-uzun-degil-mi" });
    const bilinmeyen = await portalIstek(sunucu.portal, yol, { govde: { kullaniciAdi: "hic-olmayan-kullanici", parola: "x".repeat(20), totp: "123456" } });
    const iletiler = new Set([yanlisKod.json.message, yanlisParola.json.message, bilinmeyen.json.message]);
    kontrol("§1d yanlış parola / yanlış kod / bilinmeyen hesap → AYNI 401 iletisi (faktör sızmaz)", yanlisParola.status === 401 && bilinmeyen.status === 401 && iletiler.size === 1, [...iletiler].join(" | "));
    // Bu kullanıcının iki hatası sayaçta; temiz bir hesapla devam edilir.

    console.log("\n§2 doğru üçlü → oturum; çerez biçimi");
    const k2 = await ac("SATICI_YONETICI");
    // Kod bir kez üretilir: §3a AYNI kodu yeniden oynatır (30 sn adım sınırı iki çağrı arasına düşerse
    // yeniden hesaplanan kod sonraki adımın kodu olurdu ve kilit ölçülmezdi).
    const ilkKod = await totpKodu(k2.sir, 0);
    const giris = await portalGiris(sunucu.portal, "/portal/api", k2, { totp: ilkKod });
    kontrol("§2a ✓K doğru kullanıcı + parola + TOTP → 200", giris.status === 200 && giris.cerez !== null, `${giris.status} ${giris.kod ?? ""}`);
    const sc = giris.setCookie ?? "";
    kontrol("§2b çerez HttpOnly + SameSite=Strict + Path=/portal", /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Path=\/portal(;|$)/.test(sc), sc.replace(/=[A-Za-z0-9_-]{43}/, "=…"));
    const ben = await portalIstek(sunucu.portal, "/portal/api/oturum", { cerez: giris.cerez! });
    kontrol("§2c çerezle GET /oturum → 200 + kullanıcı", ben.status === 200 && (ben.veri.kullanici as { id?: string } | undefined)?.id === k2.id);
    const cerezsiz = await portalIstek(sunucu.portal, "/portal/api/pano");
    kontrol("§2d çerezsiz korumalı uç → 401 OTURUM_YOK", cerezsiz.status === 401 && cerezsiz.kod === "OTURUM_YOK", `${cerezsiz.status} ${cerezsiz.kod}`);
    const oturumSatiri = await prisma.portalOturumu.findFirst({ where: { kullaniciId: k2.id } });
    kontrol("§2e belirteç DB'de düz değil (sha256)", oturumSatiri !== null && !giris.cerez!.includes(oturumSatiri.belirtecOzeti) && oturumSatiri.belirtecOzeti.length === 64);

    console.log("\n§3 tekrar oynatma kilidi");
    const tekrar = await portalGiris(sunucu.portal, "/portal/api", k2, { totp: ilkKod });
    kontrol("§3a aynı adımın kodu ikinci kez → 401 (doğru parolaya rağmen)", tekrar.status === 401, `${tekrar.status}`);
    const sonraki = await portalGiris(sunucu.portal, "/portal/api", k2, { adimKaydir: 1 });
    kontrol("§3b ✓K SONRAKİ adımın kodu kabul → 200 (kilit adım bazlı)", sonraki.status === 200, `${sonraki.status} ${sonraki.kod ?? ""}`);
    const an = Date.now();
    const safKod = await totpKodu(k2.sir, 0, an);
    const saf = verifyTotp(k2.sir, safKod, { atMs: an, lastUsedStep: null });
    const safTekrar = saf.ok ? verifyTotp(k2.sir, safKod, { atMs: an, lastUsedStep: saf.step }) : saf;
    kontrol("§3c saf doğrulayıcı: ilk kabul, aynı adım TEKRAR", saf.ok && !safTekrar.ok && safTekrar.reason === "TEKRAR");

    console.log("\n§4 ardışık başarısızlık kilidi (eşik 3)");
    const k3 = await ac("SATICI_OPERATOR");
    for (let i = 0; i < 3; i++) await portalGiris(sunucu.portal, "/portal/api", k3, { totp: "000000" });
    const kilitli = await portalGiris(sunucu.portal, "/portal/api", k3);
    const hayalet = await portalGiris(sunucu.portal, "/portal/api", { ...k3, kullaniciAdi: `yok-${randomUUID().slice(0, 12)}` });
    kontrol(
      "§4a 3 hatadan sonra DOĞRU üçlü bile giremez ve yanıt BİLİNMEYEN hesapla aynı (401 GIRIS_BASARISIZ, aynı ileti)",
      kilitli.status === 401 && kilitli.kod === "GIRIS_BASARISIZ" && kilitli.status === hayalet.status && kilitli.kod === hayalet.kod && kilitli.json.message === hayalet.json.message && kilitli.cerez === null,
      `${kilitli.status} ${kilitli.kod} / ${hayalet.status} ${hayalet.kod}`,
    );
    const kilitliRed = await prisma.denetim.count({ where: { varlikId: k3.id, olay: "PORTAL_GIRIS_REDDEDILDI" } });
    kontrol("§4a2 kilitli girişin reddi denetimde (PORTAL_GIRIS_REDDEDILDI · KILITLI)", kilitliRed === 1, `${kilitliRed}`);
    const satir = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: k3.id } });
    const kilitDk = satir.kilitBitis ? (satir.kilitBitis.getTime() - Date.now()) / 60_000 : 0;
    kontrol("§4b kilitBitis ~15 dk sonra, sayaç sıfırlandı", kilitDk > 14 && kilitDk <= 15 && satir.basarisizGiris === 0, kilitDk.toFixed(1));
    const kilitDenetim = await prisma.denetim.count({ where: { varlikId: k3.id, olay: "PORTAL_HESAP_KILITLENDI" } });
    kontrol("§4c kilit denetimde (PORTAL_HESAP_KILITLENDI)", kilitDenetim === 1);
    await prisma.portalKullanici.update({ where: { id: k3.id }, data: { kilitBitis: new Date(Date.now() - 1000) } });
    const acildi = await portalGiris(sunucu.portal, "/portal/api", k3);
    kontrol("§4d kilit süresi dolunca doğru üçlü → 200", acildi.status === 200, `${acildi.status}`);

    console.log("\n§5 sır saklama ve kurulum yanıtı");
    const ham = await prisma.portalKullanici.findUniqueOrThrow({ where: { id: k2.id } });
    kontrol("§5a DB'de TOTP sırrı düz değil (sarılı v1.…)", !ham.totpSirSifreli.includes(k2.sir) && ham.totpSirSifreli.startsWith("v1."));
    kontrol("§5b sarılı sır BAŞKA kullanıcı kimliğiyle açılmaz (AAD)", ctx.portalSecrets.open(ham.totpSirSifreli, k3.id) === null && ctx.portalSecrets.open(ham.totpSirSifreli, k2.id) === k2.sir);
    kontrol("§5c parola özeti scrypt, düz parola yok", ham.parolaOzeti.startsWith("scrypt$") && !ham.parolaOzeti.includes(k2.parola));
    const token = randomUUID();
    const yeniAd = `bekci-${randomUUID().slice(0, 12)}`;
    const govde = { clientToken: token, kullaniciAdi: yeniAd, adSoyad: "Yeni Operatör", rol: "SATICI_OPERATOR", parola: `op-parola-${randomUUID()}` };
    const acilis = await portalIstek(sunucu.portal, "/portal/api/kullanicilar", { cerez: giris.cerez!, govde });
    const acilisTotp = acilis.veri.totp as { sir?: string; otpauthUri?: string } | null;
    const yeniId = (acilis.veri.kullanici as { id?: string } | undefined)?.id;
    if (yeniId) kullanicilar.push(yeniId);
    kontrol("§5d hesap açılışı → 201 + TOTP sırrı ve otpauth URI (bir kez)", acilis.status === 201 && typeof acilisTotp?.sir === "string" && /^otpauth:\/\/totp\//.test(acilisTotp.otpauthUri ?? ""), `${acilis.status} ${acilis.kod ?? ""}`);
    const tekrarAcilis = await portalIstek(sunucu.portal, "/portal/api/kullanicilar", { cerez: giris.cerez!, govde });
    kontrol(
      "§5e aynı işlem kimliğiyle tekrar → aynı hesap, sır YOK (totpGosterilemez)",
      tekrarAcilis.status === 201 && (tekrarAcilis.veri.kullanici as { id?: string }).id === yeniId && tekrarAcilis.veri.totp === null && tekrarAcilis.veri.totpGosterilemez === true && tekrarAcilis.basliklar.get("idempotent-replay") === "true",
    );
    const islem = await prisma.portalIslemi.findUnique({ where: { clientToken: token } });
    const islemMetni = JSON.stringify(islem);
    kontrol("§5f saklanan yanıtta ve gövde özetinde sır/parola yok", islem !== null && !islemMetni.includes(acilisTotp?.sir ?? "∅") && !islemMetni.includes(govde.parola));
    const denetimMetni = JSON.stringify(await prisma.denetim.findMany({ where: { varlikId: yeniId ?? "" } }));
    kontrol("§5g denetimde sır/parola yok", !denetimMetni.includes(acilisTotp?.sir ?? "∅") && !denetimMetni.includes(govde.parola));

    console.log("\n§5h kullanıcı adı yarışı → 409 KULLANICI_ADI_KULLANIMDA");
    const ayniAd = await portalIstek(sunucu.portal, "/portal/api/kullanicilar", { cerez: giris.cerez!, govde: { ...govde, clientToken: randomUUID() } });
    kontrol("§5h1 alınmış ad (yeni işlem kimliği) → 409 KULLANICI_ADI_KULLANIMDA", ayniAd.status === 409 && ayniAd.kod === "KULLANICI_ADI_KULLANIMDA", `${ayniAd.status} ${ayniAd.kod}`);
    const { createPortalUserTx } = await import("../src/portal/users.service");
    const { hashPortalPassword } = await import("../src/portal/password");
    const { uniqueViolationOn } = await import("../src/lib/prisma-errors");
    const yarisAd = `bekci-${randomUUID().slice(0, 12)}`;
    const ozet = await hashPortalPassword(`yaris-${randomUUID()}`);
    // A satırı yazar ama COMMIT'i bekletir; B'nin ön okuması onu GÖRMEZ, INSERT'i A'nın commit'ini bekler → P2002.
    let birak: () => void = () => undefined;
    let yazdi: () => void = () => undefined;
    const aYazdi = new Promise<void>((r) => (yazdi = r));
    const a = prisma.$transaction(
      async (tx) => {
        const u = await tx.portalKullanici.create({ data: { kullaniciAdi: yarisAd, adSoyad: "Yarış A", rol: "SATICI_OPERATOR", parolaOzeti: ozet, totpSirSifreli: "v1.x", parolaDegisim: new Date() } });
        yazdi();
        await new Promise<void>((r) => (birak = r));
        return u.id;
      },
      { timeout: 20_000 },
    );
    await aYazdi;
    const b = prisma
      .$transaction((tx) => createPortalUserTx(tx, ctx, { username: yarisAd, fullName: "Yarış B", role: "SATICI_OPERATOR", passwordHash: ozet }))
      .then(() => "OLUSTU")
      .catch((err: { code?: string }) => err.code ?? String(err));
    setTimeout(() => birak(), 300);
    kullanicilar.push(await a);
    const bSonuc = await b;
    kontrol("§5h2 ön okumayı geçen eşzamanlı açılış (UNIQUE ihlali) → KULLANICI_ADI_KULLANIMDA, ham P2002/500 değil", bSonuc === "KULLANICI_ADI_KULLANIMDA", bSonuc);
    let ihlal: unknown = null;
    try {
      await prisma.portalKullanici.create({ data: { kullaniciAdi: yarisAd, adSoyad: "x", rol: "SATICI_OPERATOR", parolaOzeti: ozet, totpSirSifreli: "v1.x", parolaDegisim: new Date() } });
    } catch (err) {
      ihlal = err;
    }
    kontrol("§5h3 ✓K hedef ayrımı: aynı ad ihlali `kullaniciAdi`da tutar, `id`de TUTMAZ", uniqueViolationOn(ihlal, "kullaniciAdi") && !uniqueViolationOn(ihlal, "id"));

    console.log("\n§6 TOTP sıfırlama oturumları kapatır");
    const oturumOnce = await portalIstek(sunucu.portal, "/portal/api/oturum", { cerez: acildi.cerez! });
    const sifirla = await portalIstek(sunucu.portal, `/portal/api/kullanicilar/${k3.id}/totp-sifirla`, {
      cerez: giris.cerez!,
      govde: { clientToken: randomUUID(), sebep: "telefon kayboldu" },
    });
    const oturumSonra = await portalIstek(sunucu.portal, "/portal/api/oturum", { cerez: acildi.cerez! });
    const eskiSirle = await portalGiris(sunucu.portal, "/portal/api", k3, { adimKaydir: 1 });
    const yeniSir = (sifirla.veri.totp as { sir: string }).sir;
    const yeniSirle = await portalGiris(sunucu.portal, "/portal/api", { ...k3, sir: yeniSir });
    kontrol("§6a sıfırlama → açık oturum 401'e düşer", oturumOnce.status === 200 && sifirla.status === 200 && oturumSonra.status === 401, `${oturumOnce.status}/${sifirla.status}/${oturumSonra.status}`);
    kontrol("§6b eski sırrın kodu artık 401, yeni sırrınki 200", eskiSirle.status === 401 && yeniSirle.status === 200, `${eskiSirle.status}/${yeniSirle.status}`);

    console.log("\n§7 pasif hesap giremez; kendi hesabını pasife alamaz");
    const kendi = await portalIstek(sunucu.portal, `/portal/api/kullanicilar/${k2.id}/pasif`, { cerez: giris.cerez!, govde: { clientToken: randomUUID(), sebep: "deneme" } });
    kontrol("§7a kendi hesabını pasife alma → 400", kendi.status === 400, `${kendi.status}`);
    const pasif = await portalIstek(sunucu.portal, `/portal/api/kullanicilar/${k3.id}/pasif`, { cerez: giris.cerez!, govde: { clientToken: randomUUID(), sebep: "işten ayrıldı" } });
    const pasifGiris = await portalGiris(sunucu.portal, "/portal/api", { ...k3, sir: yeniSir }, { adimKaydir: 1 });
    kontrol("§7b pasif hesap doğru üçlüyle de → 401 (aynı ileti)", pasif.status === 200 && pasifGiris.status === 401 && pasifGiris.json.message === yanlisKod.json.message, `${pasif.status}/${pasifGiris.status}`);

    console.log("\n§8 ilk yönetici CLI'dan (scripts/portal-kullanici.ts)");
    const cliAd = `bekci-${randomUUID().slice(0, 12)}`;
    const cliParola = `cli-parola-${randomUUID()}`;
    const cli = (argv: string[], stdin: string) =>
      spawnSync(process.execPath, ["--import", "tsx", "scripts/portal-kullanici.ts", ...argv], {
        cwd: SATICI_KOKU,
        input: stdin,
        encoding: "utf8",
        // CLI de sunucu gibi çapa kipi ister (konteynerde compose verir); bekçi fikstür çapasını dosyadan verir.
        env: { ...process.env, ANAHTAR_DIZINI: ortam.dizin, GUVEN_CAPASI_DOSYASI: ortam.capaDosyasi },
        timeout: 60_000,
      });
    const argvParola = cli(["ekle", `--kullanici=${cliAd}`, "--ad-soyad=CLI Yönetici", "--rol=SATICI_YONETICI", `--parola=${cliParola}`], "");
    kontrol("§8a --parola argümanı REDDEDİLİR (çıkış 2, kullanıcı açılmaz)", argvParola.status === 2 && (await prisma.portalKullanici.count({ where: { kullaniciAdi: cliAd } })) === 0, `${argvParola.status}`);
    const ekle = cli(["ekle", `--kullanici=${cliAd}`, "--ad-soyad=CLI Yönetici", "--rol=SATICI_YONETICI"], `${cliParola}\n${cliParola}\n`);
    const cliSir = /Sır\s*:\s*([A-Z2-7]+)/.exec(ekle.stdout)?.[1];
    const cliSatir = await prisma.portalKullanici.findUnique({ where: { kullaniciAdi: cliAd } });
    if (cliSatir) kullanicilar.push(cliSatir.id);
    kontrol("§8b parola stdin'den → çıkış 0, TOTP sırrı çıktıda BİR KEZ", ekle.status === 0 && typeof cliSir === "string" && cliSatir?.rol === "SATICI_YONETICI", `${ekle.status} ${ekle.stderr.trim().slice(0, 120)}`);
    const cliGiris = cliSatir && cliSir ? await portalGiris(sunucu.portal, "/portal/api", { id: cliSatir.id, kullaniciAdi: cliAd, parola: cliParola, sir: cliSir, rol: "SATICI_YONETICI" }) : null;
    kontrol("§8c CLI'nın açtığı yönetici portala girer (parola + TOTP)", cliGiris?.status === 200, `${cliGiris?.status}`);
  } finally {
    await sunucu.kapat();
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
