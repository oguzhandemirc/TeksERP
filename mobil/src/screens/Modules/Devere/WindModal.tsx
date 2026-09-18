// =============================================================================
// SAR — SAYFALI (`PagedSheet`): ① ölçü · ② makine + brüt çıkış · ③ dip iadesi + kopuş + ÖZET
// =============================================================================
// Alanlar backend `windSchema` ile birebir (`beamPayload.buildWindPayload`). Fason/hazır
// kökende makine ve iplik satırı ÇİZİLMEZ — sunucu 400 verir, form hiç kurmaz; sayfalar
// ① ölçü · ② özet. Sayfa doğrulaması `validateWindPage` (İleri'de; hata o sayfada kalır),
// Kaydet'te `validateWind` bütünü yeniden sorar (aynı zincir). Gövde çakışması uyarısı
// (sunucu `WARP_BEAM_PHYSICAL_BUSY` aynası) özette — Kaydet kilitlenmez.
// =============================================================================
import React, { useState } from 'react';
import PagedSheet, { type SheetPage } from '../../../components/PagedSheet';
import PickerModal from '../../../components/PickerModal';
import { ORIGIN_LABEL, physicalBeamBusyWarning, validateWindPage, windPhysicalNos } from './beamPayload';
import { DipPage, MakinePage, NO_DEVERE_MACHINE_HINT, OlcuPage, WindSummary, type WindPageProps } from './WindPages';
import type { DevereScreenState } from './useDevereScreen';

export { NO_DEVERE_MACHINE_HINT } from './WindPages';

type Machine = NonNullable<DevereScreenState['context']['data']>['machines'][number];

function MachinePicker({ visible, machines, selected, loading, onDismiss, onSelect }: { visible: boolean; machines: Machine[]; selected: string; loading: boolean; onDismiss: () => void; onSelect: (id: string) => void }) {
  return (
    <PickerModal
      visible={visible}
      title="Devere makinesi seç"
      options={machines.map((m) => ({ value: m.id, label: m.name, sublabel: `${m.code} · ${m.stationName}` }))}
      selectedValue={selected}
      loading={loading}
      emptyText={NO_DEVERE_MACHINE_HINT}
      onDismiss={onDismiss}
      onSelect={onSelect}
    />
  );
}

/** Sayfa listesi kökene göre: IN_HOUSE üç sayfa, fason/hazır iki (ölçü · özet). */
function windPages(p: WindPageProps, lotRequired: boolean, busyWarning: string | null, onPickMachine: () => void): SheetPage[] {
  const summary = <WindSummary {...p} busyWarning={busyWarning} />;
  const v = (page: 'olcu' | 'makine') => () => {
    const r = validateWindPage(p.f, lotRequired, page);
    return r.ok ? null : r.message;
  };
  if (p.beam.originKind !== 'IN_HOUSE') {
    return [
      { key: 'olcu', title: 'Ölçü', render: () => <OlcuPage {...p} />, validate: v('olcu') },
      { key: 'ozet', title: 'Özet', render: () => summary },
    ];
  }
  return [
    { key: 'olcu', title: 'Ölçü', render: () => <OlcuPage {...p} />, validate: v('olcu') },
    { key: 'makine', title: 'Makine · iplik', render: () => <MakinePage {...p} onPickMachine={onPickMachine} />, validate: v('makine') },
    { key: 'dip', title: 'Dip iadesi · özet', render: () => <><DipPage {...p} />{summary}</> },
  ];
}

export default function WindModal({ state }: { state: DevereScreenState }) {
  const [machinePicker, setMachinePicker] = useState(false);
  const beam = state.modal?.kind === 'wind' ? state.modal.beam : null;
  const f = state.windForm;
  if (!beam || !f) return null;
  const machines = state.context.data?.machines ?? [];
  const lotRequired = state.context.data?.lotRequired ?? false;
  const set = (patch: Partial<typeof f>) => state.setWindForm({ ...f, ...patch });
  const busyWarning = windPhysicalNos(beam.physicalBeamNo, f).map((no) => physicalBeamBusyWarning(no, state.physicalBusyBeams, beam.id)).find((w) => w != null) ?? null;
  const pages = windPages({ beam, f, set, state }, lotRequired, busyWarning, () => setMachinePicker(true));

  return (
    <PagedSheet
      visible
      onDismiss={state.closeModal}
      onCancel={state.closeModal}
      title={`${beam.beamNo} — sar`}
      subtitle={`${beam.warpSpec.code} · ${beam.warpSpec.endsCount} tel · ${ORIGIN_LABEL[beam.originKind]} · plan ${beam.plannedLengthM} m`}
      pages={pages}
      onSubmit={state.submitWind}
      submitLabel="Sarımı Kaydet"
      busy={state.busy}
      submitDisabled={!state.isOnline}
      externalError={state.formError}
      overlays={<MachinePicker visible={machinePicker} machines={machines} selected={f.machineId ?? ''} loading={state.context.isLoading} onDismiss={() => setMachinePicker(false)} onSelect={(v) => { set({ machineId: v }); setMachinePicker(false); }} />}
    />
  );
}
