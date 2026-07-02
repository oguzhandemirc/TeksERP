import { placesOfKind, suggestPlace } from './placeSuggest';
import type { LastPlace, SessionPlace } from '../../services/workSession.service';

const st = (id: string, kind: string, machines: Array<{ id: string; code: string; name: string }> = []): SessionPlace => ({
  id,
  code: id.toUpperCase(),
  name: `İstasyon ${id}`,
  kind,
  machines,
});
const m = (id: string) => ({ id, code: `MAK-${id}`, name: `Makine ${id}` });

describe('suggestPlace', () => {
  const places: SessionPlace[] = [
    st('tambur', 'TAMBUR', [m('t1')]),
    st('kk1', 'RAW_QC', [m('k1'), m('k2')]),
    st('sevk', 'SHIPPING', []),
  ];

  it('son yer ekran türüyle eşleşiyorsa onu önerir (source=last)', () => {
    const last: LastPlace = {
      machine: { ...m('t1'), isActive: true },
      station: { ...st('tambur', 'TAMBUR'), isActive: true },
    };
    const s = suggestPlace(last, places, 'TAMBUR');
    expect(s).toMatchObject({ machineId: 't1', source: 'last' });
  });

  it('son yer FARKLI türdeyse önermez, türde tek yer varsa onu önerir (source=single)', () => {
    const last: LastPlace = {
      machine: { ...m('k1'), isActive: true },
      station: { ...st('kk1', 'RAW_QC'), isActive: true },
    };
    const s = suggestPlace(last, places, 'TAMBUR');
    expect(s).toMatchObject({ machineId: 't1', source: 'single' });
  });

  it('türde tek istasyon + ÇOK makine → öneri yok (operatör seçer)', () => {
    expect(suggestPlace(null, places, 'RAW_QC')).toBeNull();
  });

  it('makinesiz istasyon (SHIPPING) → istasyon-oturumu önerisi (machineId null)', () => {
    const s = suggestPlace(null, places, 'SHIPPING');
    expect(s).toMatchObject({ stationId: 'sevk', machineId: null, source: 'single' });
  });

  it('pasif makine/istasyon önerilmez', () => {
    const last: LastPlace = {
      machine: { ...m('t1'), isActive: false },
      station: { ...st('tambur', 'TAMBUR'), isActive: true },
    };
    // pasif makine → last önerilmez ama türde tek yer (t1) 'single' olarak gelir
    const s = suggestPlace(last, places, 'TAMBUR');
    expect(s?.source).toBe('single');
    const lastStPassive: LastPlace = {
      machine: null,
      station: { ...st('sevk', 'SHIPPING'), isActive: false },
    };
    const s2 = suggestPlace(lastStPassive, places, 'SHIPPING');
    expect(s2?.source).toBe('single');
  });

  it('placesOfKind türe göre filtreler', () => {
    expect(placesOfKind(places, 'RAW_QC').map((p) => p.id)).toEqual(['kk1']);
  });
});
