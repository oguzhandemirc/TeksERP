import type { Router } from "expo-router";

/** Kayıt ayrıntısına git: siparişin kendi ekranı var (`/siparisler/<id>`), diğerleri jenerik kayıt ekranı. */
export function openRecord(router: Router, projection: string, id: string): void {
  if (projection === "siparis") {
    router.push({ pathname: "/siparisler/[id]", params: { id } } as never);
    return;
  }
  router.push({ pathname: "/kayit/[projeksiyon]/[id]", params: { projeksiyon: projection, id } } as never);
}

/**
 * Ray (geniş ekran) gezinmesi YANALDIR: yığın köke indirilir, hedef bölüm tek ekran olarak açılır — yığın büyümez,
 * geri tuşu ana bölüme döner. Zaten açık olan bölümün kök ekranına dokunmak bir şey yapmaz.
 */
export function railNavigate(router: Router, route: string, path: string): void {
  if (path === route) return;
  if (router.canDismiss?.()) router.dismissAll();
  router.navigate(route as never);
}
