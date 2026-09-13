// =============================================================================
// Kısa kesim → otomatik A1 (2026-08-19, saha isteği)
// =============================================================================
// "Tamburda çalışma tercihlerine belirli bir metrenin altındaysa otomatik
// olarak A1 yazsın ayarı koyabilir miyiz?" — kısa parça bu fabrikada fiilen
// 2. kalitedir (A1); operatör kaliteyi çevirmeyi unutunca kısa parçalar
// 1. KALİTE etiketiyle depoya iniyordu.
//
// KURALIN TAMAMI BU DOSYADA — ekranda üç ayrı yol (elle yazılan uzunluk,
// makineden ölçüm, "kalanı kes") aynı fonksiyonu çağırır; kural kopyalanırsa
// biri sessizce ayrışır (tambur-plan-gate dersi).
//
// Sınırlar (hepsi bilinçli):
//   • YALNIZ BAYRAK AÇIKKEN ve eşik girilmişken (kullanıcı isteği: "sadece
//     aktifken geçerli olsun"). Varsayılan KAPALI — davranış değişikliği opt-in.
//   • YALNIZ seçili kalite VARSAYILAN (1. KALİTE) iken devreye girer. Operatör
//     A1/FIRE'ı ZATEN seçtiyse dokunulmaz — kural "çevirmeyi unuttu" vakası
//     içindir, operatörün bilinçli kararını ezmek için değil. Bu ayrım aynı
//     zamanda override'ın kendisidir: otomatik A1'i beğenmeyen operatör
//     kaliteyi elle değiştirir ve uzunluğu yeniden düzenlemedikçe kural
//     yeniden ateşlemez.
//   • Eşik ALTINDA (<) — eşiğe eşit uzunluk kısa sayılmaz ("15 m altı" dili).
//   • 2. KALİTE KATALOGDAN çözülür; katalogda yoksa/pasifse kural HİÇ ateşlemez
//     (fail-closed — kataloğa olmayan kod yazılmaz, çökme de olmaz).
//
// ⚠️ 2026-09-13 (karar ①) — KOD DEĞİL ROL: burada `SHORT_CUT_QUALITY_CODE = 'A1'`
// sabiti vardı. `A1` bu fabrikanın kodudur; kataloğu `2K` olan bir kurulumda
// sabit hiçbir satırı bulamaz ve kural SESSİZCE hiç ateşlemezdi — yani "kısa
// parça 2. kaliteye yazılsın" ayarı açık görünüp çalışmazdı. Artık
// `role = SECOND` satırı aranır (`utils/qualityRole.ts`).
// =============================================================================
import { findGradeByRole, type QualityGradeLike } from '../../../utils/qualityRole';

/** Çözücünün ihtiyacı olan en dar şekil — ekranın tam kataloğu da uyar. */
export type ShortCutGrade = QualityGradeLike;

export interface ShortCutArgs {
  /** Ayar bayrağı (cihaz tercihi) — kapalıyken kural YOK. */
  enabled: boolean;
  /** Eşik (metre) — null/0/negatif = kural YOK (bayrak açık olsa bile). */
  thresholdM: number | null;
  /** Kesimin çözülen uzunluğu (m). */
  lengthM: number;
  /** Ekranda o an seçili kalite kodu. */
  currentCode: string | null | undefined;
  /** Varsayılan kalite kodu (1.KALITE) — kural yalnız bununla ateşler. */
  defaultCode: string;
  /** Ekranın yüklediği kalite kataloğu — A1 buradan çözülür. */
  grades: readonly ShortCutGrade[];
}

/**
 * Kısa kesim kuralı: koşullar sağlanıyorsa yazılacak A1 kalitesini döner,
 * sağlanmıyorsa null (dokunma).
 */
export function shortCutOverride(args: ShortCutArgs): ShortCutGrade | null {
  const { enabled, thresholdM, lengthM, currentCode, defaultCode, grades } = args;
  if (!enabled) return null;
  if (thresholdM == null || !Number.isFinite(thresholdM) || thresholdM <= 0) return null;
  if (!Number.isFinite(lengthM) || lengthM <= 0) return null;
  if (lengthM >= thresholdM) return null;
  if (currentCode !== defaultCode) return null;
  return findGradeByRole(grades, 'SECOND');
}

/**
 * Ters yön — elle yazım sırasında uzunluk eşiğin ÜSTÜNE çıkarsa, kuralın az
 * önce OTOMATİK yazdığı A1 varsayılana geri döner. `autoApplied` olmadan
 * çağrılmamalı: operatörün KENDİ seçtiği A1'i geri almak, kuralı yardımdan
 * sabotaja çevirir. (Senaryo: 12 yazdı → A1'e döndü → 120'ye tamamladı →
 * geri dönüş olmasaydı 120 m'lik top sessizce A1 kalırdı — otomasyonun
 * çözdüğü hatanın aynısını kendisi üretirdi.)
 */
export function shortCutRevert(args: {
  enabled: boolean;
  thresholdM: number | null;
  lengthM: number;
  currentCode: string | null | undefined;
  /** 2. kaliteyi bu oturumda kural mı yazdı (ekran ref ile izler). */
  autoApplied: boolean;
  /** Ekranın yüklediği katalog — "2. kalite hangi kod" buradan çözülür. */
  grades: readonly ShortCutGrade[];
}): boolean {
  const { enabled, thresholdM, lengthM, currentCode, autoApplied, grades } = args;
  if (!autoApplied) return false;
  // Geri dönüş yalnız kuralın YAZDIĞI koddan olur; kod katalogdan çözülür.
  if (currentCode !== findGradeByRole(grades, 'SECOND')?.code) return false;
  // Bayrak/eşik bu arada kapandıysa da geri dön — otomatik yazımın dayanağı kalktı.
  if (!enabled || thresholdM == null || thresholdM <= 0) return true;
  return Number.isFinite(lengthM) && lengthM >= thresholdM;
}
