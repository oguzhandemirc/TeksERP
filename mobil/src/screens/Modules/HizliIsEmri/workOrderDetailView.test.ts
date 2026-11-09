import { detailColumns, incomingRows, targetRows, summaryItems, routeChips, stepTone, stripDeviceId, fmtNum } from './workOrderDetailView';
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
