// =============================================================================
// LEVENT TAK OKUTMA — saf çözücü (S3c): levent etiketi · gövde no · tezgah etiketi
// =============================================================================
// Levent etiketinin barkodu/QR'ı `beamNo`dur (LV+GGAAYY+NNNN; S1b WARP_BEAM etiketi);
// eski/etiketsiz levent için gövde no (`physicalBeamNo`) da kabul. Tezgah etiketi
// QR'ı makine KODUdur (panel MachineQrPrintDialog). Eşleşme katlanmış (büyük/küçük,
// Türkçe harf) — kod UYDURULMAZ: listede yoksa `unknown`. Takılabilir yalnız HAZIR levent.
// =============================================================================
import type { WarpBeam } from '../../../services/warpBeam.service';
import { foldSearchText } from '../../../utils/searchFold';
import { normalizeScanCode } from '../../../utils/scanCode';
import { beamBodyNoLooseMatch } from '../../../utils/beamBodyNo';
import { STATUS_LABEL } from './beamPayload';

export interface ScanMachine {
  id: string;
  code: string;
  name: string;
}

export type MountScan<M extends ScanMachine = ScanMachine> =
  | { kind: 'empty' }
  | { kind: 'beam'; beam: WarpBeam }
  | { kind: 'beam-blocked'; beam: WarpBeam; message: string }
  | { kind: 'machine'; machine: M }
  | { kind: 'ambiguous'; code: string; beamNos: string[] }
  | { kind: 'unknown'; code: string };

/**
 * Okunan kod → levent (beamNo > tezgah kodu > gövde no) ya da bilinmeyen. `looseBodyNo` (S3, sunucu
 * `devere.bodyNoLooseMatch`): gövde no birebir yoksa esnek kural (`utils/beamBodyNo.ts`, sunucuyla bayt-aynı).
 */
export function resolveMountScan<M extends ScanMachine>(raw: string, beams: readonly WarpBeam[], machines: readonly M[], opts: { looseBodyNo?: boolean } = {}): MountScan<M> {
  const code = normalizeScanCode(raw);
  if (!code) return { kind: 'empty' };
  const fold = foldSearchText(code);
  const byNo = beams.find((b) => foldSearchText(b.beamNo) === fold);
  if (byNo) return beamResult(byNo);
  const machine = machines.find((m) => foldSearchText(m.code) === fold);
  if (machine) return { kind: 'machine', machine };
  const byBody = beams.find((b) => b.physicalBeamNo != null && foldSearchText(b.physicalBeamNo) === fold);
  if (byBody) return beamResult(byBody);
  if (opts.looseBodyNo) {
    const loose = beams.filter((b) => [b.physicalBeamNo, b.beamBody?.bodyNo].some((n) => n != null && beamBodyNoLooseMatch(code, n)));
    if (loose.length === 1 && loose[0]) return beamResult(loose[0]);
    if (loose.length > 1) return { kind: 'ambiguous', code, beamNos: loose.map((b) => b.beamNo) };
  }
  return { kind: 'unknown', code };
}

function beamResult(beam: WarpBeam): MountScan<never> {
  if (beam.status === 'READY') return { kind: 'beam', beam };
  if (beam.status === 'MOUNTED') {
    const where = beam.currentMachine ? `${beam.currentMachine.code} yuva ${beam.currentPosition ?? '—'}` : 'bir tezgahta';
    return { kind: 'beam-blocked', beam, message: `${beam.beamNo} zaten takılı (${where}) — önce sökün.` };
  }
  return { kind: 'beam-blocked', beam, message: `${beam.beamNo} durumu "${STATUS_LABEL[beam.status]}" — takılamaz (yalnız hazır levent).` };
}

export type MountStep = 'beam' | 'machine';

/** Adım için okutma sonucu: kabul edilen değer ya da operatör metni (ret). */
export function mountScanOutcome<M extends ScanMachine>(scan: MountScan<M>, step: MountStep): { ok: true } | { ok: false; message: string | null } {
  if (scan.kind === 'empty') return { ok: false, message: null };
  if (scan.kind === 'beam-blocked') return { ok: false, message: scan.message };
  if (scan.kind === 'ambiguous') return { ok: false, message: `${scan.code} birden çok levente uyuyor (${scan.beamNos.join(', ')}) — levent etiketini okutun.` };
  if (scan.kind === 'unknown') return { ok: false, message: step === 'beam' ? `${scan.code} — hazır levent listesinde yok.` : `${scan.code} — levent tüketen tezgahlarda yok.` };
  if (step === 'beam' && scan.kind === 'machine') return { ok: false, message: 'Bu tezgah etiketi — önce leventin etiketini okutun.' };
  if (step === 'machine' && scan.kind === 'beam') return { ok: false, message: 'Bu levent etiketi — şimdi tezgahın etiketini okutun.' };
  return { ok: true };
}

/** Yuva sorusu yalnız çok yuvalı tezgahta (tek yuvalı → 1, dokunuş yok). */
export function slotNeedsInput(slots: number | null): boolean {
  return slots != null && slots > 1;
}
