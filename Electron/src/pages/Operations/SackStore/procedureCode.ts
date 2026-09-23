import { exportCodeVisible } from "@/pages/Customers/branch-schema";
import type { ShipmentDestination } from "./types";

/**
 * Gümrük/İhracat No (`procedureCode`) satırı — carinin ihracat kodu alanıyla AYNI yüklem:
 * yalnız YURTDIŞI yönde görünür. Değer YALNIZ kaydedilen numaradır; boşsa `null`
 * (ekran "girilmedi" yazar). Şube/cari kodu yedek olarak GÖSTERİLMEZ: o değer hiçbir
 * yere kaydedilmiyordu ve cari kodu gümrük numarası değildir.
 */
export function procedureCodeView(s: { destination: ShipmentDestination; procedureCode: string | null }): {
  goster: boolean;
  deger: string | null;
} {
  return { goster: exportCodeVisible(s.destination), deger: s.procedureCode?.trim() || null };
}

export const PROCEDURE_CODE_BOS = "girilmedi";
