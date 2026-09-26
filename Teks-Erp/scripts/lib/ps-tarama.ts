// =============================================================================
// PowerShell kaynağını satır satır ayıran küçük tarayıcı (bekçiler için)
// =============================================================================
// NEDEN: sunucu betiklerinin sözleşmeleri (yönlendirme yalnız EAP=Continue
// yardımcısında · yorum dışı metin ASCII · çıplak `npm` yok) YORUMU ve STRING'i
// kodtan ayırmadan ölçülemez: `Write-Host "npm ci"` bir çağrı değildir, `# ⚠`
// bir string değildir. pwsh her ortamda yok, AST'ye güvenilemez; bu tarayıcı
// yalnız bekçinin ihtiyacı kadarını bilir (yorum · '…' · "…" · here-string · { }).
// =============================================================================

export interface PsSatir {
  /** 1 tabanlı satır numarası. */
  no: number;
  /** Yorumlar çıkarılmış, string İÇERİKLERİ korunmuş metin (ASCII ölçümü için). */
  kod: string;
  /** Yorumlar ve string içerikleri çıkarılmış metin (çağrı ölçümü için). */
  ciplak: string;
  /** Satırın BAŞINDAKİ süslü parantez derinliği. */
  derinlik: number;
}

export interface PsFonksiyon {
  ad: string;
  /** Başlık ve kapanış satırları (1 tabanlı, kapsayıcı). */
  bas: number;
  son: number;
}

export interface PsTarama {
  satirlar: PsSatir[];
  fonksiyonlar: PsFonksiyon[];
}

export function psTara(kaynak: string): PsTarama {
  const hamSatirlar = kaynak.replace(/\r\n/g, "\n").split("\n");
  const satirlar: PsSatir[] = [];
  let derinlik = 0;
  let blokYorum = false;
  let hereString: '"' | "'" | null = null;
  let tek: "'" | '"' | null = null;
  const acik: Array<{ ad: string | null; bas: number; derinlik: number }> = [];
  const fonksiyonlar: PsFonksiyon[] = [];
  let bekleyenFonksiyon: { ad: string; bas: number } | null = null;

  hamSatirlar.forEach((ham, i) => {
    const no = i + 1;
    const basDerinlik = derinlik;
    let kod = "";
    let ciplak = "";

    if (hereString) {
      // here-string kapanışı satırın BAŞINDA `"@` / `'@`
      if (ham.startsWith(`${hereString}@`)) {
        hereString = null;
        kod = ham;
        ciplak = ham.slice(2);
      } else {
        kod = ham;
      }
      satirlar.push({ no, kod, ciplak, derinlik: basDerinlik });
      return;
    }

    const fm = /^\s*function\s+([A-Za-z_][\w-]*)/i.exec(ham);
    if (fm && !blokYorum && !tek) bekleyenFonksiyon = { ad: fm[1]!, bas: no };

    for (let j = 0; j < ham.length; j++) {
      const c = ham[j]!;
      const s = ham[j + 1];
      if (blokYorum) {
        if (c === "#" && s === ">") { blokYorum = false; j++; }
        continue;
      }
      if (tek) {
        kod += c;
        if (tek === '"' && c === "`") { kod += s ?? ""; j++; continue; }
        if (c === tek) {
          if (s === tek) { kod += s; j++; continue; } // '' / "" kaçışı
          tek = null;
          ciplak += c;
        }
        continue;
      }
      if (c === "<" && s === "#") { blokYorum = true; j++; continue; }
      if (c === "#") break; // satır yorumu
      if (c === "@" && (s === '"' || s === "'") && ham.slice(j + 2).trim() === "") {
        hereString = s;
        kod += ham.slice(j);
        ciplak += "@" + s;
        break;
      }
      if (c === "`") { kod += c + (s ?? ""); ciplak += c + (s ?? ""); j++; continue; }
      if (c === "'" || c === '"') { tek = c; kod += c; ciplak += c; continue; }
      if (c === "{") {
        derinlik++;
        acik.push({ ad: bekleyenFonksiyon?.ad ?? null, bas: bekleyenFonksiyon?.bas ?? no, derinlik });
        bekleyenFonksiyon = null;
      } else if (c === "}") {
        const k = acik.pop();
        if (k?.ad) fonksiyonlar.push({ ad: k.ad, bas: k.bas, son: no });
        derinlik = Math.max(0, derinlik - 1);
      }
      kod += c;
      ciplak += c;
    }
    // Çok satırlı "…" string: satır sonunda açık kalabilir (PowerShell buna izin verir).
    satirlar.push({ no, kod, ciplak, derinlik: basDerinlik });
  });

  return { satirlar, fonksiyonlar };
}

/** Satırı içeren EN İÇTEKİ fonksiyon (yoksa null). */
export function kapsayanFonksiyon(t: PsTarama, satirNo: number): PsFonksiyon | null {
  let en: PsFonksiyon | null = null;
  for (const f of t.fonksiyonlar) {
    if (f.bas <= satirNo && satirNo <= f.son && (!en || f.bas >= en.bas)) en = f;
  }
  return en;
}
