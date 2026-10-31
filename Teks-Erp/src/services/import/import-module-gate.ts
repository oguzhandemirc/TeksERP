// =============================================================================
// İÇE AKTARIM — MODÜL KAPISI (SY-H2)
// =============================================================================
// Adaptör hedef modelin modülüne bağlıysa (`ImportAdapter.module`) liste bu kapıdan süzülür;
// uçlarda kapı varlığın KENDİ middleware'idir (`routes/import.routes.ts`, lisans mesajı dahil).
// Okuyucular o middleware'lerin ön koşul sırasının aynasıdır (dokuma/maliyet → üretim önce).
import {
  readDevereEnabled,
  readDokumaEnabled,
  readMaliyetEnabled,
  readProductionEnabled,
} from "../system-setting.service";
import { AppError } from "../../utils/app-error";
import type { ImportAdapter, ImportModule } from "./import.types";

const MODULE_READERS: Record<ImportModule, () => Promise<boolean>> = {
  dokuma: async () => (await readProductionEnabled()) && (await readDokumaEnabled()),
  devere: () => readDevereEnabled(),
  maliyet: async () => (await readProductionEnabled()) && (await readMaliyetEnabled()),
};

/** Modülsüz adaptör her zaman açıktır (bugünkü 18 adaptör). */
export async function isImportModuleOpen(adapter: ImportAdapter): Promise<boolean> {
  return adapter.module ? MODULE_READERS[adapter.module]() : true;
}

/** Geri sarma gibi middleware'siz yollar için: kapalı modül 403 `MODULE_DISABLED`. */
export async function assertImportModuleOpen(adapter: ImportAdapter): Promise<void> {
  if (await isImportModuleOpen(adapter)) return;
  throw AppError.forbidden(`'${adapter.label}' içe aktarımı için ilgili modül bu kurulumda kapalı.`, {
    code: "MODULE_DISABLED",
    modul: adapter.module,
  });
}
