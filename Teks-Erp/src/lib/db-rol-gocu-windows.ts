// =============================================================================
// db-rol-gocu Windows kipi girdisi (`--sahip`; aktivasyon 2.15.8 — bugün yalnız elle/test)
// =============================================================================
// Süper URL ve sahip parolası YALNIZ ortamdan / kimlik dosyasından (argv süreç listesinde görünür).
// Kimlik dosyası kurulumun `pg-setup\db-credentials.json`ı (kur.ps1 ile aynı iki nesil).
// =============================================================================

import { readFileSync } from "node:fs";

export const SUPER_URL_ENV = "TEKSERP_PG_SUPER_URL";
export const OWNER_PASSWORD_ENV = "TEKSERP_SAHIP_PAROLASI";

/** `--sahip <ad>` · süper URL ortamdan · sahip parolası ortamdan YA DA `--kimlik` dosyasından (ikisi birden hata). */
export function windowsInput(argv: string[], env: NodeJS.ProcessEnv):
  { ownerUrl: string; sahip: { ad: string; parola: string } } | { hata: string } {
  const ad = argv[argv.indexOf("--sahip") + 1];
  if (!ad || ad.startsWith("--")) return { hata: "--sahip <ad> eksik" };
  const superUrl = env[SUPER_URL_ENV];
  if (!superUrl) return { hata: `${SUPER_URL_ENV} tanimli degil (super kullanici URL'i yalniz ortamdan)` };
  const ki = argv.indexOf("--kimlik");
  const envParola = env[OWNER_PASSWORD_ENV];
  if (ki >= 0 && envParola) return { hata: `sahip parolasi iki kaynaktan verildi (${OWNER_PASSWORD_ENV} + --kimlik); birini ver` };
  if (ki < 0) return envParola ? { ownerUrl: superUrl, sahip: { ad, parola: envParola } } : { hata: `sahip parolasi yok (${OWNER_PASSWORD_ENV} ya da --kimlik <db-credentials.json>)` };
  const yol = argv[ki + 1];
  if (!yol || yol.startsWith("--")) return { hata: "--kimlik <dosya> eksik" };
  let k: { db?: string; user?: string; pass?: string; superuser?: string; superpass?: string };
  try { k = JSON.parse(readFileSync(yol, "utf8").replace(/^\uFEFF/, "")); }
  catch { return { hata: `kimlik dosyasi okunamadi: ${yol}` }; }
  const kul = k.user ?? k.superuser;
  const parola = k.user ? k.pass : k.superpass;
  if (kul !== ad) return { hata: `kimlik dosyasindaki kullanici --sahip ile ayni degil (${kul ?? "-"} != ${ad})` };
  if (!parola) return { hata: "kimlik dosyasinda parola yok" };
  const db = decodeURIComponent(new URL(superUrl).pathname.replace(/^\//, ""));
  if (k.db && k.db !== db) return { hata: `kimlik dosyasinin DB'si baglanti DB'siyle ayni degil (${k.db} != ${db})` };
  return { ownerUrl: superUrl, sahip: { ad, parola } };
}
