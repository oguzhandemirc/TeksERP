// İki depo: oturum belirteci GİZLİ depoda (iOS Keychain / Android Keystore; web'de yalnız sekme ömrü),
// son veri önbelleği düz depoda (AsyncStorage). Depo erişimi hata verebilir — çağıran yutar, çökmeyiz.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function webSession(): KeyValue {
  const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  return {
    get: async (k) => s?.getItem(k) ?? null,
    set: async (k, v) => s?.setItem(k, v),
    remove: async (k) => s?.removeItem(k),
  };
}

export const secretStore: KeyValue =
  Platform.OS === "web"
    ? webSession()
    : {
        get: (k) => SecureStore.getItemAsync(k),
        set: (k, v) => SecureStore.setItemAsync(k, v),
        remove: (k) => SecureStore.deleteItemAsync(k),
      };

export const plainStore: KeyValue & { keys(): Promise<readonly string[]>; removeMany(keys: readonly string[]): Promise<void> } = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
  keys: () => AsyncStorage.getAllKeys(),
  removeMany: (keys) => AsyncStorage.multiRemove([...keys]),
};
