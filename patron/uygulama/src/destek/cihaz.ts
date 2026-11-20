// Talep bağlamının cihaz/sürüm girdisi (yerel modüller tembel ve hata-güvenli okunur; eksikse alan boş kalır).
// Cihaz kimliği, push belirteci, ad/e-posta OKUNMAZ.
import Constants from "expo-constants";
import { Platform } from "react-native";

export interface CihazBilgisi {
  readonly surum: string;
  readonly yapi: string | number | null;
  readonly os: string;
  readonly osSurum: string | number | null;
  readonly model: string | null;
}

export function cihazBilgisi(): CihazBilgisi {
  const cfg = Constants.expoConfig;
  const yapi = Platform.OS === "ios" ? (cfg?.ios?.buildNumber ?? null) : Platform.OS === "android" ? (cfg?.android?.versionCode ?? null) : null;
  let model: string | null = null;
  let osSurum: string | number | null = Platform.Version ?? null;
  if (Platform.OS !== "web") {
    try {
      const Device = require("expo-device") as typeof import("expo-device");
      model = Device.modelName ?? null;
      osSurum = Device.osVersion ?? osSurum;
    } catch {
      // Modül yoksa model boş kalır.
    }
  } else {
    osSurum = null; // web: tarayıcı künyesi gönderilmez
  }
  return { surum: cfg?.version ?? "?", yapi, os: Platform.OS, osSurum, model };
}
