import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_UPDATE_FEED_URL } from "@shared/update-feed";
import { APP_ID, CHANNEL_CODE, PRODUCT_NAME, WINDOW_TITLE } from "@shared/channel";
import { TITLE_PLACEHOLDER, channelPlugin, sharedIdentity, virtualModuleSource } from "../../build-identity";

/**
 * Panelin paket kimliğini ve yayın adresinin kopyalarını birbirine kilitler (tek ortak paket O5).
 *
 * Kimlik derleme ANINDA kayıttan gelir: TEK ORTAK kimlik (`deploy/dagitim.json`). Donuk eski kanal kaydı
 * (`deploy/kanallar.json`) yalnız AYRILIK için okunur: ortak paket adnansahin paneliyle çakışmamalı.
 * electron-builder'a `-c.*` ile, koda Vite sanal modülüyle (`shared/channel.ts`). Ağaçtaki `package.json`
 * dinlenme tabanıdır ve ORTAK kimliği taşır; müşteri işaretçisi (`shared/musteri.json`) yoktur.
 *
 * Paketin İÇİNE gerçekten ne yazıldığını derlemeden SONRA `scripts/panel-kimlik-kapisi.mjs paket` okur.
 */
const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as {
  name: string;
  productName: string;
  description: string;
  build: {
    appId: string;
    productName: string;
    publish?: Array<{ provider: string; url: string }>;
    directories: { output: string };
    nsis: { shortcutName: string; uninstallDisplayName: string };
    win: { artifactName: string };
    mac: { artifactName: string };
  };
};
type Dagitim = {
  urun: { panel: { appId: string; urunAdi: string; paketAdi: string } };
  indirmeKoku: string;
  gruplar: Array<{ kod: string; terfiKaynagi: string | null }>;
};
const dagitim = JSON.parse(readFileSync(resolve(process.cwd(), "../deploy/dagitim.json"), "utf-8")) as Dagitim;
const eski = JSON.parse(readFileSync(resolve(process.cwd(), "../deploy/kanallar.json"), "utf-8")) as {
  kanallar: Record<string, { ad: string; panel: { appId: string; urunAdi: string; paketAdi: string }; yayin: { panelFeed: string } }>;
};
const kokGrup = dagitim.gruplar.find((g) => g.terfiKaynagi === null)!.kod;

describe("derlenen kimlik — tek ortak", () => {
  it("gömülü kimlik ortak kimlikle birebir (appId · ürün adı · adres · başlık)", () => {
    const k = sharedIdentity();
    expect(CHANNEL_CODE).toBe(k.code);
    expect(APP_ID).toBe(k.appId);
    expect(PRODUCT_NAME).toBe(k.productName);
    expect(DEFAULT_UPDATE_FEED_URL).toBe(k.updateFeedUrl);
    expect(WINDOW_TITLE).toBe(k.windowTitle);
  });

  it("⭐ derleme TEK ORTAK kimliği gömer (müşteri bilmez)", () => {
    expect(APP_ID).toBe(dagitim.urun.panel.appId);
    expect(PRODUCT_NAME).toBe(dagitim.urun.panel.urunAdi);
    expect(WINDOW_TITLE).toBe(dagitim.urun.panel.urunAdi);
    expect(CHANNEL_CODE).toBe(kokGrup);
    expect(DEFAULT_UPDATE_FEED_URL).toBe(`${dagitim.indirmeKoku}${kokGrup}/electron/`);
  });

  it("ortak kimlik kayıttan TÜRER: kök grup = dinlenme grubu, adres indirme kökünden, etiket ve sunucu yok", () => {
    const k = sharedIdentity();
    expect(k).toEqual({
      code: kokGrup,
      name: dagitim.urun.panel.urunAdi,
      appId: dagitim.urun.panel.appId,
      productName: dagitim.urun.panel.urunAdi,
      packageName: dagitim.urun.panel.paketAdi,
      updateFeedUrl: `${dagitim.indirmeKoku}${kokGrup}/electron/`,
      windowTitle: dagitim.urun.panel.urunAdi,
      // Grup akışı (O6): her grubun feed'i indirme kökünden, terfi sırasıyla.
      groupFeeds: Object.fromEntries(dagitim.gruplar.map((g) => [g.kod, `${dagitim.indirmeKoku}${g.kod}/electron/`])),
    });
    expect(Object.keys(k.groupFeeds)[0]).toBe(kokGrup);
    // Kayıttaki değer tek kaynaktır: kopya kayıtta appId değişirse kimlik de değişir.
    expect(sharedIdentity({ ...dagitim, urun: { ...dagitim.urun, panel: { ...dagitim.urun.panel, appId: "com.ornek.baska" } } }).appId).toBe(
      "com.ornek.baska",
    );
  });

  it("⭐ ortak kimlik hiçbir eski kanalın kimliğini paylaşmaz (adnansahin paneliyle yan yana kurulur)", () => {
    const k = sharedIdentity();
    for (const [kod, c] of Object.entries(eski.kanallar)) {
      expect(k.appId.toLowerCase(), kod).not.toBe(c.panel.appId.toLowerCase());
      expect(k.productName.toLowerCase(), kod).not.toBe(c.panel.urunAdi.toLowerCase());
      expect(k.packageName.toLowerCase(), kod).not.toBe(c.panel.paketAdi.toLowerCase());
      expect(new URL(k.updateFeedUrl).host, kod).not.toBe(new URL(c.yayin.panelFeed).host);
    }
  });

  it("⭐ geçersiz dağıtım kaydı derlemeyi DURDURUR (fail-closed)", () => {
    const bozuk = { ...dagitim, urun: { ...dagitim.urun, panel: { ...dagitim.urun.panel, appId: "Büyük Harf" } } };
    expect(() => sharedIdentity(bozuk)).toThrow(/dagitim\.json GEÇERSİZ/);
    expect(() => sharedIdentity({ ...dagitim, gizli: 1 })).toThrow(/tanınmayan anahtar/);
  });
});

describe("sanal modül ve başlık", () => {
  it("sanal modül her alanı adlı dışa aktarım olarak verir (ağaç sallama kullanılmayanı atar)", () => {
    const src = virtualModuleSource(sharedIdentity());
    expect(src).toContain(`export const appId = ${JSON.stringify(dagitim.urun.panel.appId)};`);
    expect(src).not.toMatch(/export const (label|erpUrl) /);
    expect(src).not.toMatch(/export default/);
  });

  it("⭐ index.html başlığı kayıttan yazılır; yer tutucu yoksa derleme durur", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");
    expect(html).toContain(`<title>${TITLE_PLACEHOLDER}</title>`);
    const hook = channelPlugin(sharedIdentity()).transformIndexHtml as unknown as { handler: (h: string) => string };
    expect(hook.handler(html)).toContain(`<title>${dagitim.urun.panel.urunAdi}</title>`);
    expect(() => hook.handler("<title>Sabit Ad</title>")).toThrow(/yer tutucusu/);
  });
});

describe("dinlenme tabanı — package.json ORTAK kimliği taşır, müşteri işaretçisi yok", () => {
  it("shared/musteri.json YOK (derleme müşteri bilmez)", () => {
    expect(existsSync(resolve(process.cwd(), "shared/musteri.json"))).toBe(false);
  });

  it("package.json kimlik alanları + publish adresi + çıktı dizini ortak kimlikle birebir", () => {
    const k = sharedIdentity();
    const publish = pkg.build.publish ?? [];
    expect(publish.length, "build.publish yok → electron-builder latest.yml ÜRETMEZ").toBeGreaterThan(0);
    expect(publish[0]!.provider).toBe("generic");
    expect(publish[0]!.url).toBe(k.updateFeedUrl);
    expect(pkg.name).toBe(k.packageName);
    expect(pkg.productName).toBe(k.productName);
    expect(pkg.description).toBe(`${k.productName} — Admin Panel by Etkili Yazılım`);
    expect(pkg.build.appId).toBe(k.appId);
    expect(pkg.build.productName).toBe(k.productName);
    expect(pkg.build.nsis.shortcutName).toBe(k.productName);
    expect(pkg.build.nsis.uninstallDisplayName).toBe(k.productName);
    expect(pkg.build.directories.output).toBe("release/ortak/${version}");
  });
});

describe("otomatik güncelleme yayın yapılandırması", () => {
  it("grup/kanal kodu URL'de güvenli (küçük harf, rakam, tire)", () => {
    expect(CHANNEL_CODE).toMatch(/^[a-z0-9][a-z0-9-]{1,39}$/);
  });

  it("adres sonunda / ile biter (electron-updater latest.yml'i EKLER)", () => {
    expect(DEFAULT_UPDATE_FEED_URL.endsWith("/")).toBe(true);
    expect(sharedIdentity().updateFeedUrl.endsWith("/")).toBe(true);
  });

  it("kurulum dosyası adı ASCII — Türkçe karakter/boşluk taşımaz", () => {
    // Dosya adı latest.yml içinde URL olarak geçer; `${productName}` Türkçe/boşluklu adı dosyaya taşır ve
    // ad sunucuya aktarımda sessizce bozulur (güncelleme 404). Ürün adı kısayolda kalır, DOSYA adı ASCII olur.
    for (const name of [pkg.build.win.artifactName, pkg.build.mac.artifactName]) {
      expect(name, `artifactName ASCII olmalı: ${name}`).toMatch(/^[\x20-\x7E]+$/);
      expect(name).not.toContain("${productName}");
      expect(name).not.toContain(" ");
    }
  });
});
