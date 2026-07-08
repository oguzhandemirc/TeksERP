// =============================================================================
// Manuel Yedek — backend pg_dump ÇALIŞTIRMAZ, var olan görevi TETİKLER
// =============================================================================
// Kurulumda (manage.ps1) her gece 03:00 koşan "TeksERP Gece Yedek" Görev
// Zamanlayıcı görevi pg_dump + 14'lük saklama mantığını içerir. "Şimdi yedek al"
// butonu bu görevi `schtasks /run` ile tetikler: ağır iş AYRI bir SYSTEM
// prosesinde koşar, backend prosesi bloklanmaz (sisteme ek yük binmez — pg_dump
// kendi I/O'sunu yapar). Tamamlanınca dump BACKUP_DIR'e düşer; durum sayfası /
// panel "son yedek"i oradan okur.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const BACKUP_TASK_NAME = process.env.BACKUP_TASK_NAME || "TeksERP Gece Yedek";
const BACKUP_DIR = process.env.BACKUP_DIR;

export interface BackupTriggerResult {
  started: boolean;
  message: string;
}

export async function triggerManualBackup(): Promise<BackupTriggerResult> {
  if (process.platform !== "win32") {
    return {
      started: false,
      message:
        "Manuel yedek yalnızca kurulu Windows sunucusunda kullanılabilir (geliştirme ortamında devre dışı).",
    };
  }
  return new Promise<BackupTriggerResult>((resolve) => {
    // Fire-and-trigger: schtasks görevi tetikler, görev arka planda koşar.
    const child = spawn("schtasks", ["/run", "/tn", BACKUP_TASK_NAME], {
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      resolve({ started: false, message: `Yedek görevi tetiklenemedi: ${err.message}` });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          started: true,
          message:
            "Yedek başlatıldı. Birkaç dakika içinde tamamlanır; bitince 'son yedek' güncellenir.",
        });
      } else {
        resolve({
          started: false,
          message: `Yedek görevi başlatılamadı (kod ${code}). ${
            stderr.trim() || `Görev kayıtlı mı? ("${BACKUP_TASK_NAME}")`
          }`,
        });
      }
    });
  });
}

// =============================================================================
// Yedek dosyalarını listele / indir (panelden)
// =============================================================================
// Yalnız filesystem okur (DB'ye dokunmaz) → talep üzerine, ucuz. İndirme yolu
// BACKUP_DIR'le SINIRLANIR (path traversal engellenir).

export interface BackupFileInfo {
  name: string;
  sizeBytes: number;
  time: string; // dosya değişiklik zamanı (ISO)
}

export interface BackupListing {
  files: BackupFileInfo[];
  backupDir: string | null; // mutlak yedek klasörü (geri-yükleme komutu için)
  manageScriptPath: string | null; // <cwd>\scripts\manage.ps1
}

export async function listBackups(): Promise<BackupListing> {
  const manageScriptPath =
    process.platform === "win32" ? path.join(process.cwd(), "scripts", "manage.ps1") : null;
  const dir = BACKUP_DIR;
  if (!dir) return { files: [], backupDir: null, manageScriptPath };
  try {
    // F234: async fs — büyük yedek klasöründe readdirSync + per-file statSync
    // istek handler'ını (dolayısıyla event loop'u) bloklamasın.
    const names = (await fs.promises.readdir(dir)).filter((f) =>
      f.toLowerCase().endsWith(".dump"),
    );
    const files = (
      await Promise.all(
        names.map(async (name) => {
          const st = await fs.promises.stat(path.join(dir, name));
          return { name, sizeBytes: st.size, time: new Date(st.mtimeMs).toISOString() };
        }),
      )
    ).sort((a, b) => b.time.localeCompare(a.time)); // en yeni önce
    return { files, backupDir: path.resolve(dir), manageScriptPath };
  } catch {
    return { files: [], backupDir: path.resolve(dir), manageScriptPath };
  }
}

/** Güvenli yol: yalnız BACKUP_DIR içindeki bir .dump dosyası; traversal engellenir. */
export function resolveBackupPath(name: string): string | null {
  if (!BACKUP_DIR) return null;
  const safe = path.basename(name); // dizin bileşenlerini sıyır (../ vb. düşer)
  if (safe !== name || !/\.dump$/i.test(safe)) return null;
  const root = path.resolve(BACKUP_DIR);
  const abs = path.resolve(root, safe);
  if (abs !== root + path.sep + safe && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}
