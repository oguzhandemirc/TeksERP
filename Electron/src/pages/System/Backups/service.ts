import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";

export interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  time: string;
}

export interface BackupListing {
  success: boolean;
  files: BackupFileInfo[];
  backupDir: string | null; // mutlak yedek klasörü (yoksa geliştirme ortamı)
  manageScriptPath: string | null; // <cwd>\scripts\manage.ps1
}

export function useBackups() {
  return useQuery({
    queryKey: ["admin-backups"],
    queryFn: async () => {
      const res = await apiClient.get<BackupListing>("/api/admin/backups", {
        suppressErrorToast: true,
      });
      return res.data;
    },
  });
}

/** Yedeği indirir (blob → kaydet) — admin'in yerel makinesine off-site kopya. */
export async function downloadBackup(name: string): Promise<void> {
  const res = await apiClient.get(`/api/admin/backups/${encodeURIComponent(name)}/download`, {
    responseType: "blob",
    // O7 fix: global 15sn timeout büyük dump dosyasında her seferinde kesiyordu
    // (off-site kopya alınamaz hale geliyordu). Büyük transfer: 5 dk.
    timeout: 300_000,
  });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Sunucuda çalıştırılacak geri-yükleme komutu (panodan kopyalanır). */
export function restoreCommand(listing: BackupListing | undefined, name: string): string {
  const dir = listing?.backupDir ?? "C:\\ProgramData\\TeksERP\\backups";
  const script = listing?.manageScriptPath ?? ".\\manage.ps1";
  const file = `${dir}\\${name}`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -Action restore -BackupFile "${file}"`;
}
