import { detailColumns, incomingRows, targetRows, targetView, shortPropertyLabel, actionPlacement, summaryItems, routeChips, stepTone, stripDeviceId, fmtNum } from './workOrderDetailView';
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

describe('incomingRows', () => {
  it('incoming yoksa kart yok', () => {
    expect(incomingRows(null)).toEqual([]);
    expect(incomingRows(undefined)).toEqual([]);
  });
  it('dolu alanları sırayla verir, boşları atar', () => {
    const rows = incomingRows({ meters: 1200.5, kg: null, widthCm: 150, notes: [{ id: '1', noteNo: 'GB-1' }, { id: '2', noteNo: 'GB-2' }], customerBatchNo: 'M-7', itemText: 'Tül', colorText: null });
    expect(rows).toEqual([
      ['Belge No', 'GB-1, GB-2'],
      ['Müşteri Parti No', 'M-7'],
      ['Gelen Metre', '1200,5 m'],
      ['Gelen En', '150 cm'],
      ['Gelen Kumaş', 'Tül'],
    ]);
  });
});

describe('incomingRows belge başlığı', () => {
  it('evrak no, tarih, gönderen, sipariş no, işlem, top adedi; boşlar çizilmez', () => {
    const rows = incomingRows({
      meters: null, kg: null, widthCm: null, customerBatchNo: null, itemText: null, colorText: null,
      notes: [
        { id: '1', noteNo: 'GB0911260035', senderDocNo: '12345', senderDocDate: '2026-11-09T00:00:00.000Z', sender: 'Gönderen AŞ', declaredTopCount: 3, customerOrderNo: 'S-7', processText: 'Boya' },
        { id: '2', noteNo: 'GB0911260036', senderDocNo: '12346', senderDocDate: '2026-11-09T00:00:00.000Z', sender: null, declaredTopCount: 2, customerOrderNo: null, processText: null },
      ],
    });
    expect(rows).toEqual([
      ['Belge No', 'GB0911260035, GB0911260036'],
      ['Müşteri Evrak No', '12345, 12346'],
      ['Belge Tarihi', '09.11.2026'],
      ['Gönderen', 'Gönderen AŞ'],
      ['Müşteri Sipariş No', 'S-7'],
      ['İstenen İşlem', 'Boya'],
      ['Belgedeki Top', '5 top'],
    ]);
  });
  it('bir belgede top adedi yoksa toplam gösterilmez', () => {
    const rows = incomingRows({ meters: null, kg: null, widthCm: null, customerBatchNo: null, itemText: null, colorText: null, notes: [{ id: '1', noteNo: 'A', declaredTopCount: 3 }, { id: '2', noteNo: 'B' }] });
    expect(rows.some(([k]) => k === 'Belgedeki Top')).toBe(false);
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

describe('targetView adım eşlemesi ve kalemler', () => {
  const base = { propertyNames: [] as string[], fmtDate };
  const allow = { color: true, width: true, gramaj: true };
  const steps = [
    { id: 's1', stepSequence: 1, status: 'PENDING', station: { name: 'KURŞUN', kind: 'PROCESS_QC', propertyCapabilities: [{ propertyId: 'kursun' }] } },
    { id: 's2', stepSequence: 2, status: 'PENDING', station: { name: 'TAMBUR', kind: 'TAMBUR', propertyCapabilities: [] } },
  ];
  const w = (o: Partial<WorkOrder> = {}) => wo({ width: 280, foldType: '4-KAT', steps: steps as never, targetValues: [{ propertyId: 'gr', property: { name: 'KURŞUN GRAMAJI', variantOfPropertyId: 'kursun' }, value: { name: '50 gr' } }], ...o });

  it('gramaj KURŞUN adımına, kat tipi TAMBUR adımına düşer; Hedef kartından kalkar', () => {
    const v = targetView({ ...base, wo: w(), gramajPropertyId: 'gr', fixAllowed: allow });
    expect(v.byStep).toEqual({ s1: [{ label: 'Gramaj', value: '50 gr', fix: 'gramaj' }], s2: [{ label: '', value: '4-KAT', fix: null }] });
    const labels = v.rows.map(([k]) => k);
    expect(labels).not.toContain('Kat Tipi');
    expect(labels).not.toContain('KURŞUN GRAMAJI');
    expect(labels).not.toContain('Gramaj');
    expect(v.fixByLabel).toEqual({ Renk: 'color', En: 'width' });
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
});

describe('actionPlacement', () => {
  const on = { canFix: true, canCancel: true, isFason: false, hasOrderLinks: false, hasIncomingCard: true };
  it('yetkili: hepsi yerinde; belgeler Gelen kartında', () => {
    expect(actionPlacement(on)).toEqual({ reprint: true, detach: true, addBatch: true, orderLink: true, documents: 'incoming', cancel: true });
  });
  it('Gelen kartı yoksa belgeler özet şeridinde', () => {
    expect(actionPlacement({ ...on, hasIncomingCard: false }).documents).toBe('summary');
  });
  it('fason İE ve bağlı sipariş yoksa Sipariş Bağla gizli; bağlıysa görünür', () => {
    expect(actionPlacement({ ...on, isFason: true }).orderLink).toBe(false);
    expect(actionPlacement({ ...on, isFason: true, hasOrderLinks: true }).orderLink).toBe(true);
  });
  it('düzeltme yetkisi yoksa düzeltme eylemleri yok, belgeler kalır', () => {
    expect(actionPlacement({ ...on, canFix: false, canCancel: false })).toEqual({ reprint: false, detach: false, addBatch: false, orderLink: false, documents: 'incoming', cancel: false });
  });
});
