// SENARYO L — fabrika backend sürecinin iki test enjeksiyonu (sunucu modülünden ÖNCE yüklenir):
//   ① güven çapası: satıcının test kökleri (`SENARYO_CAPA_DOSYASI`) — üretimde env'den çapa
//      OKUNMAZ; bu dosya yalnız senaryo sürecinde `configureLicenseRuntimeForTests`i çağırır.
//   ② parmak izi: `SENARYO_PARMAK_IZI` = {makine, seri} verilirse işletim sistemi sorgusu (ioreg)
//      o makinenin değerlerini döndürür — aynı Mac'te "başka makine" (kopya/taşıma) canlandırılır.
import fs from "node:fs";
import cp from "node:child_process";
import { configureLicenseRuntimeForTests } from "../../src/lib/license/runtime";
import type { RootKey } from "../../src/lib/license/protocol";

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
}
