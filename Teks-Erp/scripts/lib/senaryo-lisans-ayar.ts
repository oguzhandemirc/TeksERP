// SENARYO L — fabrika backend sürecinin iki test enjeksiyonu (sunucu modülünden ÖNCE yüklenir):
//   ① güven çapası: satıcının test kökleri (`SENARYO_CAPA_DOSYASI`) — üretimde env'den çapa
//      OKUNMAZ; bu dosya yalnız senaryo sürecinde `configureLicenseRuntimeForTests`i çağırır.
//   ② parmak izi: `SENARYO_PARMAK_IZI` = {makine, seri} verilirse işletim sistemi sorgusu (ioreg)
//      o makinenin değerlerini döndürür — aynı Mac'te "başka makine" (kopya/taşıma) canlandırılır.
//   ④ çok etkenli makine: `SENARYO_ETKENLER` = {f1..f4} verilirse toplayıcı (TS ya da native) o kümeyi Linux yollarından
//      okunmuş gibi döndürür — darwin yalnız f1 + f4 okur (güçlü 1, hep zayıf tanıma); güçlü ≥ 2 makine böyle canlanır.
//   ③ bütünlük (L18): IPC `senaryo-butunluk` {kok, anahtar} → o kök + geçici PAKET anahtarıyla denetim
//      koşar ve sonucu döner; `kok: null` hedefi sıfırlar (süreç kökü, liste yok → KAPSAM_DISI).
import fs from "node:fs";
import cp from "node:child_process";
import { configureLicenseRuntimeForTests } from "../../src/lib/license/runtime";
import type { RootKey } from "../../src/lib/license/protocol";
import { configureIntegrityForTests, getIntegrityOutcome } from "../../src/lib/license/integrity-state";
import { configureLicenseCoreForTests, getLicenseCore } from "../../src/lib/license/native";
import { tsLicenseCore } from "../../src/lib/license/license-core";
import { collectedFrom } from "../../src/lib/license/fingerprint-paths";
import { refreshLicenseIntegrity } from "../../src/services/license-integrity.service";

const capaDosyasi = process.env.SENARYO_CAPA_DOSYASI;
if (!capaDosyasi) {
  console.error("⛔ senaryo backend'i: SENARYO_CAPA_DOSYASI yok");
  process.exit(2);
}
configureLicenseRuntimeForTests({ roots: JSON.parse(fs.readFileSync(capaDosyasi, "utf8")) as RootKey[] });

const sahte = process.env.SENARYO_PARMAK_IZI;
if (sahte) {
  const { makine, seri } = JSON.parse(sahte) as { makine: string; seri: string };
  const cikti = `"IOPlatformUUID" = "${makine}"\n"IOPlatformSerialNumber" = "${seri}"\n`;
  const gercekSpawn = cp.spawn;
  const sahteSpawn = ((komut: string, args?: readonly string[], secenek?: cp.SpawnOptions) =>
    komut === "/usr/sbin/ioreg"
      ? gercekSpawn("/usr/bin/printf", ["%s", cikti], secenek ?? {})
      : gercekSpawn(komut, args ?? [], secenek ?? {})) as typeof cp.spawn;
  Reflect.set(cp, "spawn", sahteSpawn);
  // Sahte makine kimliği yalnız TS sondasına (Node `spawn`) enjekte edilebilir: native çekirdek
  // yüklüyse doğrulama native'de kalır, parmak izi TOPLAMA TS'ten yapılır (özet kuralı ikisinde aynı).
  const core = getLicenseCore();
  if (core.source === "native") {
    configureLicenseCoreForTests({ ...core, collectFingerprint: (salt, f5) => tsLicenseCore.collectFingerprint(salt, f5) });
  }
}

const etkenler = process.env.SENARYO_ETKENLER;
if (etkenler) {
  const e = JSON.parse(etkenler) as Partial<Record<"f1" | "f2" | "f3" | "f4", string | null>>;
  const yol = (v: string | null | undefined): string | null => (v === undefined ? null : v);
  // Aynı türün iki yolu aynı değeri verir (gerçek Linux'ta olduğu gibi): çelişki raporu doğmaz.
  const sonuclar = {
    "f1.machine-id": yol(e.f1),
    "f1.dbus-machine-id": yol(e.f1),
    "f2.dmi-uuid": yol(e.f2),
    "f2.smbios-uuid": yol(e.f2),
    "f3.udev-seri": yol(e.f3),
    "f4.dmi-sistem": yol(e.f4),
    "f4.smbios-sistem": yol(e.f4),
  };
  configureLicenseCoreForTests({ ...getLicenseCore(), collectFingerprint: (salt, f5) => Promise.resolve(collectedFrom("linux", sonuclar, salt, f5)) });
}

interface IntegrityMessage {
  readonly tip: "senaryo-butunluk";
  readonly kok: string | null;
  readonly anahtar: { readonly kid: string; readonly x: string } | null;
}
function isIntegrityMessage(m: unknown): m is IntegrityMessage {
  return typeof m === "object" && m !== null && Reflect.get(m, "tip") === "senaryo-butunluk";
}
process.on("message", (m: unknown) => {
  if (!isIntegrityMessage(m)) return;
  configureIntegrityForTests(m.kok === null ? null : { root: m.kok, keys: m.anahtar ? [m.anahtar] : undefined });
  void refreshLicenseIntegrity()
    .catch(() => undefined)
    .finally(() => {
      const o = getIntegrityOutcome();
      process.send?.({ tip: "senaryo-butunluk-tamam", durum: o?.durum ?? null, kod: o?.kod ?? null });
    });
});
