// =============================================================================
// Test: clientToken idempotency SADECE payload özdeşse (çapraz-cihaz token yeniden
// kullanımı sessiz veri kaybı yaratmamalı). Barkod artık SUNUCU'da sıralı atanır.
// Çalıştır: npx tsx scripts/test_p1b_barcode_collision.ts
//   1. Aynı clientToken + AYNI payload → idempotent (aynı id, yeni top YOK)
//   2. Aynı clientToken + FARKLI ürün → 409 CLIENT_TOKEN_COLLISION
//   3. Aynı clientToken + FARKLI metre → 409
//   4. O token'la DB'de tam 1 Roll (2. ve sonraki girişler yaratmadı)
//   5. Atanan barkod yeni kısa formata (TEKS+YYMMDD+H+A001..) uyar
// =============================================================================
import { v4 as uuidv4 } from "uuid";
import prisma from "../src/lib/prisma";
// ⚠️ ORTAK ATLAMA DEFTERİ: "ölçemedim" ile "ölçtüm, geçti" aynı sayıya çıkamaz.
import { atlamaDefteri } from "./lib/atlama";
import { InventoryService } from "../src/services/inventory.service";
import { ItemService } from "../src/services/item.service";
import { ROLL_BARCODE_RE } from "../src/services/helpers/roll-barcode.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
const atlama = atlamaDefteri((mesaj) => {
  fail++;
  console.log(`❌ ${mesaj}`);
});
let dusenHata: string | null = null;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const inventory = new InventoryService();
const itemService = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  defaultInclude: {
    allowedColors: { include: { color: true } },
    allowedProperties: { include: { property: true } },
  },
});

async function main() {
  const ts = Date.now();
  const TOKEN = uuidv4();
  const itemIds: string[] = [];
  const rollIds: string[] = [];

  try {
    for (const suf of ["A", "B"]) {
      const r = await itemService.create(
        { code: `TEST-P1B-${suf}-${ts}`, name: `TEST P1B ${suf}`, itemType: "FABRIC", unit: "MT" },
        undefined,
      );
      itemIds.push((r.data as { id: string }).id);
    }

    // 1) İlk giriş (renksiz → ham → barkod tipi H)
    const first = await inventory.createInitialEntry(
      { itemId: itemIds[0], colorId: null, initialQty: 100, clientToken: TOKEN },
      undefined,
    );
    const firstId = (first.data as { id: string }).id;
    const firstBarcode = (first.data as { barcode: string }).barcode;
    rollIds.push(firstId);
    check("1) İlk giriş başarılı", first.success === true && !!firstId, firstId);
    check("5) Atanan barkod yeni kısa formata uyar (…H…)", ROLL_BARCODE_RE.test(firstBarcode), firstBarcode);

    // 2) Aynı token + aynı payload → idempotent (aynı id)
    const again = await inventory.createInitialEntry(
      { itemId: itemIds[0], colorId: null, initialQty: 100, clientToken: TOKEN },
      undefined,
    );
    check("2) Aynı payload idempotent (aynı id, yeni top yok)", (again.data as { id: string }).id === firstId);
    check("2b) İdempotent dönüşte barkod da aynı", (again.data as { barcode: string }).barcode === firstBarcode);

    // 3) Aynı token + FARKLI ürün → 409 CLIENT_TOKEN_COLLISION
    let collision = false, code = "";
    try {
      await inventory.createInitialEntry(
        { itemId: itemIds[1], colorId: null, initialQty: 100, clientToken: TOKEN },
        undefined,
      );
    } catch (e) {
      if (e instanceof AppError) { collision = e.statusCode === 409; code = (e.details as { code?: string })?.code ?? ""; }
    }
    check("3) Farklı ürün + aynı token → 409 CLIENT_TOKEN_COLLISION", collision && code === "CLIENT_TOKEN_COLLISION", code);

    // 4) Aynı token + FARKLI metre → 409
    let qtyCollision = false;
    try {
      await inventory.createInitialEntry(
        { itemId: itemIds[0], colorId: null, initialQty: 200, clientToken: TOKEN },
        undefined,
      );
    } catch (e) {
      if (e instanceof AppError) qtyCollision = e.statusCode === 409;
    }
    check("4) Farklı metre + aynı token → 409", qtyCollision);

    // 6) O token'la tam 1 Roll
    const cnt = await prisma.roll.count({ where: { clientToken: TOKEN } });
    check("6) DB'de o token'la tam 1 Roll (sessiz veri kaybı yok)", cnt === 1, `count=${cnt}`);
  } catch (e) {
    // ⚠️ HATA YUTULMAZ: sebebi ⏭ beyanında ADIYLA basılır.
    // ⚠️ Prisma bağlantı hatalarında `message` BOŞ olabilir — kod ve isim
    // olmadan beyan "bir şey oldu" der ve teşhis taşımaz.
    const kod = (e as { code?: string })?.code;
    const govde = e instanceof Error ? e.message.trim().slice(0, 160) : String(e);
    dusenHata = [e instanceof Error ? e.name : "hata", kod ? `[${kod}]` : "", govde || "(mesaj boş)"]
      .filter(Boolean)
      .join(" ");
    if (pass + fail > 0) { fail++; console.log(`❌ beklenmeyen hata — ${dusenHata}`); }
  } finally {
    if (rollIds.length) {
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemIds.length) {
      await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    }
    // ⛔ SIFIR ÖLÇÜM YEŞİL OLAMAZ (fail-closed, 2026-09-13 d5'in DB'siz taraması):
    // DB'ye ulaşılamayınca gövde İLK çağrıda düşüyordu, `fail` 0 kalıyordu ve
    // `process.exit(0)` hatayı kendi altında gömüyordu ⇒ "0 geçti · 0 başarısız
    // · çıkış 0" = YEŞİL AMA HİÇ BAKMADI. Üç sonuç: uyumlu / ihlal / ÖLÇÜLEMEDİ.
    if (pass + fail === 0) {
      atlama.atla(
        "TÜM BÖLÜMLER",
        dusenHata ?? "hiçbir kontrol koşmadı — DB'ye ulaşılamamış ya da gövde erken düşmüş olabilir",
        "?",
      );
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlama.ozetEki()} ===`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
