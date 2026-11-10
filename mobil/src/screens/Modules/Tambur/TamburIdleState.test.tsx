// İş yokken Tambur tableti (2026-11-11): tam ekran tek boş durum — silik ikon + "Kart veya belge okutun"; sütun, tuş
// takımı, "Henüz açık iş yok" yok. Ekran yerleşimi kaynak taramasıyla: boş durumda iki sütun da (NumpadHost sağda) çizilmez.
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderWithPaper } from '../../../test/render';
import TamburIdleState, { TAMBUR_IDLE_TEXT, TAMBUR_PICK_ROLL_TEXT } from './TamburIdleState';

describe('TamburIdleState', () => {
  it('tek cümle, başka metin ve tuş yok', () => {
    const r = renderWithPaper(<TamburIdleState />);
    expect(TAMBUR_IDLE_TEXT).toBe('Kart veya belge okutun');
    expect(r.getByText('Kart veya belge okutun')).toBeTruthy();
    expect(r.queryByText('Henüz açık iş yok')).toBeNull();
    expect(r.queryByText('Kart açılmadı')).toBeNull();
    expect(r.queryByText('1')).toBeNull();
    expect(r.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('TamburScreen boş durum yerleşimi', () => {
  const src = fs.readFileSync(path.join(__dirname, 'TamburScreen.tsx'), 'utf8');
  it('iş yokken boş durum çizilir, sol form ve sağ sütun (tuş takımı) çizilmez', () => {
    expect(src).toMatch(/const idleFull = !compact && !manualMode && !\(recutResolvedRollId && recutRollMeta\) && !activeJob;/);
    expect(src).toContain('{idleFull && <TamburIdleState />}');
    expect(src).toContain('{!idleFull && (\n        <View style={[styles.formCol');
    const right = src.indexOf('{!compact && !idleFull && (');
    const host = src.indexOf('<NumpadHost style={styles.numpadHost} />');
    expect(right).toBeGreaterThan(0);
    expect(host).toBeGreaterThan(right);
  });
  it('okutma dinleyicisi sütunların dışında kalır (boş durumda da dinler)', () => {
    const listener = src.indexOf('listenWhileHidden');
    const rightCol = src.indexOf('{!compact && !idleFull && (');
    expect(listener).toBeGreaterThan(rightCol);
  });
});

describe('TamburScreen iş açık, top seçilmemiş (2026-11-11)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'TamburScreen.tsx'), 'utf8');
  it('tablette sade "listeden top seçin" durumu; tuş takımı top seçilmeden çizilmez', () => {
    expect(TAMBUR_PICK_ROLL_TEXT).toBe('Sağdaki listeden bir top seçin');
    expect(src).toContain('!selectedRoll && !compact ? (\n            <TamburIdleState text={TAMBUR_PICK_ROLL_TEXT}');
    expect(src).toContain("{!wideMain && (!!selectedRoll || !!recutRollMeta || manualMode) && (recutRollMeta ? recutMode : cutMode) === 'manual' && (");
  });
  it('özel metinle tek cümle çizer', () => {
    const r = renderWithPaper(<TamburIdleState text={TAMBUR_PICK_ROLL_TEXT} icon="gesture-tap" />);
    expect(r.getByText(TAMBUR_PICK_ROLL_TEXT)).toBeTruthy();
    expect(r.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('TamburScreen geniş tablette ilk top otomatik seçilir (2026-11-11)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'TamburScreen.tsx'), 'utf8');
  it('iş açık, top seçili değilse kuyruğun ilk topu seçilir', () => {
    expect(src).toContain('if (compact || manualMode || recutResolvedRollId || !activeJob || selectedRoll) return;');
    expect(src).toContain('const first = activeJob.stepSummary.rolls[0];');
  });
});
