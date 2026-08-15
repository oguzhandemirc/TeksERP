// =============================================================================
// Bekçi: appMenuLayout — AppMenu'nün ekrana sığdırma kuralı
// =============================================================================
// Kilitlenen sözleşmeler:
//   • kart HER ZAMAN güvenli kutunun (ekran − margin) içinde kalır — tetik ekran
//     dışında olsa bile,
//   • sağa sığmıyorsa SOL yerine SAĞ kenardan çivilenir (`right`, alignRight),
//   • alta sığmıyorsa ÜST yerine ALT kenardan çivilenir (`bottom`, openUp),
//   • `left`/`right` ve `top`/`bottom` asla İKİSİ BİRDEN dolu olmaz — aksi hâlde
//     kart iki kenardan gerilir ve maxWidth/maxHeight garantisi anlamını yitirir,
//   • maxWidth/maxHeight negatif olamaz.
//
// NEGATİF SONDA (ölçüldü): `computeAppMenuLayout` içindeki kırpma kaldırılıp
// ham `left = anchor.x` / `top = anchorBottom + gap` bırakılınca §1 (kutu
// içinde kalma) ve §2/§3 dalları KIRMIZI verir — bkz. dosya sonundaki not.
// =============================================================================

import {
  APP_MENU_LAYOUT_DEFAULTS as D,
  computeAppMenuLayout,
  type AppMenuAnchorRect,
  type AppMenuLayout,
  type AppMenuViewport,
} from './appMenuLayout';

/** Tipik tablet (SM-X230 yatay) ve telefon (dikey). */
const TABLET: AppMenuViewport = { width: 1280, height: 800 };
const PHONE: AppMenuViewport = { width: 360, height: 800 };

/** Kartın nihai kutusunu (maxWidth/maxHeight kadar büyüdüğü varsayımıyla) çözer. */
function box(pos: AppMenuLayout, vp: AppMenuViewport) {
  const left = pos.left !== undefined ? pos.left : vp.width - (pos.right ?? 0) - pos.maxWidth;
  const top = pos.top !== undefined ? pos.top : vp.height - (pos.bottom ?? 0) - pos.maxHeight;
  return { left, top, right: left + pos.maxWidth, bottom: top + pos.maxHeight };
}

describe('computeAppMenuLayout — temel yerleşim', () => {
  it('bol yer varsa tetiğin SOL kenarına hizalanır ve ALTINDAN açılır', () => {
    const anchor: AppMenuAnchorRect = { x: 100, y: 60, width: 120, height: 40 };
    const pos = computeAppMenuLayout(anchor, TABLET);

    expect(pos.alignRight).toBe(false);
    expect(pos.openUp).toBe(false);
    expect(pos.left).toBe(100);
    expect(pos.right).toBeUndefined();
    expect(pos.top).toBe(60 + 40 + D.gap);
    expect(pos.bottom).toBeUndefined();
  });

  it('yalnız TEK yatay ve TEK dikey kenardan çivilenir', () => {
    const cases: AppMenuAnchorRect[] = [
      { x: 100, y: 60, width: 120, height: 40 }, // ortada
      { x: 1230, y: 8, width: 44, height: 44 }, // sağ üst
      { x: 12, y: 760, width: 120, height: 36 }, // sol alt
      { x: 1230, y: 760, width: 44, height: 36 }, // sağ alt
    ];
    for (const a of cases) {
      const pos = computeAppMenuLayout(a, TABLET);
      expect((pos.left === undefined) !== (pos.right === undefined)).toBe(true);
      expect((pos.top === undefined) !== (pos.bottom === undefined)).toBe(true);
    }
  });
});

describe('computeAppMenuLayout — §2 sağ kenar kırpması', () => {
  it('sağ üstteki profil tetiğinde SAĞ kenardan çivilenir (tetiğin sağına yaslı)', () => {
    // ScreenChrome profil butonu: ekranın sağ ucunda, 44px.
    const anchor: AppMenuAnchorRect = { x: 1228, y: 6, width: 44, height: 36 };
    const pos = computeAppMenuLayout(anchor, TABLET);

    expect(pos.alignRight).toBe(true);
    expect(pos.left).toBeUndefined();
    // Kartın sağ kenarı tetiğin sağ kenarıyla hizalı (1280 − 1272 = 8).
    expect(pos.right).toBe(TABLET.width - (1228 + 44));
    expect(pos.right).toBeGreaterThanOrEqual(D.margin);
  });

  it('sağ hizalamada kart ekranın SAĞINDAN taşamaz', () => {
    const anchor: AppMenuAnchorRect = { x: 300, y: 40, width: 56, height: 40 };
    const pos = computeAppMenuLayout(anchor, PHONE);

    expect(pos.alignRight).toBe(true);
    const b = box(pos, PHONE);
    expect(b.right).toBeLessThanOrEqual(PHONE.width - D.margin);
    expect(b.left).toBeGreaterThanOrEqual(D.margin);
  });

  it('iki taraf da minWidth kadar yer bırakmıyorsa güvenli kutuya yayılır', () => {
    // 220px'lik dar bir yüzeyde ortada duran tetik: ne sola ne sağa 200 sığar.
    const tiny: AppMenuViewport = { width: 220, height: 600 };
    const anchor: AppMenuAnchorRect = { x: 90, y: 100, width: 40, height: 40 };
    const pos = computeAppMenuLayout(anchor, tiny);

    expect(pos.left).toBe(D.margin);
    expect(pos.maxWidth).toBe(tiny.width - 2 * D.margin);
    const b = box(pos, tiny);
    expect(b.left).toBeGreaterThanOrEqual(D.margin);
    expect(b.right).toBeLessThanOrEqual(tiny.width - D.margin);
  });
});

describe('computeAppMenuLayout — §3 alt taşması / yukarı açılma', () => {
  it('altta yer yoksa YUKARI açılır ve ALT kenardan çivilenir', () => {
    // StepLines "⋮" tetiği listenin dibinde.
    const anchor: AppMenuAnchorRect = { x: 600, y: 740, width: 40, height: 40 };
    const pos = computeAppMenuLayout(anchor, TABLET);

    expect(pos.openUp).toBe(true);
    expect(pos.top).toBeUndefined();
    // Kartın alt kenarı tetiğin ÜSTÜNDE (800 − (740 − gap)).
    expect(pos.bottom).toBe(TABLET.height - (740 - D.gap));
    expect(pos.maxHeight).toBe(740 - D.gap - D.margin);
  });

  it('yukarı açılan kart ekranın ÜSTÜNDEN taşmaz', () => {
    const anchor: AppMenuAnchorRect = { x: 100, y: 780, width: 40, height: 18 };
    const pos = computeAppMenuLayout(anchor, TABLET);

    const b = box(pos, TABLET);
    expect(b.top).toBeGreaterThanOrEqual(D.margin);
    expect(b.bottom).toBeLessThanOrEqual(TABLET.height - D.margin);
  });

  it('altta minHeight kadar yer VARSA yukarı açılmaz (gereksiz zıplama yok)', () => {
    const anchor: AppMenuAnchorRect = { x: 100, y: 800 - D.minHeight - 40 - D.margin - D.gap, width: 40, height: 40 };
    const pos = computeAppMenuLayout(anchor, TABLET);

    expect(pos.openUp).toBe(false);
    expect(pos.maxHeight).toBeGreaterThanOrEqual(D.minHeight);
  });

  it('altı da üstü de dar ise DAHA GENİŞ olan taraf seçilir', () => {
    const shallow: AppMenuViewport = { width: 800, height: 200 };
    // Tetik dibe yakın → üstte 120, altta ~20 → yukarı açılmalı.
    const low = computeAppMenuLayout({ x: 100, y: 140, width: 40, height: 40 }, shallow);
    expect(low.openUp).toBe(true);

    // Tetik tepeye yakın → altta çok, üstte az → aşağı açılmalı.
    const high = computeAppMenuLayout({ x: 100, y: 10, width: 40, height: 30 }, shallow);
    expect(high.openUp).toBe(false);
  });
});

describe('computeAppMenuLayout — §1 kutu içinde kalma (kırpmanın bekçisi)', () => {
  // Bu blok, kırpma satırları kaldırıldığında KIRMIZI veren asıl sondadır:
  // tetik ızgarası ekranın dışına kadar taşar, sonuç kutusu HER ZAMAN içeride
  // kalmak zorundadır.
  const viewports: AppMenuViewport[] = [TABLET, PHONE, { width: 480, height: 320 }];

  it('her tetik konumunda kart güvenli kutunun içinde kalır', () => {
    for (const vp of viewports) {
      for (let x = -200; x <= vp.width + 200; x += 40) {
        for (let y = -200; y <= vp.height + 200; y += 40) {
          const pos = computeAppMenuLayout({ x, y, width: 44, height: 40 }, vp);
          const b = box(pos, vp);
          const where = `vp=${vp.width}x${vp.height} anchor=${x},${y}`;

          expect(`${where} left>=margin: ${b.left >= D.margin}`).toBe(`${where} left>=margin: true`);
          expect(`${where} right<=safe: ${b.right <= vp.width - D.margin + 0.001}`).toBe(
            `${where} right<=safe: true`,
          );
          expect(`${where} top>=margin: ${b.top >= D.margin}`).toBe(`${where} top>=margin: true`);
          expect(`${where} bottom<=safe: ${b.bottom <= vp.height - D.margin + 0.001}`).toBe(
            `${where} bottom<=safe: true`,
          );
        }
      }
    }
  });

  it('maxWidth / maxHeight negatif olamaz', () => {
    for (const vp of viewports) {
      for (let x = -200; x <= vp.width + 200; x += 60) {
        for (let y = -200; y <= vp.height + 200; y += 60) {
          const pos = computeAppMenuLayout({ x, y, width: 44, height: 40 }, vp);
          expect(pos.maxWidth).toBeGreaterThanOrEqual(0);
          expect(pos.maxHeight).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('computeAppMenuLayout — bozuk girdi', () => {
  it('NaN/Infinity ölçüm sonucu kutuyu bozmaz (measureInWindow çöp dönebilir)', () => {
    const pos = computeAppMenuLayout(
      { x: NaN, y: Infinity, width: NaN, height: -Infinity },
      TABLET,
    );
    const b = box(pos, TABLET);
    expect(Number.isFinite(b.left)).toBe(true);
    expect(Number.isFinite(b.top)).toBe(true);
    expect(b.left).toBeGreaterThanOrEqual(D.margin);
    expect(b.top).toBeGreaterThanOrEqual(D.margin);
    expect(b.right).toBeLessThanOrEqual(TABLET.width - D.margin);
    expect(b.bottom).toBeLessThanOrEqual(TABLET.height - D.margin);
  });

  it('sıfır boyutlu yüzeyde çökmez', () => {
    const pos = computeAppMenuLayout({ x: 0, y: 0, width: 0, height: 0 }, { width: 0, height: 0 });
    expect(pos.maxWidth).toBeGreaterThanOrEqual(0);
    expect(pos.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
