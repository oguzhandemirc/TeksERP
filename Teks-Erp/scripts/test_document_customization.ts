// =============================================================================
// Belge kişiselleştirme Faz 2-4 testi (kolonlar, damgalar/QR, bloklar, dil, profil)
// =============================================================================
// Kapsam:
//   1) Kolon motoru: gizleme + sıralama + toplam satırı yeniden kurulumu
//   2) Damgalar: nüsha rozeti, basım zamanı, QR (örnek belgede)
//   3) Metin blokları (konumlu) + sanitize sınırları
//   4) Dil: shipmentDispatch EN + auto (EXPORT örnek verisi)
//   5) DocumentProfile CRUD + sanitize + müşteri ataması (FK)
// Çalıştır: npx tsx scripts/test_document_customization.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { PrintedDocType } from "@prisma/client";
import { printedDocumentService } from "../src/services/printed-document.service";
import "../src/services/shipping.service";
import "../src/services/subcontractor.service";
import "../src/services/kartela.service";
import "../src/services/return.service";
import {
  sanitizeDocumentsConfig,
  type DocumentConfig,
} from "../src/services/system-setting.service";
import { documentProfileService } from "../src/services/document-profile.service";
import { applyColumnCfg, buildDocTable } from "../src/services/document-render/doc-table";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("Seed admin kullanıcısı yok — önce npm run seed");
  const uid = admin.id;

  // ── 1) Kolon motoru (saf) ────────────────────────────────────────────────
  const cols = [
    { key: "a", label: "A", align: "l" as const, cell: () => "1" },
    { key: "b", label: "B", align: "r" as const, cell: () => "2", foot: "9" },
    { key: "c", label: "C", align: "r" as const, cell: () => "3", foot: "8" },
  ];
  const visible = applyColumnCfg(cols, { hidden: ["b"], order: ["c", "a"] });
  check("kolon: gizle+sırala (c,a)", visible.map((c) => c.key).join(",") === "c,a");
  const tbl = buildDocTable({
    className: "sec",
    caption: "TEST",
    cols,
    rows: [{}],
    colCfg: { hidden: ["a"] },
    footLabel: "TOPLAM",
  });
  check("kolon: caption colspan görünür kolon sayısı", tbl.includes('colspan="2"'));
  check("kolon: gizli kolon başlığı basılmaz", !tbl.includes(">A<"));
  // footLabel yalnız foot'suz bir kolona oturur; tüm görünürlerde foot varsa
  // etiket düşer ama toplam DEĞERLERİ yine basılır (tr.tot).
  check("kolon: toplam satırı korunur", tbl.includes('class="tot"') && tbl.includes(">9<") && tbl.includes(">8<"));
  const tblWithLabel = buildDocTable({
    className: "sec",
    cols,
    rows: [{}],
    footLabel: "TOPLAM",
  });
  check("kolon: foot'suz ilk kolona TOPLAM oturur", tblWithLabel.includes(">TOPLAM<"));
  const allHidden = buildDocTable({
    className: "sec",
    cols,
    rows: [{}],
    colCfg: { hidden: ["a", "b", "c"] },
  });
  check("kolon: tüm kolonlar gizli → tablo hiç basılmaz", allHidden === "");

  // ── 2) Örnek belgede kolon gizleme ───────────────────────────────────────
  const noKg = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, {
    columns: { ceki: { hidden: ["kg", "barcode"] } },
  });
  check("örnek: çekide KG+BARKOD gizlendi", !noKg.includes(">KG<") && !noKg.includes("BARKOD NO"));

  // ── 3) Damgalar + QR + bloklar ───────────────────────────────────────────
  const stamped = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, {
    qr: true,
    stamps: { printedAt: true, printedBy: true, copyLabel: "ASIL" },
    blocks: [
      { position: "afterHeader", text: "ÜST BLOK METNİ" },
      { position: "beforeSignatures", text: "ALT YASAL İBARE" },
    ],
  });
  check("damga: nüsha rozeti (ASIL)", stamped.includes('class="copy-badge"') && stamped.includes("ASIL"));
  check("damga: basım zamanı satırı", stamped.includes("Basım:"));
  check("damga: QR img basıldı", stamped.includes('class="stamps"') && stamped.includes("data:image/png;base64"));
  check("blok: üst + alt bloklar basıldı", stamped.includes("ÜST BLOK METNİ") && stamped.includes("ALT YASAL İBARE"));

  // Kapalıyken hiçbiri basılmamalı.
  const bare = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, null);
  check("damga: kapalıyken damga çubuğu yok", !bare.includes('class="stamps"'));
  check("damga: kapalıyken rozet yok", !bare.includes('class="copy-badge"'));

  // ── 4) Dil ───────────────────────────────────────────────────────────────
  const en = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, {
    language: "en",
  });
  check("dil: en → DELIVERY NOTE + PACKING LIST", en.includes("DELIVERY NOTE") && en.includes("PACKING LIST"));
  check("dil: en → TR başlık kalmadı", !en.includes("SEVK İRSALİYESİ") && !en.includes("ÇEKİ LİSTESİ"));
  const tr = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, {
    language: "tr",
  });
  check("dil: tr → SEVK İRSALİYESİ", tr.includes("SEVK İRSALİYESİ"));
  // Örnek veri DOMESTIC → auto TR'de kalmalı (EN yalnız EXPORT sevkiyatta).
  const auto = await printedDocumentService.renderSampleHtml(PrintedDocType.SHIPMENT_DISPATCH, {
    language: "auto",
  });
  check("dil: auto + DOMESTIC örneği → TR kalır", auto.includes("SEVK İRSALİYESİ"));

  // ── 5) sanitize: yeni alanlar ────────────────────────────────────────────
  const sane = sanitizeDocumentsConfig({
    shipmentDispatch: {
      qr: true,
      stamps: { printedAt: true, copyLabel: "X".repeat(50), bilinmeyen: 1 },
      blocks: [
        { position: "afterHeader", text: "  a  " },
        { position: "yanlış", text: "b" },
        { position: "beforeSignatures", text: "" },
      ],
      language: "auto",
      columns: { ceki: { hidden: ["kg"], order: ["meters"] }, x: "bozuk" },
    },
  }).shipmentDispatch as DocumentConfig;
  check("sanitize: qr/language korunur", sane.qr === true && sane.language === "auto");
  check("sanitize: copyLabel 20'ye kırpılır", sane.stamps?.copyLabel?.length === 20);
  check("sanitize: geçersiz/boş bloklar düşer", sane.blocks?.length === 1 && sane.blocks[0]?.text === "a");
  check("sanitize: bozuk kolon girdisi düşer", Boolean(sane.columns?.ceki) && !("x" in (sane.columns ?? {})));

  // ── 6) Profil CRUD + müşteri ataması ─────────────────────────────────────
  const profName = `TEST-PROFIL-${Date.now().toString(36)}`;
  let profileId: string | null = null;
  let testCustomerId: string | null = null;
  try {
    const created = await documentProfileService.create(
      {
        name: profName,
        description: "test profili",
        config: {
          shipmentDispatch: { titleOverride: "TEST PROFIL BAŞLIĞI", bilinmeyenAlan: true },
        } as unknown,
      },
      uid,
    );
    const prof = created.data as { id: string; config: Record<string, Record<string, unknown>> };
    profileId = prof.id;
    check("profil: oluşturuldu", Boolean(prof.id));
    check(
      "profil: config sanitize edildi (bilinmeyen alan düştü)",
      prof.config.shipmentDispatch?.titleOverride === "TEST PROFIL BAŞLIĞI" &&
        !("bilinmeyenAlan" in (prof.config.shipmentDispatch ?? {})),
    );

    // Aynı adla ikinci profil → 409.
    let conflicted = false;
    try {
      await documentProfileService.create({ name: profName, config: {} }, uid);
    } catch {
      conflicted = true;
    }
    check("profil: ad tekilliği (409)", conflicted);

    // Müşteri ataması (FK) — TEST müşterisi yarat, profil ata, geri oku.
    const cust = await prisma.customer.create({
      data: {
        code: `TEST-DP-${Date.now().toString(36)}`,
        name: "TEST Belge Profili Müşterisi",
        documentProfileId: prof.id,
      },
      select: { id: true, documentProfileId: true },
    });
    testCustomerId = cust.id;
    check("profil: müşteriye atandı (FK)", cust.documentProfileId === prof.id);

    // Geçersiz profil id ataması FK'ya takılmalı.
    let fkRejected = false;
    try {
      await prisma.customer.update({
        where: { id: cust.id },
        data: { documentProfileId: "00000000-0000-4000-8000-000000000000" },
      });
    } catch {
      fkRejected = true;
    }
    check("profil: geçersiz id ataması FK ile reddedilir", fkRejected);

    // Pasifleştir → liste (default) artık dönmemeli.
    await documentProfileService.deactivate(prof.id, uid);
    const activeList = (await documentProfileService.list(false)).data as { id: string }[];
    check("profil: pasifleşince aktif listeden düşer", !activeList.some((p) => p.id === prof.id));
    const fullList = (await documentProfileService.list(true)).data as { id: string }[];
    check("profil: withInactive listesinde durur", fullList.some((p) => p.id === prof.id));
  } finally {
    // Cleanup: test müşterisini ve profili fiziksel sil (TEST- fixture sözleşmesi).
    if (testCustomerId) await prisma.customer.delete({ where: { id: testCustomerId } }).catch(() => {});
    if (profileId) await prisma.documentProfile.delete({ where: { id: profileId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch((err) => {
    console.error("Test hata:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
