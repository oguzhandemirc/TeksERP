// =============================================================================
// RESMÎ ÇEK / SENET TESLİM BORDROSU BEKÇİSİ (J2 #18)
// =============================================================================
// Ölçtüğü şeyler:
//  §1 Kapı yüklemi ORTAK — resmî bordro, anlık bordronun `bordroBlockReason`
//     yüklemini AYNEN kullanır (kopya bir yorum yazılmamış).
//  §2 Tarih zorunlu ve MUTLAK AN olarak gider; bozuk/boş değerde gövde HİÇ
//     üretilmez (sessizce "bugün"e düşmek yanlış numaralı resmi belge demekti).
//  §3 Gövde sözleşmesi — backend Zod `.strict()`: yalnız tanınan anahtarlar,
//     boş metin alanı HİÇ gönderilmez, id'ler tekilleştirilir.
//  §4 SIRA — seçim hatası, tarih hatasından ÖNCE söylenir (backend ile aynı).
//  §5 EKRAN DİKİŞİ (körlük zemini) — "yazıldı ama mount edilmedi" sınıfı:
//     sayfa TEK düğmeyi çiziyor, diyaloğu mount ediyor, diyalog saf katmanı ve
//     iki ucu (taslak · kayıt) ÇAĞIRIYOR; eski ikinci diyalog geri gelmedi (K1).
//  §6 "ZATEN AKTİF BİR BORDRODA" ONAYI (2026-08-15) — 409 uyarısı GERÇEK
//     hatadan ayrılır, `confirmDuplicate` yalnız onaylandığında gövdeye girer.
//  §7 BELGEYE DÖNÜŞ YOLU (2026-08-15) — kesilen `BRD…` kaydına ulaşan bir liste
//     VAR ve iptal düğmesi ona BAĞLI. Bu bölüm olmadan backend'in `cancel` ucu
//     (atomik claim + VOID zinciri + bekçi) hiçbir kullanıcının tetikleyemediği
//     ölü kod olarak kalıyordu.
//
// NEGATİF SONDA — "kırmızı verebiliyor mu" KANITLANDI (2026-08-15, 4 sonda;
// `cp` yedeği + `shasum` ile her sondadan sonra birebir geri yükleme doğrulandı):
//   ① `deliveryNoteBlockReason`ın `bordroBlockReason` çağrısı silindi
//      → 4 kırmızı: §1a · §1b · §1c · §4 (seçim hatası sırası).
//      ⚠️ §5* YEŞİL KALDI ve bu bilinçli: bu sonda yalnız KURAL katmanını
//      bozuyor, dikişi değil. Tek sondayla yetinilseydi ekranın bağlanmamış
//      olabileceği görülmezdi → ③ ve ④.
//   ② `buildDeliveryNoteBody` tarih kontrolü `?? new Date().toISOString()`e
//      düşürüldü (sessizce "bugün") → 1 kırmızı: §2b.
//   ③ `<ChequeOfficialBordroDialog` mount'u sayfadan kaldırıldı → 1 kırmızı: §5b.
//   ④ ANLIK bordro kaldırıldı (yeni düğme onun YERİNE geçti) → 1 kırmızı: §5c.
//   ⑤ `duplicateNoteWarning` kod kontrolü kaldırıldı (her hata "uyarı" sayıldı)
//      → 1 kırmızı: §6b (gerçek sunucu hatası onay bandına düşerdi).
//   ⑥ `buildDeliveryNoteBody` `confirmDuplicate`ı KOŞULSUZ yazdı → 2 kırmızı:
//      §3a · §6d (uyarı hiç görünmez, sessiz ikinci belge geri gelirdi).
//   ⑦ `<ChequeDeliveryNoteListDialog` mount'u kaldırıldı → 1 kırmızı: §7a.
//      ⚠️ §7b–§7d YEŞİL KALDI ve bu bilinçli: onlar diyaloğun KENDİ dikişini
//      (uçlara bağlı mı, izin kapısı doğru mu) ölçer, sayfaya mount edilip
//      edilmediğini değil. İki soru ayrı; tek kontrole indirilirse "yazıldı ama
//      mount edilmedi" ile "mount edildi ama yanlış uca bağlı" ayrımı kaybolur.
//  §8 TASLAK + TOKEN (K1, 2026-09-26) — taslak gövdesi kaydınkinin alt kümesi;
//     token yalnız belirsiz hatada yapışır; diyalog token'ı gövdeye koyar.
//   ⑧ `tokenAfterFailure` koşulsuz yeni token üretti → 1 kırmızı: §8c.
//   ⑨ diyalog `clientToken`ı gövdeye koymadı → 1 kırmızı: §8d.
// Bu dosyayı değiştirirsen aynı sondaları TEKRARLA — kırmızı verdiği kanıtlanmamış
// bekçi, bekçi değil süstür.
// =============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BORDRO_EMPTY_ERROR, BORDRO_MIXED_KIND_ERROR } from "./chequeBordro";
import {
  ALREADY_IN_ACTIVE_NOTE,
  DELIVERY_DATE_ERROR,
  buildDeliveryNoteBody,
  buildDraftBody,
  deliveryNoteBlockReason,
  duplicateNoteWarning,
  tokenAfterFailure,
  type DeliveryNoteDraft,
} from "./chequeDeliveryNote";
import type { ChequeRow } from "./service";

type Sel = Pick<ChequeRow, "id" | "kind" | "status">;

const received = (id: string, status: ChequeRow["status"] = "PORTFOLIO"): Sel => ({
  id,
  kind: "RECEIVED",
  status,
});
const issued = (id: string): Sel => ({ id, kind: "ISSUED", status: "ISSUED" });

const draft = (over: Partial<DeliveryNoteDraft> = {}): DeliveryNoteDraft => ({
  rows: [received("c1"), received("c2")],
  dateYmd: "2026-08-15",
  targetLabel: "",
  notes: "",
  ...over,
});

const src = (rel: string): string => readFileSync(resolve(__dirname, rel), "utf8");

describe("§1 kapı yüklemi ORTAK (kopyalanmaz)", () => {
  it("§1a boş seçim — anlık bordronun AYNI cümlesi", () => {
    expect(deliveryNoteBlockReason(draft({ rows: [] }))).toBe(BORDRO_EMPTY_ERROR);
  });

  it("§1b karışık yön — anlık bordronun AYNI cümlesi", () => {
    expect(deliveryNoteBlockReason(draft({ rows: [received("c1"), issued("c2")] }))).toBe(
      BORDRO_MIXED_KIND_ERROR,
    );
  });

  it("§1c iptal edilmiş kayıt bordroya giremez", () => {
    const reason = deliveryNoteBlockReason(draft({ rows: [received("c1", "CANCELLED")] }));
    expect(reason).toContain("iptal edilmiş");
  });

  it("§1d geçerli seçim + geçerli tarih → engel yok", () => {
    expect(deliveryNoteBlockReason(draft())).toBeNull();
  });
});

describe("§2 teslim tarihi", () => {
  it("§2a boş tarih engel sebebi döner", () => {
    expect(deliveryNoteBlockReason(draft({ dateYmd: "" }))).toBe(DELIVERY_DATE_ERROR);
  });

  it("§2b bozuk tarihte gövde ÜRETİLMEZ (fail-closed, fırlatır)", () => {
    // ⚠️ `null` dönmek çağıran tarafta "hiçbir şey yapmayan düğme" olurdu.
    expect(() => buildDeliveryNoteBody(draft({ dateYmd: "2026-02-31" }))).toThrow(
      DELIVERY_DATE_ERROR,
    );
    expect(() => buildDeliveryNoteBody(draft({ dateYmd: "" }))).toThrow(DELIVERY_DATE_ERROR);
  });

  it("§2c tarih MUTLAK AN olarak gider ve YEREL günü işaret eder", () => {
    const body = buildDeliveryNoteBody(draft({ dateYmd: "2026-08-15" }));
    const d = new Date(body.deliveryDate);
    expect(Number.isNaN(d.getTime())).toBe(false);
    // Yerel bileşenlerden kurulur — `new Date("2026-08-15")` UTC gece yarısıdır
    // ve negatif UTC farkında günü bir geri kaydırırdı.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });
});

describe("§3 gövde sözleşmesi (backend Zod .strict())", () => {
  it("§3a yalnız tanınan anahtarlar; boş metin alanları HİÇ gönderilmez", () => {
    const body = buildDeliveryNoteBody(draft());
    expect(Object.keys(body).sort()).toEqual(["chequeIds", "deliveryDate"]);
  });

  it("§3b dolu metin alanları KIRPILARAK gönderilir", () => {
    const body = buildDeliveryNoteBody(
      draft({ targetLabel: "  Ziraat — Merkez  ", notes: "  iki nüsha  " }),
    );
    expect(body.targetLabel).toBe("Ziraat — Merkez");
    expect(body.notes).toBe("iki nüsha");
  });

  it("§3c yalnız boşluk taşıyan alan da GÖNDERİLMEZ (başlıksız satır doğmasın)", () => {
    const body = buildDeliveryNoteBody(draft({ targetLabel: "   ", notes: "\n " }));
    expect(body).not.toHaveProperty("targetLabel");
    expect(body).not.toHaveProperty("notes");
  });

  it("§3d id'ler tekilleştirilir (pivot @@unique'ine çarpmasın)", () => {
    const body = buildDeliveryNoteBody(
      draft({ rows: [received("c1"), received("c1"), received("c2")] }),
    );
    expect(body.chequeIds).toEqual(["c1", "c2"]);
  });
});

describe("§4 hata SIRASI backend ile aynı", () => {
  it("karışık yön + bozuk tarih → önce SEÇİM hatası söylenir", () => {
    // Ters sırada, karışık yön seçen kullanıcı önce tarihi düzeltir ve asıl
    // hatasını iki tur sonra öğrenirdi.
    const reason = deliveryNoteBlockReason(
      draft({ rows: [received("c1"), issued("c2")], dateYmd: "" }),
    );
    expect(reason).toBe(BORDRO_MIXED_KIND_ERROR);
  });

  it("üretici de aynı sırayı izler", () => {
    expect(() =>
      buildDeliveryNoteBody(draft({ rows: [received("c1"), issued("c2")], dateYmd: "" })),
    ).toThrow(BORDRO_MIXED_KIND_ERROR);
  });
});

describe("§5 ekran dikişi — yazıldı ve BAĞLANDI", () => {
  it("§5a diyalog saf katmanı ve İKİ ucu çağırır; resmî belgeyi ORTAK bileşenle açar", () => {
    const dialog = src("./ChequeBordroDialog.tsx");
    expect(dialog.length).toBeGreaterThan(1500);
    expect(dialog).toContain("buildDraftBody");
    expect(dialog).toContain("buildDeliveryNoteBody");
    expect(dialog).toContain("deliveryNoteBlockReason");
    expect(dialog).toContain("draftChequeDeliveryNote");
    expect(dialog).toContain("createChequeDeliveryNote");
    // Kâğıt burada ÜRETİLMEZ — backend render eder; kayıttan sonra ORTAK görüntüleyici.
    expect(dialog).toContain("<ChequeNoteDocDialog");
    expect(dialog).not.toContain("<!doctype");
    const viewer = src("./ChequeNoteDocDialog.tsx");
    expect(viewer).toContain("PrintedDocDialog");
    expect(viewer).toContain("CHEQUE_DELIVERY_NOTE");
    // Excel backend'in `/tables`inden — kolon listesi panelde YAZILMAZ.
    expect(viewer).toContain("getTables");
    expect(viewer).toContain("docTablesToSheets");
  });

  it("§5b sayfa TEK düğmeyi çizer ve diyaloğu MOUNT eder; ikinci diyalog yok (K1)", () => {
    const page = src("./ChequesPage.tsx");
    expect(page).toContain("<ChequeBordroDialog");
    expect(page).toContain("Teslim Bordrosu");
    expect(page).not.toContain("ChequeOfficialBordroDialog");
    expect(page).not.toContain("Resmî Bordro");
  });

  it("§5c taslak OKUMA izniyle açılır, kayıt diyaloğun İÇİNDE `finance:write` ile kapılı", () => {
    // Sayfadaki düğme bir izin kapısının arkasında DEĞİL: önizleme kayıt açmaz ve
    // eski anlık bordroyu basan kullanıcı yetki kaybetmemeli.
    const page = src("./ChequesPage.tsx");
    const at = page.indexOf("onClick={() => setBordroOpen(true)}");
    expect(at).toBeGreaterThan(-1);
    const btn = page.slice(page.lastIndexOf("<Button", at), at);
    expect(page.slice(page.lastIndexOf("{/*", at), at)).not.toContain("<PermissionGate");
    expect(btn).not.toContain("PermissionGate");
    // `lastIndexOf` — aynı ifade düğmenin ÜSTÜNDEKİ yorumda da geçebilir.
    const dialog = src("./ChequeBordroDialog.tsx");
    const saveAt = dialog.lastIndexOf("createM.mutate(undefined)");
    expect(saveAt).toBeGreaterThan(-1);
    const gateAt = dialog.slice(0, saveAt).lastIndexOf("PermissionGate permission=");
    expect(gateAt).toBeGreaterThan(-1);
    expect(dialog.slice(gateAt, gateAt + 60)).toContain('"finance:write"');
  });

  it("§5e liste düğmesi SEÇİMDEN BAĞIMSIZ (aranan şey bir BELGE, bir kıymet değil)", () => {
    // Seçime bağlansaydı, geçmiş bir bordroyu aramak için önce ilgisiz bir çek
    // seçmek gerekirdi — üstelik portföyün varsayılan "canlı olanlar" süzgeci
    // yüzünden tahsil edilmiş çeklerin bordroları hiç bulunamazdı.
    const page = src("./ChequesPage.tsx");
    const at = page.indexOf("setNoteListOpen(true)");
    expect(at).toBeGreaterThan(-1);
    const btn = page.slice(page.lastIndexOf("<Button", at), at);
    expect(btn).not.toContain("selectedRows.length === 0");
  });

});

describe("§6 'zaten aktif bir bordroda' ONAYI (engel değil)", () => {
  const conflict = (details: Record<string, unknown>, message = "Seçimdeki 2 kıymet zaten AKTİF bir teslim bordrosunda (BRD1508260001).") => ({
    response: { status: 409, data: { success: false, message, details } },
  });

  it("§6a uyarı KODLA tanınır ve belge numaralarını taşır", () => {
    const w = duplicateNoteWarning(
      conflict({
        code: ALREADY_IN_ACTIVE_NOTE,
        noteDocNos: ["BRD1508260001"],
        chequeDocNos: ["CKA1508260007", "CKA1508260008"],
      }),
    );
    expect(w).not.toBeNull();
    // ⚠️ Cümle BACKEND'İNDİR (belge numarasını o biliyor) — ekran kendi
    // metnini uydurursa iki yüzey aynı olayı farklı anlatır.
    expect(w?.message).toContain("BRD1508260001");
    expect(w?.noteDocNos).toEqual(["BRD1508260001"]);
    expect(w?.chequeDocNos).toHaveLength(2);
  });

  it("§6b GERÇEK hata uyarı sayılmaz (kod eşleşmezse null)", () => {
    // Bu ayrım load-bearing: her 409'u "onayla ve devam et" diye sunmak, gerçek
    // bir sunucu hatasını kullanıcının tek tıkla geçtiği bir bandda gizlerdi.
    expect(duplicateNoteWarning(conflict({ code: "SOME_OTHER_CONFLICT" }))).toBeNull();
    expect(duplicateNoteWarning({ response: { status: 500, data: { message: "boom" } } })).toBeNull();
    expect(duplicateNoteWarning(new Error("ağ hatası"))).toBeNull();
    expect(duplicateNoteWarning(null)).toBeNull();
    expect(duplicateNoteWarning(undefined)).toBeNull();
  });

  it("§6c eksik/bozuk ayrıntıda çökmez, boş listelerle döner", () => {
    const w = duplicateNoteWarning(conflict({ code: ALREADY_IN_ACTIVE_NOTE }, ""));
    expect(w).not.toBeNull();
    expect(w?.noteDocNos).toEqual([]);
    expect(w?.chequeDocNos).toEqual([]);
    // Mesaj boşsa ekran sessiz kalmaz — yedek cümle basar.
    expect(w?.message.length ?? 0).toBeGreaterThan(10);
  });

  it("§6d `confirmDuplicate` YALNIZ onaylandığında gövdeye girer", () => {
    expect(buildDeliveryNoteBody(draft())).not.toHaveProperty("confirmDuplicate");
    expect(buildDeliveryNoteBody(draft({ confirmDuplicate: false }))).not.toHaveProperty(
      "confirmDuplicate",
    );
    expect(buildDeliveryNoteBody(draft({ confirmDuplicate: true })).confirmDuplicate).toBe(true);
  });

  it("§6e ekran onayı AYRI bir düğmeye bağlar (refleksle geçilmesin)", () => {
    const dialog = src("./ChequeBordroDialog.tsx");
    expect(dialog).toContain("duplicateNoteWarning");
    expect(dialog).toContain("createM.mutate(true)");
    expect(dialog).toContain("Yine de Bordro Kes");
  });
});

describe("§7 belgeye DÖNÜŞ YOLU (kesilen bordroya ulaşılabiliyor)", () => {
  it("§7a sayfa liste diyaloğunu MOUNT eder ve düğmesini çizer", () => {
    // ⚠️ Bu bölüm olmadan `BRD…` kaydı, oluşturma diyaloğu kapandığı anda
    // ulaşılamaz hâle geliyordu: ne yeniden basılabiliyor ne iptal edilebiliyordu.
    const page = src("./ChequesPage.tsx");
    expect(page).toContain("<ChequeDeliveryNoteListDialog");
    expect(page).toContain("Bordrolar");
  });

  it("§7b liste belgeyi AÇAR ve İPTALİ backend ucuna bağlar", () => {
    const list = src("./ChequeDeliveryNoteListDialog.tsx");
    expect(list).toContain("listChequeDeliveryNotes");
    expect(list).toContain("cancelChequeDeliveryNote");
    expect(list).toContain("<ChequeNoteDocDialog");
    // K2: liste bir RAPORDUR — Excel/PDF liste motorundan.
    expect(list).toContain("ReportExportBar");
    expect(list).toContain("deliveryNoteListSpec");
  });

  it("§7c iptal düğmesi `finance:write` ile kapılı, LİSTE değil", () => {
    // Liste okumadır (`finance:read`): imzalı bordronun kopyasını istemek için
    // yazma yetkisi aramak, muhasebeciyi kendi belgesinden mahrum bırakırdı.
    const list = src("./ChequeDeliveryNoteListDialog.tsx");
    // ⚠️ Çıpa DÜĞMENİN KENDİSİ: düz `indexOf("İptal")` diyalog AÇIKLAMA metnine
    // ("İptal edilmiş bordro…") düşüyor ve kontrol yanlış yeri ölçüyordu.
    const at = list.indexOf('title={blocked ?? "Bordroyu iptal et"}');
    expect(at).toBeGreaterThan(-1);
    const gateAt = list.slice(0, at).lastIndexOf("PermissionGate permission=");
    expect(gateAt).toBeGreaterThan(-1);
    expect(list.slice(gateAt, gateAt + 60)).toContain('"finance:write"');
    // LİSTE sorgusu izin kapısında DEĞİL (okuma `finance:read` ile gelir).
    const qAt = list.indexOf("listChequeDeliveryNotes({");
    expect(qAt).toBeLessThan(gateAt);
  });

  it("§7d İPTAL EDİLMİŞ satır GİZLENMEZ (donmuş belge kuralı)", () => {
    // Liste sorgusu `status` süzgeci GÖNDERMEZ: iptal edilmiş bordro da "İPTAL"
    // filigranıyla basılabilir olmalı ve dosyaya bakan kişi tam onu arar.
    const list = src("./ChequeDeliveryNoteListDialog.tsx");
    const at = list.indexOf("listChequeDeliveryNotes({");
    expect(at).toBeGreaterThan(-1);
    expect(list.slice(at, at + 120)).not.toContain("status:");
    expect(list).toContain("OFFICIAL_DOC_STATUS_LABEL");
  });
});

describe("§8 taslak gövdesi + deneme token'ı (K1)", () => {
  it("§8a taslak gövdesi kayıt gövdesinin ALT KÜMESİ — taslak ne gösterdiyse kayıt onu yazar", () => {
    const d = draft({ targetLabel: " Ziraat ", notes: " not ", confirmDuplicate: true, clientToken: "t-1" });
    const taslak = buildDraftBody(d);
    const kayit = buildDeliveryNoteBody(d);
    expect(Object.keys(taslak).sort()).toEqual(["chequeIds", "deliveryDate", "notes", "targetLabel"]);
    for (const [k, v] of Object.entries(taslak)) expect(kayit[k as keyof typeof kayit]).toEqual(v);
    expect(kayit.confirmDuplicate).toBe(true);
    expect(kayit.clientToken).toBe("t-1");
  });

  it("§8b taslak da fail-closed: karışık yön / bozuk tarih gövde üretmez", () => {
    expect(() => buildDraftBody(draft({ rows: [received("c1"), issued("c2")] }))).toThrow(BORDRO_MIXED_KIND_ERROR);
    expect(() => buildDraftBody(draft({ dateYmd: "" }))).toThrow(DELIVERY_DATE_ERROR);
  });

  it("§8c token YALNIZ belirsiz hatada yapışır; kesin 4xx'te yenilenir", () => {
    const gen = () => "YENI";
    const axios = (status?: number) => Object.assign(new Error("x"), status ? { response: { status } } : {});
    expect(tokenAfterFailure("ESKI", axios(), gen)).toBe("ESKI"); // ağ / zaman aşımı
    expect(tokenAfterFailure("ESKI", axios(502), gen)).toBe("ESKI");
    expect(tokenAfterFailure("ESKI", axios(400), gen)).toBe("YENI");
    expect(tokenAfterFailure("ESKI", axios(409), gen)).toBe("YENI");
    expect(tokenAfterFailure("ESKI", axios(403), gen)).toBe("YENI");
  });

  it("§8d diyalog token'ı gövdeye koyar ve hatada `tokenAfterFailure`dan geçirir", () => {
    const dialog = src("./ChequeBordroDialog.tsx");
    expect(dialog).toMatch(/buildDeliveryNoteBody\(\{[^}]*clientToken/);
    expect(dialog).toContain("tokenAfterFailure(t, e)");
    // Token mutationFn İÇİNDE üretilmez (her tıklama yeni token = korumasız).
    const fnAt = dialog.indexOf("mutationFn: (confirmDuplicate");
    expect(dialog.slice(fnAt, fnAt + 200)).not.toContain("randomUUID");
  });
});
