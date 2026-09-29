// rclone bağlantısının TÜRÜ — `ad:` biçimi makine dışı demek değildir: `type = local` bu diskte
// bir yol, `alias` neyi gösterdiği doğrulanmayan bir takma addır. Offsite süpürücü okur.
import { runProcess } from "./pg-tool.helper";

/** Makine dışı SAYILMAYAN bağlantı türleri. */
export const NON_OFFSITE_REMOTE_TYPES = ["local", "alias"] as const;

/**
 * `rclone listremotes --long` ile `ad:` hedefin türü. `null` = ölçülemedi (liste düştü ya da
 * ad listede yok) — makine dışı diye varsayılmaz, çağıran ayrıca söyler.
 */
export async function remoteBackendType(
  remote: string,
  bin: string,
  configArgs: string[],
  timeoutMs: number,
): Promise<string | null> {
  const name = /^([A-Za-z0-9_-]+):/.exec(remote.trim())?.[1];
  if (!name) return null;
  const res = await runProcess(bin, ["listremotes", "--long", ...configArgs], { timeoutMs, captureStdout: true });
  if (res.spawnError || res.code !== 0) return null;
  for (const line of (res.stdout ?? "").split(/\r?\n/)) {
    const m = /^(.+?):\s+(\S+)\s*$/.exec(line.trim());
    if (m && m[1] === name) return m[2]!.toLowerCase();
  }
  return null;
}

/** Türün hükmü: üç sonuç — temiz · makine dışı DEĞİL (uyarılı) · ölçülemedi (uyarılı, işaretsiz). */
export function describeRemoteType(remote: string, type: string | null): { notOffsite: boolean; warning: string | null } {
  if (type === null) {
    return {
      notOffsite: false,
      warning: `rclone bağlantısının türü ölçülemedi ("${remote}", listremotes --long) — makine dışı olduğu doğrulanmadı.`,
    };
  }
  if (!(NON_OFFSITE_REMOTE_TYPES as readonly string[]).includes(type)) return { notOffsite: false, warning: null };
  const ne = type === "local" ? "bu MAKİNEDE bir yol" : "neyi gösterdiği doğrulanmayan bir takma ad";
  return {
    notOffsite: true,
    warning: `Hedef ("${remote}") '${type}' türünde bir rclone bağlantısı — ${ne}; kopya alınıyor ama "makine dışı" SAYILMAZ.`,
  };
}
