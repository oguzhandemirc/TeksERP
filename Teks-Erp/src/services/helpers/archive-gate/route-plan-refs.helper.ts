// =============================================================================
// AKTİF ROTANIN PLANI — renk / özellik / fasoncu için ENGELLEYEN referans
// =============================================================================
// 1e kararı (Q1 revize, 2026-09-25): yıkıcı değişiklik KAYNAKTA durur — aktif rotanın
// adımı pasif bir rengi/özelliği/fasoncuyu planlıyorsa o kayıt arşivlenemez; çıkış rotayı
// düzeltmek ya da pasife almak. Kullanım yerinde (iş emri açılışı) eski veri yalnız uyarır.
// =============================================================================
import { Prisma } from "@prisma/client";
import type { Db, RefKind } from "../master-data-archive.helper";

const ACTIVE_ROUTE: Prisma.RouteWhereInput = { isActive: true };
const stepTitle = (s: { sequence: number; route: { name: string }; station: { name: string } }) =>
  ({ title: `${s.route.name} · adım ${s.sequence}`, detail: s.station.name });

function routeStepRef(where: (id: string) => Prisma.RouteStepWhereInput): RefKind {
  return {
    kind: "ROUTE_STEP",
    label: "Aktif rota adımı",
    count: (db: Db, id: string) => db.routeStep.count({ where: { ...where(id), route: ACTIVE_ROUTE } }),
    list: async (db: Db, id: string, take: number) =>
      (await db.routeStep.findMany({
        where: { ...where(id), route: ACTIVE_ROUTE },
        take,
        orderBy: [{ routeId: "asc" }, { sequence: "asc" }],
        select: { id: true, sequence: true, route: { select: { name: true } }, station: { select: { name: true } } },
      })).map((s) => ({ id: s.id, ...stepTitle(s) })),
  };
}

export const plannedColorStep = routeStepRef((id) => ({ plannedColorId: id }));
export const plannedSubcontractorStep = routeStepRef((id) => ({ plannedSubcontractorId: id }));
export const plannedPropertyStep = routeStepRef((id) => ({ plannedProperties: { some: { propertyId: id } } }));
