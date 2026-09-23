// =============================================================================
// ETİKET TAŞMA KAPISI — biçim değişimi basılan barkodu etiketten taşırır mı?
// =============================================================================
// SORU: fabrika bir serinin ön ekini/hanesini büyütünce o seriyle basılan
// etiketlerdeki barkod fiziksel olarak etikete SIĞMAYA devam ediyor mu?
//
// ⚠️ NEDEN KAPI, NEDEN UYARI DEĞİL: emit katmanı taşmayı LİNT ETMEZ ve bu
// bilinçli ("çakışma/taşma sorumluluğu EDİTÖRDE" — `label-elements.ts:12`).
// Editör lint'i ise şablon ELLE düzenlenince koşar; SERİ ayarı değişince
// koşmaz. Yani bugün fabrika haneyi büyütürse etiket sessizce kırpılır:
// ne hata, ne log, yalnız okunmayan barkodlar. Kapı bu boşluğu kapatır.
//
// ⚠️ KAPSAM ÖLÇÜLDÜ, VARSAYILMADI (2026-09-24): etiket barkodu (`payload.barcode`)
// bağlama göre dolar ve ÜÇ bağlamın YALNIZ İKİSİ bir numara serisi basar —
//   · roll  → `roll.barcode`  = `roll` serisi   ✓
//   · sack  → `sack.sackNo`   = `sack` serisi   ✓
//   · swatch→ `sw.barcode`    = `SW-YYMM-XXXXXX-C`, KENDİ şeması ✗
// `swatch` SERİSİ (`cardNumber`, KRT…) o etikette barkod olarak BASILMAZ, yani
// biçimi değişse de genişlik değişmez. "Her seri" diye kurulan bir kapı orada
// ya hiç ateşlemez ya da YANLIŞ seriyi ölçerdi.
//
// ⚠️ GENİŞLİK `code128WidthDots` İLE HESAPLANMAZ: o formül (`(11·len+35)·mw`)
// karakter başına 11 modül varsayıyor, oysa Code128 rakam çiftlerini subset C
// ile İKİŞER paketliyor ⇒ 12 karakterde 167 diyor, gerçeği 145 (ölçüldü). %15
// şişik bir ölçüm, SIĞAN yerleşimleri 409'la reddedip fabrikayı sebepsiz
// durdururdu. O formül YANLIŞ DEĞİL, BAŞKA BİR İŞ için: okunur satırı ortalamak
// ("kabaca; merkezleme için yeterli" — kendi yorumu). İki farklı soru, iki
// farklı hassasiyet; birleştirilmemeleri BİLİNÇLİDİR.
import bwipjs from "bwip-js";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readCanvasLayout, type LabelElement } from "../../config/label-elements";
import { readDefaultLabelMedia } from "../system-setting.service";

/** Etiket barkodu olarak GERÇEKTEN basılan seriler — ölçüldü, tahmin değil. */
const ETIKETE_BASILAN_SERILER = new Set(["roll", "sack"]);

/** Bir varyantın ölçüm sonucu — üç durum (sığar · taşar · ÖLÇÜLEMEDİ). */
export interface LabelWidthFinding {
  templateName: string;
  variantName: string;
  /** `null` = ÖLÇÜLEMEDİ; sebebi `reason`da. */
  overflowMm: number | null;
  reason?: string;
}

/**
 * Code128 modül sayısı — KODLAYICININ KENDİ ölçümü (elle formül YOK).
 *
 * bwip-js üretilen PNG'nin genişliğini modül başına 1 piksel ile verir
 * (`scale: 1`), yani dönen sayı doğrudan modül sayısıdır.
 */
async function code128Modules(text: string): Promise<number> {
  const png = await bwipjs.toBuffer({ bcid: "code128", text, scale: 1, height: 10, includetext: false });
  return png.readUInt32BE(16); // PNG IHDR genişliği
}

const mmToDots = (mm: number, dpi: number): number => (mm * dpi) / 25.4;
const dotsToMm = (dots: number, dpi: number): number => (dots * 25.4) / dpi;

/**
 * Bu seriyle basılan etiketlerde örnek kod taşıyor mu?
 *
 * ⚠️ ÜÇÜNCÜ SONUÇ KORUNUR: varyantın kanvası okunamıyorsa "taşmıyor" DEMEZ,
 * `overflowMm: null` + gerekçe döner. "Ölçemedim" ile "sığıyor" aynı sayılırsa
 * kapı, çözdüğünden büyük bir arıza üretir.
 */
export async function measureLabelWidth(
  key: string,
  ornekKod: string,
  dpi: number,
): Promise<LabelWidthFinding[]> {
  if (!ETIKETE_BASILAN_SERILER.has(key)) return [];
  const varyantlar = await prisma.labelTemplateVariant.findMany({
    where: { template: { isActive: true, deletedAt: null } },
    select: {
      name: true,
      widthMm: true,
      elements: true,
      template: { select: { name: true } },
    },
  });
  const bulgular: LabelWidthFinding[] = [];
  for (const v of varyantlar) {
    const layout = readCanvasLayout(v.elements);
    const ad = { templateName: v.template.name, variantName: v.name };
    if (!layout) {
      bulgular.push({ ...ad, overflowMm: null, reason: "Şablonun kanvas yerleşimi okunamadı." });
      continue;
    }
    const barkodlar = (layout.elements as LabelElement[]).filter((el) => el.type === "code128");
    if (barkodlar.length === 0) continue;
    const etiketGenisligiMm = Number(v.widthMm);
    for (const el of barkodlar) {
      const mw = Math.max(1, (el as { mw?: number }).mw ?? 2);
      const modul = await code128Modules(ornekKod);
      const barkodMm = dotsToMm(modul * mw, dpi);
      const sonMm = el.x + barkodMm;
      if (sonMm > etiketGenisligiMm) {
        bulgular.push({ ...ad, overflowMm: Number((sonMm - etiketGenisligiMm).toFixed(1)) });
        break; // varyant başına TEK bulgu yeter — kullanıcı şablonu açıp düzeltecek
      }
    }
  }
  return bulgular;
}

/**
 * Yazma kapısı — taşan şablon varsa 409, ADIYLA sayarak.
 *
 * ⚠️ MESAJ ŞABLONU ADIYLA SAYAR: "bir şablon taşıyor" diyen bir hata, kullanıcıyı
 * on şablonu tek tek açmaya zorlar. Yıkıcı/engelleyici işlemde soyut sayı yetmez
 * (kök kural: etkilenen HER kaydı listele).
 */
export function assertLabelWidthFits(key: string, bulgular: LabelWidthFinding[]): void {
  const tasan = bulgular.filter((b) => b.overflowMm !== null);
  if (tasan.length === 0) return;
  const names = tasan
    .map((b) => `“${b.templateName} · ${b.variantName}” (${b.overflowMm} mm taşıyor)`)
    .join(", ");
  throw AppError.conflict(
    `Bu biçimle üretilen barkod şu etiket şablonlarına SIĞMIYOR: ${names}. ` +
      "Önce şablonu düzenleyin (barkodu sola alın, modül kalınlığını düşürün ya da etiketi büyütün), " +
      "sonra numara biçimini değiştirin.",
    { code: "NUMBER_SERIES_LABEL_OVERFLOW", key, templates: tasan.map((b) => `${b.templateName} · ${b.variantName}`) },
  );
}

/** Ölçülemeyen varyantlar — `ApiResponse.warnings` için (üçüncü sonuç susmaz). */
export function labelWidthWarnings(bulgular: LabelWidthFinding[]): string[] {
  return bulgular
    .filter((b) => b.overflowMm === null)
    .map((b) => `“${b.templateName} · ${b.variantName}” etiketinde barkod genişliği ÖLÇÜLEMEDİ: ${b.reason}`);
}

/**
 * TEK GİRİŞ NOKTASI — önizleme de yazma da BUNU çağırır.
 *
 * ⚠️ ÖNİZLEME İLE YAZMA AYNI YÜKLEMDEN BESLENİR: ikisi ayrı hesaplasaydı ekran
 * "sığıyor" derken kaydet 409 verebilirdi (ya da tersi) — bu depoda "türetilmiş
 * alan / ayrışan yüzey" diye adlandırılan sınıfın ta kendisi.
 */
export async function labelWidthFindings(
  key: string,
  ornekKod: string,
): Promise<LabelWidthFinding[]> {
  if (!ETIKETE_BASILAN_SERILER.has(key)) return [];
  const { dpi } = await readDefaultLabelMedia();
  return measureLabelWidth(key, ornekKod, dpi);
}

export { code128Modules, mmToDots, ETIKETE_BASILAN_SERILER };
