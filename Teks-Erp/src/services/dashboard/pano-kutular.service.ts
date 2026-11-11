// =============================================================================
// AÇILIŞ PANOSU — kutu kataloğu ve seçimli kutu verisi
// =============================================================================
// `GET /pano/kutular` → kullanıcının görebildiği kutular; `GET /pano?kutular=a,b` → yalnız istenen
// kutular hesaplanır, aynı istekteki kutular kaynağı paylaşır (tek sorgu). Tanınmayan anahtar 400
// (fail-closed); bilinen ama izinsiz/kapalı kutu `null` (panelde kayıtlı tercih yetki kaybında kırılmasın).
// =============================================================================
import { AppError } from "../../utils/app-error";
import { loadAccessContext } from "../reports/semantik/izin";
import { resolvePanoPencere, type PanoDonem } from "./pano-donem";
import { PanoSources, panoGates, type PanoKullanici } from "./pano-kaynak";
import type { AgendaParams } from "./pano-kutu-ajanda";
import { findPanoBox, PANO_BOX_KEYS, visibleBoxCatalog, type PanoKutuTanimi } from "./pano-kutu-katalog";
import { windowEcho } from "./pano.service";

/** Tek istekte en çok kutu — katalog boyu; tekrar eden anahtar tek sayılır. */
export const PANO_MAX_BOXES = PANO_BOX_KEYS.length;

export async function getPanoBoxCatalog(user: PanoKullanici): Promise<{ kutular: PanoKutuTanimi[] }> {
  return { kutular: visibleBoxCatalog(panoGates(await loadAccessContext(user))) };
}

/** `a,b,c` → tekilleştirilmiş, sıralı anahtar listesi; boş ya da tanınmayan anahtar 400. */
export function parseBoxKeys(raw: string): string[] {
  const keys = [...new Set(raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0))];
  if (keys.length === 0) throw new AppError("En az bir kutu anahtarı verilmeli", 400, true, { code: "PANO_BOX_EMPTY" });
  const unknown = keys.filter((k) => !findPanoBox(k));
  if (unknown.length > 0) {
    throw new AppError(`Tanınmayan kutu: ${unknown.join(", ")}`, 400, true, { code: "PANO_BOX_UNKNOWN", unknown });
  }
  return keys;
}

export interface PanoKutuYaniti extends ReturnType<typeof windowEcho> {
  kutular: Record<string, unknown>;
}

export async function getPanoBoxes(
  donem: PanoDonem,
  keys: readonly string[],
  run: { user: PanoKullanici; agenda: AgendaParams; now?: Date },
): Promise<PanoKutuYaniti> {
  const now = run.now ?? new Date();
  const src = new PanoSources(resolvePanoPencere(donem, now), now);
  const can = panoGates(await loadAccessContext(run.user));
  const values = await Promise.all(
    keys.map((key) => {
      const def = findPanoBox(key);
      if (!def) throw new AppError(`Tanınmayan kutu: ${key}`, 400, true, { code: "PANO_BOX_UNKNOWN", unknown: [key] });
      return def.visible(can) ? def.compute({ src, can, user: run.user, agenda: run.agenda }) : Promise.resolve(null);
    }),
  );
  return { ...windowEcho(src), kutular: Object.fromEntries(keys.map((k, i) => [k, values[i] ?? null])) };
}
