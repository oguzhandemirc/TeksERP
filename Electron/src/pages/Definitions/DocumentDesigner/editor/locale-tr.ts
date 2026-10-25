/**
 * Tasarımcının Türkçe arayüz metinleri. Taban GrapesJS'in kendi `tr` dosyası;
 * eksik 51 anahtar ve İngilizce kalmış birkaç değer `I18n.addMessages` ile
 * tamamlanır. Tamlık `locale-tr.test.ts`te `en` anahtarlarına karşı ölçülür.
 */
import trCore from "grapesjs/locale/tr.mjs";

type Messages = { [key: string]: string | Messages };

const SIDES = { top: "Üst", right: "Sağ", bottom: "Alt", left: "Sol" } as const;
const sideSubs = (prop: string): Messages =>
  Object.fromEntries(Object.entries(SIDES).map(([k, v]) => [`${prop}-${k}-sub`, v]));

export const TR_ADDITIONS: Messages = {
  assetManager: {
    inputPlh: "Dış adres kabul edilmez — dosya yükleyin",
    addButton: "Görsel ekle",
  },
  canvas: { frameTitle: "Belge kanvası" },
  deviceManager: { devices: { tablet: "Tablet ekranı" } },
  domComponents: {
    names: {
      "": "Kutu",
      wrapper: "Belge gövdesi",
      text: "Metin",
      comment: "Yorum",
      image: "Görsel",
      video: "Video",
      label: "Etiket",
      link: "Bağlantı",
      map: "Harita",
      tfoot: "Tablo alt bilgisi",
      tbody: "Tablo gövdesi",
      thead: "Tablo başlığı",
      table: "Tablo",
      row: "Tablo satırı",
      cell: "Tablo hücresi",
    },
  },
  selectorManager: {
    states: { hover: "Üzerine gelince", active: "Tıklanınca", "nth-of-type(2n)": "Çift/tek satır" },
  },
  styleManager: {
    fileButton: "Görseller",
    sectors: { flex: "Esnek yerleşim" },
    properties: {
      margin: "Dış boşluk",
      "margin-top": "Dış boşluk üst",
      "margin-right": "Dış boşluk sağ",
      "margin-bottom": "Dış boşluk alt",
      "margin-left": "Dış boşluk sol",
      padding: "İç boşluk",
      "padding-top": "İç boşluk üst",
      "padding-right": "İç boşluk sağ",
      "padding-bottom": "İç boşluk alt",
      "padding-left": "İç boşluk sol",
      "font-family": "Yazı tipi",
      "font-size": "Yazı boyutu",
      "font-weight": "Yazı kalınlığı",
      "flex-direction": "Esnek yön",
      "flex-wrap": "Esnek sarma",
      "flex-basis": "Esnek taban",
      "flex-grow": "Esnek büyüme",
      "flex-shrink": "Esnek küçülme",
      ...sideSubs("margin"),
      ...sideSubs("padding"),
      "border-width-sub": "Kalınlık",
      "border-style-sub": "Stil",
      "border-color-sub": "Renk",
      "border-top-left-radius-sub": "Üst sol",
      "border-top-right-radius-sub": "Üst sağ",
      "border-bottom-right-radius-sub": "Alt sağ",
      "border-bottom-left-radius-sub": "Alt sol",
      "transition-property-sub": "Özellik",
      "transition-duration-sub": "Süre",
      "transition-timing-function-sub": "Zamanlama",
      "background-image-sub": "Görsel",
      "background-repeat-sub": "Tekrar",
      "background-position-sub": "Konum",
      "background-attachment-sub": "Sabitleme",
      "background-size-sub": "Boyut",
    },
  },
  traitManager: {
    traits: {
      labels: { id: "Kimlik", title: "Başlık", alt: "Alternatif metin" },
      attributes: {
        id: { placeholder: "ör. baslik-alani" },
        alt: { placeholder: "ör. Firma logosu" },
        title: { placeholder: "ör. Açıklama" },
        href: { placeholder: "ör. #bolum" },
      },
      options: { target: { false: "Bu pencere", _blank: "Yeni pencere" } },
    },
  },
  storageManager: { recover: "Kaydedilmemiş değişiklikler geri yüklensin mi?" },
};

function isObj(v: unknown): v is Messages {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Derin birleştirme — `add` kazanır (addMessages'in davranışının saf ikizi). */
export function mergeMessages(base: Messages, add: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(add)) {
    const prev = out[k];
    out[k] = isObj(prev) && isObj(v) ? mergeMessages(prev, v) : v;
  }
  return out;
}

export const TR_CORE = trCore as Messages;
export const TR_MESSAGES: Messages = mergeMessages(TR_CORE, TR_ADDITIONS);

/** `grapesjs.init({ i18n })` — tarayıcı dilinden bağımsız, her zaman Türkçe. */
export const I18N_CONFIG = {
  locale: "tr",
  localeFallback: "tr",
  detectLocale: false,
  messages: { tr: TR_CORE },
} as const;
