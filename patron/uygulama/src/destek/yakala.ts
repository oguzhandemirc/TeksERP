// Ekran görüntüsü (react-native-view-shot). Yalnız iOS/Android: web'de view-shot `captureScreen` yok → adım atlanır,
// talep yalnız metinle açılır. Modül TEMBEL yüklenir (web paketi ve yerel modülü olmayan eski derleme çökmesin); her
// hata null döner (fail-open: destek yolu ne uygulamayı ne kendini kilitler).
import { Dimensions, PixelRatio, Platform } from "react-native";
import { uzunKenaraSigdir } from "./cizim";
import type { YakalananEkran } from "./taslak";

/** Dokunma dalgası/basılı görünümün görüntüden çekilmesi için kısa bekleme. */
export const YAKALAMA_GECIKMESI_MS = 150;
/** JPEG kalitesi: metin okunur kalır, boyut ~150–400 KB. */
export const JPEG_KALITE = 0.8;

type ViewShot = typeof import("react-native-view-shot");

/** Yerel modül bağlı mı? (eski derlemede yoksa require/çağrı düşer). */
export function viewShot(): ViewShot | null {
  if (Platform.OS === "web") return null;
  try {
    return require("react-native-view-shot") as ViewShot;
  } catch {
    return null;
  }
}

export function ekranGoruntusuDestekleniyor(): boolean {
  return viewShot() !== null;
}

export async function ekraniYakala(bekle: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<YakalananEkran | null> {
  const vs = viewShot();
  if (!vs) return null;
  try {
    await bekle(YAKALAMA_GECIKMESI_MS);
    const { width, height } = Dimensions.get("window");
    const px = uzunKenaraSigdir(width * PixelRatio.get(), height * PixelRatio.get());
    if (px.width === 0) return null;
    const uri = await vs.captureScreen({ format: "jpg", quality: JPEG_KALITE, result: "data-uri", width: px.width, height: px.height });
    return typeof uri === "string" && uri.startsWith("data:") ? { uri, width: px.width, height: px.height } : null;
  } catch {
    return null;
  }
}
