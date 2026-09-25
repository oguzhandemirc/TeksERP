// Ürün kartı yaşam döngüsü — tablet saf katmanı (URUN-YASAM-DONGUSU.md §9).
import { itemLifecycleOf, lifecycleBadge, pickableLifecycle } from './item-lifecycle';

describe('pickableLifecycle', () => {
  it('⭐ sipariş kalemi yalnız "Serbest" ayarında Tükenene kadar kartı listeler', () => {
    expect(pickableLifecycle('order', undefined)).toBe('ACTIVE');
    expect(pickableLifecycle('order', { itemPhaseOutNewOrder: 'OKUTULAN_TOPLAR' })).toBe('ACTIVE');
    expect(pickableLifecycle('order', { itemPhaseOutNewOrder: 'SERBEST' })).toBe('ACTIVE,PHASE_OUT');
  });
  it('⭐ yeni üretim planı varsayılan açık, kapalıyken yalnız Aktif', () => {
    expect(pickableLifecycle('plan', undefined)).toBe('ACTIVE,PHASE_OUT');
    expect(pickableLifecycle('plan', { itemPhaseOutNewPlan: false })).toBe('ACTIVE');
  });
  it('⭐ belgesiz stok girişi (KK1) her ayarda yalnız Aktif', () => {
    expect(pickableLifecycle('stock', { itemPhaseOutNewOrder: 'SERBEST', itemPhaseOutNewPlan: true })).toBe('ACTIVE');
  });
});

describe('itemLifecycleOf / lifecycleBadge', () => {
  it('eski sunucu (lifecycleStatus yok) isActive\'ten türetilir', () => {
    expect(itemLifecycleOf({ isActive: true })).toBe('ACTIVE');
    expect(itemLifecycleOf({ isActive: false })).toBe('ARCHIVED');
    expect(itemLifecycleOf(null)).toBe('ACTIVE');
  });
  it('rozet yalnız Tükenene kadar kartta', () => {
    expect(lifecycleBadge({ lifecycleStatus: 'PHASE_OUT' }, '#b45309')).toEqual({ text: 'Tükenene kadar', color: '#b45309' });
    expect(lifecycleBadge({ lifecycleStatus: 'ACTIVE' }, '#b45309')).toBeUndefined();
  });
});
