/**
 * DERLEME KANALI — panelin dağıtım kimliği derleme ANINDA `deploy/kanallar.json`dan gelir.
 *
 * Kimlik çalışma ağacına YAZILMAZ: `deploy/electron-paketle.sh <kod>` kanalı `TEKSERP_KANAL`
 * ortam değişkeniyle verir, bu dosya onu kayıttan çözer ve üç yapılandırma (electron-vite,
 * web derlemesi, vitest) aynı çözümü kullanır. Değişken yoksa kanal dinlenme işaretçisidir
 * (`shared/musteri.json` → `varsayilan`), yani geliştirme ve testler bugünkü kimlikle koşar.
 *
 * Kod `import { … } from "virtual:tekserp-channel"` ile okur (sarmalayıcı `shared/channel.ts`):
 * adlı dışa aktarımlar ağaç sallamaya girer, yalnız KULLANILAN değer pakete gömülür.
 * Bilinmeyen kanal derlemeyi durdurur (fail-closed); ağ ve dosya yazımı yok.
 */
import type { Plugin } from "vite";
import registry from "../deploy/kanallar.json";
import pointer from "./shared/musteri.json";

/** Kanalı taşıyan ortam değişkeni — `deploy/electron-paketle.sh` her derlemede açıkça verir. */
export const CHANNEL_ENV = "TEKSERP_KANAL";
/** `index.html` `<title>` yer tutucusu; derlemede pencere başlığıyla değiştirilir. */
export const TITLE_PLACEHOLDER = "%TEKSERP_WINDOW_TITLE%";
export const VIRTUAL_MODULE = "virtual:tekserp-channel";
const RESOLVED_VIRTUAL_MODULE = `\0${VIRTUAL_MODULE}`;

/** Kayıt defterindeki bir kanalın panelin ihtiyaç duyduğu alt kümesi. */
export interface PanelChannel {
  code: string;
  name: string;
  /** Hazırlık kanalında görünür işaret ("TEST FABRİKA"); üretimde `null` → hiçbir şey çizilmez. */
  label: string | null;
  appId: string;
  productName: string;
  packageName: string;
  erpUrl: string;
  updateFeedUrl: string;
  windowTitle: string;
}

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

/** Tanınmayan kod = hata (derleme durur). */
export function panelChannel(code: string): PanelChannel {
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

/** Kayıtlı kanal kodları (testler her kanalı ayrı ölçer). */
export const registeredChannelCodes = (): string[] => Object.keys(channels);

/** Derlenen kanal: ortam değişkeni varsa o, yoksa dinlenme işaretçisi. */
export function buildChannelCode(env: Record<string, string | undefined>): string {
  return env[CHANNEL_ENV] || pointer.kod;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sanal modülün kaynağı — her alan ayrı adlı dışa aktarım (ağaç sallama kullanılmayanı atar). */
export function virtualModuleSource(ch: PanelChannel): string {
  return (Object.entries(ch) as Array<[string, string | null]>)
    .map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
    .join("\n");
}

/**
 * Vite eklentisi: `virtual:tekserp-channel` modülünü üretir ve `index.html` başlığını yazar.
 * Yer tutucu bulunamazsa derleme durur — başlık sessizce eski kimlikte kalmasın.
 */
export function channelPlugin(ch: PanelChannel): Plugin {
  return {
    name: "tekserp-channel",
    resolveId: (id) => (id === VIRTUAL_MODULE ? RESOLVED_VIRTUAL_MODULE : null),
    load: (id) => (id === RESOLVED_VIRTUAL_MODULE ? virtualModuleSource(ch) : null),
    transformIndexHtml: {
      order: "pre",
      handler: (html) => {
        if (!html.includes(TITLE_PLACEHOLDER)) {
          throw new Error(`index.html <title> yer tutucusu (${TITLE_PLACEHOLDER}) yok — pencere başlığı kanaldan yazılamıyor`);
        }
        return html.split(TITLE_PLACEHOLDER).join(escapeHtml(ch.windowTitle));
      },
    },
  };
}
