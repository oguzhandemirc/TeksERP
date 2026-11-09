// Gelen kumaş / gelen renk BEYANI (müşterinin belgedeki yazısı; İE hedefinden AYRI) — saf parçalar: belge değeri, ekrandaki
// değer ve gövdeye giriş kuralı (gelen en ile aynı desen: yalnız kullanıcı değiştirdiyse gider).
import type { DocIncomingDeclared, InboundNoteDetail, NoteParty } from '../../../../services/inboundDoc.service';

export type DeclaredKind = 'item' | 'color';

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Belge geneli beyan; eski sunucuda `incomingDeclared` yok → şablon `desenText/renkText`. */
export function docDeclaredText(d: Pick<InboundNoteDetail, 'incomingDeclared' | 'formFields'> | null | undefined, kind: DeclaredKind): string | null {
  const decl: Pick<DocIncomingDeclared, 'itemText' | 'colorText'> | undefined = d?.incomingDeclared;
  if (decl) return clean(kind === 'item' ? decl.itemText : decl.colorText);
  return clean(kind === 'item' ? d?.formFields?.desenText : d?.formFields?.renkText);
}

/** Partinin beyanı: bölüm alanı, yoksa (null) belge geneli. */
export function partyDeclaredText(p: Pick<NoteParty, 'incomingItemText' | 'incomingColorText'> | undefined, d: Parameters<typeof docDeclaredText>[0], kind: DeclaredKind): string | null {
  return clean(kind === 'item' ? p?.incomingItemText : p?.incomingColorText) ?? docDeclaredText(d, kind);
}

export interface DeclaredEdit {
  /** Elle yazılan değer; null = "beyan yok" (belgedeki silindi). */
  text: string | null;
  edited: boolean;
}

/** Ekrandaki değer: düzeltildiyse elle yazılan, değilse belgedeki. */
export const shownDeclared = (e: DeclaredEdit | undefined, doc: string | null): string | null => (e?.edited ? clean(e.text) : doc);

/** Kutuya yazılan metin → durum: boş = belgede varsa "beyan yok" (null), belgeyle aynı = düzeltme yok. */
export function applyDeclaredText(typed: string, doc: string | null): DeclaredEdit {
  const t = clean(typed);
  if (t === doc) return { text: null, edited: false };
  return { text: t, edited: true };
}

/** Gövdeye giren parça: yalnız düzeltildiyse (null = beyan yok); düzeltilmediyse anahtar yok → sunucu belgedekini yazar. */
export function declaredBodyPart(e: DeclaredEdit | undefined, kind: DeclaredKind): { incomingItemText?: string | null; incomingColorText?: string | null } {
  if (!e?.edited) return {};
  const v = clean(e.text);
  return kind === 'item' ? { incomingItemText: v } : { incomingColorText: v };
}
