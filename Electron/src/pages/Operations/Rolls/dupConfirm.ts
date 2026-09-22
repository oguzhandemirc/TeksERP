// =============================================================================
// MÜKERRER ONAY MODU — saf türetme (React'siz, test edilebilir)
// =============================================================================
// Sunucu 409 POSSIBLE_DUPLICATE verdikten sonra normal "Ekle" 90 sn boyunca
// KESİN başarısızdır (aynı parmak izi → aynı 409). 19.09.2026'da bir kullanıcı
// sarı satırdaki küçük onay bağlantısını görmeyip Ekle'ye 11 kez bastı. Çare:
// uyarı açıkken ana düğmeler "Yine de Kaydet"e DÖNÜŞÜR (aynı yer, Enter dahil);
// parmak izi değişirse iddia düşer, düğmeler normale döner.
//
// Parmak izi sunucunun ikiz ölçütüyle AYNI alanlardır (inventory.service ikiz
// sorgusu): itemId · colorId · initialQty · width. Alan eklenirse iki uçta birden.
// =============================================================================

export interface DupFingerprintInput {
  itemId: string;
  colorId: string | null;
  initialQty: number;
  width: number | null;
}

/** Sunucunun "ikiz" saydığı alanların tek satırlık imzası. */
export function dupFingerprint(v: DupFingerprintInput): string {
  return [v.itemId, v.colorId ?? "", String(v.initialQty), v.width == null ? "" : String(v.width)].join("|");
}

export interface DupWarnState {
  /** Sunucunun bildirdiği ikiz top barkodu (yoksa "—"). */
  barcode: string;
  /** 409'u üreten gövdenin parmak izi — form bundan saparsa uyarı düşer. */
  fingerprint: string;
}

/** Uyarı hâlâ geçerli mi: form aynı parmak izindeyse EVET, sapmışsa HAYIR. */
export function dupWarnStillValid(warn: DupWarnState | null, current: DupFingerprintInput): boolean {
  return warn !== null && warn.fingerprint === dupFingerprint(current);
}

export interface SubmitButtonView {
  /** Bu basış `confirmDuplicate:true` ile gider mi. */
  confirmDuplicate: boolean;
  addLabel: string;
  addPrintLabel: string;
  /** Uyarı modunda düğmeler sarı — kullanıcı "normal kayıt değil" görsün. */
  amber: boolean;
}

export function submitButtonView(
  warnOpen: boolean,
  pending: { add: boolean; addPrint: boolean },
): SubmitButtonView {
  if (pending.add || pending.addPrint) {
    return { confirmDuplicate: warnOpen, addLabel: pending.add ? "Ekleniyor..." : warnOpen ? "Yine de Kaydet" : "Ekle",
      addPrintLabel: pending.addPrint ? "Ekleniyor..." : warnOpen ? "Yine de Kaydet ve Bas" : "Ekle ve Etiket Bas", amber: warnOpen };
  }
  return warnOpen
    ? { confirmDuplicate: true, addLabel: "Yine de Kaydet", addPrintLabel: "Yine de Kaydet ve Bas", amber: true }
    : { confirmDuplicate: false, addLabel: "Ekle", addPrintLabel: "Ekle ve Etiket Bas", amber: false };
}
