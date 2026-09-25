import {
  blockingForStep,
  collectQuickWoIssues,
  parsePositiveNumber,
  summarizeMissing,
  type QuickWoIssueInput,
} from './quickWorkOrderIssues';

const base: QuickWoIssueInput = {
  rollCount: 3,
  routeTemplateId: 'r1',
  hasTambur: true,
  foldType: '2-KAT',
  foldNotConfigured: false,
  applyMissing: null,
  width: '150',
  canApplyColor: true,
  hasColor: true,
  orderLinked: true,
};

const fields = (i: Partial<QuickWoIssueInput>) =>
  collectQuickWoIssues({ ...base, ...i }).blocking.map((b) => b.field);

describe('collectQuickWoIssues — engeller', () => {
  it('tam form engelsiz ve boş alansız', () => {
    expect(collectQuickWoIssues(base)).toEqual({ blocking: [], empty: [] });
  });

  it("Tambur'suz rotada kat tipi İSTENMEZ (2. adım kilidi hatası)", () => {
    expect(fields({ hasTambur: false, foldType: null })).toEqual([]);
  });

  it("Tambur'lu rotada kat tipi boşsa engel, katalog yoksa panel yönlendirmesi", () => {
    expect(fields({ foldType: null })).toEqual(['fold']);
    const r = collectQuickWoIssues({ ...base, foldType: null, foldNotConfigured: true });
    expect(r.blocking[0].message).toMatch(/panelden/);
  });

  it('rota yokken kat ayrıca sorulmaz (tek eksik: rota)', () => {
    expect(fields({ routeTemplateId: null, foldType: null })).toEqual(['route']);
  });

  it('geçersiz en SESSİZ düşmez — engel olur; boş en engel değildir', () => {
    expect(fields({ width: 'abc' })).toEqual(['width']);
    expect(fields({ width: '0' })).toEqual(['width']);
    expect(fields({ width: '-5' })).toEqual(['width']);
    expect(fields({ width: '150,5' })).toEqual([]);
    expect(fields({ width: '  ' })).toEqual([]);
  });

  it('top yoksa 1. adımın engeli', () => {
    const r = collectQuickWoIssues({ ...base, rollCount: 0 });
    expect(r.blocking.map((b) => [b.field, b.step])).toEqual([['rolls', 0]]);
  });

  it('rota renk uygulayamıyorsa engel', () => {
    expect(fields({ applyMissing: 'renk veren (boyahane)' })).toEqual(['routeApply']);
  });
});

describe('collectQuickWoIssues — boş bırakılanlar (engel değil)', () => {
  const empty = (i: Partial<QuickWoIssueInput>) =>
    collectQuickWoIssues({ ...base, ...i }).empty.map((e) => e.field);

  it('en, renk, sipariş boşsa üçü de listelenir', () => {
    expect(empty({ width: '', hasColor: false, orderLinked: false })).toEqual(['width', 'color', 'order']);
  });

  it('rota renk vermiyorsa renk boşluğu sorulmaz', () => {
    expect(empty({ canApplyColor: false, hasColor: false })).toEqual([]);
  });

  it('boş alanlar engele dönüşmez', () => {
    const r = collectQuickWoIssues({ ...base, width: '', hasColor: false, orderLinked: false });
    expect(r.blocking).toEqual([]);
  });
});

describe('blockingForStep / summarizeMissing', () => {
  const all = collectQuickWoIssues({ ...base, rollCount: 0, routeTemplateId: null }).blocking;

  it('ara adım yalnız kendi engelini görür, son adım hepsini', () => {
    expect(blockingForStep(all, 0, 2).map((b) => b.field)).toEqual(['rolls']);
    expect(blockingForStep(all, 1, 2).map((b) => b.field)).toEqual(['route']);
    expect(blockingForStep(all, 2, 2).map((b) => b.field)).toEqual(['rolls', 'route']);
  });

  it('tek satır özet, tekrar eden kısa ad bir kez', () => {
    expect(summarizeMissing(all)).toBe('Eksik: Top · Rota');
    const twoRoute = collectQuickWoIssues({ ...base, routeTemplateId: null, applyMissing: 'x' }).blocking;
    expect(summarizeMissing(twoRoute)).toBe('Eksik: Rota');
    expect(summarizeMissing([])).toBeNull();
  });
});

describe('parsePositiveNumber', () => {
  it('virgül ve nokta ondalık kabul, çöp ve sıfır red', () => {
    expect(parsePositiveNumber('150')).toBe(150);
    expect(parsePositiveNumber('150,5')).toBe(150.5);
    expect(parsePositiveNumber('150.5')).toBe(150.5);
    expect(parsePositiveNumber('150abc')).toBeNull();
    expect(parsePositiveNumber('0')).toBeNull();
    expect(parsePositiveNumber('')).toBeNull();
  });
});
