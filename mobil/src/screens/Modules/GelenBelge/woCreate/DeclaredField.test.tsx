// Beyan kutusu (gelen metre / kg / en · müşteri / bizim parti no) — kutular aynı satırda EŞİT YÜKSEKLİKTE: değer, boş metin ve
// salt okunur metin aynı tipografi + TEK SATIR; kırmızı (eksik) yalnız renk ve kenar, boyut büyütmez; satır `stretch`.
import React from 'react';
import { StyleSheet } from 'react-native';
import { renderWithPaper } from '../../../../test/render';
import { DECLARED_BOX_HEIGHT, DeclaredField, declaredLayout } from './DeclaredField';

type Flat = { fontSize?: number; fontWeight?: string; color?: string; minHeight?: number; alignItems?: string };
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Flat;

describe('DeclaredField — eşit yükseklik, tek satır', () => {
  it('⭐ dolu, boş-zorunlu (kırmızı) ve salt okunur değer aynı yazı boyutunda ve tek satırda', () => {
    const ui = renderWithPaper(
      <>
        <DeclaredField label="Gelen metre" value={null} missing emptyText="Yok — dokunun" onPress={() => {}} testID="m" />
        <DeclaredField label="Gelen kg" value="1.250" unit="kg" fromDoc onPress={() => {}} testID="k" />
        <DeclaredField label="Bizim parti no" value="Otomatik · P001" testID="b" />
      </>,
    );
    const vals = ['m', 'k', 'b'].map((id) => ui.getByTestId(`${id}-deger`));
    for (const v of vals) {
      expect(v.props.numberOfLines).toBe(1);
      expect(flat(v).fontSize).toBe(flat(vals[1]).fontSize);
      expect(flat(v).fontWeight).toBe(flat(vals[1]).fontWeight);
    }
    expect(flat(vals[0]).fontSize).toBeGreaterThanOrEqual(20);
    expect(flat(vals[0]).color).not.toBe(flat(vals[1]).color);
  });

  it('⭐ her kutu aynı minimum yükseklikte (≥56dp) ve satır kutuları esnetir', () => {
    const ui = renderWithPaper(
      <>
        <DeclaredField label="Gelen metre" value={null} missing onPress={() => {}} testID="m" />
        <DeclaredField label="Müşteri parti no" value="A-12" testID="c" />
      </>,
    );
    for (const id of ['m', 'c']) expect(flat(ui.getByTestId(id)).minHeight).toBe(DECLARED_BOX_HEIGHT);
    expect(DECLARED_BOX_HEIGHT).toBeGreaterThanOrEqual(56);
    expect(StyleSheet.flatten(declaredLayout.row).alignItems).toBe('stretch');
  });
});
