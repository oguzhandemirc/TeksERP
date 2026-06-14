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

function ensureListener(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || stack.length === 0) return;
      // Global bloklayan modal açıksa Esc onu kapatmalı — Radix'e bırak.
      if (document.querySelector("[data-global-modal]")) return;
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
 * Dialog/Sheet sarmalayıcısı onOpenChange'i bu context'le içeriye taşır —
 * Esc yığını controlled dialog'u `onOpenChange(false)` ile kapatır.
 * (Uncontrolled kullanımda no-op: bugünkü davranıştan kötüleşme yok.)
 */
export const EscCloseContext = React.createContext<(() => void) | null>(null);
