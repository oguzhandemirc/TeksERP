// =============================================================================
// BEKÇİ — "AYNI TOKEN, FARKLI GÖVDE" (BULGU-T4-003)
// Çalıştır: npx tsx scripts/test_client_token_collision.ts
// =============================================================================
// Bir `clientToken`ın anlamı "bu MANTIKSAL denemeyi bir kez uygula"dır. Token
// eşleşince mevcut kaydı döndürmek ancak gelen gövde ÖZDEŞSE doğrudur; değilse
// sunucunun "başarılı" demesi operatörün DÜZELTMESİNİ sessizce yutar:
//
//   40 m kesilir → istek zaman aşımına uğrar (ama COMMIT olmuştur) → operatör
//   yeniden ölçüp 25 m yazar → aynı token gider → sunucu ilk kesimin 40 m'lik
//   çocuğunu "Kesim zaten kaydedilmiş" diye döndürür. 25 m HİÇ yazılmaz.
//
// §1 SAF KARAR      — yardımcının kendisi (Decimal tuzağı, null denkliği, boş liste)
// §2 ENVANTER       — token OKUYAN her fonksiyon birimi boğaz politikasının içinde ya da beyanlıdır (yapısal;
//                     ölü/hayalet satır `test_token_replay_bogaz` §2'de)
// §3 UÇTAN UCA      — çuval açma: aynı token + FARKLI müşteri → 409;
//                     aynı token + AYNI müşteri → 200 (bugünkü davranış korunur)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { join } from "path";
import { tokenBirimleri } from "./lib/token-yazim-tarama";
import { TOKEN_YOLLARI } from "./lib/token-replay-beyan";
import {
  assertReplayPayloadMatches,
  replayAlaniAyni,
} from "../src/services/helpers/idempotent-replay.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function hataKodu(fn: () => void): string {
  try {
    fn();
    return "(hata yok)";
  } catch (e) {
    return String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
  }
}

async function main(): Promise<void> {
  // ═══ §1 — SAF KARAR ═══
  console.log("\n=== §1: yardımcının kendisi ===");
  check(
    "§1: Decimal'ler DEĞERCE karşılaştırılır",
    replayAlaniAyni(new Prisma.Decimal("40.000"), 40),
    "40.000 ≡ 40",
  );
  // ⚠️ Bu, yardımcının en kolay kaybedilen özelliği: `===` iki Decimal nesnesini
  // ASLA eşit saymaz → kapı her replay'i 409'a çevirir (koruma değil ARIZA).
  check(
    "§1: farklı Decimal değeri AYNI sayılmaz",
    !replayAlaniAyni(new Prisma.Decimal("40"), 25),
  );
  check("§1: null ile undefined AYNI ('alan yok' ≡ 'alan boş')", replayAlaniAyni(null, undefined));
  check("§1: null ile dolu değer FARKLI", !replayAlaniAyni(null, "x"));

  check(
    "§1: özdeş kimlikte hata YOK",
    hataKodu(() =>
      assertReplayPayloadMatches([{ ad: "a", mevcut: "1", gelen: "1" }], "m"),
    ) === "(hata yok)",
  );
  check(
    "§1: farklı kimlikte 409 CLIENT_TOKEN_COLLISION",
    hataKodu(() => assertReplayPayloadMatches([{ ad: "a", mevcut: "1", gelen: "2" }], "m")) ===
      "CLIENT_TOKEN_COLLISION",
  );
  // Boş liste = kapının vakumen açılması. Programlama hatası olarak patlamalı.
  check(
    "§1: BOŞ kimlik listesi hata verir (kapı sessizce açılamaz)",
    hataKodu(() => assertReplayPayloadMatches([], "m")).includes("boş olamaz"),
  );

  // ═══ §2 — ENVANTER (yapısal; tarama `scripts/lib/token-yazim-tarama.ts`, beyan `scripts/lib/token-replay-beyan.ts`) ═══
  // Dosya adıyla tutulan muaf listesi, dosya boğaza taşınınca "ölü muaf" diye kızarıyor ya da yanlış dosyada kalıp
  // sessiz yeşil veriyordu. Ölçüt birim başınadır: token OKUYAN her fonksiyon birimi boğaz politikasının içindedir ya da
  // beyanlı giriş/helper/muaftır; borç satırı kapısız sayılır.
  console.log("\n=== §2: token okuyan her birim gövde kapısından geçer ===");
  const tarama = tokenBirimleri(join(__dirname, ".."));
  const politikaBirimleri = [...tarama.hepsi.values()].filter((b) => b.cagrilar.some((c) => c.ad === "tokenReplay"));
  const politikaCagrilari = new Set(politikaBirimleri.flatMap((b) => b.cagrilar.map((c) => `${b.anahtar.split("::")[0]}::${c.ad}`)));
  const okuyucular = tarama.token.filter((b) => b.okumalar.length > 0);
  check("§2: token okuyan birim bulundu (körlük zemini)", okuyucular.length >= 15, `${okuyucular.length} birim`);
  const kapisiz = okuyucular
    .filter((b) => !politikaBirimleri.includes(b) && !politikaCagrilari.has(b.anahtar))
    .filter((b) => {
      const y = TOKEN_YOLLARI[b.anahtar];
      return !y || "borc" in y;
    })
    .map((b) => b.anahtar);
  check("§2a: ⭐ gövde kapısından geçmeyen token okuyucusu YOK (boğaz politikası ya da beyanlı giriş/helper/muaf)", kapisiz.length === 0, kapisiz.join(" · ") || "hepsi");

  // ═══ §3 — UÇTAN UCA (çuval açma) ═══
  console.log("\n=== §3: çuval açma — aynı token, farklı müşteri ===");
  const damga = `TEST-T4003-${Date.now().toString().slice(-8)}`;
  const olusan = { musteri: [] as string[], cuval: [] as string[] };
  try {
    const { ShippingService } = await import("../src/services/shipping.service");
    const svc = new ShippingService();
    const a = await prisma.customer.create({ data: { code: `${damga}-A`, name: `${damga} A` } });
    const b = await prisma.customer.create({ data: { code: `${damga}-B`, name: `${damga} B` } });
    olusan.musteri.push(a.id, b.id);

    const token = crypto.randomUUID();
    const ilk = (await svc.openSack({ customerId: a.id, clientToken: token })) as {
      data: { id: string; sackNo: string };
    };
    olusan.cuval.push(ilk.data.id);
    check("§3: ilk açılış başarılı", Boolean(ilk.data.id), ilk.data.sackNo);

    // ⭐ AYNI token, FARKLI müşteri → 409. Eskiden A'nın çuvalı "Çuval açıldı"
    // diye dönüyordu ve toplar YANLIŞ müşterinin çuvalına okutuluyordu.
    let kod = "(hata yok)";
    try {
      await svc.openSack({ customerId: b.id, clientToken: token });
    } catch (e) {
      kod = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
    }
    check("§3: FARKLI müşteri + aynı token → 409", kod === "CLIENT_TOKEN_COLLISION", kod);

    // Aynı gövde → bugünkü idempotent davranış BOZULMAMALI (regresyon sondası).
    const tekrar = (await svc.openSack({ customerId: a.id, clientToken: token })) as {
      data: { id: string };
    };
    check(
      "§3: AYNI müşteri + aynı token → aynı çuval (idempotent korunuyor)",
      tekrar.data.id === ilk.data.id,
      tekrar.data.id === ilk.data.id ? "aynı id" : "FARKLI id döndü",
    );
  } finally {
    await prisma.sack.deleteMany({ where: { id: { in: olusan.cuval } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: { in: olusan.musteri } } }).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
