// =============================================================================
// BEKÇİ — "sevkiyat stok defterine bağlı mı" ölçüm aracı (lib/stok-defteri-bag-olcumu.ts)
// =============================================================================
// Açılış fotoğrafının SIKI modu bu araca güvenir; araç yanlış "bağlı" derse
// fotoğraf beyan kırılımı "güvenilir" diye damgalar. Üç şeyi ölçer:
//   §1 K aracı SENTETİK ağaçta çağıranı bulur (pozitif), yorum/import'u saymaz,
//      helper'da tanım yoksa "araç bozuk" der (fail-closed) — negatif sondalar.
//   §2 V aracı stub istemcide üç hâli doğru sınıflar (statüsüz yeni / eski / yok).
//   §3 Karar K ∧ V'dir; araç bozukken "bağlı" DEMEZ.
//   §4 Körlük zemini: gerçek ağaçta araç sağlam ve ≥80 dosya tarıyor; §4e ⭐ gerçek K CIRCIR
//      (K_TABAN=2, üye KÜMESİ adıyla; 2026-09-13 gece'ye dek yalnız bilgi satırıydı — kapı
//      sanılan şey kapı değildi) · §4f taban çürümemiş.
// DB'ye dokunmaz.
// =============================================================================
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WarehouseEventType } from "@prisma/client";
import {
  ESKI_KAPI_HELPER,
  eskiKapiCagiranlari,
  eskiKapiVeriIzi,
  kapisizYolOlcumu,
  sevkBagiKarari,
  type KapisizYolOlcumu,
  type KodOlcumu,
  type VeriOlcumu,
  kToplam,
  MIKTAR_YOLLARI,
} from "./lib/stok-defteri-bag-olcumu";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const HELPER_GOVDE = `
export async function writeWarehouseMovement(tx: unknown, e: unknown): Promise<boolean> { return true; }
export async function writeWarehouseMovements(tx: unknown, e: unknown[]): Promise<number> { return e.length; }
export async function postStockMoves(tx: unknown, e: unknown[]): Promise<number> { return e.length; }
`;

/** Sentetik backend ağacı: helper + verilen servis dosyaları. Döner: kök. */
function sentetikAgac(helper: string | null, servisler: Record<string, string>): string {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "bag-olcumu-"));
  if (helper !== null) {
    fs.mkdirSync(path.join(kok, path.dirname(ESKI_KAPI_HELPER)), { recursive: true });
    fs.writeFileSync(path.join(kok, ESKI_KAPI_HELPER), helper);
  } else {
    fs.mkdirSync(path.join(kok, "src"), { recursive: true });
  }
  for (const [ad, govde] of Object.entries(servisler)) {
    const p = path.join(kok, "src", ad);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, govde);
  }
  return kok;
}

function veri(enYeniStatusuz: Date | null, enYeniStatulu: Date | null, toplam = 10): VeriOlcumu {
  const kanitVar = enYeniStatusuz === null || (enYeniStatulu !== null && enYeniStatulu > enYeniStatusuz);
  return { toplamSatir: toplam, enYeniStatusuz, enYeniStatulu, kanitVar, aileler: [] };
}

/** Stub istemci: statüsüz/statülü en yeni tarihleri ve aile satırlarını verir. */
function stubClient(sonStatusuz: Date | null, sonStatulu: Date | null, toplam: number) {
  const satir = (d: Date, statulu: boolean) => ({ createdAt: d, fromStatus: statulu ? "WAREHOUSE" : null, toStatus: null });
  return {
    warehouseMovement: {
      count: async (args?: { where?: Record<string, unknown> }) => {
        if (!args?.where) return toplam;
        return 0;
      },
      findFirst: async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        if ("OR" in w) return sonStatulu ? satir(sonStatulu, true) : null;
        if ("eventType" in w) return null;
        return sonStatusuz ? satir(sonStatusuz, false) : null;
      },
    },
  } as unknown as Parameters<typeof eskiKapiVeriIzi>[0];
}

async function main(): Promise<void> {
  const gecici: string[] = [];
  try {
    // §1 K — kod yolu
    const k1 = sentetikAgac(HELPER_GOVDE, {
      "services/sevk.service.ts": `import { writeWarehouseMovements } from "./helpers/warehouse-ledger.helper";\n// yorumda writeWarehouseMovement( geçer, sayılmaz\nexport async function sevk(tx: unknown) { await writeWarehouseMovements(tx, []); }\n`,
      "services/temiz.service.ts": `import { postStockMoves } from "./helpers/warehouse-ledger.helper";\nexport async function temiz(tx: unknown) { await postStockMoves(tx, []); }\n`,
      "services/__tests__/sevk.test.ts": `import { writeWarehouseMovements } from "../helpers/warehouse-ledger.helper";\nwriteWarehouseMovements(null, []);\n`,
    });
    gecici.push(k1);
    const o1 = eskiKapiCagiranlari(k1);
    check("§1a araç sağlam (helper'da iki tanım bulundu)", o1.aracSaglam, o1.aracNotu ?? "");
    check("§1b çağıran TAM 1 (yorum/import/__tests__ sayılmadı)", o1.cagiranlar.length === 1, JSON.stringify(o1.cagiranlar));
    check("§1c bulunan satır doğru dosya/fonksiyon", o1.cagiranlar[0]?.dosya === "src/services/sevk.service.ts" && o1.cagiranlar[0]?.fonksiyon === "writeWarehouseMovements");
    check("§1d helper'ın kendisi taranmadı", o1.taranan === 2, `taranan=${o1.taranan}`);

    const k2 = sentetikAgac(HELPER_GOVDE, {
      "services/temiz.service.ts": `import { postStockMoves } from "./helpers/warehouse-ledger.helper";\nexport async function temiz(tx: unknown) { await postStockMoves(tx, []); }\n`,
    });
    gecici.push(k2);
    const o2 = eskiKapiCagiranlari(k2);
    check("§1e taşınmış ağaçta çağıran 0 ve araç sağlam", o2.aracSaglam && o2.cagiranlar.length === 0);

    // NEGATİF SONDA: helper tanımı kaybolursa "0 çağıran" değil "araç bozuk".
    const k3 = sentetikAgac(`export async function postStockMoves(tx: unknown, e: unknown[]): Promise<number> { return e.length; }\n`, {
      "services/sevk.service.ts": `export async function sevk(tx: unknown) { await (globalThis as any).writeWarehouseMovements(tx, []); }\n`,
    });
    gecici.push(k3);
    const o3 = eskiKapiCagiranlari(k3);
    check("§1f helper'da tanım yok → aracSaglam=false (fail-closed)", !o3.aracSaglam && o3.cagiranlar.length === 0, o3.aracNotu ?? "");
    const k4 = sentetikAgac(null, {});
    gecici.push(k4);
    const o4 = eskiKapiCagiranlari(k4);
    check("§1g helper dosyası yok → aracSaglam=false", !o4.aracSaglam);

    // §2 V — veri izi (stub)
    const t1 = new Date("2026-09-10T10:00:00Z");
    const t2 = new Date("2026-09-12T10:00:00Z");
    const v1 = await eskiKapiVeriIzi(stubClient(t2, t1, 10));
    check("§2a statüsüz satır statülüden YENİ → kanıt yok", !v1.kanitVar);
    const v2 = await eskiKapiVeriIzi(stubClient(t1, t2, 10));
    check("§2b statüsüz satır statülüden ESKİ → kanıt var", v2.kanitVar);
    const v3 = await eskiKapiVeriIzi(stubClient(null, t2, 10));
    check("§2c statüsüz satır hiç yok → kanıt var", v3.kanitVar);
    const v4 = await eskiKapiVeriIzi(stubClient(t2, null, 10));
    check("§2d statülü satır hiç yok, statüsüz var → kanıt yok", !v4.kanitVar);
    check("§2e aile listesi beş üyeli", v1.aileler.length === 5 && v1.aileler.some((a) => a.aile === WarehouseEventType.SHIPMENT));

    // §3 karar
    const kodTemiz: KodOlcumu = { aracSaglam: true, aracNotu: null, taranan: 100, cagiranlar: [], agac: "test" };
    const kodKirli: KodOlcumu = { ...kodTemiz, cagiranlar: [{ dosya: "src/services/shipping.service.ts", satir: 1, fonksiyon: "writeWarehouseMovements" }] };
    const kodBozuk: KodOlcumu = { ...kodTemiz, aracSaglam: false, aracNotu: "tanım yok" };
    // Kapısız yol kümesi (ii) — karar iki kümenin TOPLAMINA bakar.
    const kyTemiz: KapisizYolOlcumu = {
      aracSaglam: true,
      aracNotu: null,
      yollar: [{ dosya: "src/services/kartela.service.ts", fonksiyon: "dispatch", ad: "kartela sevki", bagli: true, bulunanKapi: "postStockMove" }],
    };
    const kyKirli: KapisizYolOlcumu = {
      ...kyTemiz,
      yollar: [{ ...kyTemiz.yollar[0]!, bagli: false, bulunanKapi: null }],
    };
    const kyBozuk: KapisizYolOlcumu = { aracSaglam: false, aracNotu: "`dispatch` yok", yollar: [] };
    check("§3a K=0 ∧ V kanıt → BAĞLI", sevkBagiKarari(kodTemiz, kyTemiz, veri(t1, t2)).bagli);
    check("§3b K>0 (eski kapı) → bağlı değil (V kanıt olsa da)", !sevkBagiKarari(kodKirli, kyTemiz, veri(t1, t2)).bagli);
    check("§3c K=0 ∧ V kanıt yok → bağlı değil", !sevkBagiKarari(kodTemiz, kyTemiz, veri(t2, t1)).bagli);
    check("§3d araç bozuk (eski kapı ayağı) → bağlı değil (fail-closed)", !sevkBagiKarari(kodBozuk, kyTemiz, veri(t1, t2)).bagli);
    check("§3e defter boş → K karar verir (bilgi satırı, engel değil)", sevkBagiKarari(kodTemiz, kyTemiz, veri(null, null, 0)).bagli);
    const g = sevkBagiKarari(kodKirli, kyTemiz, veri(t1, t2)).gerekceler.join("\n");
    check("§3f gerekçe çağıran dosyayı adıyla basar", g.includes("shipping.service.ts:1"));
    // ── §3f2 ⭐ K BOZUK ARAÇTA SAYI DÖNDÜRMEZ — fail-closed TİPTE ────────────
    // NEDEN (ölçüldü 2026-09-13): araç yanlış kökle çağrılınca `aracSaglam: false`
    // döndü, yani DOĞRU davrandı. Ama okuyan bayrağı okumadan
    // `cagiranlar.length + sayilanKapisiz` topladı ve K = 0 + 0 = 0 okudu —
    // *fail-closed bir ARIZA, yeşil bir SONUÇ gibi göründü* ve runbook'a "SIKI mod
    // serbest" yazılmasına bir adım kaldı. `kToplam` null döndürerek çağıranı
    // DURMAYA zorlar; `?? 0` yazan biri artık bunu bilerek yazmak zorunda.
    check("§3f2 ⭐ araç bozukken kToplam NULL (toplanamaz)", kToplam(kodBozuk, kyTemiz) === null);
    check("§3f3 ⭐ kapısız ayağı bozukken de NULL", kToplam(kodTemiz, kyBozuk) === null);
    check("§3f4 araç sağlamken kToplam gerçek K'yı verir", kToplam(kodKirli, kyKirli) === 2, String(kToplam(kodKirli, kyKirli)));
    // ── §3g–§3i — İKİNCİ KÜME kararı kendi başına verebilir ──────────────────
    // Eski kapı temiz olsa bile kapısız bir yol K'yı sıfırdan büyük tutar; bu
    // bekçinin eski hâli bunu ÖLÇEMİYORDU, çünkü karar tek kümeye bakıyordu.
    check(
      "§3g ⭐ eski kapı 0 ama kapısız yol var → bağlı DEĞİL (ikinci küme kararı tek başına verir)",
      !sevkBagiKarari(kodTemiz, kyKirli, veri(t1, t2)).bagli,
    );
    check(
      "§3h ⭐ kapısız yol ayağı bozuk → bağlı değil (fail-closed, iki ayak simetrik)",
      !sevkBagiKarari(kodTemiz, kyBozuk, veri(t1, t2)).bagli,
    );
    const gKy = sevkBagiKarari(kodTemiz, kyKirli, veri(t1, t2)).gerekceler.join("\n");
    check(
      "§3i ⭐ sayı KAPSADIĞI KÜMEYİ basar (K=1 + iki küme ayrışık + yolun adı)",
      gKy.includes("K = 1") && gKy.includes("eski kapı çağıranı 0") && gKy.includes("kartela sevki"),
      gKy,
    );

    // §4 körlük zemini — gerçek ağaç
    const gercek = eskiKapiCagiranlari(path.resolve(__dirname, ".."));
    check("§4a gerçek ağaçta araç sağlam", gercek.aracSaglam, gercek.aracNotu ?? "");
    check("§4b gerçek ağaçta ≥80 dosya tarandı", gercek.taranan >= 80, `taranan=${gercek.taranan}`);
    const gercekKy = kapisizYolOlcumu(path.resolve(__dirname, ".."));
    check(
      "§4c ⭐ gerçek ağaçta kapısız yol ayağı sağlam (fonksiyonlar yerinde)",
      gercekKy.aracSaglam,
      gercekKy.aracNotu ?? "",
    );
    check(
      "§4d ⭐ kapısız yol listesi BOŞ DEĞİL — boş liste 'hepsi bağlı' ile aynı çıktıyı verir",
      gercekKy.yollar.length >= 2,
      `ölçülen yol=${gercekKy.yollar.length}`,
    );
    const kTotal = gercek.cagiranlar.length + gercekKy.yollar.filter((y) => !y.bagli).length;
    // §4e — GERÇEK AĞAÇTA K, CIRCIR. 2026-09-13 gece'ye kadar bu sayı yalnız "bilgi"
    // satırıydı, HİÇ assert edilmiyordu: "K = 0 kapısı" diye anılan şey bir kapı
    // DEĞİLDİ (assert etmeyen kapı — 1c'nin beş yolu bulmasıyla ölçüldü). Taban
    // SAYI değil KÜME: iki üye adıyla (giriş yönü, 01 doff sonrası yazacak); yeni bir
    // kapısız yol → 3 → kırmızı. Yeşile inmesi listeden üye SİLMEKLE değil yolun
    // deftere yazmasıyla (`bagli: true`) olur; taban düşürmeyi entegratör yazar.
    // İki sonda (2026-09-13): üye ekle → 3 ❌ · rescue'ya kapı çağrısı yaz → 1, çürüme ❌.
    // 2 → 0 (2026-09-14, entegratör 1e): 01'in TAMBUR_CUT/RESCUE girişleri + kapı helper'ı
    // kaydı (`production-entry-ledger.helper`) birleşik trende ölçüldü — K=0. Üye kümesi
    // BOŞ: yeni kapısız yol (6e §4h türetmesi dahil) doğrudan kırmızı.
    const K_TABAN = 0;
    const K_UYELER: readonly string[] = [];
    const kapisizlar = gercekKy.yollar.filter((y) => !y.bagli);
    check(
      `§4e ⭐ gerçek ağaçta K ≤ taban (${K_TABAN}) — kapısız stok yolu KÜMESİ`,
      kTotal <= K_TABAN && kapisizlar.every((y) => K_UYELER.includes(y.fonksiyon)),
      `K=${kTotal}: ${kapisizlar.map((y) => y.fonksiyon).join(" · ") || "-"}`,
    );
    check(
      "§4f K tabanı ÇÜRÜMEMİŞ (gerçek < taban ise tabanı ve üye kümesini düşür)",
      kTotal >= K_TABAN,
      `gerçek ${kTotal} · taban ${K_TABAN}`,
    );
    // §4g — ÜÇÜNCÜ EKSEN: yerinde miktar değiştiren yollar. Taban YOK, SERT.
    const miktar = kapisizYolOlcumu(path.resolve(__dirname, ".."), MIKTAR_YOLLARI);
    check("§4g araç sağlam (miktar yolları yerinde)", miktar.aracSaglam, miktar.aracNotu ?? "");
    check("§4g körlük zemini: miktar yolu listesi boş değil", miktar.yollar.length >= 1, `yol=${miktar.yollar.length}`);
    check(
      "§4g ⭐ yerinde miktar değiştiren HER yol deftere bağlı (kapısız = 0, sert)",
      miktar.aracSaglam && miktar.yollar.every((y) => y.bagli),
      miktar.yollar.map((y) => `${y.fonksiyon}:${y.bagli ? y.bulunanKapi : "KAPISIZ"}`).join(" · "),
    );
    console.log(
      `   bilgi: gerçek ağaçta (${gercek.agac}) K = ${kTotal} — eski kapı ${gercek.cagiranlar.length} ` +
        `[${gercek.cagiranlar.map((c) => `${c.dosya}:${c.satir}`).join(", ") || "yok"}] + kapısız yol ` +
        `${gercekKy.yollar.filter((y) => !y.bagli).length}/${gercekKy.yollar.length} ` +
        `[${gercekKy.yollar.filter((y) => !y.bagli).map((y) => y.ad).join(", ") || "yok"}]`,
    );
  } finally {
    for (const d of gecici) fs.rmSync(d, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Beklenmeyen hata:", e);
  process.exit(1);
});
