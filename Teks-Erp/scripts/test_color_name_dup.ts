// =============================================================================
// Test: ColorService — aynı isimli renk mükerrerlik guard'ı (409)
// Çalıştır: npx tsx scripts/test_color_name_dup.ts
// Doğrulananlar:
//   1. create: aynı normalize ada ikinci renk → 409 (kod farklı olsa bile).
//   2. Büyük/küçük harf varyantı ("mavi" vs "MAVİ") normalize ile yakalanır.
//   3. update: başka rengin adını mevcut ada çekmek → 409; kendi adını
//      değiştirmeden update (no-op/self) serbest.
//   4. Pasif (soft-deleted) kayıt da sayılır → "aktifleştirin" mesajlı 409.
// =============================================================================
import prisma from "../src/lib/prisma";
import { ColorService } from "../src/services/color.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// Route config'iyle birebir (color.routes.ts).
const service = new ColorService({
  modelName: "color",
  tableName: "COLOR",
  searchFields: ["code", "name"],
  defaultInclude: undefined,
  uniqueField: "code",
});

async function expectConflict(label: string, fn: () => Promise<unknown>, msgPart?: string) {
  let err: unknown;
  try { await fn(); } catch (e) { err = e; }
  const ok =
    err instanceof AppError &&
    err.statusCode === 409 &&
    (!msgPart || err.message.includes(msgPart));
  check(label, ok, err instanceof AppError ? err.message : String(err ?? "hata fırlatılmadı"));
}

async function main() {
  const ts = Date.now();
  // Tek token (boşluksuz) → normalize yalnız büyük harfe çevirir, sıra değişmez.
  const NAME = `testmavi${ts}`;
  const NORM = NAME.toLocaleUpperCase("tr-TR"); // TESTMAVİ...
  const createdIds: string[] = [];

  try {
    // 1) İlk renk serbest
    const first = await service.create({ code: `TEST-CLR-A-${ts}`, name: NAME }, undefined);
    const firstRec = first.data as { id: string; name: string } | null;
    if (firstRec?.id) createdIds.push(firstRec.id);
    check("ilk renk oluştu + ad normalize edildi", first.success === true && firstRec?.name === NORM, firstRec?.name);

    // 2) Aynı ad (farklı kod) → 409
    await expectConflict(
      "aynı adla ikinci renk → 409",
      () => service.create({ code: `TEST-CLR-B-${ts}`, name: NAME }, undefined),
      "zaten var",
    );

    // 3) Büyük/küçük varyantı → 409 (normalize aynı ada indirger)
    await expectConflict(
      "büyük harf varyantı → 409",
      () => service.create({ code: `TEST-CLR-C-${ts}`, name: NORM.toLocaleLowerCase("tr-TR") }, undefined),
      "zaten var",
    );
    const leak = await prisma.color.count({ where: { name: NORM } });
    check("reddedilen create'ler sızmadı (tek kayıt)", leak === 1, `adet=${leak}`);

    // 4) update: başka rengin adını bu ada çekmek → 409
    const other = await service.create({ code: `TEST-CLR-D-${ts}`, name: `testyesil${ts}` }, undefined);
    const otherRec = other.data as { id: string } | null;
    if (otherRec?.id) createdIds.push(otherRec.id);
    await expectConflict(
      "update ile ad çakıştırma → 409",
      () => service.update(otherRec!.id, { name: NAME }, undefined),
      "zaten var",
    );

    // 5) Kendi adıyla update (self) serbest — kendisi hariç tutulur
    const selfUpd = await service.update(firstRec!.id, { name: NAME, hex: "#0000FF" }, undefined);
    check("kendi adıyla update serbest (self hariç)", selfUpd.success === true);

    // 6) Pasif kayıt da sayılır → "aktifleştirin" mesajı
    await service.softDelete(firstRec!.id, undefined);
    await expectConflict(
      "pasif kayıtla aynı ad → 409 + aktifleştir yönlendirmesi",
      () => service.create({ code: `TEST-CLR-E-${ts}`, name: NAME }, undefined),
      "aktifleştirin",
    );
  } finally {
    for (const id of createdIds) {
      await prisma.color.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
