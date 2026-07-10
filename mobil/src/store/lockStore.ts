// =============================================================================
// Kilit store'u + aktivite izleyicisi (idle auto-lock)
// =============================================================================
// `locked` = kilit ekranı görünür mü. Yalnız bu reaktif alandır (zustand);
// son-aktivite zaman damgası REAKTİF DEĞİL — her dokunuşta set() ile abone
// re-render'ı tetiklememek için modül-yerel mutable tutulur (60fps dokunmada
// ucuz). `useIdleLock` interval'i getLastActivity() okur, kararı idleLock.ts
// saf reducer'ı verir.
// =============================================================================

import { create } from 'zustand';

interface LockState {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useLockStore = create<LockState>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => {
    recordActivity();
    set({ locked: false });
  },
}));

// --- Reaktif olmayan aktivite zaman damgası ----------------------------------
let lastActivityTs = Date.now();

/** Dokunma/etkileşim anında çağrılır (kök responder-capture). Ucuz, re-render yok. */
export function recordActivity(): void {
  lastActivityTs = Date.now();
}

/** Idle reducer'ı için son aktivite zamanı (epoch ms). */
export function getLastActivity(): number {
  return lastActivityTs;
}

// --- Uygulama-içi sistem diyaloğu bastırması --------------------------------
// Android'de UYGULAMANIN KENDİ açtığı sistem diyalogları (BT izin/aç/PIN,
// yazdırma servisi, kamera izni) host activity'yi pause eder → RN AppState
// 'background' yayar → useIdleLock ANINDA kilitlerdi (ilk etiket basımında
// operatör kilit ekranına atılıyordu). Diyaloğu açan çağrı withSystemDialog
// ile sarılır; bastırma penceresi açıkken AppState-kilidi devreye girmez.
// Durum reaktif DEĞİL (recordActivity ile aynı gerekçe) — listener event
// anında senkron okur. finally sayesinde reddedilen izin / iptal edilen
// diyalog da sayacı düşürür.
//
// Pencerenin üç parçası (üçü de review'da kanıtlanmış gerçek boşluklara karşı):
//  - dialogDepth > 0: sarılı çağrı pending — asıl bastırma.
//  - KUYRUK (TRAILING): Android'de Print.printAsync pencere GÖRÜNÜR OLUR OLMAZ
//    çözülür (kullanıcıyı beklemez) — 'background' event'i köprüden promise
//    settle'ından SONRA gelebilir; settle sonrası kısa süre bastırma sürer ki
//    bu yarış kaybedilmesin.
//  - TAVAN (MAX): sarılı native promise askıda kalırsa (örn. BT kütüphanesinde
//    eşzamanlı iki requestBluetoothEnabled ilkini yetim bırakır — hiç çözülmez)
//    bastırma süresiz açık kalıp gerçek arka plan kilidini sessizce öldürmesin;
//    girişten bu kadar süre sonra bastırma yok sayılır.
//
// KALAN BİLİNÇLİ AÇIK: diyalog/pencere açıkken operatör home'a basar ya da
// çekip giderse ek 'background' event'i GELMEZ (activity zaten paused) —
// anlık kilit bu turda oluşamaz. Bu yüzden useIdleLock bastırılan 'background'
// anını damgalar ve dönüşte ('active') süre grace'i aşmışsa kilitler; toplam
// maruziyet ayrıca idle makinesiyle (dokunulmadığı için) sınırlıdır.
let dialogDepth = 0;
let lastDialogEnteredAt = 0;
let lastDialogSettledAt = 0;
let suppressedBackgroundAt: number | null = null;

export const SYSTEM_DIALOG_SUPPRESS_MAX_MS = 2 * 60_000;
export const SYSTEM_DIALOG_TRAILING_MS = 5_000;

/** AppState 'background' uygulamanın kendi diyaloğundan mı — kilit bastırılsın mı? */
export function isSystemDialogPending(): boolean {
  const now = Date.now();
  if (dialogDepth > 0 && now - lastDialogEnteredAt < SYSTEM_DIALOG_SUPPRESS_MAX_MS) return true;
  return lastDialogSettledAt > 0 && now - lastDialogSettledAt < SYSTEM_DIALOG_TRAILING_MS;
}

/** Sistem diyaloğu açabilen native çağrıyı sarar (BT izin/aç/PIN, print, kamera izni). */
export async function withSystemDialog<T>(fn: () => Promise<T>): Promise<T> {
  dialogDepth += 1;
  lastDialogEnteredAt = Date.now();
  try {
    return await fn();
  } finally {
    dialogDepth -= 1;
    lastDialogSettledAt = Date.now();
  }
}

/** Bastırılan 'background' anını damgala (useIdleLock listener'ı çağırır). */
export function noteSuppressedBackground(): void {
  suppressedBackgroundAt = Date.now();
}

/** Dönüşte ('active') bastırılmış arka planda geçen süreyi (ms) döner ve damgayı tüketir. */
export function consumeSuppressedBackground(): number {
  const at = suppressedBackgroundAt;
  suppressedBackgroundAt = null;
  return at == null ? 0 : Date.now() - at;
}
