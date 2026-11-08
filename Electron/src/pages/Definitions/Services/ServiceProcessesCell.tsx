// Liste hücreleri: kartın süreç türleri (Hizmet Kartları) ve türün hizmet kartı (Fason Kategorileri). İkisi de
// TEK harita isteğini paylaşır (aynı query key) — satır başına istek yok.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Workflow } from "lucide-react";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { SERVICE_PROCESS_MAP_QUERY_KEY, getServiceProcessMap, processesOf, serviceOfCategory } from "./serviceProcesses";
import { ServiceProcessesDialog } from "./ServiceProcessesDialog";
import type { ServiceItem } from "./types";

function useProcessMap() {
  const { hasPermission } = useRoleAccess();
  return useQuery({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY, queryFn: getServiceProcessMap, enabled: hasPermission("item:read"), staleTime: 30_000 });
}

export function ServiceProcessesCell({ item }: { item: ServiceItem }) {
  const { hasPermission } = useRoleAccess();
  const map = useProcessMap();
  const [open, setOpen] = useState(false);
  const names = processesOf(item.id, map.data ?? []).map((r) => r.categoryName);
  const canEdit = hasPermission("item:write");
  const text = names.length > 0 ? names.join(", ") : "—";
  return (
    <>
      {canEdit ? (
        <button
          type="button"
          className="inline-flex max-w-[16rem] items-center gap-1 text-left text-xs text-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={`${item.name} süreç türleri`}
        >
          <Workflow className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{names.length > 0 ? text : "Eşle"}</span>
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">{text}</span>
      )}
      {open && <ServiceProcessesDialog item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Fason Kategorileri listesinde türün eşli hizmet kartı (salt okunur; eşleme Hizmet Kartları ekranında). */
export function CategoryServiceCell({ categoryId }: { categoryId: string }) {
  const map = useProcessMap();
  const row = serviceOfCategory(categoryId, map.data ?? []);
  return row ? <span className="text-sm">{row.serviceItemName}</span> : <span className="text-muted-foreground">—</span>;
}
