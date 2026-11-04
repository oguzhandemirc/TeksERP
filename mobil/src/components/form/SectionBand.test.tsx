// Bekçi: şerit başlık rolü taşır, sol çubuk tonun rengini alır, hap ancak durum verilince çizilir.
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SectionBand } from './SectionBand';
import { StatusPill } from './StatusPill';
import { colors } from '../../theme';
import { pillColors } from './tone';

const bg = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor;

describe('SectionBand', () => {
  it('başlık + aside + ton çubuğu + durum hapı', () => {
    render(<SectionBand title="Makine seç" icon="cog" tone="ok" aside="KURŞUN MAKİNESİ" status={{ text: '10' }} testID="s" />);
    expect(screen.getByTestId('s').props.accessibilityRole).toBe('header');
    expect(screen.getByText('Makine seç')).toBeTruthy();
    expect(screen.getByText('KURŞUN MAKİNESİ')).toBeTruthy();
    expect(bg('s-kenar')).toBe(colors.band.bar.ok);
    expect(screen.getByTestId('s-durum')).toBeTruthy();
    expect(bg('s')).toBe(colors.band.bg);
  });
  it('durum yoksa hap yok; varsayılan ton idle', () => {
    render(<SectionBand title="Hedef" icon="texture-box" testID="h" />);
    expect(screen.queryByTestId('h-durum')).toBeNull();
    expect(bg('h-kenar')).toBe(colors.band.bar.idle);
  });
  it('StatusPill tona göre renklenir', () => {
    render(<StatusPill tone="warn" text="eksik" testID="p" />);
    expect(bg('p')).toBe(pillColors('warn').bg);
    expect(pillColors('missing').fg).toBe(colors.dangerText);
  });
});
