/**
 * DERLEME KİMLİĞİ — panelin paket kimliği derleme ANINDA kayıttan gelir, kaynağa yazılmaz.
 *
 * Varsayılan (argümansız paketleme, geliştirme, testler): TEK ORTAK kimlik `deploy/dagitim.json`
 * (`panelKimligi`, scripts/lib/dagitim.mjs). Firma adı lisanstan, grup kiradan gelir; derleme
 * müşteri bilmez.
 *
 * ESKİ KANAL YOLU (yalnız `deploy/electron-paketle.sh <kod>`; O15'te kalkar): `TEKSERP_KANAL` verilirse
 * kimlik donuk `deploy/kanallar.json`daki o kanaldan çözülür — çıktısı bugünkü kanal paketiyle aynıdır.
 *
 * Kod `import { … } from "virtual:tekserp-channel"` ile okur (sarmalayıcı `shared/channel.ts`):
 * adlı dışa aktarımlar ağaç sallamaya girer, yalnız KULLANILAN değer pakete gömülür.
 * Bilinmeyen kanal / geçersiz kayıt derlemeyi durdurur (fail-closed); ağ ve dosya yazımı yok.
 */
import type { Plugin } from "vite";
import registry from "../deploy/kanallar.json";
import dagitim from "../deploy/dagitim.json";
import { kayitHatalari, panelKimligi } from "../scripts/lib/dagitim.mjs";

/** Eski kanal yolunu seçen ortam değişkeni — yalnız `deploy/electron-paketle.sh <kod>` verir. */
export const CHANNEL_ENV = "TEKSERP_KANAL";
/** `index.html` `<title>` yer tutucusu; derlemede pencere başlığıyla değiştirilir. */
export const TITLE_PLACEHOLDER = "%TEKSERP_WINDOW_TITLE%";
export const VIRTUAL_MODULE = "virtual:tekserp-channel";
const RESOLVED_VIRTUAL_MODULE = `\0${VIRTUAL_MODULE}`;

/** Derlenen panelin kimliği (sanal modülün alanları). */
export interface PanelIdentity {
  /** Güncelleme grubu/kanalı — künyenin `kanal` alanıyla kıyaslanır. Ortakta dinlenme grubu. */
  code: string;
  name: string;
  /** Görünür deneme işareti; ortakta ve üretim kanalında `null` → hiçbir şey çizilmez. */
  label: string | null;
  appId: string;
  productName: string;
  packageName: string;
  /** Keşif bulamazsa denenen sunucu; ortakta YOK (adres keşiften / elle girişten). */
  erpUrl: string | null;
  updateFeedUrl: string;
  windowTitle: string;
}
/** Geriye uyum adı (eski kanal yolu). */
export type PanelChannel = PanelIdentity;

interface RegistryChannel {
  ad: string;
  gorunurEtiket: string | null;
  yayin: { panelFeed: string };
  panel: { appId: string; urunAdi: string; paketAdi: string; erpAdresi: string };
}

const channels = registry.kanallar as unknown as Record<string, RegistryChannel>;

/** Etiket BAŞTA: görev çubuğu dar başlığı kırparken işaret görünür kalsın. */
export function windowTitleOf(productName: string, label: string | null): string {
  return label ? `${label} · ${productName}` : productName;
}

/** Tek ortak kimlik — `deploy/dagitim.json`; kayıt geçersizse derleme durur. */
export function sharedIdentity(kayit: unknown = dagitim): PanelIdentity {
  const h = kayitHatalari(kayit);
  if (h.length) throw new Error(`deploy/dagitim.json GEÇERSİZ — ${h[0]}${h.length > 1 ? ` (+${h.length - 1})` : ""}`);
  const k = panelKimligi(kayit);
  return {
    code: k.grup,
    name: k.urunAdi,
    label: null,
    appId: k.appId,
    productName: k.urunAdi,
    packageName: k.paketAdi,
    erpUrl: null,
    updateFeedUrl: k.feed,
    windowTitle: windowTitleOf(k.urunAdi, null),
  };
}

/** ESKİ KANAL YOLU: tanınmayan kod = hata (derleme durur). */
export function panelChannel(code: string): PanelIdentity {
  const c = Object.prototype.hasOwnProperty.call(channels, code) ? channels[code] : undefined;
  if (!c) {
    throw new Error(`BİLİNMEYEN KANAL "${code}" — deploy/kanallar.json kayıtlı kanallar: ${Object.keys(channels).join(", ")}`);
  }
  return {
    code,
    name: c.ad,
    label: c.gorunurEtiket,
    appId: c.panel.appId,
    productName: c.panel.urunAdi,
    packageName: c.panel.paketAdi,
    erpUrl: c.panel.erpAdresi,
    updateFeedUrl: c.yayin.panelFeed,
    windowTitle: windowTitleOf(c.panel.urunAdi, c.gorunurEtiket),
  };
}

/** Eski kayıtlı kanal kodları (testler her kanalı ayrı ölçer). */
export const registeredChannelCodes = (): string[] => Object.keys(channels);

/** Derlenen kimlik: `TEKSERP_KANAL` varsa eski kanal yolu, yoksa tek ortak kimlik. */
export function buildIdentity(env: Record<string, string | undefined>): PanelIdentity {
  const kod = env[CHANNEL_ENV];
  return kod ? panelChannel(kod) : sharedIdentity();
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sanal modülün kaynağı — her alan ayrı adlı dışa aktarım (ağaç sallama kullanılmayanı atar). */
export function virtualModuleSource(ch: PanelIdentity): string {
  return (Object.entries(ch) as Array<[string, string | null]>)
    .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
    .join("\n");
}

/**
 * Vite eklentisi: `virtual:tekserp-channel` modülünü üretir ve `index.html` başlığını yazar.
 * Yer tutucu bulunamazsa derleme durur — başlık sessizce eski kimlikte kalmasın.
 */
export function channelPlugin(ch: PanelIdentity): Plugin {
  return {
    name: "tekserp-channel",
    resolveId: (id) => (id === VIRTUAL_MODULE ? RESOLVED_VIRTUAL_MODULE : null),
    load: (id) => (id === RESOLVED_VIRTUAL_MODULE ? virtualModuleSource(ch) : null),
    transformIndexHtml: {
      order: "pre",
      handler: (html) => {
        if (!html.includes(TITLE_PLACEHOLDER)) {
          throw new Error(`index.html <title> yer tutucusu (${TITLE_PLACEHOLDER}) yok — pencere başlığı kayıttan yazılamıyor`);
        }
        return html.split(TITLE_PLACEHOLDER).join(escapeHtml(ch.windowTitle));
      },
    },
  };
}
