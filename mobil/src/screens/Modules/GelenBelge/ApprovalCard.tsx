// Belge Tara → onay kartı → iş emri (T2). Okuma bitince, belge başına tek kayıt kipinde okuma kartının altında çıkar:
// müşteri, parti no (aday seçici), kurşun metresi (kaynak + doğrula/düzelt), rota şablonu. Onay izni varsa
// "Onayla ve … aç" (onay + oto iş emri seçilen rotayla); yoksa "Taslak olarak bırak" — onay panelden verilir.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import ModuleSheet, { SheetField } from '../../../components/ModuleSheet';
import NumpadInput from '../../../components/NumpadInput';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import { inboundDocService } from '../../../services/inboundDoc.service';
import { colors, radius, spacing, typography } from '../../../theme';
import { INBOUND_DOC_CONTEXT_KEY } from './DocHeader';
import { approvalCardView, approveResultView, batchPatch, parseMeters } from './approvalGate';
import { useApprovalCard } from './useApprovalCard';

interface Props {
  noteId: string;
  /** Okuma sonuçlandı (READ/PARTIAL) — detay ancak o zaman çekilir. */
  readDone: boolean;
  onDone: () => void;
}

type Picker = 'owner' | 'batch' | 'route' | null;

export default function ApprovalCard({ noteId, readDone, onDone }: Props) {
  const c = useApprovalCard(noteId, readDone);
  const [picker, setPicker] = useState<Picker>(null);
  const [meterOpen, setMeterOpen] = useState(false);
  const [meterText, setMeterText] = useState('');
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000, enabled: !!c.detail });
  const customers: PickerOption[] = useMemo(() => (ctx.data?.data.customers ?? []).map((x) => ({ value: x.id, label: x.name })), [ctx.data]);
  const routeOptions: PickerOption[] = useMemo(() => c.routes.map((r) => ({ value: r.id, label: r.name, sublabel: r.code ?? undefined })), [c.routes]);

  if (c.result) {
    const r = approveResultView(c.result);
    return (
      <View style={[styles.box, r.tone === 'ok' ? styles.ok : styles.warn]} testID="onay-karti-sonuc">
        <Text style={styles.title}>{r.title}</Text>
        {r.lines.map((l) => (
          <Text key={l} style={styles.note}>
            • {l}
          </Text>
        ))}
        <View style={styles.actions}>
          <Button mode="contained" icon="check" onPress={onDone} contentStyle={styles.btn} testID="onay-karti-bitti">
            Bitti
          </Button>
        </View>
      </View>
    );
  }
  if (!c.detail) return null;

  const d = c.detail;
  const v = approvalCardView(d, { canApprove: c.canApprove });
  const busy = c.busy !== null;
  const ownerName = customers.find((o) => o.value === d.ownerCustomerId)?.label ?? (d.ownerCustomerId ? 'Seçili müşteri' : '');
  const routeName = c.routeTemplateId ? routeOptions.find((o) => o.value === c.routeTemplateId)?.label ?? 'Seçili rota' : 'Fabrika varsayılanı';
  const enteredMeters = parseMeters(meterText);

  const primary = () => {
    if (v.action === 'APPROVE') return void c.approve();
    Toast.show({ type: 'info', text1: `${d.noteNo} taslak olarak bırakıldı`, text2: 'Onay panelden (Gelen Belgeler) yetkili kişi tarafından verilir.' });
    onDone();
  };
  const saveMeters = async (value: number) => {
    setMeterOpen(false);
    await c.patch({ kursunMeters: value });
  };

  return (
    <View style={styles.box} testID="onay-karti">
      <View style={styles.head}>
        <Text style={styles.title}>Onay ve iş emri</Text>
        {busy && <ActivityIndicator size="small" />}
      </View>

      <SheetField label="Müşteri" value={ownerName} placeholder="Müşteri seçin" onPress={() => setPicker('owner')} disabled={busy} />

      <View testID="onay-karti-parti">
        <SheetField
          label="Parti no"
          value={v.batch.value ?? ''}
          placeholder={v.batch.hint ?? 'Parti no'}
          onPress={() => setPicker('batch')}
          disabled={busy || v.batch.candidates.length === 0}
          hint={v.batch.value && v.batch.candidates.length > 1 ? `${v.batch.candidates.length} aday — değiştirmek için dokunun` : undefined}
        />
      </View>

      <View testID="onay-karti-metre">
        <Text style={styles.label}>Kurşun metresi</Text>
        <View style={styles.row}>
          <Text style={[styles.meters, v.meters.review && styles.warnText, !v.meters.text && styles.muted]}>
            {v.meters.text ?? 'Metre okunamadı'}
          </Text>
          {v.canVerify && (
            <Button mode="contained-tonal" icon="check" onPress={() => void c.patch({ kursunMetersReviewed: true })} disabled={busy} contentStyle={styles.btn} testID="onay-karti-dogrula">
              Doğrula
            </Button>
          )}
          <Button
            mode="outlined"
            icon="pencil"
            onPress={() => {
              setMeterText('');
              setMeterOpen(true);
            }}
            disabled={busy}
            contentStyle={styles.btn}
            testID="onay-karti-duzelt"
          >
            {v.meters.text ? 'Düzelt' : 'Metre gir'}
          </Button>
        </View>
        {v.meters.review && <Text style={styles.warnText}>Metre doğrulama bekliyor: belgedeki değeri kontrol edin.</Text>}
      </View>

      {v.action === 'APPROVE' && (
        <SheetField label="Rota şablonu" value={routeName} placeholder="Fabrika varsayılanı" onPress={() => setPicker('route')} disabled={busy} />
      )}

      {[...v.reasons, ...v.warnings].map((n) => (
        <Text key={n} style={styles.note}>
          • {n}
        </Text>
      ))}

      <View style={styles.actions}>
        <Button
          mode="contained"
          icon={v.action === 'APPROVE' ? 'check-decagram' : 'content-save-outline'}
          onPress={primary}
          loading={c.busy === 'approve'}
          disabled={busy || v.blocked}
          contentStyle={styles.btn}
          testID="onay-karti-birincil"
        >
          {v.label}
        </Button>
      </View>

      <PickerModal
        visible={picker === 'owner'}
        title="Belgenin sahibi"
        options={customers}
        selectedValue={d.ownerCustomerId}
        onSelect={(id) => {
          setPicker(null);
          if (id !== d.ownerCustomerId) void c.patch({ ownerCustomerId: id });
        }}
        onDismiss={() => setPicker(null)}
        loading={ctx.isLoading}
        onRefresh={ctx.refetch}
        emptyText={ctx.isError ? 'Liste yüklenemedi — bu bir "müşteri yok" cevabı DEĞİLDİR.' : 'Aktif müşteri yok.'}
      />
      <PickerModal
        visible={picker === 'batch'}
        title="Parti no"
        options={v.batch.candidates.map((x, i) => ({ value: String(i), label: x.value, sublabel: x.label ?? x.key ?? undefined }))}
        selectedValue={String(v.batch.candidates.findIndex((x) => x.value === v.batch.value))}
        disableSort
        onSelect={(i) => {
          setPicker(null);
          const cand = v.batch.candidates[Number(i)];
          if (cand && cand.value !== v.batch.value) void c.patch(batchPatch(cand));
        }}
        onDismiss={() => setPicker(null)}
        emptyText="Belgede parti no adayı yok."
      />
      <PickerModal
        visible={picker === 'route'}
        title="Rota şablonu"
        options={routeOptions}
        selectedValue={c.routeTemplateId}
        loading={c.routesLoading}
        leadingAction={{
          label: 'Fabrika varsayılanı',
          sublabel: 'Rotayı sunucu önerir (fabrika ayarı)',
          icon: 'factory',
          onPress: () => {
            c.setRouteTemplateId(null);
            setPicker(null);
          },
        }}
        onSelect={(id) => {
          c.setRouteTemplateId(id);
          setPicker(null);
        }}
        onDismiss={() => setPicker(null)}
        emptyText="Rota listesi okunamadı — fabrika varsayılanı kullanılır."
      />
      <ModuleSheet
        visible={meterOpen}
        onDismiss={() => setMeterOpen(false)}
        title="Kurşun metresi"
        subtitle={v.meters.text ? `Okunan: ${v.meters.text}` : 'Belgeden okunamadı'}
        size="sm"
        footer={
          <View style={styles.actions}>
            <Button onPress={() => setMeterOpen(false)} contentStyle={styles.btn}>
              Vazgeç
            </Button>
            <Button mode="contained" disabled={enteredMeters === null} onPress={() => enteredMeters !== null && void saveMeters(enteredMeters)} contentStyle={styles.btn} testID="onay-karti-metre-kaydet">
              Kaydet
            </Button>
          </View>
        }
      >
        {v.meters.choices.length > 0 && <Text style={styles.label}>Belgedeki değerler</Text>}
        <View style={styles.chips}>
          {v.meters.choices.map((m) => (
            <Chip key={m.role} onPress={() => void saveMeters(m.value)} style={styles.chip} testID={`onay-karti-metre-${m.role}`}>
              {`${m.label}: ${m.text}`}
            </Chip>
          ))}
        </View>
        <NumpadInput
          value={meterText}
          onChangeText={setMeterText}
          label="Metre"
          mode="outlined"
          useNativeKeyboard
          allowDecimal
          testID="onay-karti-metre-giris"
        />
      </ModuleSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm, backgroundColor: colors.surfaceMuted },
  ok: { backgroundColor: colors.successContainer },
  warn: { backgroundColor: colors.warningContainer },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold, color: colors.text },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  meters: { flex: 1, minWidth: 160, fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.text },
  warnText: { color: colors.warningText },
  muted: { color: colors.textMuted },
  note: { fontSize: typography.size.sm, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { minHeight: 56, justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 56 },
});
