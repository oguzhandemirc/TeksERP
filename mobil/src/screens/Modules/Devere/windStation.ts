// =============================================================================
// LEVENT SAR İSTASYONU — saf mantık (React'sız): form · hedef levent · okutma · kg · yük
// =============================================================================
// İstasyon formu yalnız İÇERİDE sarımı (IN_HOUSE, devere makinesi) taşır; fason/hazır levent
// listedeki SAR'dan sayfalı `WindModal`la sarılır (bugünkü yol). Sunucu iki adımdır: hedef
// planlı levent varsa doğrudan `/:id/wind`; yoksa önce plan (`POST /warp-beams`), sonra sar.
// Yükler `beamPayload.buildPlanPayload` / `buildWindPayload` üstünden kurulur — backend
// `createSchema` / `windSchema` ile birebirliğin TEK yeri orasıdır, burada ikinci kopya yok.
// =============================================================================
import type { WarpBeam, WarpKgSource, WindWarpBeamRequest } from '../../../services/warpBeam.service';
import { foldSearchText } from '../../../utils/searchFold';
import { normalizeScanCode } from '../../../utils/scanCode';
import { EMPTY_PLAN, STATUS_LABEL, buildWindPayload, theoreticalKg, validateWind, windDefaultFor, type PlanForm, type Validation, type WindDefault, type WindForm, type YarnLineDraft } from './beamPayload';

/** Formun sardığı levent: en eski planlı (otomatik) · okutulan/seçilen planlı · yeni plan. */
export type StationTarget = { kind: 'auto' } | { kind: 'beam'; beamId: string } | { kind: 'new' };

export interface StationForm {
  warpSpecId: string | null;
  target: StationTarget;
  lengthM: string;
  kgSource: WarpKgSource;
  /** Tartı modunda tek iplik satırının kg'si; nominal modda kullanılmaz. */
  weighedKg: string;
  /** Gövde no — yalnız YENİ planda yazılır (sarım ucu gövde almaz). */
  physicalBeamNo: string;
  machineId: string | null;
  /** Yeni plan için dokuma işi (opsiyonel; `beamWeavingLinkRequired` açıkken zorunlu). */
  weavingOrderId: string | null;
  /** Brüt iplik çıkışı; TEK satırda kg ana formdan gelir, çok satırda iplik sayfasından. */
  issues: YarnLineDraft[];
  returns: YarnLineDraft[];
  breakCount: string;
}

export interface StationSpec {
  id: string;
  code: string;
  name: string;
  endsCount: number;
  denier: number | null;
}

export interface StationDeps {
  defaultWarehouseId: string | null;
  soleMachineId: string | null;
  soleWeavingOrderId: string | null;
  lastWindDefaults: readonly WindDefault[];
}

function num(s: string): number | null {
  const t = String(s).trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Nominal kg — `theoreticalKg` (sunucu formülü aynası) metin metreden. */
export function stationNominalKg(spec: StationSpec | null, lengthM: string): number | null {
  if (!spec) return null;
  return theoreticalKg(spec.endsCount, spec.denier, num(lengthM) ?? 0);
}

/** Tartıdan metre — backend `warpLengthFromWeight` İKİZİ: net kg ÷ (tel × denye ÷ 9.000.000); hesaplanamazsa null. */
export function lengthFromWeight(netKg: number, endsCount: number, denier: number | null): number | null {
  if (denier == null || !(denier > 0) || !(endsCount > 0) || !(netKg >= 0)) return null;
  const kgPerM = (endsCount * denier) / 9_000_000;
  return Math.round((netKg / kgPerM) * 1000) / 1000;
}

/** Kartın EN ESKİ planlı içeride leventi (otomatik hedef); yoksa null → yeni plan açılır. */
export function oldestPlannedFor(planned: readonly WarpBeam[], warpSpecId: string | null): WarpBeam | null {
  if (!warpSpecId) return null;
  let best: WarpBeam | null = null;
  for (const b of planned) {
    if (b.status !== 'PLANNED' || b.originKind !== 'IN_HOUSE' || b.warpSpec.id !== warpSpecId) continue;
    if (!best || new Date(b.createdAt).getTime() < new Date(best.createdAt).getTime()) best = b;
  }
  return best;
}

/** Hedefin çözülmüş leventi (null = yeni plan). Seçilen levent listede yoksa (başkası sardı) null döner — form yeni plana düşmez, doğrulama söyler. */
export function resolveTarget(form: Pick<StationForm, 'target' | 'warpSpecId'>, planned: readonly WarpBeam[]): WarpBeam | null {
  if (form.target.kind === 'new') return null;
  if (form.target.kind === 'beam') {
    const id = form.target.beamId;
    return planned.find((b) => b.id === id) ?? null;
  }
  return oldestPlannedFor(planned, form.warpSpecId);
}

function linesFromDefault(def: WindDefault | undefined, defaultWarehouseId: string | null): YarnLineDraft[] {
  // kg BOŞ başlar (Z5 kararı: önceki sarımın kg'si bu sarımın ölçümü değildir); depo + lot önerilir.
  if (def && def.yarnIssues.length) return def.yarnIssues.map((l, i) => ({ key: `i${i + 1}`, warehouseId: l.warehouseId, qtyKg: '', reasonCode: null, lotId: l.lotId }));
  return [{ key: 'i1', warehouseId: defaultWarehouseId, qtyKg: '', reasonCode: null, lotId: null }];
}

/** Kart için taze form: son sarım önerisi (makine + iplik satırı depo/lot) ya da tek makine/varsayılan depo. */
export function initialStationForm(warpSpecId: string | null, deps: StationDeps, keep?: Partial<Pick<StationForm, 'lengthM' | 'kgSource'>>): StationForm {
  const def = warpSpecId ? windDefaultFor(deps.lastWindDefaults, warpSpecId) : undefined;
  return {
    warpSpecId,
    target: { kind: 'auto' },
    lengthM: keep?.lengthM ?? '',
    kgSource: keep?.kgSource ?? 'WEIGHED',
    weighedKg: '',
    physicalBeamNo: '',
    machineId: def?.machineId ?? deps.soleMachineId,
    weavingOrderId: deps.soleWeavingOrderId,
    issues: linesFromDefault(def, deps.defaultWarehouseId),
    returns: [],
    breakCount: '',
  };
}

/** Varsayılan kart: son levent (plan/sarım) kartı → son sarım önerisinin kartı → tek kart → null. */
export function defaultWarpSpecId(lastBeamSpecId: string | null, deps: Pick<StationDeps, 'lastWindDefaults'>, specs: readonly { id: string }[]): string | null {
  const known = (id: string | null | undefined) => (id && specs.some((s) => s.id === id) ? id : null);
  return known(lastBeamSpecId) ?? known(deps.lastWindDefaults[0]?.warpSpecId) ?? (specs.length === 1 ? specs[0]!.id : null);
}

export type StationScan =
  | { kind: 'empty' }
  | { kind: 'beam'; beam: WarpBeam }
  | { kind: 'beam-blocked'; beam: WarpBeam; message: string }
  | { kind: 'body'; physicalBeamNo: string };

/** Okutulan kod: bilinen levent no (`beamNo`, katlanmış eşleşme) → hedef; değilse gövde no. Kod uydurulmaz. */
export function resolveStationScan(raw: string, beams: readonly WarpBeam[]): StationScan {
  const code = normalizeScanCode(raw);
  if (!code) return { kind: 'empty' };
  const fold = foldSearchText(code);
  const beam = beams.find((b) => foldSearchText(b.beamNo) === fold);
  if (!beam) return { kind: 'body', physicalBeamNo: code.slice(0, 32) };
  if (beam.status !== 'PLANNED') return { kind: 'beam-blocked', beam, message: `${beam.beamNo} durumu "${STATUS_LABEL[beam.status]}" — yeniden sarılamaz.` };
  if (beam.originKind !== 'IN_HOUSE') return { kind: 'beam-blocked', beam, message: `${beam.beamNo} içeride sarılmıyor — listeden SAR ile açın.` };
  return { kind: 'beam', beam };
}

export type ScanApply = { outcome: 'accept' | 'reject'; form: StationForm; message: string | null };

/** Okutmayı forma uygular. Gövde no yalnız YENİ planda yazılabilir; planlı levente gövde sarımda yazılamaz (uç almaz) → ret + yol. */
export function applyStationScan(form: StationForm, scan: StationScan, target: WarpBeam | null): ScanApply {
  if (scan.kind === 'empty') return { outcome: 'reject', form, message: null };
  if (scan.kind === 'beam-blocked') return { outcome: 'reject', form, message: scan.message };
  if (scan.kind === 'beam') {
    const b = scan.beam;
    const lengthM = form.lengthM.trim() ? form.lengthM : String(b.plannedLengthM);
    const sameSpec = b.warpSpec.id === form.warpSpecId;
    return { outcome: 'accept', form: { ...form, warpSpecId: b.warpSpec.id, target: { kind: 'beam', beamId: b.id }, lengthM, physicalBeamNo: '', ...(sameSpec ? {} : { weighedKg: '' }) }, message: null };
  }
  if (target) {
    if (target.physicalBeamNo && foldSearchText(target.physicalBeamNo) === foldSearchText(scan.physicalBeamNo)) return { outcome: 'accept', form, message: null };
    return { outcome: 'reject', form, message: `${target.beamNo} planlı; gövdesi planda yazılır. Bu gövdeyle sarmak için "Yeni levent" seçip yeniden okutun.` };
  }
  return { outcome: 'accept', form: { ...form, physicalBeamNo: scan.physicalBeamNo }, message: null };
}

/** Gönderilecek iplik çıkışı: TEK satırda kg ana formdan (tartı = yazılan, nominal = hesap); çok satırda satırlar olduğu gibi. */
export function effectiveIssues(form: StationForm, spec: StationSpec | null): YarnLineDraft[] {
  if (form.issues.length !== 1) return form.issues;
  const nominal = stationNominalKg(spec, form.lengthM);
  const qtyKg = form.kgSource === 'THEORETICAL' ? (nominal == null ? '' : String(nominal)) : form.weighedKg;
  return [{ ...form.issues[0]!, qtyKg }];
}

/** İstasyon formu → sayfalı formun `WindForm`u (doğrulama + yük aynı zincirden geçer). Adet 1: raşel takımı listedeki SAR'da. */
export function toWindForm(form: StationForm, spec: StationSpec | null): WindForm {
  return { lengthM: form.lengthM, kgSource: form.kgSource, machineId: form.machineId, issues: effectiveIssues(form, spec), returns: form.returns, breakCount: form.breakCount, count: '1', physicalBeamNoPrefix: '' };
}

export interface StationRules {
  lotRequired: boolean;
  beamWeavingLinkRequired: boolean;
}

/** Ekran kuralları önce (kart · hedef · kg), sonra sayfalı formun AYNI zinciri (`validateWind`, IN_HOUSE). */
export function validateStation(form: StationForm, spec: StationSpec | null, target: WarpBeam | null, rules: StationRules): Validation {
  if (!spec) return { ok: false, message: 'Çözgü kartı seçin.' };
  if (form.target.kind === 'beam' && !target) return { ok: false, message: 'Seçilen levent artık planlı değil — listeyi yenileyin ya da kartı yeniden seçin.' };
  if (!target && rules.beamWeavingLinkRequired && !form.weavingOrderId) return { ok: false, message: 'Bu kurulumda levent bir dokuma iş emrine bağlanmalı — "Dokuma işi" seçin.' };
  if (form.issues.length === 1) {
    if (form.kgSource === 'THEORETICAL' && spec.denier == null) return { ok: false, message: 'İplik kartında denye yok — nominal kg hesaplanamaz; tartıp girin.' };
    if (form.kgSource === 'WEIGHED' && !((num(form.weighedKg) ?? 0) > 0)) return { ok: false, message: 'Tartı kg 0’dan büyük olmalı.' };
  }
  return validateWind(toWindForm(form, spec), 'IN_HOUSE', rules.lotRequired);
}

/** Yeni plan yükünün formu — IN_HOUSE, planlanan metre = sarılacak metre, gövde no planda. */
export function stationPlanForm(form: StationForm): PlanForm {
  return { ...EMPTY_PLAN, warpSpecId: form.warpSpecId, plannedLengthM: form.lengthM, originKind: 'IN_HOUSE', physicalBeamNo: form.physicalBeamNo, weavingOrderId: form.weavingOrderId };
}

/** Sar yükü — `buildWindPayload` (windSchema birebir). İş bağı GÖNDERİLMEZ: plandaki iş korunur (sunucu "verilmezse plandaki kalır"). */
export function buildStationWindPayload(form: StationForm, spec: StationSpec | null, clientToken: string): WindWarpBeamRequest {
  return buildWindPayload(toWindForm(form, spec), 'IN_HOUSE', clientToken);
}

/** Plan doğdu, sar düştüyse: hedef artık O levent — tekrar SAR ikinci plan AÇMAZ. */
export function afterPlanCreated(form: StationForm, beamId: string): StationForm {
  return { ...form, target: { kind: 'beam', beamId } };
}

/** Sarım sonrası: kart, makine, metre, kg kaynağı, iplik depo/lot kalır; ölçümler (kg, gövde, iade, kopuş) temizlenir; hedef yeniden otomatik. */
export function afterWind(form: StationForm): StationForm {
  return { ...form, target: { kind: 'auto' }, weighedKg: '', physicalBeamNo: '', issues: form.issues.map((l) => ({ ...l, qtyKg: '' })), returns: [], breakCount: '' };
}
