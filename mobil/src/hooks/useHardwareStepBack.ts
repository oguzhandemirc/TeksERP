import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/**
 * Donanım geri tuşu = Appbar'daki "Önceki adım" (QA 2026-11-03: formdan geri liste/hub'ı atlayıp ızgaraya dönüyordu).
 * Mount'ta BİR KEZ kaydolur → sonra açılan modallar (AppModal her render'da yeniden kaydolur) önce yakalar;
 * odakta olmayan ekran pas geçer. `onStepBack` yoksa olay ekrana (pop) bırakılır.
 */
export function useHardwareStepBack(onStepBack: (() => void) | undefined, navigation: { isFocused?: () => boolean }): void {
  const stepBackRef = useRef(onStepBack);
  stepBackRef.current = onStepBack;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const fn = stepBackRef.current;
      if (!fn || (typeof navigation.isFocused === 'function' && !navigation.isFocused())) return false;
      fn();
      return true;
    });
    return () => sub.remove();
  }, [navigation]);
}
