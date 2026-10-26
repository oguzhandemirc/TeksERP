// =============================================================================
// SİSTEM tasarımı önizlemesi — eşleniği (kopyalanabilir Liquid) OLMAYAN türde de
// yerleşik renderer'ı örnek veriyle çizer; hiçbir şey yazmaz (T5 "Önizle" düğmesi).
// =============================================================================

import { PrintedDocType } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { getRegisteredDocBuilders, printedDocumentService } from "../printed-document.service";
import { readTravelerCardConfig } from "../system-setting.service";
import { TravelerCardService } from "../traveler-card.service";
import { getContract } from "./sozlesme/kayit";

const travelerCards = new TravelerCardService();

export async function renderSystemPreview(docType: string): Promise<{ html: string }> {
  getContract(docType); // bilinmeyen tür → 400 (FAIL-CLOSED)
  if (docType === PrintedDocType.TRAVELER_CARD) {
    return { html: await travelerCards.renderSampleHtml(await readTravelerCardConfig()) };
  }
  const entry = getRegisteredDocBuilders().get(docType as PrintedDocType);
  if (!entry?.renderHtml) {
    throw AppError.conflict(`"${docType}" türünün yerleşik çıktısı yok; önizleme tasarlanan şablondan yapılır.`, {
      code: "NO_SYSTEM_PREVIEW",
      docType,
    });
  }
  return { html: await printedDocumentService.renderSampleHtml(docType as PrintedDocType, null) };
}
