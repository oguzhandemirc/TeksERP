import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JWS_MAX_LENGTH } from "./kunye-jws.mjs";

/**
 * DAĞITIM İPTALİ YEREL DEPOSU — panelin gördüğü en yüksek sıralı dağıtım iptali (`tekserp-paketiptal`, kök imzalı)
 * `userData/lisans-iptal.jws`te saklanır (tasarım §3.4): sonraki denetimde yanıt iptalsiz gelse de iptal geri
 * alınamaz. Dosya güvenilmez girdi sayılır — her okumada imzası yeniden doğrulanır (`mergeReleaseRevocations`);
 * okuma/yazma hatası yutulur (en iyi çaba: depo yoksa yalnız o anki kaynaklar ölçülür).
 */
export const REVOCATION_FILE_NAME = "lisans-iptal.jws";

export interface RevocationStore {
  read(): string | null;
  save(token: string): void;
}

export function createRevocationStore(dir: () => string | null): RevocationStore {
  const file = (): string | null => {
    const d = dir();
    return d ? path.join(d, REVOCATION_FILE_NAME) : null;
  };
  return {
    read() {
      const f = file();
      if (!f) return null;
      try {
        if (statSync(f).size > JWS_MAX_LENGTH) return null;
        const text = readFileSync(f, "utf8").trim();
        return text.length > 0 && text.length <= JWS_MAX_LENGTH ? text : null;
      } catch {
        return null;
      }
    },
    save(token) {
      const f = file();
      if (!f || token.length === 0 || token.length > JWS_MAX_LENGTH) return;
      const tmp = `${f}.${process.pid}.yeni`;
      try {
        writeFileSync(tmp, token, { encoding: "utf8", mode: 0o600 });
        renameSync(tmp, f);
      } catch {
        // En iyi çaba: yazılamayan iptal bu denetimde yine uygulanır, yalnız kalıcılaşmaz.
      }
    },
  };
}
