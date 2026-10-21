// =============================================================================
// SAR istasyonu — iplik satırları SAYFASI (`PagedSheet`): ① brüt çıkış · ② dip iadesi + kopuş
// =============================================================================
// İstasyon formu tek iplik satırını ana formdan (tartı/nominal kg) sürer; çok depo/lot, dip
// iadesi ve kopuş buradadır. Tek satırda burada yazılan kg ana formun tartı kg'sine taşınır
// (iki kaynak olmasın). Doğrulama sayfalı formun zinciri (`validateWindPage`).
// =============================================================================
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import PagedSheet, { type SheetPage } from '../../../components/PagedSheet';
import NumpadInput from '../../../components/NumpadInput';
import { sheet } from '../../../components/ModuleSheet';
import type { TabletContext } from '../../../services/warpBeam.service';
import { validateWindPage, type YarnLineDraft } from './beamPayload';
import YarnLinesEditor from './YarnLinesEditor';
import { effectiveIssues, toWindForm, type StationForm, type StationSpec } from './windStation';

interface Props {
  visible: boolean;
  form: StationForm;
  spec: StationSpec | null;
  context: TabletContext | undefined;
  yarnItemId: string | null;
  onApply: (patch: Partial<StationForm>) => void;
  onDismiss: () => void;
}

interface Draft {
  issues: YarnLineDraft[];
  returns: YarnLineDraft[];
  breakCount: string;
}

export default function WindYarnSheet({ visible, form, spec, context, yarnItemId, onApply, onDismiss }: Props) {
  const [d, setD] = useState<Draft>({ issues: [], returns: [], breakCount: '' });
  // Açılışta tek satırın kg'si ana formdan tohumlanır (nominal/tartı) — sayfada görülen = gidecek olan.
  useEffect(() => {
    if (visible) setD({ issues: effectiveIssues(form, spec), returns: form.returns, breakCount: form.breakCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız açılışta tohumla (yazarken form değişse de taslak ezilmez)
  }, [visible]);
  if (!visible) return null;

  const lotRequired = context?.lotRequired ?? false;
  const lots = context?.yarnLots ? context.yarnLots.filter((l) => !yarnItemId || l.itemId === yarnItemId) : undefined;
  const asWind = () => ({ ...toWindForm({ ...form, ...d }, spec), issues: d.issues });
  const pages: SheetPage[] = [
    {
      key: 'cikis',
      title: 'Brüt iplik çıkışı',
      render: () => (
        <YarnLinesEditor title={lotRequired ? 'Brüt iplik çıkışı (cağlık) — lot ZORUNLU' : 'Brüt iplik çıkışı (cağlık)'} lines={d.issues} warehouses={context?.warehouses ?? []} withReason={false} onChange={(issues) => setD({ ...d, issues })} lots={lots} lotRequired={lotRequired} qualityHold={context?.yarnQualityHold} />
      ),
      validate: () => {
        const r = validateWindPage(asWind(), lotRequired, 'makine');
        return r.ok || r.message === 'Devere makinesi seçin.' ? null : r.message;
      },
    },
    {
      key: 'dip',
      title: 'Dip iadesi · kopuş',
      render: () => (
        <>
          <YarnLinesEditor title="Dip iadesi" lines={d.returns} warehouses={context?.warehouses ?? []} withReason onChange={(returns) => setD({ ...d, returns })} lots={lots} qualityHold={context?.yarnQualityHold} />
          <View style={sheet.row}>
            <View style={sheet.col}>
              <Text style={sheet.label}>Kopuş adedi (isteğe bağlı)</Text>
              <NumpadInput value={d.breakCount} onChangeText={(t) => setD({ ...d, breakCount: t })} allowDecimal={false} numpadMaxLength={5} numpadLabel="Kopuş" placeholder="—" style={sheet.input} />
            </View>
          </View>
        </>
      ),
      validate: () => {
        const r = validateWindPage(asWind(), lotRequired, 'dip');
        return r.ok ? null : r.message;
      },
    },
  ];

  const apply = () => {
    const single = d.issues.length === 1 ? d.issues[0]!.qtyKg.trim() : '';
    // Tek satırda yazılan kg TARTIdır: ana form tartı moduna geçer (nominal kendiliğinden yazılmaz).
    const kg = single && single !== effectiveIssues(form, spec)[0]?.qtyKg ? { kgSource: 'WEIGHED' as const, weighedKg: single } : {};
    onApply({ issues: d.issues, returns: d.returns, breakCount: d.breakCount, ...kg });
    onDismiss();
  };

  return <PagedSheet visible onDismiss={onDismiss} onCancel={onDismiss} title="İplik satırları" subtitle={spec ? `${spec.code} · ${spec.endsCount} tel` : undefined} pages={pages} onSubmit={apply} submitLabel="Tamam" />;
}
