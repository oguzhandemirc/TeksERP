// =============================================================================
// Esc yığını — O5 fix
// =============================================================================
// Radix, Esc'i yalnız EN ÜST DismissableLayer'a verir (global sıra). Sekmeye
// gömülü (non-modal) dialoglarda bu kırılıyordu: arka plan sekmesinde açık bir
// dialog "en üst layer" olunca aktif sekmedeki dialog Esc'i HİÇ görmüyor,
// operatör için Esc sebepsizce ölü kalıyordu.
//
// Çözüm: scoped dialog/sheet'ler Radix Esc'ini tamamen kapatır ve buraya
// kayıt olur; capture-phase tek global dinleyici Esc'te yığını ÜSTTEN tarayıp
// AKTİF sekmedeki ilk (en üstte açılmış) kaydı kapatır. Global bloklayan modal
// (login/komut paleti — [data-global-modal]) açıkken karışmayız: Radix halleder.
// =============================================================================

import * as React from "react";

interface EscEntry {
  close: () => void;
  isActive: () => boolean;
}

const stack: EscEntry[] = [];
let installed = false;

/**
 * Esc'i kendisi hak eden ETKİLEŞİMLİ pop katmanları. Rol ile eşleşiyoruz çünkü
 * `data-ui-pop` tooltip'te de var ve fareyle açılmış bir ipucu Esc'i çalmamalı.
 * dropdown/context-menu → menu · select → listbox · popover → dialog.
 */
const POP_LAYER_SELECTOR = [
  '[data-ui-pop][data-state="open"][role="menu"]',
  '[data-ui-pop][data-state="open"][role="listbox"]',
  '[data-ui-pop][data-state="open"][role="dialog"]',
].join(",");

function ensureListener(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || stack.length === 0) return;
      // Global bloklayan modal açıksa Esc onu kapatmalı — Radix'e bırak.
      if (document.querySelector("[data-global-modal]")) return;
      // ÜSTTE açık bir etkileşimli pop katmanı (menü / select / popover) varsa Esc
      // ONUN — yığına hiç dokunmayız. Aksi halde dialog İÇİNDEKİ dropdown'a basılan
      // Esc, dropdown yerine TÜM dialog'u kapatıyordu (girilen veri kayboluyordu).
      // Tooltip HARİÇ (`role="tooltip"`): fareyle açılmış bir ipucu Esc'i çalmamalı.
      if (document.querySelector(POP_LAYER_SELECTOR)) return;
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i];
        if (entry?.isActive()) {
          e.preventDefault();
          e.stopPropagation();
          entry.close();
          return;
        }
      }
    },
    true, // capture: Radix'in kendi document dinleyicisinden ÖNCE
  );
}

/** Scoped dialog içeriği mount olduğu sürece yığında kalır. */
export function useEscapeTarget(enabled: boolean, close: () => void, isActive: () => boolean): void {
  const closeRef = React.useRef(close);
  const isActiveRef = React.useRef(isActive);
  closeRef.current = close;
  isActiveRef.current = isActive;

  React.useEffect(() => {
    if (!enabled) return;
    ensureListener();
    const entry: EscEntry = {
      close: () => closeRef.current(),
      isActive: () => isActiveRef.current(),
    };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled]);
}

/**
 * Yığın kaydını MOUNT ömrüne bağlar. Dialog/Sheet içeriğinin İÇİNE render edilir:
 * Radix, Content'in çocuklarını yalnız dialog AÇIKKEN mount eder.
 *
 * Neden gerekli: `useEscapeTarget` doğrudan `DialogContent` gövdesinde çağrılırsa
 * hook, dialog KAPALI olsa bile koşar — çünkü `<DialogContent>` her zaman render
 * edilen `<Dialog>`'un (salt context provider) çocuğudur; Radix yalnız portal
 * İÇERİĞİNİ atlar, bizim bileşenimiz mount olur. Sonuç: bir ekranda tanımlı her
 * dialog/sheet kalıcı ve "aktif" bir kayıt bırakıyordu (çuval ekranında 7 kayıt,
 * hiçbiri açık değil) → yığın hiç boşalmıyor, capture dinleyicisi Esc'i koşulsuz
 * yutuyor ve uygulamada Esc HİÇBİR dropdown'ı/popover'ı kapatmıyordu.
 */
export function EscapeRegistrar({
  close,
  isActive,
}: {
  close: () => void;
  isActive: () => boolean;
}): null {
  useEscapeTarget(true, close, isActive);
  return null;
}

/**
 * Dialog/Sheet sarmalayıcısı onOpenChange'i bu context'le içeriye taşır —
 * Esc yığını controlled dialog'u `onOpenChange(false)` ile kapatır.
 * (Uncontrolled kullanımda no-op: bugünkü davranıştan kötüleşme yok.)
 */
export const EscCloseContext = React.createContext<(() => void) | null>(null);
