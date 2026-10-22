// Ekran odağı: expo-router `useFocusEffect` (geri dönüş fonksiyonu odak kaybında koşar). Gezinme bağlamı olmayan
// ortamda (expo-router'ı `useFocusEffect`siz taklit eden testler) etkisizdir — ekran her an odakta sayılır.
import * as Router from "expo-router";
import type { EffectCallback } from "react";

const noop = (_cb: EffectCallback): void => undefined;

export const useScreenFocus: (cb: EffectCallback) => void =
  typeof (Router as { useFocusEffect?: unknown }).useFocusEffect === "function" ? Router.useFocusEffect : noop;
