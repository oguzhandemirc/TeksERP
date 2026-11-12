// Tambur etiket şablonu seçimi (çoklu etiket seti, 2026-11-11) — saf kararlar; ekran, hook ve jest aynı kaynaktan.
// Seçim İE boyunca YAPIŞKANDIR (bellek, İE'de saklanmaz); İE değişince sıfırlanır ve sunucunun `last.templateId`inden
// bir kez tohumlanır. Teklifte olmayan, ya da başka aşama (kind) için yapılmış seçim varsayılana döner (K3).
import type { LabelTemplateOption } from '../../../services/tambur.service';

/** Sunucunun bu bağlam için teklifi; null = eski backend (alan yok) → düğme eski davranışında. */
export interface TemplateOffer {
  kind: string | null;
  defaultTemplateId: string | null;
  options: LabelTemplateOption[];
}

export interface TemplateChoiceState {
  /** Yapışkanlığın kapsamı (iş emri id). Değişince seçim sıfırlanır. */
  scopeKey: string | null;
  /** null = varsayılanı izle (gövdeye alan gitmez). */
  selectedId: string | null;
  /** Seçimin yapıldığı aşama; null = henüz bir teklifle eşleşmedi (tohum). */
  kind: string | null;
  /** Değer `last` tohumundan mı — düşerse operatöre uyarı verilmez. */
  auto: boolean;
  /** Bu kapsamda tohum denendi mi (bir kez). */
  seeded: boolean;
}

export function initialTemplateChoice(scopeKey: string | null): TemplateChoiceState {
  return { scopeKey, selectedId: null, kind: null, auto: false, seeded: false };
}

/** İE değişti mi → sıfır; aynıysa aynı nesne. */
export function withChoiceScope(s: TemplateChoiceState, scopeKey: string | null): TemplateChoiceState {
  return s.scopeKey === scopeKey ? s : initialTemplateChoice(scopeKey);
}

/** `label-suggestions.last.templateId` tohumu — kapsam başına bir kez; operatör seçtiyse ezmez. */
export function withChoiceSeed(s: TemplateChoiceState, lastTemplateId: string | null | undefined): TemplateChoiceState {
  if (s.seeded) return s;
  if (s.selectedId != null || !lastTemplateId) return { ...s, seeded: true };
  return { ...s, selectedId: lastTemplateId, kind: null, auto: true, seeded: true };
}

/** Operatörün seçimi. Varsayılanı seçmek "varsayılanı izle"ye döner (topa yazılmaz, sonraki varsayılan değişimine uyar). */
export function withChoice(s: TemplateChoiceState, templateId: string, offer: TemplateOffer): TemplateChoiceState {
  const selectedId = templateId === offer.defaultTemplateId ? null : templateId;
  return { ...s, selectedId, kind: offer.kind, auto: false, seeded: true };
}

/**
 * Teklif değişti (hedef/müşteri/aşama): seçim teklifte yoksa ya da başka aşamaya aitse varsayılana döner.
 * `warn` = operatörün kendi seçimi düştü (kısa uyarı); tohum sessizce düşer.
 */
export function reconcileChoice(
  s: TemplateChoiceState,
  offer: TemplateOffer | null,
): { state: TemplateChoiceState; warn: boolean } {
  if (s.selectedId == null || offer == null) return { state: s, warn: false };
  const offered = offer.options.some((o) => o.id === s.selectedId);
  const sameKind = s.kind == null || s.kind === offer.kind;
  if (offered && sameKind) {
    return s.kind == null ? { state: { ...s, kind: offer.kind }, warn: false } : { state: s, warn: false };
  }
  return { state: { ...s, selectedId: null, kind: null, auto: false }, warn: !s.auto };
}

/** Sunucu seçimi reddetti (400 LABEL_TEMPLATE_NOT_OFFERED): varsayılana dön. */
export function dropChoice(s: TemplateChoiceState): { state: TemplateChoiceState; warn: boolean } {
  if (s.selectedId == null) return { state: s, warn: false };
  return { state: { ...s, selectedId: null, kind: null, auto: false }, warn: !s.auto };
}

/** Önizleme gövdesindeki `templateId`: yalnız varsayılandan FARKLI seçim varsa (teklif henüz bilinmiyorsa tohum gider). */
export function previewTemplateId(s: TemplateChoiceState, offer: TemplateOffer | null): string | undefined {
  if (s.selectedId == null) return undefined;
  if (offer && s.selectedId === offer.defaultTemplateId) return undefined;
  return s.selectedId;
}

/** Kesim gövdesindeki `labelTemplateId`: yalnız teklif bilinir, seçim teklifte ve varsayılandan farklıysa. */
export function cutTemplateId(s: TemplateChoiceState, offer: TemplateOffer | null): string | undefined {
  if (s.selectedId == null || offer == null) return undefined;
  if (s.selectedId === offer.defaultTemplateId) return undefined;
  if (s.kind != null && s.kind !== offer.kind) return undefined;
  return offer.options.some((o) => o.id === s.selectedId) ? s.selectedId : undefined;
}

/** Düğmenin hâli: eski backend → eski davranış; tek seçenek → pasif (K4); aksi seçici. */
export type TemplateButtonMode = 'legacy' | 'single' | 'picker';
export function templateButtonMode(offer: TemplateOffer | null): TemplateButtonMode {
  if (offer == null) return 'legacy';
  return offer.options.length < 2 ? 'single' : 'picker';
}

/** Yanıttan teklif (alan yoksa eski backend → null). */
export function offerFromPreview(p: {
  kind?: string | null;
  templateOptions?: LabelTemplateOption[] | null;
  defaultTemplateId?: string | null;
} | null | undefined): TemplateOffer | null {
  if (!p || !Array.isArray(p.templateOptions)) return null;
  return { kind: p.kind ?? null, defaultTemplateId: p.defaultTemplateId ?? null, options: p.templateOptions };
}

const SOURCE_TEXT: Record<LabelTemplateOption['source'], string> = {
  DEFAULT: 'varsayılan',
  CUSTOMER: 'müşteri',
  GLOBAL: 'herkes için',
};

/** PickerModal seçenekleri — sunucu sırası korunur; varsayılan "★ … (varsayılan)". */
export function templatePickerOptions(offer: TemplateOffer): { value: string; label: string; sublabel: string }[] {
  return offer.options.map((o) => {
    const isDefault = o.isDefault || o.id === offer.defaultTemplateId;
    return { value: o.id, label: isDefault ? `★ ${o.name}` : o.name, sublabel: isDefault ? SOURCE_TEXT.DEFAULT : SOURCE_TEXT[o.source] };
  });
}

/** Seçicide işaretli değer: seçim ya da varsayılan. */
export function shownTemplateId(s: TemplateChoiceState, offer: TemplateOffer | null): string | null {
  return s.selectedId ?? offer?.defaultTemplateId ?? null;
}

/**
 * Yeniden basım (K8): seçilen topun kayıtlı şablonuyla aynıysa yazılmadan basılır; farklıysa topa yazılır.
 * Dönüş: `undefined` = yazma yok; aksi `PUT /labels/rolls/:id/template` gövdesindeki değer (varsayılan → null).
 */
export function reprintTemplateWrite(
  pickedId: string,
  roll: { currentTemplateId: string | null; defaultTemplateId: string | null },
): string | null | undefined {
  const effective = roll.currentTemplateId ?? roll.defaultTemplateId;
  if (pickedId === effective) return undefined;
  return pickedId === roll.defaultTemplateId ? null : pickedId;
}
