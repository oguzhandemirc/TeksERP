// =============================================================================
// Belge sözleşmesi + Sistem tasarımı GÖRÜNÜMÜ ve P-d dondurma (plan §2 P-d, §3.10)
// =============================================================================
// Kopyalama anındaki ETKİN genel belge ayarı şablonun ilk sürümüne donar; profil ezmesi
// HARİÇ (o basımda üstüne biner, R4). Sözleşme görünümü düz JSON'dur (fonksiyon taşımaz).
// =============================================================================

import { DOC_CONFIG_KEYS } from "../printed-document.service";
import { readDocumentsConfig, type DocumentsConfig } from "../system-setting.service";
import { travelerTemplateService } from "../traveler-template.service";
import { getSystemEquivalent, materializeEquivalent } from "./sistem/kayit";
import { getContract, internalFieldsOf, listContracts, shownToInternalFields, type RegisteredContract } from "./sozlesme/kayit";

const LANGUAGE_WARNING =
  "Sistem ayarında belge dili İngilizce/otomatik seçili; tasarımcı şablonu Türkçe basar (İngilizce eşlenik kapsam dışı).";

/**
 * P-d dondurma (saf): genel `documentsConfig[belgeKey]` → `ayarNormalize` (profil HARİÇ) ·
 * `columns.*.shown` iç kolonları → `internalFields` · `language en|auto` → uyarı (normalize "tr" yazar).
 */
export function freezeSystemSettings(contract: RegisteredContract, documentsConfig: DocumentsConfig, ownConfig?: unknown) {
  const key = (DOC_CONFIG_KEYS as Record<string, string>)[contract.docType];
  const raw: unknown = ownConfig !== undefined ? ownConfig : key ? (documentsConfig[key] ?? {}) : {};
  const language = raw && typeof raw === "object" ? (raw as { language?: unknown }).language : undefined;
  return {
    settings: contract.ayarNormalize(raw) as Record<string, unknown>,
    internalFields: shownToInternalFields(contract, raw),
    warnings: language === "en" || language === "auto" ? [LANGUAGE_WARNING] : [],
  };
}

/**
 * Kopyalama anının etkin ayarı. Refakat kartının ayarı genel belge ayarında değil, kart
 * şablon çözümündedir (P-d kartta da geçerli: kopya bugünkü kart ayarını taşır).
 */
export async function freezeCurrentSettings(contract: RegisteredContract) {
  const own = contract.docType === "TRAVELER_CARD" ? (await travelerTemplateService.resolveForPrint(null)).config : undefined;
  return freezeSystemSettings(contract, await readDocumentsConfig(), own);
}

// ── Sözleşme ve sistem görünümü ───────────────────────────────────────────────

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function contractView(c: RegisteredContract) {
  return plain({
    docType: c.docType,
    hedef: c.hedef,
    contractVersion: c.contractVersion,
    kokler: c.kokler,
    tablolar: c.tablolar,
    ayarSemasi: c.ayarSemasi,
    icAlanlar: internalFieldsOf(c),
    senaryolar: c.senaryolar().map((s) => ({ ad: s.ad, aciklama: s.aciklama })),
  });
}

export function listContractViews() {
  return listContracts().map((c) => ({ docType: c.docType, hedef: c.hedef, contractVersion: c.contractVersion, copyable: getSystemEquivalent(c.docType) !== null }));
}

export function getContractView(docType: string) {
  return contractView(getContract(docType));
}

export async function getSystemView(docType: string) {
  const contract = getContract(docType);
  const eq = getSystemEquivalent(docType);
  const frozen = await freezeCurrentSettings(contract);
  return { docType, copyable: eq !== null, equivalent: eq ? materializeEquivalent(eq, frozen.settings) : null, ...frozen };
}
