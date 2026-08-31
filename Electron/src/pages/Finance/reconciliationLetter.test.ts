// =============================================================================
// MUTABAKAT MEKTUBU BEKÇİSİ (J2 #18)
// =============================================================================
// Ölçtüğü şeyler:
//  §1 `asOf` GÜN SONUDUR — bu dosyanın var oluş sebebi. Gün BAŞI gönderilirse
//     backend'in `txnDate <= asOf` süzgeci o günün hareketlerini SESSİZCE
//     dışarıda bırakır; mektup doğru görünen ama eksik bir bakiyeyle karşı
//     tarafa gider ve fark ancak mutabakat reddedilince anlaşılır.
//  §2 Tarih YEREL bileşenlerden kurulur (`new Date("YYYY-MM-DD")` UTC gece
//     yarısıdır) ve bozuk/boş değerde gövde HİÇ üretilmez.
//  §3 Pasif cari kapısı — backend 409'unun ekrandaki ikizi.
//  §4 Gövde sözleşmesi (backend Zod `.strict()`): tanınan anahtarlar, boş not
//     hiç gönderilmez.
//  §5 EKRAN DİKİŞİ (körlük zemini) — düğme cari EKSTRESİNDE, kesit tarihi
//     ekrandaki dönemin BİTİŞİNDEN ön-dolu, diyalog mount edilmiş, donmuş belge
//     ORTAK `PrintedDocDialog` ile açılıyor.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-15, 4 sonda;
// `cp` yedeği + `shasum` ile her sondadan sonra birebir geri yükleme doğrulandı):
//   ① `buildReconciliationLetterBody`te `dayEndIso` → `dayStartIso`
//      → 2 kırmızı: §1a · §1b. (Asıl saha hatasının aynısı: kâğıt EKSİK bakiye
//      basar ve hiçbir yerde hata görünmez.)
//   ② Pasif cari dalı hem yüklemden hem üreticiden silindi
//      → 3 kırmızı: §3a · §3b · §3c.
//   ③ `<ReconciliationLetterDialog` mount'u kaldırıldı → 2 kırmızı: §5b · §5c.
//   ④ `defaultAsOfYmd={to}` → `{from}` (ekran ile kâğıt ayrışır)
//      → 1 kırmızı: §5c.
// Bu dosyayı değiştirirsen aynı dördünü TEKRARLA — kırmızı verdiği kanıtlanmamış
// bekçi, bekçi değil süstür.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_DATE_ERROR,
  RECONCILIATION_INACTIVE_ERROR,
  buildReconciliationLetterBody,
  reconciliationBlockReason,
  type ReconciliationDraft,
} from "./reconciliationLetter";

const draft = (over: Partial<ReconciliationDraft> = {}): ReconciliationDraft => ({
  cariId: "11111111-1111-1111-1111-111111111111",
  cariIsActive: true,
  asOfYmd: "2026-07-31",
  notes: "",
  ...over,
});

const src = (rel: string): string => readFileSync(resolve(__dirname, rel), "utf8");

describe("§1 asOf GÜN SONUDUR", () => {
  it("§1a seçilen günün SON anı gönderilir (o günün hareketleri DAHİL)", () => {
    const body = buildReconciliationLetterBody(draft({ asOfYmd: "2026-07-31" }));
    const d = new Date(body.asOf);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
  });

  it("§1b aynı günün öğlen hareketi kesitin İÇİNDE kalır", () => {
    // Backend süzgeci `txnDate <= asOf`. Gün başı gönderilseydi bu karşılaştırma
    // false olur ve 31 Temmuz'un tüm hareketleri mektuptan düşerdi.
    const body = buildReconciliationLetterBody(draft({ asOfYmd: "2026-07-31" }));
    const noon = new Date(2026, 6, 31, 12, 0, 0);
    expect(noon.getTime() <= new Date(body.asOf).getTime()).toBe(true);
  });
});

describe("§2 tarih çözümü", () => {
  it("§2a boş tarih engel sebebi döner", () => {
    expect(reconciliationBlockReason(draft({ asOfYmd: "" }))).toBe(RECONCILIATION_DATE_ERROR);
  });

  it("§2b var olmayan gün (31 Şubat) sessizce TAŞMAZ, reddedilir", () => {
    // `new Date(2026, 1, 31)` hata vermez, 3 Mart'a taşar — kesit tarihi bir
    // ay ileri kaymış bir mektup, yanlış dönemin bakiyesini anlatır.
    expect(reconciliationBlockReason(draft({ asOfYmd: "2026-02-31" }))).toBe(
      RECONCILIATION_DATE_ERROR,
    );
    expect(() => buildReconciliationLetterBody(draft({ asOfYmd: "2026-02-31" }))).toThrow(
      RECONCILIATION_DATE_ERROR,
    );
  });

  it("§2c geçerli taslakta engel yok", () => {
    expect(reconciliationBlockReason(draft())).toBeNull();
  });
});

describe("§3 pasif cari kapısı", () => {
  it("§3a pasif cariye mektup kesilemez (sebep yol gösterir)", () => {
    const reason = reconciliationBlockReason(draft({ cariIsActive: false }));
    expect(reason).toBe(RECONCILIATION_INACTIVE_ERROR);
    expect(reason).toContain("aktifleştirin");
  });

  it("§3b üretici de fail-closed reddeder (ekran nezaket, üretici set)", () => {
    expect(() => buildReconciliationLetterBody(draft({ cariIsActive: false }))).toThrow(
      RECONCILIATION_INACTIVE_ERROR,
    );
  });

  it("§3c pasif cari + bozuk tarih → önce PASİFLİK söylenir", () => {
    expect(reconciliationBlockReason(draft({ cariIsActive: false, asOfYmd: "" }))).toBe(
      RECONCILIATION_INACTIVE_ERROR,
    );
  });
});

describe("§4 gövde sözleşmesi (backend Zod .strict())", () => {
  it("§4a boş not HİÇ gönderilmez", () => {
    const body = buildReconciliationLetterBody(draft({ notes: "   " }));
    expect(Object.keys(body).sort()).toEqual(["asOf", "cariId"]);
  });

  it("§4b dolu not kırpılarak gönderilir", () => {
    const body = buildReconciliationLetterBody(draft({ notes: "  Temmuz dönemi  " }));
    expect(body.notes).toBe("Temmuz dönemi");
  });

  it("§4c cariId aynen taşınır", () => {
    const body = buildReconciliationLetterBody(draft());
    expect(body.cariId).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("§5 ekran dikişi — yazıldı ve BAĞLANDI", () => {
  it("§5a diyalog saf katmanı çağırır ve donmuş belgeyi ORTAK bileşenle açar", () => {
    const dialog = src("./ReconciliationLetterDialog.tsx");
    expect(dialog.length).toBeGreaterThan(1500);
    expect(dialog).toContain("buildReconciliationLetterBody");
    expect(dialog).toContain("reconciliationBlockReason");
    expect(dialog).toContain("createReconciliationLetter");
    expect(dialog).toContain("PrintedDocDialog");
    expect(dialog).toContain("RECONCILIATION_LETTER");
    expect(dialog).not.toContain("<!doctype");
  });

  it("§5b düğme CARİ EKSTRESİNDE ve diyalog MOUNT edilmiş", () => {
    const statement = src("./StatementDialog.tsx");
    expect(statement).toContain("Mutabakat Mektubu");
    expect(statement).toContain("<ReconciliationLetterDialog");
  });

  it("§5c kesit tarihi EKRANDAKİ dönemin BİTİŞİNDEN ön-dolar", () => {
    // Başlangıç tarihinden ön-doldurmak, kullanıcının baktığı kapanış
    // bakiyesinden BAŞKA bir rakam basardı — ekran ile kâğıt ayrışırdı.
    expect(src("./StatementDialog.tsx")).toContain("defaultAsOfYmd={to}");
  });

  it("§5d yazma kapısı `finance:write` (backend rotasıyla hizalı)", () => {
    const statement = src("./StatementDialog.tsx");
    const at = statement.indexOf("Mutabakat Mektubu");
    expect(at).toBeGreaterThan(-1);
    const before = statement.slice(0, at);
    const gateAt = before.lastIndexOf("PermissionGate permission=");
    expect(gateAt).toBeGreaterThan(-1);
    expect(before.slice(gateAt, gateAt + 60)).toContain('"finance:write"');
  });
});

// =============================================================================
// §6 BELGEYE DÖNÜŞ YOLU (2026-08-15 çapraz incelemesi)
// =============================================================================
// ⚠️ Mektup kesilebiliyor ama kesildikten sonra ULAŞILAMIYORDU: tek erişim,
// oluşturma diyaloğunun state'indeki `createdId` idi ve diyalog koşullu mount
// olduğu için kapanınca ölüyordu. Sonucu üç katmanlıydı: imzalı mektubun
// kopyası yeniden basılamıyor · yanlış kesilen mektup iptal edilemiyor
// (backend `cancel` ucu yazılmış ve bekçilenmişti) · ve `clientToken`ın
// bilinçli olarak atlanmasının gerekçesi ("mükerrer kopya TEK ADIMDA iptal
// edilir") dayandığı adımı kaybediyordu. Bu bölüm o dikişi kilitler.
//
// NEGATİF SONDA (ölçüldü): `<ReconciliationLetterListDialog` mount'u kaldırıldı
// → 1 kırmızı (§6a). §6b–§6e yeşil kaldı ve bu bilinçli: onlar diyaloğun KENDİ
// dikişini ölçer (uçlara bağlı mı, kapsam doğru mu), mount edilip edilmediğini
// değil — iki soru ayrıdır.
describe("§6 belgeye DÖNÜŞ YOLU (kesilen mektuba ulaşılabiliyor)", () => {
  it("§6a ekstre diyaloğu liste diyaloğunu MOUNT eder ve düğmesini çizer", () => {
    const statement = src("./StatementDialog.tsx");
    expect(statement).toContain("<ReconciliationLetterListDialog");
    expect(statement).toContain("Mektuplar");
  });

  it("§6b liste belgeyi AÇAR ve İPTALİ backend ucuna bağlar", () => {
    const list = src("./ReconciliationLetterListDialog.tsx");
    expect(list).toContain("listReconciliationLetters");
    expect(list).toContain("cancelReconciliationLetter");
    expect(list).toContain("PrintedDocDialog");
    expect(list).toContain("RECONCILIATION_LETTER");
  });

  it("§6c liste BU CARİYE daralır (ekstrenin bağlamı korunur)", () => {
    // Global bir mektup sayfası ayrı bir karardır (menü + route + izin);
    // bağlamsız bir liste, kullanıcının sorduğu soruyu ("bu carinin mektupları")
    // her açılışta yeniden aratırdı.
    const list = src("./ReconciliationLetterListDialog.tsx");
    expect(list).toContain("cariId");
    const at = list.indexOf("listReconciliationLetters({");
    expect(at).toBeGreaterThan(-1);
    expect(list.slice(at, at + 80)).toContain("cariId");
  });

  it("§6d iptal `finance:write` ile kapılı, LİSTE değil", () => {
    // Liste bir OKUMADIR: imzalı mektubun kopyasını istemek için yazma yetkisi
    // aramak, ekranı zaten açabilen muhasebeciyi kendi belgesinden ederdi.
    const list = src("./ReconciliationLetterListDialog.tsx");
    expect(list).toContain('PermissionGate permission="finance:write"');
    const statement = src("./StatementDialog.tsx");
    const at = statement.indexOf("setLetterListOpen(true)");
    expect(at).toBeGreaterThan(-1);
    // Düğmenin KENDİSİ izin kapısında değil (liste okumadır).
    expect(statement.slice(statement.lastIndexOf("<Button", at), at)).not.toContain(
      "PermissionGate",
    );
  });

  it("§6e İPTAL EDİLMİŞ mektup listeden GİZLENMEZ (donmuş belge kuralı)", () => {
    const list = src("./ReconciliationLetterListDialog.tsx");
    const at = list.indexOf("listReconciliationLetters({");
    expect(list.slice(at, at + 120)).not.toContain("status:");
    expect(list).toContain("OFFICIAL_DOC_STATUS_LABEL");
  });
});
