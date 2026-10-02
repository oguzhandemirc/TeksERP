// İki depo: oturum belirteci GİZLİ depoda (iOS Keychain / Android Keystore; web'de yalnız sekme ömrü), son veri
// önbelleği düz depoda — telefonda AsyncStorage (Android yedeğe girmez: `app.json` `allowBackup: false`), web'de
// sessionStorage: sekme kapanınca finans/cari verisi tarayıcıda kalmaz. Depo erişimi hata verebilir — çağıran yutar.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { browserStore, type KeyValue, type ListedStore } from "./browser-store";

export type { KeyValue, ListedStore };

const web = Platform.OS === "web";
const browser = globalThis as { sessionStorage?: Storage; localStorage?: Storage };

export const secretStore: KeyValue = web
  ? browserStore(browser.sessionStorage)
  : {
      get: (k) => SecureStore.getItemAsync(k),
      set: (k, v) => SecureStore.setItemAsync(k, v),
      remove: (k) => SecureStore.deleteItemAsync(k),
    };

export const plainStore: ListedStore = web
  ? browserStore(browser.sessionStorage)
  : {
      get: (k) => AsyncStorage.getItem(k),
      set: (k, v) => AsyncStorage.setItem(k, v),
      remove: (k) => AsyncStorage.removeItem(k),
      keys: () => AsyncStorage.getAllKeys(),
      removeMany: (keys) => AsyncStorage.multiRemove([...keys]),
    };

/** Eski sürümün web önbelleğini yazdığı kalıcı depo (localStorage) — açılışta temizlenir; telefonda yok. */
export const legacyPlainStore: ListedStore | null = web ? browserStore(browser.localStorage) : null;
