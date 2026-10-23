import type { Router } from "expo-router";

/** Kayıt ayrıntısına git: siparişin kendi ekranı var (`/siparisler/<id>`), diğerleri jenerik kayıt ekranı. */
export function openRecord(router: Router, projection: string, id: string): void {
  if (projection === "siparis") {
    router.push({ pathname: "/siparisler/[id]", params: { id } } as never);
    return;
  }
  router.push({ pathname: "/kayit/[projeksiyon]/[id]", params: { projeksiyon: projection, id } } as never);
}
