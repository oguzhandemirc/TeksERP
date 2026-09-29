import type { Router } from "expo-router";

/** Jenerik kayıt ayrıntısına git. */
export function openRecord(router: Router, projection: string, id: string): void {
  router.push({ pathname: "/kayit/[projeksiyon]/[id]", params: { projeksiyon: projection, id } } as never);
}
