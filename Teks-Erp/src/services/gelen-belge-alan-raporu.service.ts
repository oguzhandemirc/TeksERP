// =============================================================================
// GELEN BELGE — okuma özetinin `templateFields` alanı (tablet İş Emirleri okutma önizlemesi, salt okunur)
// =============================================================================
// Kaynak: notun ilk okunmuş bölgesi (`readFirstRegion`) + bölgenin şablonu. GENEL yedek şablonda ya da şablonsuz
// bölgede rapor YOK (işaretli alan yok); BLIND güven kipinde de yok (tahmin forma dolmadığı gibi önizlemeye de çıkmaz).
// =============================================================================
import prisma from "../lib/prisma";
import { templateByCode } from "../lib/gelen-belge/sablon-bul";
import { fieldReport, type TemplateFieldReport } from "../lib/gelen-belge/alan-raporu";
import { readFirstRegion, type TrustMode } from "./gelen-belge-parti-metre.service";
import { FALLBACK_TEMPLATE_CODE, USER_TEMPLATE_PREFIX } from "./gelen-belge-sablon.service";
import { loadUserTemplates } from "./gelen-belge-ozel-sablon.service";

export async function noteTemplateFields(noteId: string, trust: TrustMode = "NORMAL"): Promise<TemplateFieldReport[] | null> {
  if (trust === "BLIND") return null;
  const region = await readFirstRegion(prisma, noteId);
  const code = region?.templateId;
  if (!region || !code || code === FALLBACK_TEMPLATE_CODE) return null;
  // Kullanıcı şablonu önbellekte yoksa (yeniden başlatma sonrası) DB'den bir kez tazelenir.
  let template = templateByCode(code);
  if (!template && code.startsWith(USER_TEMPLATE_PREFIX)) template = (await loadUserTemplates()).find((t) => t.id === code);
  return template ? fieldReport(template, region.fields) : null;
}
