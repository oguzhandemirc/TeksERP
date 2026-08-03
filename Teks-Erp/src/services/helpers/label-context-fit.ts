// =============================================================================
// Şablon ↔ baskı bağlamı UYUM ANALİZİ
// =============================================================================
// NEDEN VAR: `label.service.buildSackRenderInput` FAIL-CLOSED olmayı amaçlıyor —
// SACK şablonu çözülemezse Türkçe hata verir, roll/swatch etiketine SAPMAZ. Ama
// guard yalnız `routing.template != null`'a bakıyordu ve ÜÇ atama yüzeyinin
// hiçbiri tür kontrolü yapmıyor (`setContextDefault`, `customerTemplateRoute.set`,
// `peripheral.setTemplateRoute` — "tek havuz" mimarisi bilinçli olarak kaldırmış).
// Sonuç: ÇUVAL bağlamına bir ROLL şablonu atanırsa `routing.template` DOLU döner,
// fail-closed guard ARKA KAPIDAN geçilir ve iki çöp çıktı doğar:
//   (a) varyantsız legacy akış şablonu → `label-html-landscape.helper` içinde SACK
//       dalı HİÇ YOK (grep: 0 sonuç) → ROLL düzeni basılır, "Ürün adı —", "En —";
//       tam olarak guard'ın engellemeye çalıştığı çıktı.
//   (b) kanvas varyantı var ama `sackNo` bind'i yok → `label-canvas-html.helper`
//       `present:false` ile ROLL alanlarını sessizce ATLAR → çuval numarası HİÇ
//       basılmaz, yarı boş etiket. Ne hata, ne log.
//
// TASARIM KARARI: uyum `LabelTemplate.kind`'a BAKMAZ. O kolon DEPRECATED + nullable
// ("kimlik değil, yalnız migration bilgisi — yeni şablonlar null doğar"), dolayısıyla
// kind karşılaştırması yeni şablonların hepsinde anlamsızdır. Uyum ŞABLONUN BAĞLADIĞI
// ALANLARDAN türetilir. Bu "tek havuz" mimarisini KIRMAZ: tek havuzun iddiası
// "şablon türden bağımsızdır", "şablon bağlamın KİMLİĞİNİ basmasa da olur" DEĞİL.
//
// ASİMETRİ BİLİNÇLİ: kimlik kontrolü yalnız SACK'te uygulanır.
//   • ROLL_RAW/ROLL_FINISHED/SWATCH kimliği = zorunlu barkod/QR elemanının KENDİSİ
//     (`assertTemplateAssignable` her varyantta qr/code128 şart koşar; `payload.barcode`
//     = roll/swatch barkodu) → ayrı bir kimlik alanı yok, kontrol edilecek şey yok.
//   • ÇUVALDA barkod da `sackNo`dur AMA okunur "Çuval No" ayrı bir katalog alanıdır
//     (`label-field-values` onu açıkça "etiketin kimliği" diye tanımlar) ve ROLL
//     şablonlarında HİÇ bulunmaz → yanlış atamanın tek mekanik imzası budur.
//   • ROLL_RAW'ın hiç özgü alanı YOK (tümü ROLL_FINISHED ile ortak) → o bağlamda
//     "yabancı şablon" tespiti YAPILAMAZ. Uydurma kural üretmiyoruz.
// =============================================================================

import { LabelKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readCanvasLayout } from "../../config/label-elements";
import { getUnifiedCatalog } from "../../config/label-fields";

/** Bağlamın KİMLİK bind'i — o bağlamda basılmadıkça etiket kimsiz kalır. */
const IDENTITY_BIND: Partial<Record<LabelKind, { key: string; label: string }>> = {
  [LabelKind.SACK]: { key: "sackNo", label: "Çuval No" },
};

/**
 * YAPISAL minimal tip — bilinçli olarak `LabelTemplate & {variants}` DEĞİL: analiz
 * yalnız ada ve varyant `elements`'ına bakar. Tam modeli istemek çağıranları
 * gereksiz `select` genişletmeye (ve deprecated `kind` kolonunu çekmeye) zorlardı.
 */
type TemplateLike = { name: string; variants?: { elements: unknown }[] };

/** Yalnız TEK bağlamda tanımlı alan anahtarları — o bağlama ÖZGÜ imza. */
export function getKindExclusiveKeys(kind: LabelKind): Set<string> {
  return new Set(
    getUnifiedCatalog()
      .filter((f) => f.kinds.length === 1 && f.kinds[0] === kind)
      .map((f) => f.key)
  );
}

/** Şablonun (tüm varyantlarında) kanvas `field` elemanlarının bağladığı anahtarlar.
 *  KOŞULLU eleman (`showIf`) SAYILMAZ: bu küme "şablon bu bağlamın kimliğini basar
 *  mı" sorusunun cevabıdır ve koşullu alan yalnız BAZI baskılarda çıkar → garanti
 *  vermez. Fail-closed guard'ın (assertContextRenderable) dayanağı budur. */
export function collectBoundKeys(t: TemplateLike): Set<string> {
  const keys = new Set<string>();
  for (const v of t.variants ?? []) {
    const layout = readCanvasLayout(v.elements);
    if (!layout) continue;
    for (const el of layout.elements) {
      if (el.type === "field" && typeof el.bind === "string" && !el.showIf) keys.add(el.bind);
    }
  }
  return keys;
}

/** Şablonun HİÇ kanvas varyantı var mı (yoksa legacy akış modeline düşer). */
function hasCanvasVariant(t: TemplateLike): boolean {
  return (t.variants ?? []).some((v) => readCanvasLayout(v.elements) !== null);
}

export type ContextFit =
  | { ok: true }
  | { ok: false; reason: "no-canvas" | "missing-identity"; message: string };

/**
 * Şablon bu bağlamda basılabilir mi? Kimlik alanı TANIMLI OLMAYAN bağlamlarda
 * (ROLL_RAW / ROLL_FINISHED / SWATCH) her zaman `ok` — orada kimlik zorunlu barkodun
 * kendisidir ve bağlam-dışı alanın boş basılması `getUnifiedCatalog`'un BİLİNÇLİ
 * kabulüdür ("bağlam-dışı alan baskıda boş kalır").
 *
 * KAPSAM DIŞI (bilinçli): "bu şablon yalnız başka bağlamın özel alanlarını bağlıyor"
 * türü BİLGİLENDİRİCİ uyarı. Setter'ların yanıt şekli uyarı taşımıyor ve onu yüzeye
 * çıkaracak istemci yok → üretilse ölü kod olurdu. Gerekirse `getKindExclusiveKeys`
 * ile eklenir (dosyada dışa açık bırakıldı).
 */
export function analyzeContextFit(t: TemplateLike, kind: LabelKind): ContextFit {
  const identity = IDENTITY_BIND[kind];
  if (!identity) return { ok: true };

  // Varyantsız şablon bu bağlamda BASILAMAZ: emitter'da SACK dalı yok, ROLL
  // düzenine düşer. Kanvas varyantı ŞART.
  if (!hasCanvasVariant(t)) {
    return {
      ok: false,
      reason: "no-canvas",
      message:
        `『${t.name}』 şablonunda tasarım (kanvas) yok — çuval etiketi olarak basılamaz. ` +
        `Etiket Stüdyosu'nda şablona bir tasarım ekleyin, ya da Etiketler → Atamalar'da ` +
        `Çuval bağlamına tasarımı olan bir şablon atayın.`,
    };
  }
  if (!collectBoundKeys(t).has(identity.key)) {
    return {
      ok: false,
      reason: "missing-identity",
      message:
        `『${t.name}』 şablonu çuval etiketi olarak basılamaz — çuval numarası ` +
        `("${identity.label}") alanı şablonda yok, dolayısıyla basılan etiket hangi çuvala ` +
        `ait olduğunu göstermez. Etiket Stüdyosu'nda bu alanı ekleyin, ya da ` +
        `Etiketler → Atamalar'da Çuval bağlamına doğru şablonu atayın.`,
    };
  }
  return { ok: true };
}

/**
 * BASKI ANI guard'ı — FAIL-CLOSED. Uyumsuzsa Türkçe 400; sessiz çöp etiket YOK.
 * `buildSackRenderInput`'un `routing.template != null` guard'ının hemen ardında
 * çağrılır (o guard tek başına arka kapıdan geçilebiliyordu).
 */
export function assertContextRenderable(t: TemplateLike, kind: LabelKind): void {
  const fit = analyzeContextFit(t, kind);
  if (!fit.ok) throw AppError.badRequest(fit.message);
}
