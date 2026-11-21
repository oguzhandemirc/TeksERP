// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — görünüm parçaları (tablet tasarım dili, Tambur referansı)
// =============================================================================
// Üst şerit devereci çipi · SOL: şu anki iş kartı (devereci, irsaliye, siparişler, kahraman sayı) + levent ekleme ·
// SAĞ: eklenen leventler. Seçici pencerelerde uzun ad iki satıra sarar.
// =============================================================================
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Text, Button, Chip, TouchableRipple, Icon } from 'react-native-paper';
import ModalTextInput from '../../../components/ModalTextInput';
import PickerModal from '../../../components/PickerModal';
import ScannerEntryBar from '../../../components/ScannerEntryBar';
import TruncatedText from '../../../components/TruncatedText';
import { colors } from '../../../theme';
import { fmtMeters } from '../../../utils/meters';
import { heroFigure, parseNum, type BeamDraft } from './receiveDocPayload';
import type { DevereKabulState } from './useDevereKabul';
import { ds, MAIN_BLUE } from './devereKabul.styles';

/** Başlık satırında devereci çipi — dokununca devereci seçici açılır. */
export function SubChip({ name, onPress }: { name: string | null; onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} style={ds.subChip} borderless rippleColor="rgba(255,255,255,0.2)" accessibilityRole="button" accessibilityLabel={name ? `Devereci ${name}. Değiştir` : 'Devereci seç'} testID="devere-kabul-devereci">
      <View style={ds.subChipInner}>
        <Icon source="account-hard-hat-outline" size={18} color={colors.textOnDark} />
        <TruncatedText style={ds.subChipText}>{name ?? 'Devereci seç'}</TruncatedText>
      </View>
    </TouchableRipple>
  );
}

/** Devereci ve açık sipariş seçicileri (seçilmiş sipariş listeden düşer). */
export function HeaderPickers({ state: s, picker, onClose }: { state: DevereKabulState; picker: null | 'sub' | 'order'; onClose: () => void }) {
  const pickedIds = new Set(s.orders.map((o) => o.orderId));
  return (
    <>
      <PickerModal
        visible={picker === 'sub'}
        title="Devereci"
        wrapLabels
        numColumns={2}
        options={s.subcontractors.map((x) => ({ value: x.id, label: x.name, sublabel: `${x.openOrderCount} açık sipariş` }))}
        selectedValue={s.subcontractorId ?? ''}
        loading={s.context.isLoading}
        emptyText="Açık fason devere siparişi olan devereci yok — sipariş panelden açılır (Üretim › Devere / Çözgü)."
        onDismiss={onClose}
        onSelect={(id) => { s.selectSubcontractor(id); onClose(); }}
      />
      <PickerModal
        visible={picker === 'order'}
        title="Açık sipariş"
        wrapLabels
        numColumns={2}
        options={s.ctxOrders.filter((o) => !pickedIds.has(o.id)).map((o) => ({
          value: o.id,
          label: `${o.orderNo} — ${o.warpSpec.name}`,
          sublabel: o.remainingBeamCount === null ? `kalan ${fmtMeters(Number(o.remainingM))} m` : `${o.remainingBeamCount} levent bekleniyor · kalan ${fmtMeters(Number(o.remainingM))} m`,
        }))}
        selectedValue=""
        loading={s.context.isFetching}
        emptyText="Bu deverecinin kabul bekleyen başka açık siparişi yok."
        onDismiss={onClose}
        onSelect={(id) => { s.addOrder(id); onClose(); }}
      />
    </>
  );
}

/** Seçili siparişin künyesi + kahraman sayı ("0/2 levent" ya da "3.000 m kalan"). */
function OrderInfo({ state }: { state: DevereKabulState }) {
  const o = state.activeOrder;
  if (!o) return <Text style={ds.hint}>{state.subcontractorId ? 'Siparişi seçin.' : 'Önce devereciyi seçin (üst şeritteki çip).'}</Text>;
  const drafted = state.orders.find((x) => x.orderId === o.id)?.beams.length ?? 0;
  const hero = heroFigure(drafted, o);
  return (
    <View style={ds.row}>
      <View style={ds.grow}>
        <TruncatedText style={ds.orderTitle}>{`${o.orderNo} · ${o.warpSpec.name}`}</TruncatedText>
        <Text style={ds.gray}>{`Kalan ${fmtMeters(Number(o.remainingM))} m · gelen ${o.receivedBeamCount} levent / ${fmtMeters(Number(o.receivedM))} m`}</Text>
      </View>
      <View style={ds.hero} testID="devere-kabul-kahraman">
        <Text style={ds.heroValue}>{hero.value}</Text>
        <Text style={ds.heroUnit}>{hero.unit}</Text>
      </View>
    </View>
  );
}

/** SOL üst: şu anki iş — devereci, irsaliye no (büyük kutu), sipariş seçimi, sipariş künyesi. */
export function JobCard({ state, onPickSub, onPickOrder }: { state: DevereKabulState; onPickSub: () => void; onPickOrder: () => void }) {
  return (
    <View style={ds.card}>
      <View style={ds.row}>
        <View style={ds.grow}>
          <Text style={ds.caps}>DEVERECİ</Text>
          {state.subcontractor ? (
            <TouchableRipple onPress={onPickSub} accessibilityRole="button" accessibilityLabel="Devereciyi değiştir">
              <TruncatedText style={ds.bigName}>{state.subcontractor.name}</TruncatedText>
            </TouchableRipple>
          ) : (
            <Button mode="contained" icon="account-hard-hat-outline" buttonColor={MAIN_BLUE} onPress={onPickSub} contentStyle={ds.tall}>Devereci seç</Button>
          )}
        </View>
        <View style={ds.grow}>
          <Text style={ds.label}>İrsaliye no</Text>
          <ModalTextInput mode="outlined" value={state.deliveryNoteNo} onChangeText={state.setDeliveryNoteNo} maxLength={64} autoCapitalize="characters" placeholder="Devereci irsaliyesi" style={ds.bigInput} testID="devere-kabul-irsaliye" />
        </View>
      </View>
      {state.subcontractorId ? (
        <ScrollView horizontal contentContainerStyle={ds.row} keyboardShouldPersistTaps="handled">
          {state.orders.map((o) => (
            <Chip key={o.orderId} selected={o.orderId === state.activeOrderId} showSelectedOverlay onPress={() => state.setActiveOrderId(o.orderId)} onClose={() => state.removeOrder(o.orderId)} style={ds.chip} textStyle={ds.chipText}>
              {`${o.orderNo} · ${o.beams.length}`}
            </Chip>
          ))}
          <Button mode="outlined" icon="plus" onPress={onPickOrder} contentStyle={ds.tall} testID="devere-kabul-siparis-ekle">
            {state.orders.length ? 'Sipariş ekle' : 'Sipariş seç'}
          </Button>
        </ScrollView>
      ) : null}
      <OrderInfo state={state} />
    </View>
  );
}

interface AddProps {
  state: DevereKabulState;
  code: string;
  setCode: (c: string) => void;
  canAdd: boolean;
  onCamera: () => void;
}

/** SOL alt: levent ekleme — gövde QR (kamerada "Numara yaz" da var) ve/veya gövdesiz levent. */
export function AddBeamCard({ state: s, code, setCode, canAdd, onCamera }: AddProps) {
  const mode = s.settings.beamBodyMode;
  return (
    <View style={ds.card}>
      <Text style={ds.cardTitle}>Levent ekle</Text>
      {mode !== 'OFF' ? (
        <ScannerEntryBar value={code} onChangeText={setCode} placeholder="Gövde QR / no okut-yaz…" onResolve={() => { void s.scanBody(code); setCode(''); }} resolving={s.resolving} onScan={canAdd ? onCamera : undefined} scanCtaLabel="GÖVDE QR OKUT" tone="blue" hardwareListening />
      ) : null}
      {mode !== 'REQUIRED' ? (
        <Button mode={mode === 'OFF' ? 'contained' : 'outlined'} buttonColor={mode === 'OFF' ? MAIN_BLUE : undefined} icon="plus" onPress={() => s.openNewLine(null)} disabled={!canAdd} contentStyle={ds.tall} testID="devere-kabul-govdesiz">
          {mode === 'OFF' ? 'LEVENT EKLE' : 'Gövdesiz levent ekle'}
        </Button>
      ) : null}
      {mode !== 'OFF' ? <Text style={ds.hint}>QR okunmuyorsa kamera penceresinde gövde numarasını yazın.</Text> : null}
    </View>
  );
}

function lineName(b: BeamDraft): string {
  return b.body ? `${b.body.bodyNo}${b.body.kind === 'new' ? ' (yeni)' : ''}` : b.physicalBeamNo.trim() || 'gövdesiz';
}

/** SAĞ: bu kabule eklenen leventler (aktif sipariş). Satıra ya da kalem düğmesine dokununca düzeltilir. */
export function LinesCard({ state }: { state: DevereKabulState }) {
  const o = state.orders.find((x) => x.orderId === state.activeOrderId);
  const beams = o?.beams ?? [];
  const total = beams.reduce((n, b) => n + (parseNum(b.lengthM) ?? 0), 0);
  return (
    <View style={[ds.card, ds.grow]}>
      <View style={ds.cardTitleRow}>
        <Text style={ds.cardTitle}>Eklenen leventler</Text>
        {beams.length ? <Text style={ds.summary}>{`${beams.length} levent · ${fmtMeters(total)} m`}</Text> : null}
      </View>
      {!o ? <Text style={ds.hint}>Sipariş seçilince leventler burada listelenir.</Text> : null}
      {o && beams.length === 0 ? <Text style={ds.hint}>Henüz levent yok — gövde QR'ını okutun.</Text> : null}
      <ScrollView>
        {o && beams.map((b, i) => {
          const gross = parseNum(b.grossKg);
          return (
            <TouchableRipple key={b.key} onPress={() => state.editLine(o.orderId, b)} accessibilityLabel={`${i + 1}. levent düzelt`}>
              <View style={ds.lineRow}>
                <Text style={ds.lineIdx}>{i + 1}</Text>
                <View style={ds.grow}>
                  <TruncatedText style={ds.lineName}>{lineName(b)}</TruncatedText>
                  {gross !== null ? <Text style={ds.lineSub}>{`tartı ${fmtMeters(gross)} kg`}</Text> : null}
                </View>
                <Text style={ds.lineM}>{parseNum(b.lengthM) === null ? '— m' : `${fmtMeters(parseNum(b.lengthM) as number)} m`}</Text>
                <View style={[ds.squareBtn, ds.squareBlue]}>
                  <Icon source="pencil-outline" size={24} color={MAIN_BLUE} />
                </View>
              </View>
            </TouchableRipple>
          );
        })}
      </ScrollView>
    </View>
  );
}
