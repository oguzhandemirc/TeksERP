import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

/** Backend `services/read-only-db.service.ts` `ReadOnlyDbStatus` aynası. */
export type ReadOnlyDbState = "HAZIR" | "KAPALI" | "KURULUMDA_YOK";

export interface ReadOnlyDbStatus {
  state: ReadOnlyDbState;
  role: string | null;
  database: string;
  host: string | null;
  port: number | null;
  container: boolean;
  passwordRotatedAt: string | null;
  activeConnections: number;
  connectionLimit: number;
  hiddenTables: string[];
  hiddenColumns: Record<string, string[]>;
}

export const READ_ONLY_DB_QUERY_KEY = ["read-only-db"];

/** Ekran hatayı kendi şeridinde gösterir (`suppressErrorToast`). */
export async function fetchReadOnlyDb(): Promise<ReadOnlyDbStatus> {
  const res = await apiClient.get<{ data: ReadOnlyDbStatus }>("/api/admin/read-only-db", { suppressErrorToast: true });
  return res.data.data;
}

/** Parola yalnız bu yanıtta döner; çağıran onu yalnız sonuç penceresinin ömrü boyunca tutar. */
export async function rotateReadOnlyDbPassword(): Promise<{ status: ReadOnlyDbStatus; password: string }> {
  const res = await apiClient.post<{ data: { status: ReadOnlyDbStatus; password: string } }>(
    "/api/admin/read-only-db/password",
    {},
    { suppressErrorToast: true },
  );
  return res.data.data;
}

export function useReadOnlyDb() {
  return useQuery<ReadOnlyDbStatus>({ queryKey: READ_ONLY_DB_QUERY_KEY, queryFn: fetchReadOnlyDb, retry: false });
}

export function useRotateReadOnlyDbPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rotateReadOnlyDbPassword,
    // Parola önbelleğe GİRMEZ: yalnız durum tazelenir.
    onSuccess: (r) => qc.setQueryData(READ_ONLY_DB_QUERY_KEY, r.status),
  });
}
