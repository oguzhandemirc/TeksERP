// Bayat pencere ölçüsü onarımı (prova 2026-11-06): ML Kit belge tarayıcısı PORTRAIT kilitli bir aktivite açar; dönüşte
// RN `Dimensions.window` dikey (ör. 800×1280) KALIYOR, kök görünüm ise yatay çiziliyor → pencereye göre boyutlanan her
// modal (PickerModal) ekrandan taşıyordu. Doğruluk kaynağı kök görünümün GERÇEK çerçevesidir (SafeAreaProvider frame).

export interface WindowSize {
  width: number;
  height: number;
  scale: number;
  fontScale: number;
}

/**
 * Kök çerçeve ile pencere ölçüsü YÖN olarak ayrışıyorsa (biri yatay, öteki dikey) onarılmış pencereyi döner; aynı yöndeyse
 * ya da çerçeve henüz ölçülmediyse null (dokunulmaz). Yalnız yön ayrışmasına bakılır: küçük piksel farkları (sistem
 * çubukları) olağan yerleşimdir, onlara karışılmaz.
 */
export function healedWindow(frame: { width: number; height: number } | null | undefined, win: WindowSize): WindowSize | null {
  if (!frame || frame.width <= 0 || frame.height <= 0) return null;
  if (win.width <= 0 || win.height <= 0) return null;
  const frameLandscape = frame.width > frame.height;
  const winLandscape = win.width > win.height;
  if (frameLandscape === winLandscape) return null;
  return { width: frame.width, height: frame.height, scale: win.scale, fontScale: win.fontScale };
}
