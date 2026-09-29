// SENARYO P — adım defteri (yeşil/kırmızı/kısmi + kanıt satırları). `test_` öneki yok → bekçi değil.
import type { Duzenek } from "./senaryo-patron-duzenek";

export class Adim {
  readonly kanit: string[] = [];
  kirmizi = 0;
  kismiNedeni: string | null = null;
  kontrol(ad: string, ok: boolean, ayrinti = ""): boolean {
    const satir = `${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`;
    this.kanit.push(satir);
    console.log(`    ${satir}`);
    if (!ok) this.kirmizi++;
    return ok;
  }
  not(metin: string): void {
    this.kanit.push(`ℹ️ ${metin}`);
    console.log(`    ℹ️ ${metin}`);
  }
  kismi(neden: string): void {
    this.kismiNedeni = neden;
    console.log(`    ⚠️ KISMİ: ${neden}`);
  }
}

export type AdimFn = (no: string, baslik: string, fn: (a: Adim) => Promise<void>) => Promise<void>;
export type AdimGrubu = (d: Duzenek, adim: AdimFn) => Promise<void>;

/** Koşul sağlanana dek dener; geçen süre (ms) ya da zaman aşımında null. */
export async function bekleKosul(kosul: () => Promise<boolean>, ms: number, aralik = 250): Promise<number | null> {
  const t0 = Date.now();
  for (;;) {
    if (await kosul()) return Date.now() - t0;
    if (Date.now() - t0 > ms) return null;
    await new Promise((r) => setTimeout(r, aralik));
  }
}
