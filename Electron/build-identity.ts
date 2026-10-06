/**
 * DERLEME KİMLİĞİ — panelin paket kimliği derleme ANINDA kayıttan gelir, kaynağa yazılmaz.
 *
 * Tek kaynak: TEK ORTAK kimlik `deploy/dagitim.json` (`panelKimligi`, scripts/lib/dagitim.mjs). Firma adı
 * lisanstan, grup kiradan gelir; derleme müşteri bilmez. Eski kanal yolu emekli (`eski-kanal-son` etiketi).
 *
 * Kod `import { … } from "virtual:tekserp-channel"` ile okur (sarmalayıcı `shared/channel.ts`):
 * adlı dışa aktarımlar ağaç sallamaya girer, yalnız KULLANILAN değer pakete gömülür.
 * Geçersiz kayıt derlemeyi durdurur (fail-closed); ağ ve dosya yazımı yok.
 */
import type { Plugin } from "vite";
import dagitim from "../deploy/dagitim.json";
import { kayitHatalari, panelKimligi } from "../scripts/lib/dagitim.mjs";

/** `index.html` `<title>` yer tutucusu; derlemede pencere başlığıyla değiştirilir. */
export const TITLE_PLACEHOLDER = "%TEKSERP_WINDOW_TITLE%";
export const VIRTUAL_MODULE = "virtual:tekserp-channel";
const RESOLVED_VIRTUAL_MODULE = `\0${VIRTUAL_MODULE}`;

/** Derlenen panelin kimliği (sanal modülün alanları). */
export interface PanelIdentity {
  /** Dinlenme grubu (kök grup) — gömülü taban; çalışan panel grubu kiradan alır. */
  code: string;
  name: string;
  appId: string;
  productName: string;
  packageName: string;
  updateFeedUrl: string;
  windowTitle: string;
  /** Güncelleme grubu → panel feed'i (terfi sırasıyla); feed kiradaki gruptan seçilir, künye o grubun adını taşır. */
  groupFeeds: Readonly<Record<string, string>>;
}

/** Tek ortak kimlik — `deploy/dagitim.json`; kayıt geçersizse derleme durur. */
export function sharedIdentity(kayit: unknown = dagitim): PanelIdentity {
  const h = kayitHatalari(kayit);
  if (h.length) throw new Error(`deploy/dagitim.json GEÇERSİZ — ${h[0]}${h.length > 1 ? ` (+${h.length - 1})` : ""}`);
  const k = panelKimligi(kayit);
  return {
    code: k.grup,
    name: k.urunAdi,
    appId: k.appId,
    productName: k.urunAdi,
    packageName: k.paketAdi,
    updateFeedUrl: k.feed,
    windowTitle: k.urunAdi,
    groupFeeds: { ...k.grupFeedleri },
  };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sanal modülün kaynağı — her alan ayrı adlı dışa aktarım (ağaç sallama kullanılmayanı atar). */
export function virtualModuleSource(ch: PanelIdentity): string {
  return (Object.entries(ch) as Array<[string, unknown]>)
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
