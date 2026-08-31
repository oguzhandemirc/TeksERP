// =============================================================================
// BEKÇİ — fason kabulünde replay kimliği, PANEL tarafı (BULGU-T2-007)
// =============================================================================
// Mobil ikizi: `mobil/src/screens/Modules/FasonKabul/receiveAttempt.test.ts`.
// İki yön ölçülür (ikisi de gerekli):
//   ① KORUMA        — aynı teslimat yeniden gönderilirse AYNI token.
//   ② AYNADAKİ İKİZ — farklı/sonraki teslimat YENİ token (yoksa düzeltmenin
//                     kendisi, kopyadan daha kötü bir hata üretir: ikinci gerçek
//                     teslimat cached makbuzu alır ve SESSİZCE kaybolur).
// Ayrıca §PARİTE: iki ikizin sayısal sınırı ve kimlik alanları AYRIŞMAMALI.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FASON_RETRY_WINDOW_MS,
  isAmbiguousFailure,
  onReceiveFailed,
  onReceiveSucceeded,
  receiveFingerprint,
  tokenForReceive,
  type ReceiveAttempt,
} from "@/lib/fasonReceiveAttempt";

const T0 = 1_800_000_000_000;
const yuk = (over: Partial<Parameters<typeof receiveFingerprint>[0]> = {}) => ({
  workOrderId: "wo1",
  stepId: "s1",
  subcontractorId: "boyahane",
  returns: [{ rollId: "r1", receivedQty: 30 }],
  newRolls: [{ qty: 30 }],
  ...over,
});
/** Panelde hata axios'tan gelir — durum kodu `response.status`tedir. */
const axiosHata = (status?: number) =>
  status === undefined
    ? Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" })
    : Object.assign(new Error("Hata"), { response: { status } });

describe("isAmbiguousFailure — panelin hata şekli", () => {
  it("ağ hatası (yanıt YOK) belirsizdir", () => {
    expect(isAmbiguousFailure(axiosHata())).toBe(true);
  });
  it("5xx belirsizdir (sunucu tx'i kapatmış olabilir)", () => {
    expect(isAmbiguousFailure(axiosHata(500))).toBe(true);
  });
  it("⭐ KESİN 4xx belirsiz DEĞİL — `response.status` okunuyor", () => {
    // ⚠️ Bu kontrol, alanın yanlış okunmasına karşı: `error.status` (mobil şekli)
    // panelde YOKTUR; yalnız onu okusaydık HER hata "belirsiz" olur, düzeltilemez
    // bir 409'da aynı yük sonsuza dek yeniden gönderilirdi.
    expect(isAmbiguousFailure(axiosHata(409))).toBe(false);
    expect(isAmbiguousFailure(axiosHata(400))).toBe(false);
  });
  it("düz `status` alanı da okunur (ileride normalize edilirse)", () => {
    expect(isAmbiguousFailure(Object.assign(new Error("x"), { status: 403 }))).toBe(false);
  });
});

describe("① KORUMA — aynı teslimatın tekrarı aynı token", () => {
  it("⭐ SAHA SENARYOSU: timeout → operatör yeniden tıklar → AYNI token", () => {
    const fp = receiveFingerprint(yuk());
    const ilk = tokenForReceive(null, fp, T0, () => "TOKEN-1");
    const dusmus = onReceiveFailed(ilk, fp, axiosHata(), T0);
    expect(dusmus).not.toBeNull();
    expect(tokenForReceive(dusmus, fp, T0 + 120_000, () => "TOKEN-2")).toBe("TOKEN-1");
  });

  it("düşmüş deneme yokken taze token", () => {
    expect(tokenForReceive(null, "fp", T0, () => "YENİ")).toBe("YENİ");
  });

  it("KESİN 4xx'te yapışmaz (sonsuz yeniden gönderim döngüsü kurulmaz)", () => {
    expect(onReceiveFailed("T", "fp", axiosHata(409), T0)).toBeNull();
  });

  it("⭐ renk/en/not kimliğe GİRMEZ — düzeltip yeniden göndermek aynı teslimattır", () => {
    const a = receiveFingerprint({ ...yuk(), appliedColorId: "kirmizi" } as never);
    const b = receiveFingerprint({ ...yuk(), appliedColorId: "mavi", notes: "ıslak" } as never);
    expect(a).toBe(b);
  });
});

describe("② AYNADAKİ İKİZ — yeni teslimat sessizce yutulmaz", () => {
  const dusmus = (fp: string): ReceiveAttempt => ({ token: "ESKİ", fingerprint: fp, at: T0 });

  it("⭐ FARKLI teslimat (başka metraj) taze token alır", () => {
    const yeniFp = receiveFingerprint(yuk({ returns: [{ rollId: "r1", receivedQty: 45 }] }));
    expect(tokenForReceive(dusmus(receiveFingerprint(yuk())), yeniFp, T0 + 60_000, () => "YENİ")).toBe(
      "YENİ",
    );
  });

  it("⭐ AYNI rakamlar ama PENCERE dolmuş → taze token (yarınki teslimat)", () => {
    const t = tokenForReceive(
      dusmus(receiveFingerprint(yuk())),
      receiveFingerprint(yuk()),
      T0 + FASON_RETRY_WINDOW_MS + 1,
      () => "YENİ",
    );
    expect(t).toBe("YENİ");
  });

  it("⭐ BAŞARIDAN SONRA yapışkanlık BİTER", () => {
    expect(tokenForReceive(onReceiveSucceeded(), "fp", T0, () => "YENİ")).toBe("YENİ");
  });

  it("satır sırası kimliği değiştirmez", () => {
    const a = receiveFingerprint(
      yuk({ returns: [{ rollId: "r1", receivedQty: 30 }, { rollId: "r2", receivedQty: 40 }] }),
    );
    const b = receiveFingerprint(
      yuk({ returns: [{ rollId: "r2", receivedQty: 40 }, { rollId: "r1", receivedQty: 30 }] }),
    );
    expect(a).toBe(b);
  });
});

describe("§PARİTE — mobil ikizinden AYRIŞMAMALI", () => {
  // İki ayrı proje, ortak import YOK (`permissions.ts` ile aynı durum) → kural
  // iki yerde yaşıyor ve sessizce ayrışabilir. Bu bölüm metin üzerinden
  // mekanik olarak kilitler.
  const ikizYolu = join(
    __dirname,
    "../../../mobil/src/screens/Modules/FasonKabul/receiveAttempt.ts",
  );
  const ikiz = readFileSync(ikizYolu, "utf8");

  it("KÖRLÜK ZEMİNİ: mobil ikizi gerçekten okundu", () => {
    // Yol kayarsa / dosya taşınırsa aşağıdaki kontroller vakumen yeşil kalmasın.
    expect(ikiz.length).toBeGreaterThan(2000);
    expect(ikiz).toContain("export function tokenForReceive");
    expect(ikiz).toContain("export function receiveFingerprint");
  });

  it("⭐ zaman penceresi İKİ TARAFTA da aynı", () => {
    expect(ikiz).toContain("FASON_RETRY_WINDOW_MS = 10 * 60_000");
    expect(FASON_RETRY_WINDOW_MS).toBe(10 * 60_000);
  });

  it("⭐ parmak izi alanları ve SIRASI aynı", () => {
    // Sıra da kimliğin parçası: alanlar aynı ama sıra farklıysa iki istemci aynı
    // teslimat için FARKLI parmak izi üretir ve panelde korunan bir tekrar
    // tablette korunmaz (ya da tersi).
    expect(ikiz).toContain(
      "[p.workOrderId, p.stepId, p.subcontractorId, donusler, parcalar].join('|')",
    );
    expect(receiveFingerprint(yuk())).toBe("wo1|s1|boyahane|r1:30.000|30.000");
  });

  it("üç sınırın üçü de mobil ikizde duruyor", () => {
    expect(ikiz).toContain("prev.fingerprint === fingerprint");
    expect(ikiz).toContain("nowMs - prev.at <= FASON_RETRY_WINDOW_MS");
    expect(ikiz).toContain("isAmbiguousFailure(error)");
  });
});

describe("§TEL — kural gerçekten ÇAĞRILIYOR mu (saf modül yeşilken tel kopabilir)", () => {
  // ⚠️ Bu turda iki kez ısıran sınıf: bekçi ürünü değil kendi kopyasını ölçüyor,
  // ya da kodu değil bir YORUMU eşliyor. Bu yüzden ① yorumlar AYIKLANIR,
  // ② kontrol iki yönlüdür (eski desen GİTTİ + yeni desen VAR).
  const yol = join(__dirname, "../pages/Operations/WorkOrders/FasonReceiveDialog.tsx");
  const ham = readFileSync(yol, "utf8");
  const kod = ham.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("KÖRLÜK ZEMİNİ: dosya okundu ve yorum ayıklaması işe yaradı", () => {
    expect(ham.length).toBeGreaterThan(4000);
    expect(kod.length).toBeLessThan(ham.length); // yorumlar gerçekten düştü
    expect(kod).toContain("workOrderService.receiveFason");
  });

  it("⭐ token artık gövdede ÜRETİLMİYOR (eski kusur geri gelemez)", () => {
    // `crypto.randomUUID()` yorumda GEÇİYOR (kusurun anlatımı) — yorumsuz
    // metinde geçmemeli. Bu kontrol yorum ayıklaması olmadan vakumen yeşildi.
    expect(kod).not.toContain("crypto.randomUUID()");
  });

  it("⭐ üç bağlantı noktası da bağlı: çözüm · düşüş · başarı", () => {
    expect(kod).toContain("tokenForReceive(failedAttemptRef.current");
    expect(kod).toContain("onReceiveFailed(");
    expect(kod).toContain("onReceiveSucceeded()");
  });

  it("TAM kabul yolu (FasonReceiveInline) BİLEREK dokunulmadan kalır", () => {
    // Orada `receivedQty` hiç gönderilmez → yalnız TAM kabul → sunucunun
    // küme-eşitliği guard'ı zaten koruyor (ölçüldü: subcontractor.service
    // "sameRolls" dalı, kısmi kalemli makbuz cached DÖNEMEZ). Token eklemek
    // ikinci bir mekanizma olurdu; bu kontrol o kararı yazılı tutar.
    const inline = readFileSync(
      join(__dirname, "../pages/Operations/WorkOrders/FasonReceiveInline.tsx"),
      "utf8",
    );
    expect(inline).toContain("workOrderService.receiveFason");
    expect(inline).not.toContain("receivedQty");
  });
});
