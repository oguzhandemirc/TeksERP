// Kod ↔ görsel kip geçişi (plan §4, D3). Görsel kipte kod salt-okunurdur; ham Liquid
// (`{% %}`) içeren kaynak görsele dönemez — GrapesJS etiketleri metin düğümüne çevirip bozar.

export type EditMode = "VISUAL" | "CODE";

export const CODE_MODE_WARNING = "Kod kipindesiniz — görsel düzenleme kısıtlı. Görsel düzenleyiciye dönmek için ham Liquid etiketlerini ({% %}) kaldırın.";
export const VISUAL_READONLY_NOTE = "Görsel kipte kod salt-okunurdur. Düzenlemek için “Koda geç”.";
export const SWITCH_TO_CODE_CONFIRM =
  "Şablon kod kipine geçer: HTML ve CSS'i doğrudan düzenlersiniz, görsel düzenleme kısıtlanır. Ham Liquid etiketi ({% %}) yazdığınız sürece görsele dönülemez.";

const RAW_TAG = /\{%-?[\s\S]*?-?%\}/;

/** Kaynakta ham Liquid etiketi var mı (yorum dahil; görsel kip yalnız data-* yönergelerini taşır). */
export function hasRawLiquidTag(html: string): boolean {
  return RAW_TAG.test(html);
}

/** Görsele dönüş engelinin Türkçe gerekçesi; engel yoksa null. */
export function visualReturnBlocker(html: string): string | null {
  if (!hasRawLiquidTag(html)) return null;
  const m = RAW_TAG.exec(html);
  const line = m ? html.slice(0, m.index).split("\n").length : 1;
  return `Ham Liquid etiketi var (satır ${line}); görsel düzenleyici bunu taşıyamaz.`;
}

/** Kod sekmesi düzenlenebilir mi: yalnız kod kipinde. */
export function isCodeEditable(mode: EditMode): boolean {
  return mode === "CODE";
}
