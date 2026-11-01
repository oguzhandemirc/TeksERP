// Kilit koy/aç sonrası rozet taşıyan TÜM yüzeyler tazelenir (Cari Hesaplar, Cariler, İçerideki İşler, Sevke Hazır İşler).
import type { QueryClient } from "@tanstack/react-query";
import { CONSIGNED_WORK_QUERY_KEY } from "@/pages/Operations/ConsignedWork/service";
import { READY_WORKS_QUERY_KEY } from "@/pages/Operations/ReadyWorks/service";

export function invalidateHoldViews(qc: QueryClient): void {
  for (const key of ["finance", "cari-hold", "customers", CONSIGNED_WORK_QUERY_KEY, READY_WORKS_QUERY_KEY]) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}
