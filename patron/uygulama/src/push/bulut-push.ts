// Bulut kipi bildirim bağının çıkışta bırakılması: kayıtta belirteç gizli depoya yazılır, çıkışta `/oturum/kapat`tan
// ÖNCE `POST /cihazlar/birak` ile sunucuda bu telefonun satırları pasife çekilir (bütün tesislerde). Hata sessizdir:
// eski sunucu 404 ya da çevrimdışı → belirteç bulutta yaşar (bugünkü davranış); çıkış hiçbir durumda bekletilmez.
import type { Api } from "../api/endpoints";
import type { KeyValue } from "../state/browser-store";

/** Gizli depoda: bu cihazın bulut kaydındaki son belirteci (ham; yalnız güvenli depoda). */
export const BULUT_PUSH_KEY = "patron.bulutPushBelirteci";

export async function bulutPushHatirla(store: KeyValue, belirtec: string): Promise<void> {
  await store.set(BULUT_PUSH_KEY, belirtec).catch(() => undefined);
}

/** Ekrandan kayıt: gizli depo çağrı anında alınır (ekran modülü yüklenirken yerel depo modülü istenmesin). */
export function bulutPushHatirlaGizli(belirtec: string): Promise<void> {
  return bulutPushHatirla((require("../state/store") as typeof import("../state/store")).secretStore, belirtec);
}

export async function bulutPushBirak(api: Pick<Api, "deviceRelease">, store: KeyValue): Promise<void> {
  const belirtec = await store.get(BULUT_PUSH_KEY).catch(() => null);
  if (!belirtec) return;
  await api.deviceRelease(belirtec).catch(() => undefined);
  await store.remove(BULUT_PUSH_KEY).catch(() => undefined);
}
