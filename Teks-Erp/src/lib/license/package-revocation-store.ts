// PAKET sertifikası İPTAL listesi deposu (`PAKET-ANAHTARI-KOK-ALTINDA.md` §2.4): tek kopya `LICENSE_DIR/paket-iptal.jws`.
// Kaynakları kira yanıtı (`paketIptal`) ve güncelleyici (paketin getirdiğini aynı dosyaya yazar); yüksek sıra kazanır.
// Yalnız bu derlemenin kökleriyle doğrulanan belge tutulur; biçimsiz/imzasız gelen sessizce yok sayılır.
import path from "node:path";
import { PACKAGE_REVOCATION_FILE, pickNewerPackageRevocation, verifyPackageRevocation, type RootKey, type VerifiedPackageRevocation } from "./protocol";
import { getLicenseStore } from "./store";
import { readFileState, writeFileAtomicSync } from "./store-files";
import { ROOT_PUBLIC_KEYS } from "./trust-anchor";

const MAX_PACKAGE_REVOCATION_BYTES = 128 * 1024;

function revocationFile(): string | null {
  const store = getLicenseStore();
  return store ? path.join(store.dir, PACKAGE_REVOCATION_FILE) : null;
}

/** Dosyadaki doğrulanmış PAKET iptal listesi; yoksa/okunamazsa/doğrulanmazsa null (iptal bilinmiyor = işaret yok). */
export function loadPackageRevocation(roots: readonly RootKey[] = ROOT_PUBLIC_KEYS): VerifiedPackageRevocation | null {
  const file = revocationFile();
  if (!file) return null;
  const read = readFileState(file, MAX_PACKAGE_REVOCATION_BYTES);
  if (read.kind !== "METIN") return null;
  const r = verifyPackageRevocation(read.text.trim(), roots);
  return r.ok ? r.value : null;
}

/** Gelen liste doğrulanır ve eldekinden YÜKSEK sıralıysa dosyaya yazılır; aksi her durumda dokunulmaz. */
export function adoptPackageRevocation(token: unknown, roots: readonly RootKey[] = ROOT_PUBLIC_KEYS): boolean {
  if (typeof token !== "string") return false;
  const incoming = verifyPackageRevocation(token, roots);
  if (!incoming.ok) return false;
  const held = loadPackageRevocation(roots);
  if (pickNewerPackageRevocation(held, incoming.value) !== incoming.value) return false;
  const store = getLicenseStore();
  const file = revocationFile();
  if (!store || !file || (store.problem !== null && store.problem !== "OKUNAMADI")) return false;
  try {
    writeFileAtomicSync(file, `${token}\n`);
  } catch {
    return false;
  }
  return true;
}
