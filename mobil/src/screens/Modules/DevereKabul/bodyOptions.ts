// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — gövde seçicisi (panel D3 `receive-body-options.ts` aynası; saf, ağ yok)
// =============================================================================
// Seçenekler ve sıra sunucudan (bu siparişle gidenler önce). Seçim opsiyoneldir; gönderilenden farklı gövde
// kabulü engellenmez, yalnız "farklı gövde" rozeti (devereci gövdeyi sonraya saklayabilir).
// =============================================================================
import type { ReceiveBodyOption, ReceiveBodyOptions } from '../../../services/devereKabul.service';
import type { BodyDraft, OrderDraft } from './receiveDocPayload';

/** Seçenek satırının ikincil metni: nereden geldi + sahip (bizim değilse). Panel `optionHint` ile aynı. */
export function optionHint(o: ReceiveBodyOption): string {
  const where = o.sentWithOrder ? 'bu siparişle gönderildi' : o.sentWith?.orderNo ? `${o.sentWith.orderNo} ile gönderildi` : `${o.statusAgeDays} gündür deverecide`;
  return o.owner.kind === 'OURS' ? where : `${where} · ${o.owner.customer?.name ?? o.owner.label}`;
}

export const bodyFromOption = (o: ReceiveBodyOption): BodyDraft => ({ kind: 'existing', id: o.id, bodyNo: o.bodyNo, hint: optionHint(o) });

/** Taslağın herhangi bir satırında seçilmiş kayıtlı gövdeler (bütün siparişler; sunucu da aynı gövdeye 400 verir). */
export function takenBodyIds(orders: OrderDraft[]): Set<string> {
  const ids = new Set<string>();
  for (const o of orders) for (const b of o.beams) if (b.body?.kind === 'existing') ids.add(b.body.id);
  return ids;
}

/** Listede önerilecekler: başka satırda seçilmiş gövde tekrar önerilmez. */
export function availableOptions(choices: ReceiveBodyOptions | undefined, taken: ReadonlySet<string>): ReceiveBodyOption[] {
  return (choices?.options ?? []).filter((o) => !taken.has(o.id));
}

/**
 * "Farklı gövde": bu siparişle gövde gönderilmişken satırdaki gövde onlardan biri değil (yerinde tanım dahil).
 * Gövde hiç gönderilmediyse kıyas yok → rozet yok. Bilgi amaçlıdır, kabulü engellemez.
 */
export function isDifferentBody(body: BodyDraft | null | undefined, choices: ReceiveBodyOptions | undefined): boolean {
  if (!body || !choices || choices.sent.length === 0) return false;
  return body.kind === 'new' || !choices.sent.some((s) => s.id === body.id);
}

export const sentBodiesText = (choices: ReceiveBodyOptions | undefined): string => (choices?.sent ?? []).map((s) => s.bodyNo).join(', ');
