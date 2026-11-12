// Bekçilerin router katmanına erişimi — GERÇEK imzayla tek yardımcı (test_type_assertion_ratchet §2 B).
// Express 5 tiplerinde `IRoute.methods` yok ama çalışma zamanında var; `as unknown as {…}` yerine burada okunur.
import type { Router } from "express";
import type { ILayer } from "express-serve-static-core";

/** Katmanın rotası verilen HTTP metodunu (küçük harf: "get", "patch") taşıyor mu. */
export function routeHasMethod(layer: ILayer, method: string): boolean {
  const methods: unknown = layer.route ? Reflect.get(layer.route, "methods") : undefined;
  return typeof methods === "object" && methods !== null && Reflect.get(methods, method) === true;
}

/** Router'ın kendi yığınında yol + metotla eşleşen rota katmanı (alt router'a inmez). */
export function findRouteLayer(router: Router, path: string, method: string): ILayer | undefined {
  return router.stack.find((l) => l.route?.path === path && routeHasMethod(l, method));
}
