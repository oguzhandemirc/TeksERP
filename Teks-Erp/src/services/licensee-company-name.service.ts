// Belge unvanının (`company.name`) İLK değeri lisanstan gelir (K-7): satır yoksa ya da nötr yedekse
// lisans adı bir kez yazılır; fabrikanın girdiği ad hiçbir HAK'la ezilmez. Ekran adı ayrıdır
// (`lib/license/licensee-name.ts`) ve buraya bağlı değildir.
import prisma from "../lib/prisma";
import { uyari } from "../lib/logger";
import { currentLicenseeName } from "../lib/license/licensee-name";
import { AuditService } from "./audit.service";
import { DEFAULT_COMPANY_NAME, SETTING_KEYS, invalidateFeatureFlagsCache } from "./system-setting.service";

const TABLE = "SYSTEM_SETTING";
const DESCRIPTION = "ERP'nin kurulduğu firmanın adı (panel başlığı + uygulama geneli)";
const NAME_MAX = 120;

export type CompanySeedOutcome = "LISANS_YOK" | "YAZILDI" | "NOTR_DEGISTI" | "DOKUNULMADI";

/**
 * Koşullu ve tekrarlanabilir: oluşturma çakışmada hiçbir şey yazmaz, güncelleme yalnız değer hâlâ nötr
 * yedekken tutar (atomik WHERE) — eşzamanlı panel yazımını ezmez, ikinci çağrı DOKUNULMADI döner.
 */
export async function seedCompanyNameFromLicense(licensee: string | null = currentLicenseeName()): Promise<CompanySeedOutcome> {
  const name = licensee?.trim().slice(0, NAME_MAX) ?? "";
  if (!name) return "LISANS_YOK";
  const key = SETTING_KEYS.COMPANY_NAME;
  const created = await prisma.systemSetting.createMany({
    data: [{ key, value: name, description: DESCRIPTION, updatedById: null }],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    await AuditService.log({ userId: undefined, action: "CREATE", tableName: TABLE, recordId: key, oldData: null, newData: { value: name, kaynak: "lisans" } });
    invalidateFeatureFlagsCache();
    return "YAZILDI";
  }
  const updated = await prisma.systemSetting.updateMany({
    where: { key, value: { equals: DEFAULT_COMPANY_NAME } },
    data: { value: name, updatedById: null },
  });
  if (updated.count === 0) return "DOKUNULMADI";
  await AuditService.log({
    userId: undefined,
    action: "UPDATE",
    tableName: TABLE,
    recordId: key,
    oldData: { value: DEFAULT_COMPANY_NAME },
    newData: { value: name, kaynak: "lisans" },
  });
  invalidateFeatureFlagsCache();
  return "NOTR_DEGISTI";
}

/** Kabul ve boot yolu için: hata yutulur — unvan yazılamadı diye lisans kabulü düşmez, bir sonraki boot yeniden dener. */
export async function seedCompanyNameQuietly(): Promise<void> {
  try {
    await seedCompanyNameFromLicense();
  } catch (err) {
    uyari("lisans", "firma unvanı lisans adından yazılamadı (sonraki açılışta yeniden)", err instanceof Error ? err.message : err);
  }
}
