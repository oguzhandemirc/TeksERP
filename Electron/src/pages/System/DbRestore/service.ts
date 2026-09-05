import apiClient from "@/services/apiClient";
import type { DbCopyListing, SwapCommands, VerificationReport } from "./types";

/** React-query anahtarı — hook'lar ve invalidate eden yüzeyler tek kaynaktan okur. */
export const DB_COPIES_QUERY_KEY = ["db-copies"];

/**
 * Saf veri erişimi (React'e bağlı değil) — hook'lar `hooks.ts`te.
 *
 * ⚠️ Tüm uçlar `suppressErrorToast: true` taşır: ekran hatayı KENDİ şeridinde
 * gösterir, interceptor'ın ikinci toast'ı gerekmez ([EL-18]).
 */
export async function fetchDbCopies(): Promise<DbCopyListing> {
  const res = await apiClient.get<{ success: boolean; data: DbCopyListing }>(
    "/api/admin/db-copies",
    { suppressErrorToast: true },
  );
  return res.data.data;
}

export async function startCopy(
  backupName: string,
): Promise<{ success: boolean; message: string; copyName?: string }> {
  const res = await apiClient.post<{ success: boolean; message: string; copyName?: string }>(
    "/api/admin/db-copies",
    { backupName },
    { suppressErrorToast: true },
  );
  return res.data;
}

export async function verifyCopy(name: string): Promise<VerificationReport> {
  const res = await apiClient.post<{ success: boolean; data: VerificationReport }>(
    `/api/admin/db-copies/${encodeURIComponent(name)}/verify`,
    {},
    { suppressErrorToast: true },
  );
  return res.data.data;
}

export async function dropCopy(input: {
  name: string;
  force?: boolean;
}): Promise<{ success: boolean; message: string }> {
  const res = await apiClient.delete<{ success: boolean; message: string }>(
    `/api/admin/db-copies/${encodeURIComponent(input.name)}${input.force ? "?force=1" : ""}`,
    { suppressErrorToast: true },
  );
  return res.data;
}

/**
 * Takas + geri alma komut blokları. Kopya `ready` değilse backend 409 döner ve
 * komut ÜRETİLMEZ — yarım bir kopyaya geçiş felakettir.
 */
export async function fetchSwapCommands(name: string): Promise<SwapCommands> {
  const res = await apiClient.get<{ success: boolean; data: SwapCommands }>(
    `/api/admin/db-copies/${encodeURIComponent(name)}/swap-command`,
    { suppressErrorToast: true },
  );
  return res.data.data;
}
