// test_gelen_belge_motor §11 (Gülkesim A, 2026-11-02): parti no adayları + kurşun metresi — bekçinin bölümü; dosya boyu
// tavanı yüzünden ayrı. Saf (DB'siz): gerçek anonim fikstürler + şablonlar çağırandan gelir.
import { extractDocument, splitRegions, validateTemplate, type DocumentTemplate, type OcrResult } from "../../src/lib/gelen-belge/motor";
import { draftFromExtraction } from "../../src/lib/gelen-belge/taslak";
import { batchNoCandidates, normalizeBatchNo, pickBatchNo } from "../../src/lib/gelen-belge/parti-no";
import { resolveKursunMeters } from "../../src/lib/gelen-belge/kursun-metre";

type Check = (label: string, ok: boolean, detay?: string) => void;

export function gulkesimPartiMetre(check: Check, gercek: (ad: string) => OcrResult, sablonlar: DocumentTemplate[]): void {
  const vals = (d: ReturnType<typeof draftFromExtraction>) => d.header.batchNoCandidates.map((c) => c.value);
  const d46 = draftFromExtraction(extractDocument(gercek("0246-iki-belge"), sablonlar));
  check("§11a ⭐ Kömürhan (0246 bölge 1): adaylar [ISM9439770 (BARCODE), müş. parti no] · kurşun 241 OUTPUT (tablo TOPLAM), giriş 238 yalnız bilgi, review yok",
    JSON.stringify(vals(d46)) === JSON.stringify(["ISM9439770", "9999-99 ÖRNEK KUMAŞ ÖRN"]) && d46.header.batchNoCandidates[0]!.kind === "BARCODE"
      && d46.header.kursun.meters === "241" && d46.header.kursun.source === "OUTPUT" && d46.header.kursun.candidates.input === "238" && !d46.header.kursun.review,
    JSON.stringify({ c: vals(d46), k: d46.header.kursun }));
  const dAlt = draftFromExtraction(extractDocument(splitRegions(gercek("0246-iki-belge"))[1]!.ocr, sablonlar));
  check("§11b ⭐ Bayhas (sevk fişi): adaylar [96399, 167] · kurşun 200 OUTPUT (toplam metre, çıkış bölümü), giriş 198,1",
    JSON.stringify(vals(dAlt)) === JSON.stringify(["96399", "167"]) && dAlt.header.kursun.meters === "200" && dAlt.header.kursun.source === "OUTPUT" && dAlt.header.kursun.candidates.input === "198.1" && !dAlt.header.kursun.review,
    JSON.stringify({ c: vals(dAlt), k: dAlt.header.kursun }));
  const d45 = draftFromExtraction(extractDocument(gercek("0245-ceki-listesi-a"), sablonlar));
  check("§11c ⭐ Güleçsoy (2 blok): adaylar [fiş 914279, ham parti blok 1 P9918733, iş emri blok 1 99K-24749] · kurşun 4.521 OUTPUT (Σ blok beyanı = Σ satır)",
    JSON.stringify(vals(d45)) === JSON.stringify(["914279", "P9918733", "99K-24749"]) && d45.header.kursun.meters === "4521" && d45.header.kursun.source === "OUTPUT" && d45.header.kursun.candidates.lineSum === "4521" && !d45.header.kursun.review,
    JSON.stringify({ c: vals(d45), k: d45.header.kursun }));
  const d43 = draftFromExtraction(extractDocument(gercek("0243-kesim-takip-formu"), sablonlar));
  check("§11d ⭐ Takva (el yazısı): adaylar [evrak 90779, form sıra 926322] · OUTPUT (okunan 1) + review (el yazısı ve Σ 1775 ile çelişki)",
    JSON.stringify(vals(d43)) === JSON.stringify(["90779", "926322"]) && d43.header.kursun.source === "OUTPUT" && d43.header.kursun.review && d43.header.kursun.candidates.lineSum === "1775",
    JSON.stringify({ c: vals(d43), k: d43.header.kursun }));
  const d44 = draftFromExtraction(extractDocument(gercek("0244-kumas-irsaliyesi"), sablonlar));
  check("§11e ⭐ DRN (el yazısı, numarasız): aday yok · LINE_SUM + review",
    d44.header.batchNoCandidates.length === 0 && d44.header.kursun.source === "LINE_SUM" && d44.header.kursun.meters === d44.header.kursun.candidates.lineSum && d44.header.kursun.review,
    JSON.stringify(d44.header.kursun));
  const cks = sablonlar.find((t) => t.id === "cikis-ceki-listesi")!;
  const yildiz = batchNoCandidates(cks, { isEmriNo: " *ISM1439770* ", musteriPartiNo: "*ISM1439770*" });
  check("§11f ⭐ Code39 yıldızı soyulur, büyük harf, aynı değer tek aday; 64 karakter tavanı; boş → null",
    yildiz.length === 1 && yildiz[0]!.value === "ISM1439770" && normalizeBatchNo("x".repeat(80))!.length === 64 && normalizeBatchNo(" ** ") === null && normalizeBatchNo("koyu  bej") === "KOYU BEJ",
    JSON.stringify(yildiz));
  const iki = batchNoCandidates(cks, { isEmriNo: "ISM1", musteriPartiNo: "P-7" });
  check("§11g seçim: hatırlanan anahtar adaydan önce · tek aday seçilir · çok adayda hatırlanan yoksa boş · hatırlananın değeri yoksa kural sürer",
    pickBatchNo(iki, "musteriPartiNo")?.value === "P-7" && pickBatchNo(iki, null) === null && pickBatchNo(iki.slice(0, 1), null)?.key === "isEmriNo"
      && pickBatchNo(iki.slice(0, 1), "musteriPartiNo")?.value === "ISM1" && pickBatchNo([], "isEmriNo") === null);
  const genel = sablonlar.find((t) => t.id === "genel")!;
  const onc = (f: Record<string, string>) => resolveKursunMeters({ template: genel, fields: f, totalsDeclared: null, lineMeters: ["100", "50"] });
  check("§11h öncelik sabit: çıkış > toplam > Σ satır; giriş hiçbir zaman seçilmez; Σ ile %0,5 üstü fark → review",
    onc({ cikisMetre: "150", toplamMetre: "149", girisMetre: "151" }).source === "OUTPUT" && onc({ toplamMetre: "150", girisMetre: "151" }).source === "TOTAL"
      && onc({ girisMetre: "151" }).source === "LINE_SUM" && onc({ girisMetre: "151" }).meters === "150" && onc({ cikisMetre: "160" }).review && !onc({ cikisMetre: "150.5" }).review);
  const bozuk1 = validateTemplate({ ...cks, batchNoCandidates: [{ field: "yok", kind: "BATCH" }] });
  const bozuk2 = validateTemplate({ ...cks, batchNoCandidates: [{ field: "isEmriNo", kind: "SIHIR" }] });
  const bozuk3 = validateTemplate({ ...cks, meterSources: { output: ["yokAlan"] } });
  const bozuk4 = validateTemplate({ ...sablonlar.find((t) => t.id === "urun-sevk-fisi")!, meterSources: { output: ["$tableTotal"] } });
  check("§11i validator: bilinmeyen aday alanı/türü, bilinmeyen metre alanı, tablosuz şablonda $tableTotal reddedilir; 6 şablon geçerli",
    !bozuk1.ok && !bozuk2.ok && !bozuk3.ok && !bozuk4.ok && sablonlar.every((t) => validateTemplate(t).ok),
    [...bozuk1.errors, ...bozuk2.errors, ...bozuk3.errors, ...bozuk4.errors].join(" | "));
}
