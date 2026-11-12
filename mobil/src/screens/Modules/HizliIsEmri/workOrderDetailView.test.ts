import { detailColumns, incomingView, arrivalText, singlePieceNote, visibleAttachedRolls, targetRows, targetView, shortPropertyLabel, actionPlacement, summaryItems, routeChips, stepTone, stripDeviceId, fmtNum, foldLocked } from './workOrderDetailView';
import type { WorkOrder } from '../../../types/models';

const fmtDate = (s: string) => `D(${s})`;
const wo = (o: Partial<WorkOrder> = {}) => ({ id: 'w', workOrderNumber: 'IE1', status: 'IN_PROGRESS', createdAt: '2026-11-09', ...o }) as WorkOrder;

describe('detailColumns', () => {
  it('900dp altı tek, üstü iki sütun', () => {
    expect(detailColumns(599)).toBe(1);
    expect(detailColumns(899)).toBe(1);
    expect(detailColumns(900)).toBe(2);
    expect(detailColumns(1280)).toBe(2);
  });
});

describe('incomingView (Gelen kartı)', () => {
  const base = { meters: null, kg: null, widthCm: null, customerBatchNo: null, itemText: null, colorText: null, notes: [] as never[] };
  it('belgesiz İE: giren metre varsa yalnız metre satırı, yoksa "Gelen bilgisi yok"', () => {
    expect(incomingView(null, 241)).toEqual({ meters: '241 m', metersLabel: 'Giren Metre', rows: [], sources: [], moreRows: [], empty: false });
    expect(incomingView(undefined, 0).empty).toBe(true);
    expect(incomingView(null).meters).toBeNull();
  });
  it('⭐ metre kritik rakam; kg · en · kumaş · renk · parti no · nasıl geldi sırayla, boşlar atılır', () => {
    const v = incomingView({ ...base, meters: 241, kg: null, widthCm: 350, customerBatchNo: 'ISM1439770', itemText: '2008-58 KOYU BEJ FULAR', colorText: '58 KOYU BEJ FULAR', notes: [{ id: '1', noteNo: 'GB0911260073' }], rootCount: 1, rootRollIds: ['r1'], arrivalForm: 'SINGLE_PIECE' });
    expect(v.meters).toBe('241 m');
    expect(v.metersLabel).toBe('Gelen Metre');
    expect(v.rows).toEqual([
      ['Gelen En', '350 cm'],
      ['Gelen Kumaş', '2008-58 KOYU BEJ FULAR'],
      ['Gelen Renk', '58 KOYU BEJ FULAR'],
      ['Müşteri Parti No', 'ISM1439770'],
      ['Kumaş Nasıl Geldi', 'Tek parça'],
    ]);
    expect(v.sources).toEqual(['GB0911260073']);
    expect(v.empty).toBe(false);
  });
  it('kaynak belge: GB no · evrak no · tarih; künye satırları kaynak belgenin altında', () => {
    const v = incomingView({
      ...base, kg: 1200.5,
      notes: [
        { id: '1', noteNo: 'GB0911260035', senderDocNo: '12345', senderDocDate: '2026-11-09T00:00:00.000Z', sender: 'Gönderen AŞ', declaredTopCount: 3, customerOrderNo: 'S-7', processText: 'Boya' },
        { id: '2', noteNo: 'GB0911260036', senderDocNo: null, senderDocDate: null, sender: null, declaredTopCount: 2, customerOrderNo: null, processText: null },
      ],
    });
    expect(v.rows).toEqual([['Gelen Kg', '1200,5 kg']]);
    expect(v.sources).toEqual(['GB0911260035 · Evrak 12345 · 09.11.2026', 'GB0911260036']);
    expect(v.moreRows).toEqual([['Gönderen', 'Gönderen AŞ'], ['Müşteri Sipariş No', 'S-7'], ['İstenen İşlem', 'Boya'], ['Belgedeki Top', '5 top']]);
    expect(v.meters).toBeNull();
  });
  it('bir belgede top adedi yoksa toplam gösterilmez', () => {
    const v = incomingView({ ...base, notes: [{ id: '1', noteNo: 'A', declaredTopCount: 3 }, { id: '2', noteNo: 'B' }] });
    expect(v.moreRows.some(([k]) => k === 'Belgedeki Top')).toBe(false);
  });
});

describe('geliş biçimi (tek parça / top top)', () => {
  const inc = (arrivalForm: 'SINGLE_PIECE' | 'ROLLS' | undefined, rootCount?: number) => ({ meters: 241, kg: null, widthCm: null, customerBatchNo: null, itemText: null, colorText: null, notes: [], arrivalForm, rootCount, rootRollIds: ['root'] });
  it('arrivalText: Tek parça · N parti · N top; eski sunucu → null (satır yok)', () => {
    expect(arrivalText(inc('SINGLE_PIECE', 1))).toBe('Tek parça');
    expect(arrivalText(inc('SINGLE_PIECE', 2))).toBe('Tek parça · 2 parti');
    expect(arrivalText(inc('ROLLS', 3))).toBe('3 top');
    expect(arrivalText(inc(undefined, 1))).toBeNull();
    expect(arrivalText(null)).toBeNull();
  });
  it('⭐ tek parçada Bağlı Toplar açıklaması metreyle; top topta yok', () => {
    expect(singlePieceNote(inc('SINGLE_PIECE', 1))).toBe('Tek parça müşteri kumaşı · 241 m — üretimde top olarak çıkacak');
    expect(singlePieceNote(inc('ROLLS', 2))).toBeNull();
    expect(singlePieceNote(null)).toBeNull();
  });
  it('⭐ tek parçada kök top listeden düşer; top topta liste aynen kalır', () => {
    const rolls = [{ id: 'root' }, { id: 'child' }];
    expect(visibleAttachedRolls(rolls, inc('SINGLE_PIECE', 1))).toEqual([{ id: 'child' }]);
    expect(visibleAttachedRolls(rolls, inc('ROLLS', 1))).toEqual(rolls);
    expect(visibleAttachedRolls(rolls, null)).toEqual(rolls);
  });
});

describe('targetRows', () => {
  const base = { propertyNames: [] as string[], fmtDate };
  it('"—" satırı üretmez', () => {
    const rows = targetRows({ ...base, wo: wo({ targetItem: { name: 'Tül' } as never }) });
    expect(rows).toEqual([['Ürün', 'Tül'], ['Renk', 'Renksiz / Ham']]);
    expect(rows.some(([, v]) => v === '—')).toBe(false);
  });
  it('gramaj, özellik, metraj, kg, termin, sipariş görünür', () => {
    const rows = targetRows({
      ...base,
      propertyNames: ['Pamuk'],
      wo: wo({
        width: 280, foldType: '2-KAT', targetQuantity: 1000.4, targetWeight: 80,
        plannedEndDate: '2026-12-01',
        targetValues: [{ property: { name: 'Kurşun Gramajı' }, value: { name: '45 gr' } }],
        orderLinks: [{ orderLine: { order: { orderNumber: 'SP-9' } } }] as never,
      }),
    });
    const map = Object.fromEntries(rows);
    expect(map['En']).toBe('280 cm');
    expect(map['Kurşun Gramajı']).toBe('45 gr');
    expect(map['Üretim Özelliği']).toBe('Pamuk');
    expect(map['Hedef Metraj']).toBe('1000 m');
    expect(map['Hedef Kg']).toBe('80 kg');
    expect(map['Planlı Termin']).toBe('D(2026-12-01)');
    expect(map['Sipariş']).toBe('SP-9');
  });
});

describe('summaryItems', () => {
  it('müşteri, parti, top özeti ve oluşturanı tek şeritte verir', () => {
    const items = summaryItems({
      wo: wo({ customer: { id: 'c', name: 'Kader' }, batches: [{ id: 'b', batchNumber: 'P01' }], createdBy: { id: 'u', fullName: 'Ayşe' }, inputRolls: { count: 3, totalMeters: 450 } }),
      typeLabel: 'Fason', statusLabel: 'Devam', rollCount: 0, rollMeters: 0, fmtDate,
    });
    expect(items).toEqual([
      ['Müşteri', 'Kader'], ['Bizim Parti', 'P01'], ['Tür', 'Fason'], ['Top', '3 top · 450 m'], ['Oluşturma', 'D(2026-11-09) · Ayşe'],
    ]);
  });
  it('⭐ tek parça müşteri kumaşında "N top" yazılmaz', () => {
    const items = summaryItems({ wo: wo({ inputRolls: { count: 1, totalMeters: 241 } }), typeLabel: '', rollCount: 0, rollMeters: 0, fmtDate, singlePiece: true });
    expect(items.some(([k]) => k === 'Top')).toBe(false);
  });
  it('inputRolls yoksa bağlı toplardan sayar; müşteri yoksa atlar', () => {
    const items = summaryItems({ wo: wo(), typeLabel: '', statusLabel: '', rollCount: 2, rollMeters: 99.6, fmtDate });
    expect(items).toEqual([['Top', '2 top · 100 m'], ['Oluşturma', 'D(2026-11-09)']]);
  });
});

describe('routeChips', () => {
  it('sıraya göre çip', () => {
    const chips = routeChips([
      { id: 'b', stepSequence: 2, status: 'PENDING', station: { name: 'TAMBUR' } },
      { id: 'a', stepSequence: 1, status: 'IN_PROGRESS', station: { name: 'KURŞUN' } },
    ] as never);
    expect(chips.map((c) => c.name)).toEqual(['KURŞUN', 'TAMBUR']);
  });
});

describe('stepTone / rota rozeti', () => {
  it('durum renkleri', () => {
    expect(stepTone('ACTIVE', false)).toBe('info');
    expect(stepTone('ACTIVE', true)).toBe('warning');
    expect(stepTone('PENDING', false)).toBe('neutral');
    expect(stepTone('COMPLETED', false)).toBe('success');
  });
  it('fason dışarıda ve konum', () => {
    const [a, b] = routeChips([
      { id: 'a', stepSequence: 1, status: 'ACTIVE', station: { name: 'BOYA', type: 'EXTERNAL' } },
      { id: 'b', stepSequence: 2, status: 'PENDING', station: { name: 'KURŞUN', type: 'INTERNAL' } },
    ] as never);
    expect(a).toMatchObject({ outside: true, tone: 'warning', where: 'Fason (dış)' });
    expect(b).toMatchObject({ outside: false, tone: 'neutral', where: 'Fabrika içi' });
  });
});

describe('stripDeviceId / fmtNum', () => {
  it('cihaz uuid parçasını siler', () => {
    expect(stripDeviceId('TAMBUR okutması (cihaz e795d09e-aaaa-bbbb)')).toBe('TAMBUR okutması');
    expect(stripDeviceId('(cihaz x)')).toBeNull();
    expect(stripDeviceId(null)).toBeNull();
  });
  it('Türkçe ondalık', () => expect(fmtNum(12.34)).toBe('12,3'));
});

describe('shortPropertyLabel', () => {
  it('adım adı atılır, tamlama eki düşer (veri-bağımsız)', () => {
    expect(shortPropertyLabel('KURŞUN GRAMAJI', 'KURŞUN')).toBe('Gramaj');
    expect(shortPropertyLabel('Kurşun Gramajı', 'KURSUN')).toBe('Gramaj');
  });
  it('eşleşmezse ya da kelime sınırı yoksa adı olduğu gibi bırakır', () => {
    expect(shortPropertyLabel('KURŞUN GRAMAJI', 'TAMBUR')).toBe('KURŞUN GRAMAJI');
    expect(shortPropertyLabel('KURŞUNLU', 'KURŞUN')).toBe('KURŞUNLU');
    expect(shortPropertyLabel('KURŞUN', 'KURŞUN')).toBe('KURŞUN');
  });
});

/** targetView vakalarının ortak rota/değer kurgusu (iki describe paylaşır). */
const targetFx = () => {
  const base = { propertyNames: [] as string[], fmtDate };
  const allow = { color: true, width: true, gramaj: true };
  const steps = [
    { id: 's1', stepSequence: 1, status: 'PENDING', station: { name: 'KURŞUN', kind: 'PROCESS_QC', propertyCapabilities: [{ propertyId: 'kursun' }] } },
    { id: 's2', stepSequence: 2, status: 'PENDING', station: { name: 'TAMBUR', kind: 'TAMBUR', propertyCapabilities: [] } },
  ];
  // Adım eşlemesi SUNUCUDAN (`edit.stepId`, yazma kapısıyla aynı fonksiyon) — istemci yetenek listesinden eşleme yapmaz.
  const gramajTv = { propertyId: 'gr', property: { name: 'KURŞUN GRAMAJI', variantOfPropertyId: 'kursun' }, value: { name: '50 gr' }, edit: { stepId: 's1', locked: false } };
  const w = (o: Partial<WorkOrder> = {}) => wo({ width: 280, foldType: '4-KAT', steps: steps as never, targetValues: [gramajTv], ...o });
  return { base, allow, steps, gramajTv, w };
};

describe('targetView adım eşlemesi ve kalemler', () => {
  const { base, allow, steps, gramajTv, w } = targetFx();

  it('gramaj sunucunun eşlediği KURŞUN adımına, kat tipi TAMBUR adımına düşer; Hedef kartından kalkar', () => {
    const v = targetView({ ...base, wo: w(), gramajPropertyId: 'gr', fixAllowed: allow });
    expect(v.byStep).toEqual({ s1: [{ label: 'Gramaj', value: '50 gr', fix: 'gramaj' }], s2: [{ label: '', value: '4-KAT', fix: null }] });
    const labels = v.rows.map(([k]) => k);
    expect(labels).not.toContain('Kat Tipi');
    expect(labels).not.toContain('KURŞUN GRAMAJI');
    expect(labels).not.toContain('Gramaj');
    expect(v.fixByLabel).toEqual({ Renk: 'color', En: 'width' });
  });
  it('istemci yetenek listesinden eşleme İCAT ETMEZ: `edit` yoksa (eski sunucu) değer Hedef kartında kalır', () => {
    const v0 = targetView({ ...base, wo: w({ targetValues: [{ ...gramajTv, edit: undefined }] }), gramajPropertyId: 'gr', fixAllowed: allow });
    expect(v0.byStep.s1).toBeUndefined();
    expect(v0.fixByLabel['KURŞUN GRAMAJI']).toBe('gramaj');
  });
  it('eşleme bilgisi yoksa (eski sunucu) değerler Hedef kartında kalır, kalem satırda', () => {
    const v = targetView({ ...base, wo: w({ steps: [] }), gramajPropertyId: 'gr', fixAllowed: allow });
    expect(v.byStep).toEqual({});
    expect(v.rows).toContainEqual(['Kat Tipi', '4-KAT']);
    expect(v.rows).toContainEqual(['KURŞUN GRAMAJI', '50 gr']);
    expect(v.fixByLabel['KURŞUN GRAMAJI']).toBe('gramaj');
  });
  it('izin yoksa kalem yok; gramaj izinli ama değer yoksa "Belirtilmedi" satırı kalemle açılır', () => {
    expect(targetView({ ...base, wo: w(), gramajPropertyId: 'gr' }).fixByLabel).toEqual({});
    const v = targetView({ ...base, wo: w({ targetValues: [] }), gramajPropertyId: 'gr', fixAllowed: allow });
    expect(v.rows).toContainEqual(['Gramaj', 'Belirtilmedi']);
    expect(v.fixByLabel.Gramaj).toBe('gramaj');
  });
  it('gramaj izinsizse (canGramaj yok) adım altı kalemsizdir', () => {
    const v = targetView({ ...base, wo: w(), gramajPropertyId: 'gr', fixAllowed: { ...allow, gramaj: false } });
    expect(v.byStep.s1[0].fix).toBeNull();
  });
  it('kat tipi düzeltme izinliyse ve Tambur başlamadıysa TAMBUR adımı altında kalemlidir', () => {
    const v = targetView({ ...base, wo: w(), gramajPropertyId: 'gr', fixAllowed: { ...allow, fold: true } });
    expect(v.byStep.s2).toEqual([{ label: '', value: '4-KAT', fix: 'fold' }]);
  });
  it('Tambur adımı başladıysa kat kilitli (sunucu kilidi aynası) → kalemsiz düz metin', () => {
    const started = [steps[0], { ...steps[1], status: 'ACTIVE' }];
    expect(foldLocked(started as never)).toBe(true);
    expect(foldLocked(steps as never)).toBe(false);
    expect(foldLocked([] as never)).toBe(false);
    const v = targetView({ ...base, wo: w({ steps: started as never }), gramajPropertyId: 'gr', fixAllowed: { ...allow, fold: true } });
    expect(v.byStep.s2).toEqual([{ label: '', value: '4-KAT', fix: null }]);
  });
});

describe('targetView kat ve desen kalemleri', () => {
  const { base, allow, steps, gramajTv, w } = targetFx();

  it('kat boşsa ve izinliyse TAMBUR altında "Kat Belirtilmedi" kalemle açılır; izinsizse hiç çıkmaz', () => {
    const v = targetView({ ...base, wo: w({ foldType: null }), gramajPropertyId: 'gr', fixAllowed: { ...allow, fold: true } });
    expect(v.byStep.s2).toEqual([{ label: 'Kat', value: 'Belirtilmedi', fix: 'fold' }]);
    expect(targetView({ ...base, wo: w({ foldType: null }), gramajPropertyId: 'gr', fixAllowed: allow }).byStep.s2).toBeUndefined();
  });
  describe('kurşun dışı hedef değer (Hedef değeri değiştir)', () => {
    const steps3 = [...steps, { id: 's3', stepSequence: 3, status: 'PENDING', station: { name: 'BRODE', kind: 'PROCESS_QC', propertyCapabilities: [] } }];
    const desen = (edit: { stepId: string | null; locked: boolean } | undefined, values = [{ id: 'z', name: 'Zebra' }, { id: 'j', name: 'Jasmin' }]) =>
      ({ propertyId: 'ds', valueId: 'z', property: { name: 'BRODE DESENİ', variantOfPropertyId: 'brode', values }, value: { name: 'Zebra' }, edit });
    const tv = (d: ReturnType<typeof desen>) => w({ steps: steps3 as never, targetValues: [gramajTv, d] });
    it('⭐ adımı başlamamış (locked=false) → adım altında kalemli, özellik kimliğiyle', () => {
      const v = targetView({ ...base, wo: tv(desen({ stepId: 's3', locked: false })), gramajPropertyId: 'gr', fixAllowed: { ...allow, target: true } });
      expect(v.byStep.s3).toEqual([{ label: 'Desen', value: 'Zebra', fix: 'target', propertyId: 'ds' }]);
    });
    it('⭐ adımı başlamış (locked=true) → düz metin', () => {
      const v = targetView({ ...base, wo: tv(desen({ stepId: 's3', locked: true })), gramajPropertyId: 'gr', fixAllowed: { ...allow, target: true } });
      expect(v.byStep.s3).toEqual([{ label: 'Desen', value: 'Zebra', fix: null }]);
    });
    it('izin yok · seçenek yok · eski sunucu (edit yok) → kalemsiz', () => {
      expect(targetView({ ...base, wo: tv(desen({ stepId: 's3', locked: false })), gramajPropertyId: 'gr', fixAllowed: allow }).byStep.s3[0].fix).toBeNull();
      expect(targetView({ ...base, wo: tv(desen({ stepId: 's3', locked: false }, [])), gramajPropertyId: 'gr', fixAllowed: { ...allow, target: true } }).byStep.s3[0].fix).toBeNull();
      const old = targetView({ ...base, wo: tv(desen(undefined)), gramajPropertyId: 'gr', fixAllowed: { ...allow, target: true } });
      expect(old.fixByLabel['BRODE DESENİ']).toBeUndefined();
      expect(old.rows).toContainEqual(['BRODE DESENİ', 'Zebra']);
    });
    it('adımı eşlenemeyen kilitsiz değer Hedef kartında kalemli; özelliği targetByLabel taşır', () => {
      const v = targetView({ ...base, wo: tv(desen({ stepId: null, locked: false })), gramajPropertyId: 'gr', fixAllowed: { ...allow, target: true } });
      expect(v.fixByLabel['BRODE DESENİ']).toBe('target');
      expect(v.targetByLabel['BRODE DESENİ']).toBe('ds');
    });
  });
  it('rotada Tambur yoksa kat Hedef kartında, izinliyse kalemli satır', () => {
    const v = targetView({ ...base, wo: w({ steps: [] }), gramajPropertyId: 'gr', fixAllowed: { ...allow, fold: true } });
    expect(v.fixByLabel['Kat Tipi']).toBe('fold');
  });
});

describe('actionPlacement', () => {
  const on = { canFix: true, canCancel: true, isFason: false, hasOrderLinks: false };
  it('yetkili: hepsi yerinde (Belgeler başlık çubuğunda, burada karar yok)', () => {
    expect(actionPlacement(on)).toEqual({ reprint: true, detach: true, addBatch: true, orderLink: true, cancel: true });
  });
  it('fason İE ve bağlı sipariş yoksa Sipariş Bağla gizli; bağlıysa görünür', () => {
    expect(actionPlacement({ ...on, isFason: true }).orderLink).toBe(false);
    expect(actionPlacement({ ...on, isFason: true, hasOrderLinks: true }).orderLink).toBe(true);
  });
  it('düzeltme yetkisi yoksa düzeltme eylemleri yok', () => {
    expect(actionPlacement({ ...on, canFix: false, canCancel: false })).toEqual({ reprint: false, detach: false, addBatch: false, orderLink: false, cancel: false });
  });
});
