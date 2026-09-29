// Şifreli modül anahtarının fabrika tarafı (Faz 2d): anahtar YALNIZ motorun kullanılabilir saydığı
// (bu kuruluma bağlı, doğrulanmış, geri alınmamış) kiradan, çekirdekte açılır — üretimde native, TS'e
// düşme yalnız geliştirmede (`__TEKSERP_NATIVE_REQUIRED__`da `getLicenseCore()` TS döndürmez).
import { anchorArgument } from "./core-bridge";
import { dropCachedModuleKey, readCachedModuleKey, writeCachedModuleKey } from "./module-key-cache";
import { getLicenseCore } from "./native";
import { b64uDecode } from "./protocol";
import { getLicenseConfig, getLicenseSnapshot } from "./runtime";
import { getLicenseStore } from "./store";

export type ModuleKeyOutcome =
  | { readonly ok: true; readonly key: Buffer; readonly surum: number | null; readonly kaynak: "kira" | "onbellek" }
  | { readonly ok: false; readonly code: string; readonly message: string };

function refuse(code: string, message: string): ModuleKeyOutcome {
  return { ok: false, code, message };
}

/** (modül, kid) anahtarını açar: kira + HAK + kurulumun X25519 özel yarısı → çekirdek. Sonuç bir ANAHTARDIR. */
export function unlockModuleKey(modul: string, kid: string): ModuleKeyOutcome {
  const store = getLicenseStore();
  if (!store || store.problem || !store.key) return refuse("LISANS_DEPOSU_YOK", "Lisans deposu kullanılamıyor");
  const pair = store.key.x25519;
  if (!pair) return refuse("SIFRELEME_ANAHTARI_YOK", "Kurulumun şifreleme anahtarı henüz yok (ilk yoklamada doğar)");
  let snap;
  try {
    snap = getLicenseSnapshot();
  } catch {
    return refuse("LISANS_OLCULEMEDI", "Lisans durumu ölçülemedi");
  }
  if (!snap.lease || !snap.entitlement || !store.leaseJws || !store.entitlementJws) {
    return refuse("KIRA_YOK", "Kullanılabilir kira ya da HAK yok");
  }
  const kiraId = snap.lease.document.kiraId;
  const cached = readCachedModuleKey(store.dir, { modul, kid, kiraId });
  if (cached) return { ok: true, key: cached, surum: null, kaynak: "onbellek" };
  const r = getLicenseCore().unwrapLeaseModuleKey({
    lease: store.leaseJws,
    entitlement: store.entitlementJws,
    privateKeyX: pair.privateX,
    modul,
    kid,
    ...(anchorArgument(getLicenseConfig().roots) ? { roots: getLicenseConfig().roots } : {}),
  });
  if (!r.ok) {
    dropCachedModuleKey(store.dir, modul);
    return refuse(r.code, r.message);
  }
  const key = b64uDecode(r.value.anahtar);
  if (!key || key.length !== 32) return refuse("MODUL_SARMA_ACILAMADI", "Açılan modül anahtarı biçimsiz");
  writeCachedModuleKey(store.dir, { modul, kid, kiraId, key });
  return { ok: true, key, surum: r.value.surum, kaynak: "kira" };
}
