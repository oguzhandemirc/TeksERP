// =============================================================================
// SAR — sayfalı formun SAYFALARI: ① ölçü · ② makine + brüt çıkış · ③ dip iadesi + kopuş + ÖZET
// =============================================================================
// Form verisi `WindModal`da (state.windForm); sayfalar yalnız çizer ve `set` ile yazar.
// Fason/hazır kökende ② ve ③ yok — ② yerine yalnız ÖZET (`WindSummary`).
// =============================================================================
import React from 'react';
import { View } from 'react-native';
import { Text, SegmentedButtons } from 'react-native-paper';
import NumpadInput from '../../../components/NumpadInput';
import ModalTextInput from '../../../components/ModalTextInput';
import { SheetField, sheet } from '../../../components/ModuleSheet';
import { SummaryRow } from '../../../components/PagedSheet';
import type { WarpBeam, WarpKgSource } from '../../../services/warpBeam.service';
import { KG_SOURCE_LABEL, linesTotalKg, setCount, theoreticalKg, type WindForm } from './beamPayload';
import YarnLinesEditor from './YarnLinesEditor';
import type { DevereScreenState } from './useDevereScreen';

/** Makine listesi BOŞken alan gizlenmez — kurulum yolu söylenir (fail-soft; 6e'nin "Devere" görev türü inince güncellenir). */
export const NO_DEVERE_MACHINE_HINT = "Tanımlı devere makinesi yok — panelde Tanımlar → Üretim İstasyonları → istasyon kartında 'Levent sarar' + makine.";

export interface WindPageProps {
  beam: WarpBeam;
  f: WindForm;
  set: (patch: Partial<WindForm>) => void;
  state: DevereScreenState;
}

export function nominalKg(beam: WarpBeam, f: WindForm): number | null {
  return theoreticalKg(beam.warpSpec.endsCount, beam.warpSpec.yarnItem.linearDensityDen, Number(f.lengthM.replace(',', '.')));
}

/** ① Ölçü: metre | adet · (adet>1) gövde öneki · kg kaynağı. */
export function OlcuPage({ beam, f, set }: WindPageProps) {
  const denier = beam.warpSpec.yarnItem.linearDensityDen;
  const n = setCount(f) ?? 1;
  return (
    <>
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Sarılan metre</Text>
          <NumpadInput value={f.lengthM} onChangeText={(t) => set({ lengthM: t })} allowDecimal numpadMaxLength={8} numpadLabel="Sarılan metre" placeholder="m" style={sheet.input} />
          {denier == null ? (
            <Text style={sheet.warn}>İplik kartında denye yok — sunucu nominal kg hesaplayamaz; kaydet 400 verir, kartı düzelttirin.</Text>
          ) : (
            <Text style={sheet.hint}>{`Nominal ≈ ${nominalKg(beam, f) ?? '—'} kg`}</Text>
          )}
        </View>
        <View style={sheet.col}>
          <Text style={sheet.label}>Adet (raşel takımı — 1 = tek levent)</Text>
          <NumpadInput value={f.count} onChangeText={(t) => set({ count: t })} allowDecimal={false} numpadMaxLength={2} numpadLabel="Adet" placeholder="1" style={sheet.input} />
          {n > 1 ? <Text style={sheet.hint}>{`${n} levent birlikte doğar; iplik satırları TOPLAMDIR, levent başına pay ÷ ${n}.`}</Text> : null}
        </View>
      </View>
      {n > 1 ? (
        <>
          <Text style={sheet.label}>Gövde no öneki (isteğe bağlı, ör. R7 → R7-1 …)</Text>
          <ModalTextInput value={f.physicalBeamNoPrefix} onChangeText={(t) => set({ physicalBeamNoPrefix: t })} maxLength={28} placeholder="—" style={sheet.input} dense />
        </>
      ) : null}
      <Text style={sheet.label}>Kg kaynağı</Text>
      <SegmentedButtons value={f.kgSource} onValueChange={(v) => set({ kgSource: v as WarpKgSource })} buttons={(['WEIGHED', 'THEORETICAL'] as WarpKgSource[]).map((k) => ({ value: k, label: KG_SOURCE_LABEL[k], labelStyle: sheet.segmentLabel }))} />
    </>
  );
}

/** ② Makine + brüt iplik çıkışı (IN_HOUSE). Makine seçici `PickerModal` — `WindModal` overlays'te. */
export function MakinePage({ beam, f, set, state, onPickMachine }: WindPageProps & { onPickMachine: () => void }) {
  const ctx = state.context.data;
  const machines = ctx?.machines ?? [];
  const machineName = machines.find((m) => m.id === f.machineId)?.name ?? '';
  // Faz 2: lot adayları kartın ipliğine süzülür; sunucu göndermiyorsa (eski) seçici çizilmez. Kapı sunucudan.
  const lots = ctx?.yarnLots ? ctx.yarnLots.filter((l) => l.itemId === beam.warpSpec.yarnItem.id) : undefined;
  const lotRequired = ctx?.lotRequired ?? false;
  return (
    <>
      <SheetField label="Devere makinesi" value={machineName} placeholder={machines.length ? 'Seçilmedi' : 'Makine yok'} onPress={onPickMachine} hint={machines.length ? undefined : NO_DEVERE_MACHINE_HINT} />
      <YarnLinesEditor title={lotRequired ? 'Brüt iplik çıkışı (cağlık) — lot ZORUNLU' : 'Brüt iplik çıkışı (cağlık)'} lines={f.issues} warehouses={ctx?.warehouses ?? []} withReason={false} onChange={(issues) => set({ issues })} disabled={state.busy} lots={lots} lotRequired={lotRequired} qualityHold={ctx?.yarnQualityHold} />
    </>
  );
}

/** ③ Dip iadesi + kopuş (IN_HOUSE) — özet altına `WindSummary` gelir. */
export function DipPage({ beam, f, set, state }: WindPageProps) {
  const ctx = state.context.data;
  const lots = ctx?.yarnLots ? ctx.yarnLots.filter((l) => l.itemId === beam.warpSpec.yarnItem.id) : undefined;
  return (
    <>
      <YarnLinesEditor title="Dip iadesi" lines={f.returns} warehouses={ctx?.warehouses ?? []} withReason onChange={(returns) => set({ returns })} disabled={state.busy} lots={lots} qualityHold={ctx?.yarnQualityHold} />
      <View style={sheet.row}>
        <View style={sheet.col}>
          <Text style={sheet.label}>Kopuş adedi (isteğe bağlı)</Text>
          <NumpadInput value={f.breakCount} onChangeText={(t) => set({ breakCount: t })} allowDecimal={false} numpadMaxLength={5} numpadLabel="Kopuş" placeholder="—" style={sheet.input} />
        </View>
      </View>
    </>
  );
}

/** ÖZET — son sayfada; gövde çakışması uyarısı (sunucu 409 aynası) burada da yazılır, Kaydet kilitlenmez. */
export function WindSummary({ beam, f, state, busyWarning }: WindPageProps & { busyWarning: string | null }) {
  const inHouse = beam.originKind === 'IN_HOUSE';
  const n = setCount(f) ?? 1;
  const machineName = state.context.data?.machines.find((m) => m.id === f.machineId)?.name ?? null;
  return (
    <View>
      <Text style={sheet.label}>Özet</Text>
      <SummaryRow label="Sarılan metre" value={f.lengthM ? `${f.lengthM} m` : null} />
      <SummaryRow label="Adet" value={n > 1 ? `${n} levent${f.physicalBeamNoPrefix.trim() ? ` · önek ${f.physicalBeamNoPrefix.trim()}` : ''}` : '1 levent'} />
      <SummaryRow label="Kg kaynağı" value={KG_SOURCE_LABEL[f.kgSource]} />
      <SummaryRow label="Nominal kg" value={nominalKg(beam, f)} />
      <SummaryRow label="Gövde no" value={beam.physicalBeamNo} />
      {inHouse ? (
        <>
          <SummaryRow label="Devere makinesi" value={machineName} />
          <SummaryRow label="Brüt çıkış" value={f.issues.length ? `${linesTotalKg(f.issues)} kg · ${f.issues.length} satır` : null} />
          <SummaryRow label="Dip iadesi" value={f.returns.length ? `${linesTotalKg(f.returns)} kg · ${f.returns.length} satır` : 'yok'} />
          <SummaryRow label="Kopuş" value={f.breakCount.trim() || null} />
        </>
      ) : (
        <Text style={sheet.hint}>Fason/hazır levent: makine ve iplik satırı yazılmaz — iplik tüketimi bizim defterde değil.</Text>
      )}
      {busyWarning ? <Text style={sheet.warn} testID="sar-govde-uyari">{busyWarning}</Text> : null}
    </View>
  );
}
