// K30-D alan kataloğu (saf): zorunlular kilitli, bilinmeyen anahtar atılır, blob birleştirme diğer anahtarları korur,
// gizli alan belgeden dolunca üste çıkar, koşullu alanlar yalnız koşulunda sayılır.
import { initialFormState } from './woForm';
import {
  WO_FIELDS,
  docFilledFields,
  fieldApplicable,
  isRequiredField,
  mergePrefBlob,
  otherFields,
  parseHidden,
  placement,
  selectorSections,
  toggleHidden,
  valuedFields,
  type FieldContext,
} from './woFieldCatalog';

const ctx: FieldContext = { showQuantity: true, hasTambur: true, hasKursun: true, hasRouteSteps: true, hasMachine: true };
const noDoc = { docShown: [], suggestions: {}, docText: { desen: null, renk: null } };

describe('woFieldCatalog', () => {
  it('zorunlu ve kilitli dört alan: Müşteri, Rota, Parti no, Kurşun metresi', () => {
    expect(WO_FIELDS.filter((f) => f.required).map((f) => f.key).sort()).toEqual(['kursunMetresi', 'musteri', 'partiNo', 'rota']);
    expect(new Set(WO_FIELDS.map((f) => f.key)).size).toBe(WO_FIELDS.length);
  });

  it('dilim 2 alanları (adımlar, makine, hedef özellik) ⚙ listesinde; iş emri türü formda sorulmaz (bağdan türer)', () => {
    const listed = selectorSections().flatMap((s) => s.fields.map((f) => f.key));
    expect(listed).not.toContain('isEmriTuru');
    for (const k of ['hedefOzellik', 'makine', 'rotaAdimlari'] as const) {
      expect(WO_FIELDS.find((f) => f.key === k)?.planned).toBeUndefined();
      expect(listed).toContain(k);
    }
    expect(listed).toContain('en');
    expect(selectorSections().map((s) => s.section)).toEqual(['Belge', 'Üretim', 'Plan']);
  });

  it('parseHidden: dizi değilse boş; bilinmeyen, zorunlu ve tekrar atılır', () => {
    expect(parseHidden(null)).toEqual([]);
    expect(parseHidden({ tabletIeForm: 'x' })).toEqual([]);
    expect(parseHidden({ tabletIeForm: { gizli: 'en' } })).toEqual([]);
    expect(parseHidden({ tabletIeForm: { gizli: ['en', 'rota', 'yok', 7, 'en', 'not'] } })).toEqual(['en', 'not']);
  });

  it('mergePrefBlob: blob\'un diğer anahtarları ve tabletIeForm alt anahtarları korunur; zorunlu yazılmaz', () => {
    const blob = { theme: 'dark', workOrders: { subcontractorDefault: 'lastUsed' }, tabletIeForm: { gizli: ['not'], baska: 1 } };
    const out = mergePrefBlob(blob, ['en', 'musteri', 'en']);
    expect(out).toEqual({ theme: 'dark', workOrders: { subcontractorDefault: 'lastUsed' }, tabletIeForm: { gizli: ['en'], baska: 1 } });
    expect(blob.tabletIeForm.gizli).toEqual(['not']);
    expect(mergePrefBlob(null, [])).toEqual({ tabletIeForm: { gizli: [] } });
  });

  it('toggleHidden: zorunlu kapatılamaz; diğerleri aç/kapa', () => {
    expect(toggleHidden([], 'rota')).toEqual([]);
    expect(isRequiredField('kursunMetresi')).toBe(true);
    expect(toggleHidden([], 'en')).toEqual(['en']);
    expect(toggleHidden(['en', 'not'], 'en')).toEqual(['not']);
  });

  it('placement: gizli → diğer; belgeden dolan gizli → üst; zorunlu hep üst', () => {
    expect(placement('en', [], [])).toBe('top');
    expect(placement('en', ['en'], [])).toBe('other');
    expect(placement('en', ['en'], ['en'])).toBe('top');
    expect(placement('rota', ['rota' as never], [])).toBe('top');
  });

  it('docFilledFields: rozetli alanlar + belgede yazan desen/renk', () => {
    expect(docFilledFields(noDoc)).toEqual([]);
    expect(docFilledFields({ docShown: ['width', 'note'], suggestions: { targetColor: { id: 'c', name: 'Ekru' } }, docText: { desen: 'D-1', renk: null } }).sort()).toEqual(
      ['en', 'hedefKumas', 'hedefRenk', 'not'].sort(),
    );
  });

  it('koşullu alanlar: metraj/kg bayrakla, kat tipi tamburla, gramaj/makine kurşunla, adımlar rotayla', () => {
    const off: FieldContext = { showQuantity: false, hasTambur: false, hasKursun: false, hasRouteSteps: false };
    for (const k of ['hedefMetraj', 'hedefKg', 'katTipi', 'gramaj', 'makine', 'rotaAdimlari', 'hedefOzellik'] as const) {
      expect(fieldApplicable(k, off)).toBe(false);
      expect(fieldApplicable(k, ctx)).toBe(true);
    }
    expect(fieldApplicable('en', off)).toBe(true);
    // Makine kurşun adımından değil, o istasyonda makine olmasından: kurşun var + makine yok → çizilmez.
    expect(fieldApplicable('makine', { ...ctx, hasMachine: false })).toBe(false);
    // "Diğer alanlar (n)": koşulu tutmayan ve belgeden dolan gizli alan sayılmaz.
    expect(otherFields(['katTipi', 'en', 'not'], ['not'], off)).toEqual(['en']);
    expect(otherFields(['katTipi', 'en', 'not'], [], ctx)).toEqual(['en', 'katTipi', 'not']);
  });

  it('valuedFields: yalnız kullanıcının doldurduğu/değiştirdiği (gövdeye gidecek) alanlar', () => {
    const e = initialFormState().extras;
    expect(valuedFields(e, { stepsEdited: false })).toEqual([]);
    expect(valuedFields({ ...e, foldType: 'A' }, { stepsEdited: false })).toEqual([]);
    expect(
      valuedFields({ ...e, woType: 'CUSTOMER_GOODS_SERVICE', propertyIds: [], machineId: null, width: '150', note: ' ' }, { stepsEdited: true }).sort(),
    ).toEqual(['en', 'hedefOzellik', 'makine', 'rotaAdimlari'].sort());
  });
});
