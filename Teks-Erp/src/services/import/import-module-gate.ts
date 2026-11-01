// =============================================================================
// İÇE AKTARIM — MODÜL KAPISI (SY-H2)
// =============================================================================
// Adaptör hedef modelin modülüne bağlıysa (`ImportAdapter.module`) liste bu kapıdan süzülür;
// uçlarda kapı varlığın KENDİ middleware'idir (`routes/import.routes.ts`, lisans mesajı dahil).
// Okuyucular o middleware'lerin ön koşul sırasının aynasıdır (dokuma/maliyet → üretim önce).
import {
  SETTING_KEYS,
  readDevereEnabled,
  readDokumaEnabled,
  readMaliyetEnabled,
  readProductionEnabled,
} from "../system-setting.service";
import { AppError } from "../../utils/app-error";
import { licenseModuleError } from "../../lib/license/module-ceiling";
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

/** Geri sarma gibi middleware'siz yollar için: lisans kapattıysa 403 `LICENSE_MODULE`, yoksa `MODULE_DISABLED`. */
export async function assertImportModuleOpen(adapter: ImportAdapter): Promise<void> {
  if (!adapter.module || (await isImportModuleOpen(adapter))) return;
  switch (adapter.module) {
    case "dokuma":
      throw licenseModuleError(SETTING_KEYS.DOKUMA_ENABLED, "Dokuma") ?? moduleDisabled(adapter);
    case "devere":
      throw licenseModuleError(SETTING_KEYS.DEVERE_ENABLED, "Devere") ?? moduleDisabled(adapter);
    case "maliyet":
      throw licenseModuleError(SETTING_KEYS.MALIYET_ENABLED, "Maliyet") ?? moduleDisabled(adapter);
  }
}

function moduleDisabled(adapter: ImportAdapter): AppError {
  return AppError.forbidden(`'${adapter.label}' içe aktarımı için ilgili modül bu kurulumda kapalı.`, {
    code: "MODULE_DISABLED",
    modul: adapter.module,
  });
}
