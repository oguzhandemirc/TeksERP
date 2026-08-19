import { resolveShortCutConfig } from './resolveShortCutConfig';

// Fabrika ayarı ile cihaz override'ının birleşimi — "hangisi geçerli"nin TEK
// cevabı. Öncelik yanlış yazılırsa (server override'ı ezerse) süpervizörün
// kapattığı kural sessizce çalışmaya devam ederdi.

describe('resolveShortCutConfig — fabrika + cihaz override', () => {
  it("'server': fabrika değerleri aynen geçer", () => {
    expect(resolveShortCutConfig(true, 15, 'server', 99)).toEqual({ enabled: true, thresholdM: 15 });
    expect(resolveShortCutConfig(false, 15, 'server', 99)).toEqual({ enabled: false, thresholdM: 15 });
  });

  it("'off': fabrika AÇIK olsa da bu cihazda kapalı", () => {
    // ⚠️ Öncelik tersine yazılırsa (server kazanırsa) burası kırmızı verir.
    expect(resolveShortCutConfig(true, 15, 'off', 20)).toEqual({ enabled: false, thresholdM: null });
  });

  it("'on': fabrika KAPALI olsa da bu cihazda açık, eşik CİHAZINKİ", () => {
    expect(resolveShortCutConfig(false, 15, 'on', 20)).toEqual({ enabled: true, thresholdM: 20 });
  });

  it("'on' + cihaz eşiği girilmemiş → kural inert; fabrika eşiğine SIZMAZ", () => {
    // Sunucu eşiğine düşmek, operatörün ekranda görmediği bir eşikle kesim
    // yapmak olurdu — kuralın sessizce "başka bir sayıyla" çalışması.
    expect(resolveShortCutConfig(true, 15, 'on', null)).toEqual({ enabled: true, thresholdM: null });
  });

  it("'server' + fabrika eşiği yok → bayrak açık ama kural etkisiz", () => {
    expect(resolveShortCutConfig(true, null, 'server', 20)).toEqual({ enabled: true, thresholdM: null });
  });
});
