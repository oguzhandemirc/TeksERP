// =============================================================================
// CI PARÇALI BEKÇİ KOŞUMU — dağıtım + birleşim denetimi (TEK KAYNAK)
// =============================================================================
// NEDEN: sıralı paket CI'da ~40 dk sürüyordu (807 dosya, 2026-10-12). CI bekçileri N
// parçaya böler; her parça kendi runner'ında kendi Postgres'iyle koşar. Bu dosya iki
// soruyu cevaplar ve ikisini de `run-all-tests.ts` kullanır:
//   ① `parcalariKur` — hangi dosya hangi parçada (süre dengeli, BELİRLENİMLİ: her
//      parça aynı ağaçtan aynı tabloyu kurar, aralarında iletişim yoktur).
//   ② `birlesimDenetimi` — parçaların GERÇEKTE koştuğu dosyaların birleşimi = diskteki
//      bütün bekçiler, kesişim boş. Sessiz atlanan bekçi = KIRMIZI.
// Süre tablosu `scripts/ci-parca-sureleri.json`; tabloda olmayan (yeni) dosya ad
// özetiyle (sha256) bir parçaya düşer. Tablo yalnız DENGEYİ etkiler, doğruluğu değil.
// =============================================================================
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const SURE_TABLOSU_YOLU = join(__dirname, "..", "ci-parca-sureleri.json");

/**
 * Gizli SIRA BAĞIMLILIĞI ölçülmüş dosyalar: grup tek birim olarak AYNI parçaya düşer ve
 * parça içinde BİTİŞİK, YAZILDIĞI SIRAYLA koşar (blok, son üyesinin adının yerinde).
 * Bitişiklik şart: araya giren bekçi önkoşulu bozabilir (ölçüldü, aşağıda). Üye eklerken
 * gerekçe + ölçüm yazılır. Ölçüm 2026-10-12, dal koşusu 38304837817 + `tekserp_ciparca_test`.
 */
export const SABIT_GRUPLAR: readonly (readonly string[])[] = [
  // `doc_pagesize_override` salt-okunur ve var olan bir SUBCONTRACTOR_DISPATCH belgesi
  // ister ("hiç SUBCONTRACTOR_DISPATCH yok"); taze DB'de onu `consecutive_fason` bırakır.
  ["test_consecutive_fason.ts", "test_doc_pagesize_override.ts"],
  // `rol_modeli_kalinti` ① DB'de bağsız fason profili OLMADIĞINI ister; `migrate_partner_roles`
  // göçü hepsini bağlar. Araya `fixture-subcontractor` çağıran bir bekçi girerse TEST-FASON-*
  // bağsız doğar ⇒ bitişik koşmalı (ölçüldü: m → r yeşil, m → fason bekçisi → r kırmızı).
  ["test_migrate_partner_roles.ts", "test_rol_modeli_kalinti.ts"],
];

export interface ParcaKaydi {
  parca: number;
  toplam: number;
  sha: string;
  dosyalar: string[];
  basarisiz: string[];
  /** dosya → saniye (bu koşumun ölçümü; tablo yenilemesi için) */
  sureler: Record<string, number>;
}

/** `i/N` biçimini çözer (1 ≤ i ≤ N); geçersizde null — çağıran fail-closed düşer. */
export function parcaArgumaniCoz(arg: string | undefined): { i: number; n: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(arg ?? "");
  if (!m) return null;
  const i = Number(m[1]);
  const n = Number(m[2]);
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 1 || i > n) return null;
  return { i, n };
}

export function sureTablosuOku(yol = SURE_TABLOSU_YOLU): Record<string, number> {
  const ham = JSON.parse(readFileSync(yol, "utf8")) as { sureler?: Record<string, number> };
  if (!ham.sureler || typeof ham.sureler !== "object") throw new Error(`süre tablosu bozuk: ${yol}`);
  return ham.sureler;
}

/** Tabloda olmayan dosyanın parçası (0 tabanlı) — ada bağlı, ağaçtan bağımsız. */
export function ozetParcasi(dosya: string, n: number): number {
  return parseInt(createHash("sha256").update(dosya).digest("hex").slice(0, 8), 16) % n;
}

/**
 * Dosyaları N parçaya böler. Bilinen süreli birimler en uzun-önce açgözlü (LPT) en az
 * yüklü parçaya; bilinmeyenler `ozetParcasi` ile. Parça içi sıra ada göredir (sıralı
 * koşumdaki göreli sıra korunur); sabit grup bitişik blok, son üyesinin adının yerinde.
 * Eşitlikler ad ve parça numarasıyla bozulur ⇒ aynı girdi her makinede aynı çıktı.
 */
export function parcalariKur(
  dosyalar: readonly string[],
  n: number,
  sureler: Readonly<Record<string, number>>,
  gruplar: readonly (readonly string[])[] = SABIT_GRUPLAR,
): string[][] {
  if (!Number.isInteger(n) || n < 1) throw new Error(`parça sayısı geçersiz: ${n}`);
  const kume = new Set(dosyalar);
  const gruptaki = new Set<string>();
  type Birim = { ad: string; anahtar: string; uyeler: string[]; sure: number | null };
  const birimler: Birim[] = [];
  for (const g of gruplar) {
    const uyeler = [...new Set(g)].filter((f) => kume.has(f) && !gruptaki.has(f));
    if (uyeler.length === 0) continue;
    for (const f of uyeler) gruptaki.add(f);
    const bilinen = uyeler.filter((f) => typeof sureler[f] === "number");
    const sirali = [...uyeler].sort();
    birimler.push({
      ad: sirali[0]!,
      anahtar: sirali[sirali.length - 1]!,
      uyeler,
      sure: bilinen.length ? bilinen.reduce((s, f) => s + sureler[f]!, 0) : null,
    });
  }
  for (const f of [...kume].sort()) {
    if (gruptaki.has(f)) continue;
    birimler.push({ ad: f, anahtar: f, uyeler: [f], sure: typeof sureler[f] === "number" ? sureler[f]! : null });
  }
  const parcalar: Birim[][] = Array.from({ length: n }, () => []);
  const yuk = new Array<number>(n).fill(0);
  const bilinenler = birimler
    .filter((b) => b.sure !== null)
    .sort((a, b) => b.sure! - a.sure! || (a.ad < b.ad ? -1 : a.ad > b.ad ? 1 : 0));
  for (const b of bilinenler) {
    let hedef = 0;
    for (let k = 1; k < n; k++) if (yuk[k]! < yuk[hedef]!) hedef = k;
    yuk[hedef]! += b.sure!;
    parcalar[hedef]!.push(b);
  }
  for (const b of birimler.filter((x) => x.sure === null)) parcalar[ozetParcasi(b.ad, n)]!.push(b);
  return parcalar.map((p) =>
    p.sort((a, b) => (a.anahtar < b.anahtar ? -1 : a.anahtar > b.anahtar ? 1 : 0)).flatMap((b) => b.uyeler),
  );
}

/** Parça başına tahmini süre (sn); tabloda olmayan dosya 0 sayılır. */
export function parcaYukleri(parcalar: readonly string[][], sureler: Readonly<Record<string, number>>): number[] {
  return parcalar.map((p) => p.reduce((s, f) => s + (sureler[f] ?? 0), 0));
}

/**
 * Parça kayıtlarının birleşimi = `tumDosyalar`, kesişim boş, 1..N her parça TAM bir
 * kez. Boş hata listesi = yeşil. Kayıt yoksa (parça hiç koşmadıysa) o da hatadır.
 */
export function birlesimDenetimi(
  tumDosyalar: readonly string[],
  kayitlar: readonly Pick<ParcaKaydi, "parca" | "toplam" | "dosyalar">[],
): string[] {
  const hatalar: string[] = [];
  if (kayitlar.length === 0) return ["hiç parça kaydı yok — hiçbir parça koşum sonuna ulaşmadı"];
  const toplamlar = [...new Set(kayitlar.map((k) => k.toplam))];
  if (toplamlar.length !== 1) hatalar.push(`parça kayıtları farklı N taşıyor: ${toplamlar.join(", ")}`);
  const n = Math.max(...toplamlar);
  for (let i = 1; i <= n; i++) {
    const adet = kayitlar.filter((k) => k.parca === i).length;
    if (adet !== 1) hatalar.push(`parça ${i}/${n}: ${adet} kayıt (beklenen 1)`);
  }
  const sayac = new Map<string, number[]>();
  for (const k of kayitlar) for (const f of k.dosyalar) sayac.set(f, [...(sayac.get(f) ?? []), k.parca]);
  for (const f of [...tumDosyalar].sort()) {
    const p = sayac.get(f);
    if (!p) hatalar.push(`HİÇBİR PARÇADA KOŞMADI: ${f}`);
    else if (p.length > 1) hatalar.push(`BİRDEN ÇOK PARÇADA KOŞTU: ${f} (parça ${p.join(", ")})`);
  }
  const disk = new Set(tumDosyalar);
  for (const f of [...sayac.keys()].sort()) if (!disk.has(f)) hatalar.push(`kayıtta var, diskte yok: ${f}`);
  return hatalar;
}
