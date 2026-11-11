// Cariler rol şeridi — sayılar SUNUCUDAN: listeyle AYNI uç + AYNI arama + rol süzgeci, `pagination.total`
// (istemcide sayma yok; liste ile şerit aynı where'den gelir). Bağsız eski fason profilleri "Fason"a eklenir.
import { useQuery } from "@tanstack/react-query";
import { UNLINKED_SUBCONTRACTOR_FILTER } from "@/components/forms/supplierPicker";
import { directionFilters, subcontractorFilters } from "@/lib/partnerRoles";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";

export interface CariRoleCounts {
  all: number;
  customer: number;
  supplier: number;
  subcontractor: number;
}

const total = (r: { pagination?: { total?: number } }) => r.pagination?.total ?? 0;

async function fetchCounts(search: string | undefined): Promise<CariRoleCounts> {
  const one = (filters: Record<string, string>) => customerService.getAll({ page: 1, pageSize: 1, sortBy: "name", sortOrder: "asc", search, filters }).then(total);
  const [all, customer, supplier, subLinked, subUnlinked] = await Promise.all([
    one({}),
    one({ ...directionFilters("CUSTOMER") }),
    one({ ...directionFilters("SUPPLIER") }),
    one({ ...subcontractorFilters("YES") }),
    subcontractorService.getAll({ page: 1, pageSize: 1, sortBy: "name", sortOrder: "asc", search, filters: { ...UNLINKED_SUBCONTRACTOR_FILTER } }).then(total),
  ]);
  return { all: all + subUnlinked, customer, supplier, subcontractor: subLinked + subUnlinked };
}

export function useCariRoleCounts(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ["customers", "cariler", "role-counts", search],
    queryFn: () => fetchCounts(search || undefined),
    enabled,
    staleTime: 30_000,
  });
}
