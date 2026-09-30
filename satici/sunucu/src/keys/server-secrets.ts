// Sunucunun üç simetrik sırrı (portal TOTP sarma anahtarı · etkinleştirme kodu sırrı · modül kasası anahtarı)
// ANAHTAR_DIZINI'nde 0600 dosyadır ve TEK üreticisi `anahtar.ts sirlar-uret`tir. Anahtar birimi VDS'te SALT
// OKUNUR bağlanır: sunucu ya da CLI açılışta yaratmaya kalkarsa EROFS'la düşerdi → eksikse yaratmadan durur.
import { existsSync } from "node:fs";
import path from "node:path";
import { PORTAL_SECRET_KEY_FILE, PortalSecretBox } from "../portal/secret-box";
import { ACTIVATION_CODE_PEPPER_FILE, ActivationCodeHasher } from "./code-pepper";
import { MODULE_VAULT_KEY_FILE, ModuleKeyVault } from "./module-vault";

export const SERVER_SECRET_FILES = [PORTAL_SECRET_KEY_FILE, ACTIVATION_CODE_PEPPER_FILE, MODULE_VAULT_KEY_FILE] as const;

export interface ServerSecrets {
  portalSecrets: PortalSecretBox;
  moduleVault: ModuleKeyVault;
  codeHasher: ActivationCodeHasher;
}

export class MissingServerSecretsError extends Error {
  constructor(
    readonly dir: string,
    readonly missing: readonly string[],
  ) {
    super(
      `Sunucu sırları eksik (${dir}): ${missing.join(", ")}. Sunucu bu dosyaları kendisi ÜRETMEZ (anahtar birimi salt okunur). ` +
        `Anahtar makinesinde "npx tsx scripts/anahtar.ts sirlar-uret --dizin=<anahtar dizini>" koşun, üretilen dosyaları ` +
        `0600 olarak anahtar birimine kopyalayıp yeniden başlatın (docs/ops/SATICI-KURULUM.md §2).`,
    );
    this.name = "MissingServerSecretsError";
  }
}

export function missingServerSecrets(dir: string): string[] {
  return SERVER_SECRET_FILES.filter((f) => !existsSync(path.join(dir, f)));
}

/** Üç sırrı YALNIZ OKUR; biri bile eksikse hiçbirini yaratmadan açık hata (fail-closed). */
export function loadServerSecrets(dir: string): ServerSecrets {
  const missing = missingServerSecrets(dir);
  if (missing.length > 0) throw new MissingServerSecretsError(dir, missing);
  return {
    portalSecrets: PortalSecretBox.load(dir, { create: false }),
    moduleVault: ModuleKeyVault.load(dir, { create: false }),
    codeHasher: ActivationCodeHasher.load(dir, { create: false }),
  };
}

/** `sirlar-uret`in gövdesi: eksik olanı 0600 üretir, VAR olanın üstüne yazmaz (yazsaydı TOTP/kod/kasa kaybolurdu). */
export function generateServerSecrets(dir: string): Array<{ file: string; created: boolean }> {
  const producers: ReadonlyArray<readonly [string, () => unknown]> = [
    [PORTAL_SECRET_KEY_FILE, () => PortalSecretBox.load(dir, { create: true })],
    [ACTIVATION_CODE_PEPPER_FILE, () => ActivationCodeHasher.load(dir, { create: true })],
    [MODULE_VAULT_KEY_FILE, () => ModuleKeyVault.load(dir, { create: true })],
  ];
  return producers.map(([file, produce]) => {
    const existed = existsSync(path.join(dir, file));
    produce();
    return { file, created: !existed };
  });
}
