// =============================================================================
// GELEN BELGE — notun OKUNDUĞU şablon sürümü + çok parti İE kipi (2026-11-09, belge tanıt 3 aşama)
// =============================================================================
// Şablon kuralı (`rules.multiParty`) notun okunduğu sürümden okunur: `templateId` + `templateVersion` → `SenderTemplateVersion`
// anlık görüntüsü; sürüm satırı yoksa yalnız sürüm eşitse güncel şablon, değilse kural YOK (fabrika). Böylece şablon sonradan
// değişse/sıfırlansa da geçmiş belgenin kipi değişmez. Öncelik: gövde `mode` > şablon kuralı > fabrika ayarı (çağıran uygular).
// `readMultiPartyWorkOrder()` gelen belge yolunda YALNIZ burada çağrılır (`test_gelen_belge_sablon_kural` sayar).
// =============================================================================
import prisma from "../lib/prisma";
import { MULTI_PARTY_RULES, type DocumentTemplate, type MultiPartyRule } from "../lib/gelen-belge/motor";
import { readMultiPartyWorkOrder, type MultiPartyWorkOrderMode } from "./system-setting.service";

export interface NoteTemplateSnapshot {
  code: string;
  name: string;
  version: number;
  /** Okunduğu sürümün şablon JSON'u (anlık görüntü ya da sürümü eşit güncel satır). */
  template: DocumentTemplate;
  /** Okuma anındaki sınıflandırma skoru (0..1); yoksa null. */
  score: number | null;
}

const asTemplate = (v: unknown): DocumentTemplate | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as DocumentTemplate) : null);

/** Notun okunduğu şablon sürümü; şablonsuz not (GENEL/elle) ya da çözülemeyen sürüm → null (FAIL-CLOSED: kural yok). */
export async function noteTemplateSnapshot(noteId: string): Promise<NoteTemplateSnapshot | null> {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { templateId: true, templateVersion: true, templateScore: true, template: { select: { code: true, version: true, template: true } } },
  });
  if (!note?.templateId || !note.template || note.templateVersion == null) return null;
  const snap = await prisma.senderTemplateVersion.findUnique({ where: { templateId_version: { templateId: note.templateId, version: note.templateVersion } }, select: { template: true } });
  const raw = snap ? snap.template : note.templateVersion === note.template.version ? note.template.template : null;
  const template = asTemplate(raw);
  if (!template) return null;
  const name = typeof template.name === "string" && template.name.trim() ? template.name : note.template.code;
  return { code: note.template.code, name, version: note.templateVersion, template, score: note.templateScore == null ? null : Number(note.templateScore) };
}

/** Saf: şablonun çok parti kuralı (bilinmeyen değer kural sayılmaz). */
export function multiPartyRuleOf(template: Pick<DocumentTemplate, "rules"> | null | undefined): MultiPartyRule | null {
  const v = template?.rules?.multiParty;
  return v && (MULTI_PARTY_RULES as readonly string[]).includes(v) ? v : null;
}

export type MultiPartyModeSource = "TEMPLATE" | "FACTORY";

/** Notun varsayılan çok parti kipi: okunduğu sürümün kuralı, yoksa fabrika ayarı. */
export async function resolveMultiPartyMode(noteId: string): Promise<{ mode: MultiPartyWorkOrderMode; source: MultiPartyModeSource; templateCode: string | null }> {
  const snap = await noteTemplateSnapshot(noteId);
  const rule = multiPartyRuleOf(snap?.template);
  if (rule) return { mode: rule, source: "TEMPLATE", templateCode: snap!.code };
  return { mode: await readMultiPartyWorkOrder(), source: "FACTORY", templateCode: snap?.code ?? null };
}
