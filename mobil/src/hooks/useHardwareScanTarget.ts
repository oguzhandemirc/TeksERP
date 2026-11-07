import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

import { pushScanTarget, type ScanHandler } from '../services/hardwareScanner/scanBus';

/** Bileşeni kapsayan AppModal pencerelerinin kimlikleri (dıştan içe) — AppModal içeriğine sağlar. */
export const ScanOverlayContext = createContext<readonly number[]>([]);

/**
 * Donanım okuyucu hedefi: `active` iken handler LIFO yığının üstüne girer, okumayı en üstteki alır
 * (açık modal alttaki ekrandan önce gelir; adımlı ekranda o adımın hedefi `active` olur).
 * Navigasyon ekranı odakta değilse hedef kendiliğinden düşer — arkada kalan ekran okuma çalmaz.
 * `background`: kapalı pencerenin ekran dinleyicisi — üstünde açık bir AppModal varsa okuma almaz.
 */
export function useHardwareScanTarget(
  handler: ScanHandler,
  opts: { active?: boolean; background?: boolean } = {},
): void {
  const { active = true, background = false } = opts;
  const ref = useRef(handler);
  ref.current = handler;
  const backgroundRef = useRef(background);
  backgroundRef.current = background;
  const within = useContext(ScanOverlayContext);

  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (nav ? nav.isFocused() : true));
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener('focus', () => setFocused(true));
    const offBlur = nav.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [nav]);

  const on = active && focused;
  useEffect(() => {
    if (!on) return;
    return pushScanTarget(ref, backgroundRef, within);
  }, [on, within]);
}
