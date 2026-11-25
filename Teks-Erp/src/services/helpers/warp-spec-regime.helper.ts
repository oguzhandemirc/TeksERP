// =============================================================================
// TeksERP — ÇÖZGÜ KARTI REJİMİ (ürün kartı D4 / K1) · TEK yüklem
// =============================================================================
// "Bu kurulumda çözgü kartı (WarpSpec) tanımlanabilir mi?" sorusunun TEK cevabı:
//   devere  ∨  dokuma (üretim ∧ dokuma)
// Çözgü kartı ürün YAPISI tanımıdır: devere (levent sarımı) de dokuma (kumaş yapısı, gramaj, maliyet) de okur.
// Yalnız tanım genişler; levent/fason devere işlemleri `requireDevereEnabled`de kalır.
// Rota kapısı `requireWarpSpecRegime` bu dosyadan okur; panel aynası `Electron/src/lib/warp-spec-regime.ts`.
// =============================================================================
import prisma from "../../lib/prisma";
import { readDevereEnabled, readDokumaEnabled, readProductionEnabled } from "../system-setting.service";

type SettingClient = Pick<typeof prisma, "systemSetting">;

/** Dokuma ETKİN mi (ön koşul üretim dahil) — `requireDokumaEnabled`in açık dalıyla aynı iki okuma. */
export async function warpSpecWeavingOpen(tx?: SettingClient): Promise<boolean> {
  return (await readProductionEnabled(tx)) && (await readDokumaEnabled(tx));
}

/** Çözgü kartı rejimi açık mı: devere ∨ dokuma. */
export async function warpSpecRegimeOpen(tx?: SettingClient): Promise<boolean> {
  if (await readDevereEnabled(tx)) return true;
  return warpSpecWeavingOpen(tx);
}
