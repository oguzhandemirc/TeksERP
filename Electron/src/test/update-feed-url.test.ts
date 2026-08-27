import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_UPDATE_FEED_URL, MUSTERI_KODU, UPDATE_BASE_URL } from "@shared/update-feed";

/**
 * Yayın adresinin üç kopyasını birbirine kilitler.
 *
 * Adres bir kez `package.json > build.publish` içinden pakete gömülür
 * (uygulamanın gerçekten baktığı yer), bir kez `shared/update-feed.ts`ten
 * türetilir (Ayarlar ekranının yazdığı ve elle kontrolün kullandığı yer), ve
 * ikisi de `shared/musteri.json`daki müşteri kodundan beslenir.
 *
 * İKİ AYRI ARIZA SINIFI kilitleniyor:
 *  ① **Adres ayrışması** — uygulama A'ya bakar, ekran B yazar, "dosyayı
 *    sunucuya koydum ama gelmiyor" denir ve teşhis edilecek iz kalmaz.
 *  ② **Yanlış müşteri** — paket başka bir fabrikanın kanalını gösterir ve o
 *    fabrikanın güncellemesini indirip kurar. Bu daha sinsidir: dosyalar kendi
 *    aralarında TUTARLIDIR, yalnızca yanlış müşteriyi gösterirler. Tek
 *    müşteriyle hiç görünmez, ikinci fabrikada patlar.
 *
 * ⚠️ Bu bekçi KAYNAK dosyalara bakar. Paketin İÇİNE gerçekten ne yazıldığını
 * `deploy/electron-paketle.sh` derlemeden SONRA `app-update.yml`den okuyup
 * doğrular — kaynak doğru olduğu halde çıktının yanlış olması mümkündür
 * (mobil tarafında tam olarak bu yaşandı).
 */
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
  build: {
    publish?: Array<{ provider: string; url: string }>;
    win: { artifactName: string };
    mac: { artifactName: string };
  };
};
const musteri = JSON.parse(
  readFileSync(resolve(process.cwd(), "shared/musteri.json"), "utf-8"),
) as { kod: string; ad: string };

describe("otomatik güncelleme yayın yapılandırması", () => {
  it("package.json publish adresi shared sabitiyle birebir aynı", () => {
    const publish = pkg.build.publish ?? [];
    expect(publish.length, "build.publish yok → electron-builder latest.yml ÜRETMEZ").toBeGreaterThan(0);
    const first = publish[0]!;
    expect(first.provider).toBe("generic");
    expect(first.url).toBe(DEFAULT_UPDATE_FEED_URL);
  });

  it("adres MÜŞTERİ kodundan türetiliyor (elle yazılmış ikinci kopya yok)", () => {
    expect(MUSTERI_KODU).toBe(musteri.kod);
    expect(DEFAULT_UPDATE_FEED_URL).toBe(`${UPDATE_BASE_URL}${musteri.kod}/electron/`);
    // package.json'daki adres de aynı müşteriyi göstermeli — bu, "yanlış
    // fabrikaya güncelleme" arızasının tek mekanik kapısı.
    expect(pkg.build.publish?.[0]?.url).toContain(`/${musteri.kod}/electron/`);
  });

  it("müşteri kodu URL'de güvenli (küçük harf, rakam, tire)", () => {
    // Türkçe karakter ya da boşluk taşıyan bir kod, adresi aktarımda sessizce
    // bozulan bir yayına çevirir.
    expect(musteri.kod).toMatch(/^[a-z0-9][a-z0-9-]{1,30}$/);
    expect(musteri.ad.trim().length).toBeGreaterThan(0);
  });

  it("adres sonunda / ile biter (electron-updater latest.yml'i EKLER)", () => {
    expect(DEFAULT_UPDATE_FEED_URL.endsWith("/")).toBe(true);
    expect(UPDATE_BASE_URL.endsWith("/")).toBe(true);
  });

  it("kurulum dosyası adı ASCII — Türkçe karakter/boşluk taşımaz", () => {
    // Dosya adı latest.yml içinde URL olarak geçer. `productName` ("Adnan Şahin
    // ERP") kullanılırsa ad "Adnan Şahin ERP-2.8.2-Setup.exe" olur; bu ad
    // sunucuya aktarımda (FTP/nginx/Windows→Linux kopya) sessizce bozulur ve
    // güncelleme 404 alır. Ürün adı kısayolda kalır, DOSYA adı ASCII olur.
    for (const name of [pkg.build.win.artifactName, pkg.build.mac.artifactName]) {
      expect(name, `artifactName ASCII olmalı: ${name}`).toMatch(/^[\x20-\x7E]+$/);
      expect(name).not.toContain("${productName}");
      expect(name).not.toContain(" ");
    }
  });
});
