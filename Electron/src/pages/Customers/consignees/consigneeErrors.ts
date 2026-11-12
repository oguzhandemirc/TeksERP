// Etiket alıcısı uçlarının çıkışlı 409'ları — genel toast yerine satırda çizilir (yıkıcı işlem kuralı: engelleyen
// toplar tek tek) ve "birleştir" çıkışı verir. Tanınmayan hata `other` ile cümlesine düşer.
import axios from "axios";
import type { ConsigneeLiveRoll } from "./consigneeService";

export type ConsigneeIssue =
  | { kind: "in-use"; message: string; rolls: ConsigneeLiveRoll[] }
  | { kind: "name-taken"; message: string; conflictId: string | null }
  | { kind: "other"; message: string };

export function consigneeIssueOf(error: unknown): ConsigneeIssue {
  const body = axios.isAxiosError(error)
    ? (error.response?.data as { message?: string; details?: { code?: unknown; rolls?: unknown; conflictId?: unknown } } | undefined)
    : undefined;
  const message = body?.message || "İşlem yapılamadı.";
  const d = body?.details;
  if (d?.code === "CONSIGNEE_IN_USE" && Array.isArray(d.rolls)) return { kind: "in-use", message, rolls: d.rolls as ConsigneeLiveRoll[] };
  if (d?.code === "CONSIGNEE_NAME_TAKEN") return { kind: "name-taken", message, conflictId: typeof d.conflictId === "string" ? d.conflictId : null };
  return { kind: "other", message };
}
