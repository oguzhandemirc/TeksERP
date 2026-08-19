// Müşteriye renk ATAMA (assigned) ile müşterideki ÖZEL AD (alias) bağımsızlığı testi.
// Çalıştırma:  npx ts-node scripts/test_color_assignment.ts
// Test verisi üzerinde çalışır; ürettiği rengi sonunda siler (cascade → alias'lar).
//
// Doğrulananlar:
//   1. customerIds ile atama → satır assigned=true, alias=null.
//   2. findById sadece assigned=true müşterileri customerIds olarak döner.
//   3. Müşteri panelinden ad verme (assigned'a dokunmaz) → assigned=false, alias dolu.
//   4. Atanmamış-ama-adlı renk findById customerIds'e GİRMEZ.
//   5. Sonradan atama, var olan adlı satırı korur → assigned=true + alias aynı (bağımsızlık).
//   6. Atama kaldırma: alias'sız satır SİLİNİR.
//   7. Atama kaldırma: alias'lı satır KORUNUR → assigned=false, alias durur.

import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { ColorService } from "../src/services/color.service";
import { CustomerAliasService } from "../src/services/customer-alias.service";
import { assertColorsAssignableToCustomer } from "../src/services/helpers/color-assignment.helper";

const rejects = async (fn: () => Promise<unknown>): Promise<boolean> => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

const colors = new ColorService({
  modelName: "color",
  tableName: "COLOR",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  uniqueField: "code",
});
const aliases = new CustomerAliasService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const getRow = (customerId: string, colorId: string) =>
  prisma.customerColorAlias.findUnique({
    where: { customerId_colorId: { customerId, colorId } },
    select: { assigned: true, alias: true },
  });

const customerIdsOf = async (colorId: string): Promise<string[]> => {
  const res = await colors.findById(colorId);
  return ((res.data as { customerIds?: string[] }).customerIds ?? []).sort();
};

// Listede (findAll) bir renk kodu için dönen id'leri çek. scope opsiyonel:
// "public" → müşteriye atanmış renkler dışlanır (picker davranışı).
const listIdsByCode = async (
  code: string,
  scope?: "public",
): Promise<string[]> => {
  const query: Record<string, unknown> = { search: code };
  if (scope) query.scope = scope;
  const res = await colors.findAll({ query } as unknown as Request);
  return (res.data as Array<{ id: string }>).map((c) => c.id);
};

// assignedTo=<customerId> → sadece o müşteriye atanmış renkler (picker pinned).
const listIdsAssignedTo = async (
  customerId: string,
  code: string,
): Promise<string[]> => {
  const res = await colors.findAll({
    query: { search: code, assignedTo: customerId },
  } as unknown as Request);
  return (res.data as Array<{ id: string }>).map((c) => c.id);
};

async function main() {
  const custs = await prisma.customer.findMany({
    where: { isActive: true },
    select: { id: true },
    take: 2,
  });
  if (custs.length < 2) throw new Error("Test için en az 2 aktif müşteri gerek (npm run seed).");
  const [A, B] = custs.map((c) => c.id);

  // 1 + 2: A'ya atama ile renk oluştur
  const created = await colors.create({
    code: `TEST-CLR-${Date.now()}`,
    name: "Test Atama Rengi",
    hex: "#123456",
    customerIds: [A],
  });
  const colorId = (created.data as { id: string }).id;

  const code = (created.data as { code: string }).code;

  const rA1 = await getRow(A, colorId);
  check("1. Atama satırı assigned=true, alias=null", rA1?.assigned === true && rA1?.alias === null);
  check("2. findById customerIds = [A]", (await customerIdsOf(colorId)).join() === [A].sort().join());

  // 2b + 2c: Picker scope — A'ya atanmış renk scope=public listesinde GÖRÜNMEZ,
  // ama scope'suz (renk yönetim sayfası) listede görünür.
  check(
    "2b. scope=public atanmış rengi dışlar",
    !(await listIdsByCode(code, "public")).includes(colorId),
  );
  check(
    "2c. scope'suz liste atanmış rengi gösterir (yönetim)",
    (await listIdsByCode(code)).includes(colorId),
  );

  // 2d: Müşteriye HİÇ atanmamış (public) renk scope=public'te görünür.
  const pub = await colors.create({
    code: `TEST-PUB-${Date.now()}`,
    name: "Test Public Renk",
    hex: "#abcdef",
  });
  const pubId = (pub.data as { id: string }).id;
  const pubCode = (pub.data as { code: string }).code;
  check(
    "2d. scope=public atanmamış rengi gösterir",
    (await listIdsByCode(pubCode, "public")).includes(pubId),
  );

  // 2e: assignedTo=<customer> picker pinned kaynağı — sadece o müşterinin
  // atanmış renkleri (#3 izin ayrıştırması).
  check(
    "2e. assignedTo=A atanmış rengi içerir",
    (await listIdsAssignedTo(A, code)).includes(colorId),
  );
  check(
    "2f. assignedTo=B atanmış rengi içermez",
    !(await listIdsAssignedTo(B, code)).includes(colorId),
  );

  // 2g–2j: Sipariş guard (#2) — assertColorsAssignableToCustomer.
  check(
    "2g. guard: A bağlamında exclusive renge izin verir",
    !(await rejects(() => assertColorsAssignableToCustomer([colorId], A))),
  );
  check(
    "2h. guard: B bağlamında exclusive rengi reddeder",
    await rejects(() => assertColorsAssignableToCustomer([colorId], B)),
  );
  check(
    "2i. guard: müşterisiz bağlamda exclusive rengi reddeder",
    await rejects(() => assertColorsAssignableToCustomer([colorId], null)),
  );
  check(
    "2j. guard: public renk her bağlamda serbest",
    !(await rejects(() => assertColorsAssignableToCustomer([pubId], B))) &&
      !(await rejects(() => assertColorsAssignableToCustomer([pubId], null))),
  );

  await prisma.color.delete({ where: { id: pubId } });

  // 3 + 4: B için müşteri panelinden ad ver (atama YOK)
  await aliases.upsertColorAlias(B, colorId, "B-OZEL-AD");
  const rB1 = await getRow(B, colorId);
  check("3. Adlı satır assigned=false, alias dolu", rB1?.assigned === false && rB1?.alias === "B-OZEL-AD");
  check("4. Atanmamış adlı renk customerIds'e girmez", (await customerIdsOf(colorId)).join() === [A].sort().join());

  // 5: B'yi de ata → var olan adlı satır korunur, assigned=true olur (bağımsızlık)
  await colors.update(colorId, { customerIds: [A, B] });
  const rB2 = await getRow(B, colorId);
  check("5. Sonradan atama adı korur (assigned=true + alias aynı)", rB2?.assigned === true && rB2?.alias === "B-OZEL-AD");

  // 6: A'nın atamasını kaldır (A alias'sız) → satır silinir
  await colors.update(colorId, { customerIds: [B] });
  const rA2 = await getRow(A, colorId);
  check("6. Alias'sız atama kaldırınca satır silinir", rA2 === null);
  check("6b. B hâlâ atanmış + adlı", (await getRow(B, colorId))?.assigned === true);

  // 7: B'ye atama varken kaldır → adlı olduğu için satır korunur
  await colors.update(colorId, { customerIds: [] });
  const rB3 = await getRow(B, colorId);
  check("7. Alias'lı atama kaldırınca satır korunur (assigned=false, alias durur)", rB3?.assigned === false && rB3?.alias === "B-OZEL-AD");
  check("7b. findById artık boş", (await customerIdsOf(colorId)).length === 0);

  // ===========================================================================
  // #4 — Renk formundan atama + "müşterideki ad" tek seferde (customerAliases).
  // ===========================================================================
  const c2 = await colors.create({
    code: `TEST-CLR2-${Date.now()}`,
    name: "Test Atama+Ad",
    hex: "#654321",
    customerIds: [A, B],
    customerAliases: { [A]: "A-FORM-AD" }, // sadece A'ya ad
  });
  const color2Id = (c2.data as { id: string }).id;

  const r2A = await getRow(A, color2Id);
  const r2B = await getRow(B, color2Id);
  check("8. Create: A atandı + form adı yazıldı", r2A?.assigned === true && r2A?.alias === "A-FORM-AD");
  check("8b. Create: B atandı ama adsız (map'te yok)", r2B?.assigned === true && r2B?.alias === null);

  const detail2 = await colors.findById(color2Id);
  const aliases2 = (detail2.data as { customerAliases?: Record<string, string> }).customerAliases ?? {};
  check("9. findById customerAliases A adını döner", aliases2[A] === "A-FORM-AD" && aliases2[B] === undefined);

  // 10: Non-clobber — customerAliases map'te A YOK ama A hâlâ atalı → adı KORUNUR.
  await colors.update(color2Id, { customerIds: [A, B], customerAliases: { [B]: "B-FORM-AD" } });
  check("10. Map'te olmayan A'nın adı korunur", (await getRow(A, color2Id))?.alias === "A-FORM-AD");
  check("10b. Map'teki B'nin adı yazılır", (await getRow(B, color2Id))?.alias === "B-FORM-AD");

  // 11: Boş string ile ad temizlenir (null).
  await colors.update(color2Id, { customerIds: [A, B], customerAliases: { [A]: "" } });
  check("11. Boş ad → null (temizlenir)", (await getRow(A, color2Id))?.alias === null);
  check("11b. Dokunulmayan B adı durur", (await getRow(B, color2Id))?.alias === "B-FORM-AD");

  await prisma.color.delete({ where: { id: color2Id } });

  // Temizlik (test artefaktı — cascade alias'ları siler)
  await prisma.color.delete({ where: { id: colorId } });

  console.log(`\n${pass}/${pass + fail} geçti.`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
