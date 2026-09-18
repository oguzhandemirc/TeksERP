// =============================================================================
// useBeamForms — yerel doğrulama satırı (`formError`) YAPIŞMAZ (gerçek cihaz bulgusu 2026-09-18 03:12)
// =============================================================================
//   §1 doğrulama düşünce mesaj yazılır, mutate ÇAĞRILMAZ
//   §2 alan değişince (setWindForm / setPlanForm) mesaj DÜŞER — operatör kg'yi doldurunca kırmızı satır gider
//   §3 doğrulama geçince mesaj DÜŞER ve mutate çağrılır — sunucunun 409 toast'ıyla eski satır yan yana kalmaz
// Negatif sonda (2026-09-18, bir kezlik): `setWindForm` sarmalayıcısından `setFormError(null)` silindi → §2 ❌;
// `submitWind`deki `setFormError(null)` silindi → §3 ❌.
// =============================================================================
import { act, renderHook } from '@testing-library/react-native';
import { useBeamForms } from './useBeamForms';
import type { WarpBeam } from '../../../services/warpBeam.service';

const beam = { id: 'b1', beamNo: 'LV1', originKind: 'IN_HOUSE', plannedLengthM: 900, warpSpec: { id: 's1', code: 'C', name: 'N', endsCount: 100, yarnItem: { id: 'y', code: 'Y', name: 'Y', linearDensityDen: 150 } } } as unknown as WarpBeam;

function setup(
  lotRequired = false,
  { soleMachineId = null, lastWarpSpecId = null, soleWeavingOrderId = null, beamWeavingLinkRequired = false, lastWindDefaults = [] }: { soleMachineId?: string | null; lastWarpSpecId?: string | null; soleWeavingOrderId?: string | null; beamWeavingLinkRequired?: boolean; lastWindDefaults?: import('./beamPayload').WindDefault[] } = {},
) {
  const plan = { mutate: jest.fn() };
  const wind = { mutate: jest.fn() };
  const attemptRef = { current: null };
  const hook = renderHook(
    (p: { lotRequired: boolean }) =>
      useBeamForms({
        attemptRef,
        mutations: { plan, wind } as unknown as Parameters<typeof useBeamForms>[0]['mutations'],
        defaultWarehouseId: 'w1',
        open: () => {},
        current: { kind: 'wind', beam },
        lotRequired: p.lotRequired,
        soleMachineId,
        lastWindDefaults,
        lastWarpSpecId,
        soleWeavingOrderId,
        beamWeavingLinkRequired,
      }),
    { initialProps: { lotRequired } },
  );
  return { hook, plan, wind };
}

describe('useBeamForms formError', () => {
  it('§1 eksik kg → mesaj yazılır, mutate çağrılmaz', () => {
    const { hook, wind } = setup();
    act(() => hook.result.current.openWind(beam));
    act(() => hook.result.current.setWindForm({ ...hook.result.current.windForm!, machineId: 'm1' }));
    act(() => hook.result.current.submitWind());
    expect(hook.result.current.formError).toBe('İplik çıkışı: kg 0’dan büyük olmalı.');
    expect(wind.mutate).not.toHaveBeenCalled();
  });

  it('§2 ⭐ alan değişince mesaj düşer', () => {
    const { hook } = setup();
    act(() => hook.result.current.openWind(beam));
    act(() => hook.result.current.setWindForm({ ...hook.result.current.windForm!, machineId: 'm1' }));
    act(() => hook.result.current.submitWind());
    expect(hook.result.current.formError).not.toBeNull();
    const f = hook.result.current.windForm!;
    act(() => hook.result.current.setWindForm({ ...f, issues: [{ ...f.issues[0]!, qtyKg: '12' }] }));
    expect(hook.result.current.formError).toBeNull();
  });

  it('§3 ⭐ doğrulama geçince mesaj düşer ve mutate çağrılır — form DEĞİŞMEDEN (bağlam lotRequired düştü)', () => {
    const { hook, wind } = setup(true);
    act(() => hook.result.current.openWind(beam));
    const f0 = hook.result.current.windForm!;
    act(() => hook.result.current.setWindForm({ ...f0, machineId: 'm1', issues: [{ ...f0.issues[0]!, qtyKg: '12' }] }));
    act(() => hook.result.current.submitWind());
    expect(hook.result.current.formError).toBe('Lot zorunlu: her iplik çıkış satırında lot seçin.');
    // Alan değişimi YOK — yalnız bağlam yenilendi; §2 kolu devreye girmez, "geçince düşer" tek başına ölçülür.
    hook.rerender({ lotRequired: false });
    act(() => hook.result.current.submitWind());
    expect(hook.result.current.formError).toBeNull();
    expect(wind.mutate).toHaveBeenCalledTimes(1);
  });

  it('§4 ⭐ ön-seçim: tek makine SAR açılışında IN_HOUSE kökende ön-seçili, çoklu makinede null', () => {
    const { hook } = setup(false, { soleMachineId: 'm1' });
    act(() => hook.result.current.openWind(beam));
    expect(hook.result.current.windForm?.machineId).toBe('m1');
    const { hook: h2 } = setup(false, { soleMachineId: null });
    act(() => h2.result.current.openWind(beam));
    expect(h2.result.current.windForm?.machineId).toBeNull();
  });

  it('§4b ön-seçim: son çözgü kartı Plan açılışında ön-dolu, yoksa boş', () => {
    const { hook } = setup(false, { lastWarpSpecId: 's-son' });
    act(() => hook.result.current.openPlan());
    expect(hook.result.current.planForm.warpSpecId).toBe('s-son');
    const { hook: h2 } = setup(false, {});
    act(() => h2.result.current.openPlan());
    expect(h2.result.current.planForm.warpSpecId).toBeNull();
  });

  it('§4c ⭐ Z1: tek dokuma işi Plan açılışında ön-seçili; beamWeavingLinkRequired açıkken iş seçilmeden mutate ÇAĞRILMAZ', () => {
    const { hook } = setup(false, { soleWeavingOrderId: 'wo1' });
    act(() => hook.result.current.openPlan());
    expect(hook.result.current.planForm.weavingOrderId).toBe('wo1');

    // Zorunlu + iş yok → submitPlan hata verir, mutate yok.
    const { hook: h2, plan } = setup(false, { beamWeavingLinkRequired: true });
    act(() => h2.result.current.openPlan());
    act(() => h2.result.current.setPlanForm({ ...h2.result.current.planForm, warpSpecId: 's1', plannedLengthM: '500' }));
    act(() => h2.result.current.submitPlan());
    expect(h2.result.current.formError).toMatch(/dokuma işine bağlanmalı/);
    expect(plan.mutate).not.toHaveBeenCalled();
    // İş seçilince geçer.
    act(() => h2.result.current.setPlanForm({ ...h2.result.current.planForm, weavingOrderId: 'wo9' }));
    act(() => h2.result.current.submitPlan());
    expect(plan.mutate).toHaveBeenCalledTimes(1);
  });

  it('§3b plan tarafı aynı sözleşme: hata → alan değişimi düşürür → geçince mutate', () => {
    const { hook, plan } = setup();
    act(() => hook.result.current.submitPlan());
    expect(hook.result.current.formError).toBe('Çözgü kartı seçin.');
    act(() => hook.result.current.setPlanForm({ ...hook.result.current.planForm, warpSpecId: 's1' }));
    expect(hook.result.current.formError).toBeNull();
    act(() => hook.result.current.setPlanForm({ ...hook.result.current.planForm, plannedLengthM: '1200' }));
    act(() => hook.result.current.submitPlan());
    expect(hook.result.current.formError).toBeNull();
    expect(plan.mutate).toHaveBeenCalledTimes(1);
  });
});

describe('useBeamForms — Z5 SAR ön-dolgu (lastWindDefaults)', () => {
  it('§5 ⭐ kartın son sarım önerisi makine + iplik satırlarını doldurur (öneri makinesi soleMachineId’i yener); kart eşleşmezse taban+soleMachineId', () => {
    const def = { warpSpecId: 's1', machineId: 'm9', yarnIssues: [{ warehouseId: 'w9', lotId: 'l9', qtyKg: 12.5 }, { warehouseId: 'w8', lotId: null, qtyKg: 3 }], yarnReturns: [{ warehouseId: 'w9', lotId: 'l9', qtyKg: 1, reasonCode: 'DIP' }] };
    const { hook } = setup(false, { soleMachineId: 'm1', lastWindDefaults: [def] });
    act(() => hook.result.current.openWind(beam));
    const f = hook.result.current.windForm!;
    expect(f.machineId).toBe('m9'); // öneri makinesi, soleMachineId 'm1' DEĞİL
    expect(f.issues.map((l) => [l.warehouseId, l.lotId, l.qtyKg])).toEqual([['w9', 'l9', ''], ['w8', null, '']]); // depo+lot dolu, kg BOŞ
    expect(f.returns).toHaveLength(0); // dip iadesi ön-doldurulmaz
    // Kart eşleşmezse öneri yok → taban tek boş çıkış + soleMachineId.
    const { hook: h2 } = setup(false, { soleMachineId: 'm1', lastWindDefaults: [{ ...def, warpSpecId: 's-baska' }] });
    act(() => h2.result.current.openWind(beam)); // beam.warpSpec.id 's1' ≠ 's-baska'
    const g = h2.result.current.windForm!;
    expect([g.machineId, g.issues.length, g.issues[0]!.qtyKg, g.returns.length]).toEqual(['m1', 1, '', 0]);
  });
});
