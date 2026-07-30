// =============================================================================
// Test: Müşteriye bağlı SERBEST etiketler — M:N kolaylık bağı uçtan uca
// Çalıştır: npx tsx scripts/test_customer_standalone_label.ts
// =============================================================================
// Kapsam (gerçek DB — adnansahin_db; fixtures TEST- prefix, finally'de temizlenir):
//   1. set() yalnız standalone şablon bağlar — türlü (non-standalone) → 400.
//   2. set() olmayan/pasif id → 400; hiçbir satır yazılmaz (validation tx ÖNCESİ).
//   3. list() bağlı serbest etiketleri döner ([{id,name}]).
//   4. Replace-set: eski bağı kaldırır + yenisini ekler; dedupe.
//   5. listStandaloneTemplates(customerId) = bağlı ∪ genel (bağsız); başka
//      müşteriye ÖZEL bağlı etiket dışlanır. customerId'siz → tümü.
//   6. Cascade: şablon silinince pivot düşer; müşteri silinince pivot düşer.
// =============================================================================

import { LabelKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelTemplateService } from "../src/services/label-template.service";
import { LabelService } from "../src/services/label.service";
import { CustomerStandaloneLabelService } from "../src/services/customer-standalone-label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function expectThrow(fn: () => Promise<unknown>, label: string, msgPart?: string): Promise<void> {
  try {
    await fn();
    check(label, false, "beklenen hata atılmadı");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, msgPart ? msg.includes(msgPart) : true, msg);
  }
}

const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
const tplService = new LabelTemplateService();
const labelService = new LabelService();
const linkService = new CustomerStandaloneLabelService();

const createdTemplateIds: string[] = [];
const createdCustomerIds: string[] = [];
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function mkCustomer(tag: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `TEST-${tag}-${stamp}`, name: `TEST Müşteri ${tag} ${stamp}` },
    select: { id: true },
  });
  createdCustomerIds.push(c.id);
  return c.id;
}

async function mkStandalone(tag: string): Promise<string> {
  const t = await tplService.create({ name: `TEST-STD-${tag}-${stamp}`, standalone: true }, undefined);
  createdTemplateIds.push(t.data.id);
  return t.data.id;
}

async function main(): Promise<void> {
  const custA = await mkCustomer("CA");
  const custB = await mkCustomer("CB");
  const stdA = await mkStandalone("A");
  const stdGeneral = await mkStandalone("GEN");
  const stdB = await mkStandalone("B");
  const stdReplace = await mkStandalone("REP");
  const normal = (await tplService.create({ name: `TEST-NORM-${stamp}`, kind: LabelKind.ROLL_FINISHED })).data.id;
  createdTemplateIds.push(normal);

  // --- 1. set() türlü şablonu reddeder (400, adıyla) ---
  await expectThrow(
    () => linkService.set(custA, [stdA, normal]),
    "set(türlü şablon dahil) → 400 (serbest değil)",
    "serbest etiket değil",
  );
  // Reddedilen çağrı hiçbir satır yazmamalı (validation tx ÖNCESİ).
  check("reddedilen set → hiçbir bağ yazılmadı", (await linkService.list(custA)).data.length === 0);

  // --- 2. Olmayan id → 400 ---
  await expectThrow(
    () => linkService.set(custA, [NIL_UUID]),
    "set(olmayan şablon) → 400 (bulunamadı/pasif)",
    "bulunamadı",
  );
  // Olmayan müşteri → 404.
  await expectThrow(() => linkService.set(NIL_UUID, [stdA]), "set(olmayan müşteri) → 404", "Müşteri bulunamadı");
  await expectThrow(() => linkService.list(NIL_UUID), "list(olmayan müşteri) → 404", "Müşteri bulunamadı");

  // --- 3. set() + list() mutlu yol ---
  const setB = await linkService.set(custB, [stdB]);
  check("set(B,[stdB]) → templateIds döndü", setB.data.templateIds.length === 1 && setB.data.templateIds[0] === stdB);

  const setA = await linkService.set(custA, [stdA]);
  check("set(A,[stdA]) → templateIds=[stdA]", setA.data.templateIds.length === 1 && setA.data.templateIds[0] === stdA);
  const listA1 = (await linkService.list(custA)).data;
  check("list(A) → tam olarak [stdA]", listA1.length === 1 && listA1[0].id === stdA);
  check("list(A) → satır {id,name} taşır", typeof listA1[0]?.name === "string" && listA1[0].name.length > 0);

  // --- 4. Replace-set: eski kalkar + yeni eklenir; dedupe ---
  await linkService.set(custA, [stdReplace, stdReplace]); // aynı id iki kez → dedupe
  const listA2 = (await linkService.list(custA)).data;
  check("replace-set → eski (stdA) kaldırıldı", !listA2.some((r) => r.id === stdA));
  check("replace-set → yeni (stdReplace) eklendi", listA2.some((r) => r.id === stdReplace));
  check("replace-set → dedupe (tek satır)", listA2.length === 1);
  // A'yı stdA'ya geri al (filtre testi için); stdReplace tekrar bağsız = genel olur.
  await linkService.set(custA, [stdA]);

  // --- 5. listStandaloneTemplates(customerId) = bağlı ∪ genel; başka müşteriye özel dışlanır ---
  // Son bağ durumu: A→stdA, B→stdB; stdGeneral & stdReplace bağsız (genel); normal türlü.
  const fA = (await labelService.listStandaloneTemplates(custA)).data.map((t) => t.id);
  check("filter(A) → bağlı stdA VAR", fA.includes(stdA));
  check("filter(A) → genel stdGeneral VAR", fA.includes(stdGeneral));
  check("filter(A) → B'ye özel stdB YOK", !fA.includes(stdB));
  check("filter(A) → türlü normal YOK", !fA.includes(normal));

  const fB = (await labelService.listStandaloneTemplates(custB)).data.map((t) => t.id);
  check("filter(B) → bağlı stdB VAR", fB.includes(stdB));
  check("filter(B) → genel stdGeneral VAR", fB.includes(stdGeneral));
  check("filter(B) → A'ya özel stdA YOK", !fB.includes(stdA));

  const fAll = (await labelService.listStandaloneTemplates()).data.map((t) => t.id);
  check("filter(yok) → tüm serbest (stdA,stdB,stdGeneral) VAR",
    fAll.includes(stdA) && fAll.includes(stdB) && fAll.includes(stdGeneral));
  check("filter(yok) → türlü normal YOK", !fAll.includes(normal));

  // --- 5b. Pasif-bağlı etiket kaydetmede KORUNUR (veri kaybı koruması) ---
  // Panel yalnız AKTİF serbest etiketleri gösterir; pasif bir şablona olan mevcut
  // bağ checkbox'ta görünmez. Blind replace onu düşürmemeli (yoksa şablon tekrar
  // aktifleşince "genel"e döner). set() gizli (pasif) bağları korur.
  const stdInactive = await mkStandalone("INACT");
  await linkService.set(custA, [stdA, stdInactive]);         // ikisi de bağlı
  await tplService.update(stdInactive, { isActive: false }); // pasife al → panelde görünmez
  await linkService.set(custA, [stdA]);                      // kullanıcı yalnız görüneni kaydeder
  const visInact = (await linkService.list(custA)).data.map((r) => r.id);
  check("pasif-bağlı: list() pasifi göstermez", !visInact.includes(stdInactive) && visInact.includes(stdA));
  const preserved = await prisma.customerStandaloneLabel.count({ where: { customerId: custA, templateId: stdInactive } });
  check("pasif-bağlı: kaydetmede pivot KORUNDU (veri kaybı yok)", preserved === 1);
  await tplService.update(stdInactive, { isActive: true });  // reaktive → tekrar görünür
  const visReact = (await linkService.list(custA)).data.map((r) => r.id);
  check("pasif-bağlı: reaktive → bağ geri görünür", visReact.includes(stdInactive));
  await linkService.set(custA, [stdA]);                      // sonraki cascade testi için sıfırla

  // --- 6. Cascade ---
  // 6a. Şablon silinince pivot düşer (templateId FK ON DELETE CASCADE).
  await linkService.set(custA, [stdA, stdReplace]);
  await prisma.labelTemplate.delete({ where: { id: stdReplace } });
  const afterTplDel = (await linkService.list(custA)).data.map((r) => r.id);
  check("cascade(şablon sil) → pivot düştü (stdReplace yok)", !afterTplDel.includes(stdReplace));
  check("cascade(şablon sil) → diğer bağ (stdA) durur", afterTplDel.includes(stdA));
  const orphanTpl = await prisma.customerStandaloneLabel.count({ where: { templateId: stdReplace } });
  check("cascade(şablon sil) → templateId pivot satırı 0", orphanTpl === 0);

  // 6b. Müşteri silinince pivot düşer (customerId FK ON DELETE CASCADE).
  const bLinksBefore = await prisma.customerStandaloneLabel.count({ where: { customerId: custB } });
  await prisma.customer.delete({ where: { id: custB } });
  const bLinksAfter = await prisma.customerStandaloneLabel.count({ where: { customerId: custB } });
  check("cascade(müşteri sil) → önce bağ vardı", bLinksBefore === 1);
  check("cascade(müşteri sil) → pivot düştü (0)", bLinksAfter === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  // Pivot cascade ile şablon/müşteri silinince gider; yine de emniyet için önce sil.
  await prisma.customerStandaloneLabel.deleteMany({
    where: { OR: [{ customerId: { in: createdCustomerIds } }, { templateId: { in: createdTemplateIds } }] },
  });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  console.log("Cleanup: test müşteri + şablon + pivot silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup().catch((err) => console.error("Cleanup hatası:", err));
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
