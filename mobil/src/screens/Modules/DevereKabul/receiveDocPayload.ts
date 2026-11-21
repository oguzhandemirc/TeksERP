// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — saf yardımcılar (M1). Panel `receive-model.ts` + `receive-doc-model.ts` AYNASI:
// satır taslağı → belge gövdesi; OFF'ta brüt/dara gitmez, REQUIRED'da brüt zorunlu, aynı gövde iki satırda
// yasak, ≤20 sipariş / ≤50 levent. Tablet hesap YAPMAZ — dağıtım, irsaliye tekrarı, uygunluk sunucuda.
// =============================================================================
import { foldSearchText } from '../../../utils/searchFold';
import type { DevereMode3, ReceiveBeamLine, ReceiveDocFields, ResolvedBeamBody, WarpingTabletOrder } from '../../../services/devereKabul.service';

export const MAX_DOC_ORDERS = 20;
export const MAX_DOC_BEAMS = 50;

export type BodyDraft =
  | { kind: 'existing'; id: string; bodyNo: string; hint: string }
  | { kind: 'new'; bodyNo: string; ownerKind: 'OURS' | 'WARPER' };

export interface BeamDraft {
  /** Yerel satır kimliği (liste anahtarı; sunucuya gitmez). */
  key: string;
  body: BodyDraft | null;
  /** Gövde kipi kapalıyken elle yazılan gövde no (isteğe bağlı). */
  physicalBeamNo: string;
  lengthM: string;
  grossKg: string;
  tareKg: string;
  /** Ek-2 r: bu levent reddedilen hangi sarımın yeniden sarımı (siparişin `reworkCandidates`inden). */
  reworkOfBeamId?: string;
}

export interface OrderDraft {
  orderId: string;
  orderNo: string;
  beams: BeamDraft[];
}

/** "1.200,5" / "1200.5" → 1200.5; boş/geçersiz → null. */
export function parseNum(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Sunucunun `1200.000` metnini girdi biçimine çevirir (`1200`, `512,5`). */
export function inputText(v: string | null | undefined): string {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? String(n).replace('.', ',') : '';
}

/** Bir sonraki satırın ön dolu metresi: plan satırlarında sıradaki boy (yoksa son boy). */
export function nextPlanLength(order: Pick<WarpingTabletOrder, 'beamLines' | 'receivedBeamCount'>, draftedCount: number): string {
  const lens: string[] = [];
  for (const l of order.beamLines) for (let i = 0; i < l.beamCount; i++) lens.push(l.beamLengthM);
  if (lens.length === 0) return '';
  const idx = order.receivedBeamCount + draftedCount;
  return inputText(lens[Math.min(idx, lens.length - 1)]);
}

/** Kabulde bağlanabilen gövde: aktif ve boş (depoda ya da deverecide) — panel `ReceiveBodyCell` ile aynı küme. */
const RECEIVABLE_BODY = new Set(['EMPTY_STOCK', 'AT_SUBCONTRACTOR']);

/** Resolve sonucu → taslak gövde ya da operatör metni (eklemeden ret). `null` = tanımsız → yerinde tanım. */
export function bodyFromResolve(code: string, body: ResolvedBeamBody | null): BodyDraft | string {
  if (body === null) return { kind: 'new', bodyNo: code.trim(), ownerKind: 'OURS' };
  if (!body.isActive || !RECEIVABLE_BODY.has(body.status)) {
    const on = body.currentWarpBeam ? ` (üstünde ${body.currentWarpBeam.beamNo})` : '';
    return `${body.bodyNo} şu an "${body.statusLabel}"${on} — yalnız boş gövde dolu leventle dönebilir.`;
  }
  return { kind: 'existing', id: body.id, bodyNo: body.bodyNo, hint: body.owner.label };
}

/** Satır doğrulaması (satır sayfası "Ekle" düğmesi + belge kurulumu ortak). */
export function validateBeam(d: BeamDraft, weighing: DevereMode3): string | null {
  const len = parseNum(d.lengthM);
  if (len === null || len <= 0) return 'Metre girin.';
  if (weighing === 'OFF') return null;
  const gross = d.grossKg.trim() ? parseNum(d.grossKg) : null;
  const tare = d.tareKg.trim() ? parseNum(d.tareKg) : null;
  if (d.grossKg.trim() && (gross === null || gross <= 0)) return 'Brüt kg geçerli bir sayı olmalı.';
  if (d.tareKg.trim() && (tare === null || tare < 0)) return 'Dara kg geçerli bir sayı olmalı.';
  if (weighing === 'REQUIRED' && gross === null) return 'Brüt kg yazın (bu kurulumda dönüş tartısı zorunlu).';
  if (tare !== null && gross === null) return 'Dara yazıldıysa brüt kg da yazılmalı.';
  if (tare !== null && gross !== null && tare >= gross) return 'Dara brütten küçük olmalı.';
  return null;
}

export function beamLine(d: BeamDraft, weighing: DevereMode3, subcontractorId: string | null): ReceiveBeamLine {
  const line: ReceiveBeamLine = { lengthM: r3(parseNum(d.lengthM) ?? 0) };
  if (weighing !== 'OFF') {
    const g = parseNum(d.grossKg);
    const t = parseNum(d.tareKg);
    line.grossKg = g === null ? null : r3(g);
    line.tareKg = t === null ? null : r3(t);
  }
  if (d.body?.kind === 'existing') line.beamBodyId = d.body.id;
  else if (d.body?.kind === 'new') {
    line.newBody = { bodyNo: d.body.bodyNo.trim() || null, owner: d.body.ownerKind === 'WARPER' ? { kind: 'WARPER', subcontractorId } : { kind: 'OURS' } };
  } else line.physicalBeamNo = d.physicalBeamNo.trim() || null;
  if (d.reworkOfBeamId) line.reworkOfBeamId = d.reworkOfBeamId;
  return line;
}

/** Gövde tekrarı anahtarı (kimlik ya da no; harf duyarsız). */
export function bodyKey(d: BeamDraft): string | null {
  if (d.body?.kind === 'existing') return `id:${d.body.id}`;
  const no = foldSearchText((d.body?.bodyNo ?? d.physicalBeamNo).trim());
  return no ? `no:${no}` : null;
}

/** Okutulan gövde taslakta zaten var mı (kimlik ya da no; harf duyarsız) — okutma anında "mükerrer". */
export function draftsHaveBody(orders: OrderDraft[], body: BodyDraft): boolean {
  const no = foldSearchText(body.bodyNo.trim());
  return orders.some((o) => o.beams.some((b) =>
    (body.kind === 'existing' && b.body?.kind === 'existing' && b.body.id === body.id) || foldSearchText((b.body?.bodyNo ?? b.physicalBeamNo).trim()) === no));
}

export type DocBuild = { ok: true; body: ReceiveDocFields; beamCount: number; totalM: number } | { ok: false; error: string | null };

/** Satırsız sipariş belgeye girmez; bir satır hatalıysa belge kurulmaz (hep-ya-hiç). */
export function buildDocBody(orders: OrderDraft[], p: { subcontractorId: string | null; deliveryNoteNo: string; weighing: DevereMode3 }): DocBuild {
  const out: ReceiveDocFields['orders'] = [];
  const seen = new Map<string, string>();
  const reworkSeen = new Set<string>();
  let beamCount = 0;
  let totalM = 0;
  for (const o of orders) {
    if (o.beams.length === 0) continue;
    const beams: ReceiveBeamLine[] = [];
    for (const [i, d] of o.beams.entries()) {
      const err = validateBeam(d, p.weighing);
      if (err) return { ok: false, error: `${o.orderNo} ${i + 1}. levent: ${err}` };
      const key = bodyKey(d);
      if (key) {
        const other = seen.get(key);
        if (other) return { ok: false, error: `Aynı gövde iki kez okutulmuş (${other === o.orderNo ? o.orderNo : `${other} ve ${o.orderNo}`}).` };
        seen.set(key, o.orderNo);
      }
      if (d.reworkOfBeamId) {
        if (reworkSeen.has(d.reworkOfBeamId)) return { ok: false, error: `${o.orderNo}: aynı reddedilen levent iki satırda yeniden sarım seçilmiş.` };
        reworkSeen.add(d.reworkOfBeamId);
      }
      const line = beamLine(d, p.weighing, p.subcontractorId);
      totalM += line.lengthM;
      beams.push(line);
    }
    beamCount += beams.length;
    out.push({ warpingOrderId: o.orderId, beams });
  }
  if (out.length === 0) return { ok: false, error: null };
  if (out.length > MAX_DOC_ORDERS) return { ok: false, error: `Bir kabul belgesinde en çok ${MAX_DOC_ORDERS} sipariş olabilir.` };
  if (beamCount > MAX_DOC_BEAMS) return { ok: false, error: `Bir kabul belgesinde en çok ${MAX_DOC_BEAMS} levent olabilir.` };
  return { ok: true, beamCount, totalM: r3(totalM), body: { subcontractorId: p.subcontractorId, deliveryNoteNo: p.deliveryNoteNo.trim() || null, orders: out } };
}

/** Deneme parmak izi: aynı belge gövdesi = aynı mantıksal deneme (token yalnız belirsiz hatada yapışır). */
export function docFingerprint(body: ReceiveDocFields): string {
  return JSON.stringify(body);
}

/** "3/4 levent" — beklenen bilinmiyorsa yalnız sayı. */
export function progressText(drafted: number, remaining: number | null): string {
  return remaining === null ? `${drafted} levent` : `${drafted}/${remaining} levent`;
}
