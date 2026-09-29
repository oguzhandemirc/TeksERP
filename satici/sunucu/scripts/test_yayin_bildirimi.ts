// =============================================================================
// YAYIN BİLDİRİMİ + SÜRÜM GÖRÜNÜMÜ (Faz 3d). İmza betiğin KENDİSİYLE atılır (scripts/lib/yayin-bildirim.mjs) —
// tel biçimi iki uçta ayrışırsa burada kırmızı. Ölçülen:
//   §1 yayıncı anahtarı yalnız YÖNETİCİ kaydeder; biçimsiz/tekrar kid reddedilir
//   §2 imzalı bildirim deftere girer; aynı olayın tekrarı aynı satır (idempotent); TERFI/TERFI_ATLANDI
//   §3 red: kurcalanmış gövde · imzasız · tanınmayan yayıncı · eski zaman → 401; şema dışı anahtar → 400
//   §4 bildirim kanalın güncel sürümünü (kiraya akan) DEĞİŞTİRMEZ
//   §5 pasif yayıncı reddedilir; betik ağ/sunucu hatasında FIRLATMAZ (başarısız/atlandı döner)
//   §6 sürüm görünümü: salt-okunur yayın kökünden latest.yml · OTA manifesti · APK künyesi · defter TSV (en yeni önce);
//      kök yok/okunamaz → "ölçülemedi" durumu; görünüm modülü diske YAZMAZ
// Koşum: npx tsx scripts/test_yayin_bildirimi.ts   (yalnız *_test DB)
// =============================================================================
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseOverview } from "../src/distribution/releases.view";
import { dagitimOrtamiKur, genelIstek } from "./lib/dagitim-ortam";
import { hedefDbKapisi, kanalFiksturu, kapat, kontrol, SATICI_KOKU, sonuc, temizlePortal } from "./lib/test-ortam";

interface Betik {
  anahtarUret(g: { kid: string; dizin: string }): { kid: string; dosya: string; acikAnahtar: string };
  bildirimGovdesi(g: Record<string, unknown>): Buffer;
  imzala(govde: Buffer, pem: string): string;
  yayinBildir(olay: Record<string, unknown>, s?: Record<string, unknown>): Promise<{ durum: string; not: string }>;
  IMZA_BASLIGI: string;
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const m = (await import(pathToFileURL(path.resolve(SATICI_KOKU, "..", "..", "scripts", "lib", "yayin-bildirim.mjs")).href)) as Betik;
  const d = await dagitimOrtamiKur();
  const { prisma } = await import("../src/lib/prisma");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "yayinci-"));
  const ek = randomUUID().slice(0, 8);
  const kanal = await kanalFiksturu(`bekci-yayin-${ek}`);
  const kid = `bekci-yayinci-${ek}`;
  const yabanciKid = `bekci-yabanci-${ek}`;
  try {
    console.log("\n§1 yayıncı anahtarı");
    const a = m.anahtarUret({ kid, dizin: tmp });
    const yabanci = m.anahtarUret({ kid: yabanciKid, dizin: tmp });
    const opKayit = await d.p("POST", "/yayincilar", { kid, ad: "Mac yayıncı", acikAnahtar: a.acikAnahtar }, d.operator.cerez);
    const kayit = await d.p("POST", "/yayincilar", { kid, ad: "Mac yayıncı", acikAnahtar: a.acikAnahtar });
    const tekrar = await d.p("POST", "/yayincilar", { kid, ad: "x", acikAnahtar: a.acikAnahtar });
    const bozuk = await d.p("POST", "/yayincilar", { kid: `bekci-bozuk-${ek}`, ad: "x", acikAnahtar: "A".repeat(42) });
    kontrol("§1a operatör 403 · yönetici 201 · aynı kid 409 · biçimsiz açık anahtar (42 karakter) 400", opKayit.status === 403 && kayit.status === 201 && tekrar.status === 409 && bozuk.status === 400, `${opKayit.status}/${kayit.status}/${tekrar.status}/${bozuk.status}`);
    const liste = await d.p("GET", "/yayincilar", undefined, d.operator.cerez);
    kontrol("§1b liste yalnız açık yarıyı taşır", JSON.stringify(liste.json.data).includes(kid) && !JSON.stringify(liste.json.data).includes("PRIVATE"));

    console.log("\n§2 imzalı bildirim");
    const adres = `${d.sunucu.genel}/yayin/bildirim`;
    const ayar = { adres, kid, anahtar: a.dosya };
    const yayin = { olay: "YAYIN", urun: "panel", kanal, surum: "1.4.0", ayrinti: { tur: "kurulum", sha16: "0123456789abcdef", boyut: 1234 } };
    const r1 = await m.yayinBildir(yayin, { ayar });
    const r2 = await m.yayinBildir(yayin, { ayar });
    const r3 = await m.yayinBildir({ olay: "TERFI", urun: "panel", kanal, surum: "1.4.0", ayrinti: { etiket: `terfi/${kanal}/panel-v1.4.0` } }, { ayar });
    const r4 = await m.yayinBildir({ olay: "TERFI_ATLANDI", urun: "tablet", kanal, surum: "2.9.9", ayrinti: { tur: "ota", cumle: "acil düzeltme kullanıcı onayıyla çıkıyor" } }, { ayar });
    const satirlar = await prisma.yayinBildirimi.findMany({ where: { kanalKodu: kanal } });
    kontrol("§2a gönderildi → tekrar 'zaten-vardi' → terfi + atlama; defterde 3 satır", r1.durum === "gonderildi" && r2.durum === "zaten-vardi" && r3.durum === "gonderildi" && r4.durum === "gonderildi" && satirlar.length === 3, `${r1.durum}/${r2.durum}/${r3.durum}/${r4.durum} ${satirlar.length}`);
    const ilk = satirlar.find((x) => x.olay === "YAYIN")!;
    kontrol("§2b satır yayıncıyı, makineyi ve ayrıntıyı taşır", ilk.yayinciKid === kid && JSON.stringify(ilk.ayrinti).includes("0123456789abcdef") && JSON.stringify(ilk.ayrinti).includes("makine"));
    const degistir = await prisma.yayinBildirimi.update({ where: { id: ilk.id }, data: { surum: "9.9.9" } }).then(() => "yazıldı", (e: Error) => e.message);
    kontrol("§2c ✓K yayın defteri satırı DEĞİŞTİRİLEMEZ (tetikleyici)", /Defter satırı değiştirilemez/.test(degistir));

    console.log("\n§3 red");
    const pem = readFileSync(a.dosya, "utf8");
    const govde = m.bildirimGovdesi({ kid, olay: "YAYIN", urun: "tablet", kanal, surum: "3.0.0" });
    const imza = m.imzala(govde, pem);
    const post = (g: Buffer | string, s?: string) => genelIstek(d.sunucu.genel, "/yayin/bildirim", { yontem: "POST", govde: g, basliklar: { "Content-Type": "application/json", ...(s ? { [m.IMZA_BASLIGI]: s } : {}) } });
    const kurcali = await post(Buffer.from(govde.toString().replace("3.0.0", "3.0.1")), imza);
    const imzasiz = await post(govde);
    const yGovde = m.bildirimGovdesi({ kid: yabanciKid, olay: "YAYIN", urun: "tablet", kanal, surum: "3.0.0" });
    const tanimsiz = await post(yGovde, m.imzala(yGovde, readFileSync(yabanci.dosya, "utf8")));
    const baskaAnahtar = await post(govde, m.imzala(govde, readFileSync(yabanci.dosya, "utf8")));
    const eskiG = m.bildirimGovdesi({ kid, zaman: new Date(Date.now() - 20 * 60_000), olay: "YAYIN", urun: "tablet", kanal, surum: "3.0.0" });
    const eski = await post(eskiG, m.imzala(eskiG, pem));
    const fazlaG = Buffer.from(JSON.stringify({ ...JSON.parse(govde.toString()), fazla: 1 }));
    const fazla = await post(fazlaG, m.imzala(fazlaG, pem));
    const hepsi401 = [kurcali, imzasiz, tanimsiz, baskaAnahtar, eski].every((r) => r.status === 401 && r.kod === "YAYINCI_IMZASI_GECERSIZ");
    kontrol("§3a kurcalanmış · imzasız · tanınmayan yayıncı · başka anahtar · eski zaman → 401", hepsi401, [kurcali, imzasiz, tanimsiz, baskaAnahtar, eski].map((r) => r.status).join("/"));
    kontrol("§3b şema dışı anahtar → 400; hiçbiri deftere girmedi", fazla.status === 400 && (await prisma.yayinBildirimi.count({ where: { kanalKodu: kanal } })) === 3, `${fazla.status}`);
    const dogru = await post(govde, imza);
    kontrol("§3c aynı gövde doğru imzayla → 201 (red kurgusu değil gövde)", dogru.status === 201, `${dogru.status}`);

    console.log("\n§4 kanal kaydı");
    const k = await prisma.kanal.findUniqueOrThrow({ where: { kod: kanal } });
    kontrol("§4a bildirimler kanalın güncel sürümlerini (kiraya akan) değiştirmedi", JSON.stringify(k.guncelSurumler) === "{}", JSON.stringify(k.guncelSurumler));

    console.log("\n§5 pasif yayıncı · betik asla fırlatmaz");
    const kayitId = (kayit.veri as { id: string }).id;
    const pasif = await d.p("POST", `/yayincilar/${kayitId}/pasif`, { sebep: "anahtar Mac değişti" });
    const sonra = await m.yayinBildir({ ...yayin, surum: "1.4.1" }, { ayar });
    kontrol("§5a pasife alınan yayıncının bildirimi reddedilir (betik 'basarisiz', fırlatmadı)", pasif.status === 200 && sonra.durum === "basarisiz" && /401/.test(sonra.not), `${pasif.status} ${sonra.durum} ${sonra.not}`);
    const ulasilmaz = await m.yayinBildir(yayin, { ayar: { ...ayar, adres: "http://127.0.0.1:1/yayin/bildirim" }, zamanAsimiMs: 2000 });
    const ayarsiz = await m.yayinBildir(yayin, { ayar: null });
    const anahtarsiz = await m.yayinBildir(yayin, { ayar: { ...ayar, anahtar: path.join(tmp, "yok.pem") } });
    kontrol("§5b ulaşılmaz sunucu · yapılandırma yok · anahtar dosyası yok → fırlatmadan başarısız/atlandı", ulasilmaz.durum === "basarisiz" && ayarsiz.durum === "atlandi" && anahtarsiz.durum === "basarisiz");

    console.log("\n§6 sürüm görünümü");
    const kok = d.dizin.yayin;
    const diskKanal = `bekci-disk-${ek}`;
    mkdirSync(path.join(kok, "html", kanal, "electron"), { recursive: true });
    writeFileSync(path.join(kok, "html", kanal, "electron", "latest.yml"), "version: 1.4.0\nfiles:\n  - url: TeksERP-1.4.0-Setup.exe\n");
    mkdirSync(path.join(kok, "html", kanal, "mobil", "apk"), { recursive: true });
    writeFileSync(path.join(kok, "html", kanal, "mobil", "apk", "surum.json"), JSON.stringify({ versionName: "2.9.9", versionCode: 60 }));
    mkdirSync(path.join(kok, "html", kanal, "mobil", "ota", "54.2"), { recursive: true });
    const cok = `--sinir\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ id: "x", extra: { expoClient: { version: "2.9.9" } } })}\r\n--sinir--\r\n`;
    writeFileSync(path.join(kok, "html", kanal, "mobil", "ota", "54.2", "manifest"), cok);
    mkdirSync(path.join(kok, "html", diskKanal), { recursive: true });
    mkdirSync(path.join(kok, "defter"), { recursive: true });
    writeFileSync(path.join(kok, "defter", `${kanal}-YAYIN-DEFTERI.tsv`), ["2026-09-01T10:00:00+03:00\t1.3.9\tu@mac\taaaa\t100", "2026-09-20T10:00:00+03:00\t1.4.0\tu@mac\tbbbb\t200\tterfi-atlandi: acil"].join("\n") + "\n");
    const sv = await d.p("GET", "/surumler");
    const kanallar = (sv.veri as { kanallar: { kod: string; kayitli: unknown; yayinda: Record<string, unknown>; defter: { surum: string; not: string | null }[]; bildirimler: unknown[] }[] }).kanallar;
    const kv = kanallar.find((x) => x.kod === kanal)!;
    const yv = kv.yayinda as { panel: { surum: string }; tabletApk: { surum: string; vc: number }; tabletOta: { runtime: string; surum: string }[] };
    kontrol("§6a yayında: panel 1.4.0 · APK 2.9.9 (vc 60) · OTA 54.2 → 2.9.9", sv.veri.yayinKoku === "OLCULDU" && yv.panel.surum === "1.4.0" && yv.tabletApk.surum === "2.9.9" && yv.tabletApk.vc === 60 && yv.tabletOta[0]?.runtime === "54.2" && yv.tabletOta[0]?.surum === "2.9.9", JSON.stringify(yv).slice(0, 160));
    kontrol("§6b defter TSV en yeni önce, 6. kolon not; bildirimler 4", kv.defter[0]?.surum === "1.4.0" && /terfi-atlandi/.test(kv.defter[0]?.not ?? "") && kv.defter.length === 2 && kv.bildirimler.length === 4, `${kv.defter.length}/${kv.bildirimler.length}`);
    const disk = kanallar.find((x) => x.kod === diskKanal);
    kontrol("§6c yalnız diskte olan kanal da görünür (kayıt yok)", disk !== undefined && disk.kayitli === null);
    const bagsiz = await releaseOverview(prisma, undefined);
    const okunamaz = await releaseOverview(prisma, path.join(tmp, "yok"));
    kontrol("§6d kök bağlı değil → BAGLI_DEGIL, okunamıyor → OKUNAMADI (boş liste 'yayın yok' sayılmaz)", bagsiz.yayinKoku === "BAGLI_DEGIL" && okunamaz.yayinKoku === "OKUNAMADI" && bagsiz.kanallar.every((x) => x.yayinda === null));
    const kaynak = readFileSync(path.join(SATICI_KOKU, "src", "distribution", "releases.view.ts"), "utf8");
    kontrol("§6e görünüm modülü diske yazmaz (salt-okunur)", !/writeFile|appendFile|\brm\(|unlink|mkdir|rename|copyFile|createWriteStream/.test(kaynak));
  } finally {
    await d.temizle({ yayinciKidler: [kid, yabanciKid], bildirimKanallari: [kanal] });
    await temizlePortal({ kanallar: [kanal] });
    rmSync(tmp, { recursive: true, force: true });
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
