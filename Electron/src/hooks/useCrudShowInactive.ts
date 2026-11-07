// CrudPage liste kaydı (opt-in): sıralama + "Pasifleri göster". Anahtar URL'de durur ki kayıt
// geri yüklensin ve kayıtlı görünüme girsin; opt-in olmayan sayfada yerel durum (bugünkü davranış).
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";

export const SHOW_INACTIVE_PARAM = "showInactive";
export const CRUD_PERSIST: TableFilterPersistConfig = { filterKeys: [], extraKeys: [SHOW_INACTIVE_PARAM] };

export function useShowInactive(urlBacked: boolean): [boolean, (v: boolean) => void] {
  const [local, setLocal] = useState(false);
  const [sp, setSp] = useSearchParams();
  if (!urlBacked) return [local, setLocal];
  const set = (v: boolean) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v) next.set(SHOW_INACTIVE_PARAM, "true");
        else next.delete(SHOW_INACTIVE_PARAM);
        next.delete("cursor");
        return next;
      },
      { replace: true },
    );
  return [sp.get(SHOW_INACTIVE_PARAM) === "true", set];
}
