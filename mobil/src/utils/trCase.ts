// =============================================================================
// Türkçe harf katlaması — TEK KAYNAK (`"tr-TR"` yalnız bu dosyada yazılır)
// =============================================================================
// ⚠️ BU DOSYA ÜÇ PROJEDE BAYT-BAYT AYNIDIR ve öyle KALMALIDIR (search-fold emsali):
//     Teks-Erp/src/utils/tr-case.ts
//     Electron/src/lib/tr-case.ts
//     mobil/src/utils/trCase.ts
// Bekçi md5 eşitliğini ölçer: `Teks-Erp/scripts/test_tr_case.ts` §3.
//
// AD (insan metni) içindir: "iplik" → "İPLİK", "IŞIK" → "ışık". İki yazım
// (`"tr"` · `"tr-TR"`) 113 yerde yan yana yaşıyor ve yazan↔okuyan simetrisi elle
// korunuyordu; kanonik yazım burada sabitlenir, çağrı yeri yalnız yönü söyler.
//
// ⚠️ KOD için kullanılmaz — kod bir kimliktir, ASCII'dir ve karşılaştırması
// `foldCodeForCompare` / `normalizeScanCode` (utils/code-format) ile yapılır:
// `"sip".toLocaleUpperCase("tr-TR") === "SİP"` olduğu için `"SIP"` ile eşleşmez.

const TR_LOCALE = "tr-TR";

/** Türkçe büyük harf: i → İ, ı → I. */
export function upperTr(text: string): string {
  return text.toLocaleUpperCase(TR_LOCALE);
}

/** Türkçe küçük harf: İ → i, I → ı. */
export function lowerTr(text: string): string {
  return text.toLocaleLowerCase(TR_LOCALE);
}
