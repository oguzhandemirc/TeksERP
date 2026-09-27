import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_UPDATE_FEED_URL, MUSTERI_KODU, UPDATE_BASE_URL } from "@shared/update-feed";
import { APP_ID, CHANNEL_CODE, CHANNEL_LABEL, PRODUCT_NAME, WINDOW_TITLE } from "@shared/channel";
import {
  CHANNEL_ENV,
  TITLE_PLACEHOLDER,
  buildChannelCode,
  channelPlugin,
  panelChannel,
  registeredChannelCodes,
  virtualModuleSource,
  windowTitleOf,
} from "../../build-channel";

/**
 * Yayın adresinin ve panel kimliğinin kopyalarını birbirine kilitler.
 *
 * Kimlik derleme ANINDA kanal kaydından (`deploy/kanallar.json`) gelir: electron-builder'a
 * `-c.*` ile (`app-update.yml`, appId, ürün adı), koda Vite sanal modülüyle
 * (`shared/channel.ts`). Ağaçtaki `package.json` + `shared/musteri.json` yalnız DİNLENME
 * değeridir (varsayilan kanal) ve ezilen tabandır.
 *
 * İKİ AYRI ARIZA SINIFI kilitleniyor:
 *  ① **Adres ayrışması** — uygulama A'ya bakar, ekran B yazar, "dosyayı
 *    sunucuya koydum ama gelmiyor" denir ve teşhis edilecek iz kalmaz.
 *  ② **Yanlış müşteri** — paket başka bir fabrikanın kanalını gösterir ve o
 *    fabrikanın güncellemesini indirip kurar. Bu daha sinsidir: dosyalar kendi
 *    aralarında TUTARLIDIR, yalnızca yanlış müşteriyi gösterirler.
 *
 * `deploy/electron-paketle.sh` bu dosyayı derlemeden ÖNCE `TEKSERP_KANAL=<kod>` ile koşar:
 * derlenecek kanalın kaydı çözülüyor mu burada ölçülür. Paketin İÇİNE gerçekten ne
 * yazıldığını derlemeden SONRA `scripts/kanal-kapisi.mjs panel-yayin` okur.
 */
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
  name: string;
  build: {
    appId: string;
    productName: string;
    publish?: Array<{ provider: string; url: string }>;
    win: { artifactName: string };
    mac: { artifactName: string };
  };
};
const musteri = JSON.parse(readFileSync(resolve(process.cwd(), "shared/musteri.json"), "utf-8")) as Record<
  string,
  string
>;
const kayit = JSON.parse(readFileSync(resolve(process.cwd(), "../deploy/kanallar.json"), "utf-8")) as {
  varsayilan: string;
};

describe("derlenen kanal — kimlik kayıttan", () => {
  it("derlenen kanal = TEKSERP_KANAL ya da dinlenme işaretçisi", () => {
    expect(CHANNEL_CODE).toBe(process.env[CHANNEL_ENV] || musteri.kod);
    expect(MUSTERI_KODU).toBe(CHANNEL_CODE);
  });

  it("gömülü kimlik kaydın o kanalıyla birebir (appId · ürün adı · adres · başlık · etiket)", () => {
    const k = panelChannel(CHANNEL_CODE);
    expect(APP_ID).toBe(k.appId);
    expect(PRODUCT_NAME).toBe(k.productName);
    expect(DEFAULT_UPDATE_FEED_URL).toBe(k.updateFeedUrl);
    expect(WINDOW_TITLE).toBe(k.windowTitle);
    expect(CHANNEL_LABEL).toBe(k.label);
  });

  it("güncelleme adresi kanal KODUNDAN türer (elle yazılmış ikinci kopya yok)", () => {
    expect(DEFAULT_UPDATE_FEED_URL).toBe(`${UPDATE_BASE_URL}${CHANNEL_CODE}/electron/`);
  });

  it("her kayıtlı kanal çözülüyor: adres kökten türer, başlık ürün adını (ve varsa etiketi) taşır", () => {
    const kodlar = registeredChannelCodes();
    expect(kodlar.length).toBeGreaterThanOrEqual(2);
    for (const kod of kodlar) {
      const k = panelChannel(kod);
      expect(k.updateFeedUrl, kod).toBe(`${UPDATE_BASE_URL}${kod}/electron/`);
      expect(k.windowTitle, kod).toContain(k.productName);
      if (k.label) expect(k.windowTitle, kod).toContain(k.label);
      else expect(k.windowTitle, kod).toBe(k.productName);
    }
  });

  it("⭐ üretim kanalında etiket YOK → başlık ürün adının kendisi (bugünkü görünüm)", () => {
    expect(windowTitleOf("Adnan Şahin ERP", null)).toBe("Adnan Şahin ERP");
    expect(windowTitleOf("TeksERP Test Fabrika", "TEST FABRİKA")).toBe("TEST FABRİKA · TeksERP Test Fabrika");
  });

  it("⭐ tanınmayan kanal derlemeyi DURDURUR (fail-closed)", () => {
    expect(() => panelChannel("testfabirka")).toThrow(/BİLİNMEYEN KANAL/);
    expect(buildChannelCode({ [CHANNEL_ENV]: "testfabrika" })).toBe("testfabrika");
    expect(buildChannelCode({})).toBe(musteri.kod);
  });

  it("sanal modül her alanı adlı dışa aktarım olarak verir (ağaç sallama kullanılmayanı atar)", () => {
    const src = virtualModuleSource(panelChannel("testfabrika"));
    expect(src).toContain('export const appId = "com.etkiliyazilim.teks-erp.testfabrika";');
    expect(src).toContain('export const label = "TEST FABRİKA";');
    expect(src).not.toMatch(/export default/);
  });

  it("⭐ index.html başlığı kanaldan yazılır; yer tutucu yoksa derleme durur", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");
    expect(html).toContain(`<title>${TITLE_PLACEHOLDER}</title>`);
    const hook = channelPlugin(panelChannel("testfabrika")).transformIndexHtml as unknown as {
      handler: (h: string) => string;
    };
    expect(hook.handler(html)).toContain("<title>TEST FABRİKA · TeksERP Test Fabrika</title>");
    expect(() => hook.handler("<title>Adnan Şahin ERP</title>")).toThrow(/yer tutucusu/);
  });
});

describe("dinlenme tabanı — package.json + musteri.json varsayilan kanalı gösterir", () => {
  it("musteri.json yalnız kodu taşır ve o kod varsayilan kanal", () => {
    expect(Object.keys(musteri)).toEqual(["kod"]);
    expect(musteri.kod).toBe(kayit.varsayilan);
  });

  it("package.json publish adresi + appId + ürün adı varsayilan kanalınki", () => {
    const publish = pkg.build.publish ?? [];
    expect(publish.length, "build.publish yok → electron-builder latest.yml ÜRETMEZ").toBeGreaterThan(0);
    const v = panelChannel(kayit.varsayilan);
    expect(publish[0]!.provider).toBe("generic");
    expect(publish[0]!.url).toBe(v.updateFeedUrl);
    expect(pkg.build.appId).toBe(v.appId);
    expect(pkg.build.productName).toBe(v.productName);
    expect(pkg.name).toBe(v.packageName);
  });
});

describe("otomatik güncelleme yayın yapılandırması", () => {
  it("müşteri kodu URL'de güvenli (küçük harf, rakam, tire)", () => {
    // Türkçe karakter ya da boşluk taşıyan bir kod, adresi aktarımda sessizce
    // bozulan bir yayına çevirir.
    expect(CHANNEL_CODE).toMatch(/^[a-z0-9][a-z0-9-]{1,30}$/);
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
