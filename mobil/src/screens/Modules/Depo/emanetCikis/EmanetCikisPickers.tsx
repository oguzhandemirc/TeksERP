import React, { useEffect, useMemo, useState } from 'react';
import { Text, Button } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';

import PickerModal, { type PickerOption } from '../../../../components/PickerModal';
import ModuleSheet, { sheet } from '../../../../components/ModuleSheet';
import NumpadInput from '../../../../components/NumpadInput';
import { consignmentService, type BeamCandidate, type YarnCandidate } from '../../../../services/consignment.service';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { emptyOrProblemText } from '../../../../utils/queryState';
import { colors } from '../../../../theme';
import { beamKey, blockedText, lineBlock, parseKg, yarnKey } from './emanetCikisLogic';

// =============================================================================
// Emanet çıkış seçicileri — müşteri (sahip) · aday levent/lot (PickerModal) · iplik kg kartı.
// Adaylar sunucu aday ucundan (sahip süzgeci + engel sunucuda); engelli satır rozetle görünür, seçilince nedeni söyler.
// =============================================================================

export const CANDIDATES_KEY = 'consignment-candidates';

export function useCandidates(ownerId: string | null, search: string, enabled: boolean) {
  return useQuery({
    queryKey: [CANDIDATES_KEY, ownerId, search],
    queryFn: () => consignmentService.candidates(ownerId!, search),
    enabled: enabled && !!ownerId,
    staleTime: 0,
  });
}

export function OwnerPicker({ visible, selectedId, onSelect, onDismiss }: { visible: boolean; selectedId: string | null; onSelect: (id: string, name: string) => void; onDismiss: () => void }) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  // Emanet sahip seçicisi: müşteri kartı (iletişim/vergi) okunmaz; yalnız emaneti olan müşteriler gelir.
  const q = useQuery({
    queryKey: ['consignment-owners', debounced],
    queryFn: () => consignmentService.owners(debounced),
    enabled: visible,
  });
  const options = useMemo<PickerOption[]>(() => (q.data?.owners ?? []).map((c) => ({ value: c.id, label: c.name, sublabel: c.code })), [q.data]);
  const empty = 'Emanet malı olan müşteri bulunamadı';
  return (
    <PickerModal
      visible={visible}
      title="Malın sahibi"
      options={options}
      selectedValue={selectedId}
      loading={q.isLoading}
      emptyText={emptyOrProblemText(q, empty)}
      quickAddSlot={<TruncatedHint on={!!q.data?.truncated} />}
      onRefresh={() => void q.refetch()}
      paginated
      searchValue={search}
      onSearchSubmit={setSearch}
      onSelect={(v) => onSelect(v, options.find((o) => o.value === v)?.label ?? '')}
      onDismiss={onDismiss}
    />
  );
}

/** Satır tavanı doldu: liste kesildi, aradığı yoksa operatör aramayı daraltır. */
function TruncatedHint({ on }: { on: boolean }) {
  return on ? <Text style={sheet.hint} testID="emanet-liste-kesik">Liste uzun, ilk satırlar gösteriliyor — aramayı daraltın.</Text> : null;
}

const BLOCKED_BADGE = colors.warningText;

interface CandidatePickerProps {
  kind: 'beam' | 'yarn' | null;
  ownerId: string;
  taken: ReadonlySet<string>;
  /** Okutulan lot birden çok depoda ise yalnız onlar listelenir. */
  yarnSubset?: YarnCandidate[] | null;
  onBlocked: (reason: string) => void;
  onPickBeam: (b: BeamCandidate) => void;
  onPickYarn: (y: YarnCandidate) => void;
  onDismiss: () => void;
}

export function CandidatePicker({ kind, ownerId, taken, yarnSubset, onBlocked, onPickBeam, onPickYarn, onDismiss }: CandidatePickerProps) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300).trim();
  const q = useCandidates(ownerId, debounced, kind !== null && !yarnSubset);
  const data = q.data;
  const yarns = useMemo(() => yarnSubset ?? data?.yarns ?? [], [yarnSubset, data]);
  const options = useMemo<PickerOption[]>(() => {
    if (kind === 'beam') {
      return (data?.beams ?? []).map((b) => {
        const why = lineBlock(beamKey(b), b.blockedReason, taken);
        return { value: b.warpBeamId, label: b.beamNo, sublabel: `${b.warpSpecName ?? '—'} · ${b.remainingM} m`, ...(why ? { badge: { text: why, color: BLOCKED_BADGE } } : {}) };
      });
    }
    return yarns.map((y) => {
      const why = lineBlock(yarnKey(y), y.blockedReason, taken);
      return { value: yarnKey(y), label: `Lot ${y.lotNo}`, sublabel: `${y.itemName} · ${y.warehouseName} · ${y.balanceKg} kg`, ...(why ? { badge: { text: why, color: BLOCKED_BADGE } } : {}) };
    });
  }, [kind, data, yarns, taken]);
  const truncated = kind === 'beam' ? data?.truncated.beams : data?.truncated.yarns;
  const moduleOff = data && (kind === 'beam' ? !data.modules.devere : !data.modules.iplik);
  const empty = moduleOff ? 'Bu kalem türünün modülü kapalı' : kind === 'beam' ? 'Bu müşterinin hazır emanet leventi yok' : 'Bu müşterinin depoda bakiyeli emanet lotu yok';
  return (
    <PickerModal
      visible={kind !== null}
      title={kind === 'beam' ? 'Levent seç' : yarnSubset ? 'Lotun deposunu seç' : 'İplik lotu seç'}
      options={options}
      loading={q.isLoading && !yarnSubset}
      emptyText={emptyOrProblemText(q, empty)}
      quickAddSlot={<TruncatedHint on={!!truncated && !yarnSubset} />}
      onRefresh={() => void q.refetch()}
      paginated
      searchValue={search}
      onSearchSubmit={setSearch}
      onSelect={(v) => {
        const opt = options.find((o) => o.value === v);
        if (opt?.badge) return onBlocked(opt.badge.text);
        if (kind === 'beam') {
          const b = (data?.beams ?? []).find((x) => x.warpBeamId === v);
          if (b) onPickBeam(b);
        } else {
          const y = yarns.find((x) => yarnKey(x) === v);
          if (y) onPickYarn(y);
        }
      }}
      onDismiss={onDismiss}
    />
  );
}

/** İplik satırının kg'si — varsayılan o depodaki bakiye; ≤0 / biçimsiz değer eklenmez. */
export function KgSheet({ lot, onDone, onDismiss }: { lot: YarnCandidate | null; onDone: (y: YarnCandidate, kg: string) => void; onDismiss: () => void }) {
  const [value, setValue] = useState('');
  const lotKey = lot ? yarnKey(lot) : null;
  // Yeni lot açılınca varsayılan = o depodaki bakiye (operatör çoğu kez lotun tamamını iade eder).
  useEffect(() => {
    if (lot) setValue(lot.balanceKg.replace(/\.?0+$/, '').replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotKey]);
  const kg = parseKg(value);
  const close = onDismiss;
  return (
    <ModuleSheet
      visible={lot !== null}
      onDismiss={close}
      size="sm"
      title={lot ? `Lot ${lot.lotNo} — çıkış miktarı` : ''}
      subtitle={lot ? `${lot.itemName} · ${lot.warehouseName} deposunda ${lot.balanceKg} kg` : undefined}
      footer={
        <>
          <Button onPress={close}>Vazgeç</Button>
          <Button mode="contained" disabled={kg === null} testID="emanet-kg-ekle" onPress={() => {
            if (lot && kg) onDone(lot, kg);
          }}>Belgeye ekle</Button>
        </>
      }
    >
      <Text style={sheet.label}>Miktar (kg)</Text>
      <NumpadInput value={value} onChangeText={setValue} numpadLabel="Miktar (kg)" allowDecimal style={sheet.input} />
      {kg === null ? <Text style={sheet.error}>0'dan büyük bir kg girin (en çok 3 ondalık).</Text> : null}
      {lot?.blockedReason ? <Text style={sheet.warn}>{blockedText(lot.blockedReason)}</Text> : null}
    </ModuleSheet>
  );
}
