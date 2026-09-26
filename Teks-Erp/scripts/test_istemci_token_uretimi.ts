// =============================================================================
// Bekçi: İSTEMCİ TOKEN ÜRETİMİ — panel ve tablette `clientToken` deneme başına doğar, tıklama başına değil (DB'siz, AST)
// Çalıştır: npx tsx scripts/test_istemci_token_uretimi.ts
// =============================================================================
// NEDEN: gönderim anında üretilen token (`clientToken: crypto.randomUUID()` mutationFn'de) her tıklamada yenidir;
// ağ kopmasından sonra ikinci tıklama İKİNCİ kaydı açar ve sunucu boğazının replay'i hiç devreye girmez
// (`TOKEN-REPLAY-KILIDI.md` D4; ölçüldü 2026-09-26: panelde 7, tablette 1 site). Kural kk1.md "İstemci token'ı".
// Tarama `lib/istemci-token-tarama.ts` (üretimin sözdizimsel biçimi), beyan `lib/istemci-token-beyan.ts`.
//   §1 SERT KOL (taban 0): satır içi üretim (`clientToken: üret()`), sınıflanamayan üretim, beyansız `return üret()`,
//      mutationFn içinde tembel/enjeksiyon dışı üretim, gönderim olayında (onClick/onPress/onSubmit) yenileme.
//   §2 muaf satırları kapalı sınıftan; her satır tam `adet` üretimi örter; EZILEN_VARSAYILAN'ın ezeni ölçülür.
//   §3 SERT KAPI (taban 0, D4b): token TUTAN her birim politika yardımcısına bağlıdır (kesin 4xx'te yeniler).
//   §4 körlük: iki istemci de taranıyor, politika kökleri dışa açık, uyumlu tutucu tanınıyor.
//   §5 İKİZ MAKİNE: panel `lib/attemptToken.ts` ile tablet `offline/attemptToken.ts` durum makinesi AST'de özdeş.
//   §6 belirsiz-hata ölçütü istemci başına TEK tanım; tablet ikizi onu `entryAttempt`ten alır (kopya yok).
//   §7 POLİTİKA API'Sİ: `useAttemptToken` denemesi token'ı okur, sonucu `onFailure` VE `onSuccess`e bağlar; `renew`
//      başarı/hata yolunda çağrılmaz (onError/onSuccess/mutationFn · catch · then/catch/finally geri çağrısı).
//      Deneme nesnesi birimden kaçamaz (prop · argüman · dönüş; bağımlılık dizisi hariç) — kaçan sonuç bağı ölçülemez.
// KALAN RİSK (beyanlı kör nokta): uyum BİRİM düzeyinde ölçülür — politika yardımcısını kullanan bir birime
// eklenen ikinci, ayrı bir ham tutucu (`useState(() => üret())`) P3'e düşmez ve görülmez.
// §7 efektin bağımlılık dizisini ölçmez (`renew` efekti seçim dizisine bağlanırsa yeşil kalır) — bunu diyalog testi tutar.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";
import { ISTEMCI_MUAF, KOK_POLITIKA, MUAF_SINIFLARI } from "./lib/istemci-token-beyan";
import { ISTEMCI_KOKLERI, REPO, istemciDosyalari, politikaAdlari, tara, type Uretim } from "./lib/istemci-token-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const IKIZLER = ["Electron/src/lib/attemptToken.ts", "mobil/src/offline/attemptToken.ts"] as const;
/** İstemci başına belirsiz-hata ölçütünün TEK tanımı (hata biçimi istemciye özgü: panel axios, tablet `.status`). */
const BELIRSIZ_KAYNAK: Readonly<Record<string, string>> = {
  "Electron/src": "Electron/src/lib/attemptToken.ts",
  "mobil/src": "mobil/src/offline/entryAttempt.ts",
};

const HER_YERDE_SERBEST = new Set<Uretim["bicim"]>(["TUTUCU", "TEMBEL", "YENILEME", "ENJEKSIYON", "SATIR_ANAHTARI"]);
const MUTATIONFN_SERBEST = new Set<Uretim["bicim"]>(["TEMBEL", "ENJEKSIYON"]);
const TUTUCU_BICIMLER = new Set<Uretim["bicim"]>(["TUTUCU", "TEMBEL"]);

const yer = (u: Uretim) => `${u.dosya}:${u.satir} ${u.bicim}${u.olay ? `@${u.olay}` : ""} «${u.metin}»`;

function main(): void {
  console.log("=== İstemci token üretimi — deneme başına (AST) ===\n");
  const t = tara();
  const anahtar = (u: Uretim) => `${u.dosya}::${u.birim}`;
  const muafMi = (u: Uretim) => ISTEMCI_MUAF[anahtar(u)]?.bicim === u.bicim;

  console.log("§1 Sert kol — gönderim anında üretim yok");
  const ihlal = t.uretimler.filter((u) => {
    if (u.olay === "mutationFn" && !MUTATIONFN_SERBEST.has(u.bicim)) return true;
    if (u.olay === "gonderim" && u.bicim === "YENILEME") return true;
    return !HER_YERDE_SERBEST.has(u.bicim) && !muafMi(u);
  });
  check("⭐ satır içi / mutationFn içi / sınıflanamayan token üretimi YOK (taban 0)", ihlal.length === 0, ihlal.map(yer).join(" · "));

  console.log("§2 Muaf satırları");
  const sinifDisi = Object.entries(ISTEMCI_MUAF).filter(([, m]) => !(m.sinif in MUAF_SINIFLARI)).map(([k]) => k);
  check("muaf sınıfları kapalı kümeden", sinifDisi.length === 0, sinifDisi.join(" · "));
  const adetHatasi = Object.entries(ISTEMCI_MUAF).flatMap(([k, m]) => {
    const n = t.uretimler.filter((u) => anahtar(u) === k && u.bicim === m.bicim).length;
    return n === m.adet ? [] : [`${k}: beyan ${m.adet} · gerçek ${n}`];
  });
  check("her muaf satırı tam beyan ettiği adedi örter (ölü ya da geniş satır yok)", adetHatasi.length === 0, adetHatasi.join(" · "));
  const ezenHatasi = Object.entries(ISTEMCI_MUAF).flatMap(([k, m]) => {
    if (m.sinif !== "EZILEN_VARSAYILAN") return [];
    const [dosya, kurucu] = k.split("::");
    const ezilir = [...t.birimler.values()].some((b) => !b.anahtar.startsWith(`${dosya}::`) && b.adlar.has(kurucu) && !!m.ezen && b.adlar.has(m.ezen));
    return ezilir ? [] : [`${k}: ${m.ezen ?? "(ezen yok)"} kurucuyla aynı birimde çağrılmıyor`];
  });
  check("EZILEN_VARSAYILAN: kurucunun token'ı çağıran birimde politika fonksiyonuyla eziliyor", ezenHatasi.length === 0, ezenHatasi.join(" · "));

  console.log("§3 Sert kapı — token tutan her birim yardımcıya bağlı");
  const kokler = [...new Set(Object.values(KOK_POLITIKA).flat())];
  const politika = politikaAdlari(t, kokler);
  const tutucuBirimler = [...new Set(t.uretimler.filter((u) => TUTUCU_BICIMLER.has(u.bicim)).map(anahtar))];
  const uyumluMu = (k: string) => [...(t.birimler.get(k)?.adlar ?? [])].some((x) => politika.has(x));
  const bagsiz = tutucuBirimler.filter((k) => !uyumluMu(k)).sort();
  check("⭐ token tutan birim politika yardımcısına bağlı (taban 0 — kesin 4xx'te yenilemeyen tutucu yok)", bagsiz.length === 0, bagsiz.join(" · "));

  console.log("§4 Körlük sondası");
  for (const kok of ISTEMCI_KOKLERI) {
    const n = t.uretimler.filter((u) => u.dosya.startsWith(`${kok}/`)).length;
    check(`${kok} taranıyor (≥ 10 üretim)`, n >= 10, `${n} üretim`);
  }
  check("dosya taraması kör değil (≥ 1500 dosya)", t.dosyaSayisi >= 1500, `${t.dosyaSayisi} dosya`);
  const kokEksik = Object.entries(KOK_POLITIKA).flatMap(([dosya, adlar]) =>
    adlar.filter((ad) => !t.disaAcik.some((f) => f.dosya === dosya && f.ad === ad)).map((ad) => `${dosya}::${ad}`),
  );
  check("politika kökleri beyan edilen dosyadan dışa açılıyor", kokEksik.length === 0, kokEksik.join(" · "));
  check("politika adları türetiliyor (≥ 6)", politika.size >= 6, [...politika].sort().join(","));
  const uyumlu = tutucuBirimler.filter(uyumluMu);
  check("uyumlu tutucu tanınıyor (≥ 2 birim)", uyumlu.length >= 2, uyumlu.join(" · "));

  console.log("§5 İkiz makine (panel ↔ tablet)");
  const kaynak = (rel: string) => ts.createSourceFile(rel, fs.readFileSync(path.join(REPO, rel), "utf8"), ts.ScriptTarget.Latest, true);
  const govde = (sf: ts.SourceFile, ad: string) => {
    const f = sf.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === ad);
    // Yorum ve boşluk atılır, tırnak biçimi tekleşir: iki istemcinin biçim kuralı farklı (panel ", tablet ').
    return f?.body ? ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, f.body, sf).replace(/'/g, '"').replace(/\s+/g, " ") : null;
  };
  const uyeler = (sf: ts.SourceFile) => {
    const i = sf.statements.find((st): st is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(st) && st.name.text === "AttemptToken");
    return i ? i.members.map((m) => m.name?.getText(sf) ?? "?").join(",") : null;
  };
  const [panel, tablet] = IKIZLER.map(kaynak);
  for (const ad of ["createAttemptToken", "useAttemptToken"]) {
    const [p, m] = [govde(panel!, ad), govde(tablet!, ad)];
    check(`⭐ ${ad} gövdesi iki istemcide özdeş`, p !== null && p === m, p === null || m === null ? "fonksiyon bulunamadı" : p === m ? "aynı" : `panel «${p.slice(0, 120)}» ≠ tablet «${m.slice(0, 120)}»`);
  }
  const [up, ut] = [uyeler(panel!), uyeler(tablet!)];
  check("AttemptToken arayüzü iki istemcide aynı üyeleri taşır", up !== null && up === ut, `${up} | ${ut}`);

  console.log("§6 Belirsiz-hata ölçütü istemci başına tek tanım");
  for (const kok of ISTEMCI_KOKLERI) {
    const tanimlar = t.disaAcik.filter((f) => f.ad === "isAmbiguousFailure" && f.dosya.startsWith(`${kok}/`)).map((f) => f.dosya);
    check(`⭐ ${kok}: isAmbiguousFailure yalnız ${BELIRSIZ_KAYNAK[kok]}'de tanımlı`, tanimlar.length === 1 && tanimlar[0] === BELIRSIZ_KAYNAK[kok], tanimlar.join(" · ") || "tanım yok");
  }
  const ikizKaynak = fs.readFileSync(path.join(REPO, IKIZLER[1]), "utf8");
  check("tablet ikizi ölçütü entryAttempt'ten alır (kopya yok)", /import\s*\{[^}]*\bisAmbiguousFailure\b[^}]*\}\s*from\s*['"]\.\/entryAttempt['"]/.test(ikizKaynak));

  console.log("§7 Politika API'si — deneme sonucu yardımcıya bağlı, renew yalnız açılış/sıfırlama");
  const SONUC_YOLU = new Set(["onError", "onSuccess", "onSettled", "mutationFn"]);
  const BAGIMLILIK = new Set(["useEffect", "useLayoutEffect", "useCallback", "useMemo"]);
  const apiHatasi: string[] = [];
  let deneme = 0;
  for (const rel of istemciDosyalari()) {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    // Hook dışı makine (`createAttemptToken`) bu ölçümü atlatır; adı (takma adla import dahil) yalnız yardımcıda geçer.
    if (!(IKIZLER as readonly string[]).includes(rel) && /\bcreateAttemptToken\b/.test(src)) apiHatasi.push(`${rel}: createAttemptToken yardımcı dışında (useAttemptToken kullan)`);
    // Takma adlı hook denemeyi taramadan saklar.
    if (/\buseAttemptToken\s+as\b/.test(src)) apiHatasi.push(`${rel}: useAttemptToken takma adla içe alınmış (tarama göremez)`);
    if (!/\buseAttemptToken\s*\(/.test(src)) continue;
    const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const satir = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const gez = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer) && /(^|\.)useAttemptToken$/.test(n.initializer.expression.getText(sf))) {
        deneme++;
        const ad = n.name.text;
        // Kapsam: bildirimi içeren en yakın fonksiyon (hook gövdesi).
        let kapsam: ts.Node = n;
        while (kapsam.parent && !(ts.isFunctionDeclaration(kapsam) || ts.isArrowFunction(kapsam) || ts.isFunctionExpression(kapsam) || ts.isMethodDeclaration(kapsam))) kapsam = kapsam.parent;
        const cagri = new Map<string, ts.Node[]>();
        let kacti = false;
        const tara7 = (k: ts.Node) => {
          if (ts.isIdentifier(k) && k.text === ad && k !== n.name) {
            const ust = k.parent;
            if (ts.isPropertyAccessExpression(ust) && ust.expression === k) {
              const liste = cagri.get(ust.name.text) ?? [];
              liste.push(ust);
              cagri.set(ust.name.text, liste);
            } else {
              // Bağımlılık dizisi (useEffect/useCallback/useMemo'nun ikinci argümanı) kaçış değildir.
              const dizi = ts.isArrayLiteralExpression(ust) ? ust.parent : null;
              const bagimlilik = dizi && ts.isCallExpression(dizi) && BAGIMLILIK.has(dizi.expression.getText(sf)) && dizi.arguments[1] === ust;
              if (!bagimlilik) kacti = true;
            }
          }
          ts.forEachChild(k, tara7);
        };
        tara7(kapsam);
        const yer = `${rel}:${satir(n)} ${ad}`;
        if (!cagri.has("token") && !cagri.has("keyed")) apiHatasi.push(`${yer}: token/keyed okunmuyor`);
        // Birimden kaçan deneme (prop/argüman/dönüş) sonucun nereye bağlandığını ölçülemez kılar → fail-closed.
        if (kacti) apiHatasi.push(`${yer}: deneme nesnesi birimden kaçıyor (sonuç bağı ölçülemez)`);
        else {
          if (!cagri.has("onFailure")) apiHatasi.push(`${yer}: onFailure çağrılmıyor (kesin 4xx'te yenileme / belirsizde yapışma yok)`);
          if (!cagri.has("onSuccess")) apiHatasi.push(`${yer}: onSuccess çağrılmıyor`);
        }
        for (const r of cagri.get("renew") ?? []) {
          for (let u: ts.Node | undefined = r.parent; u && u !== kapsam; u = u.parent) {
            const sonucYolu =
              (ts.isPropertyAssignment(u) && SONUC_YOLU.has(u.name.getText(sf))) ||
              ts.isCatchClause(u) ||
              ((ts.isArrowFunction(u) || ts.isFunctionExpression(u)) && ts.isCallExpression(u.parent) && ts.isPropertyAccessExpression(u.parent.expression) && ["then", "catch", "finally"].includes(u.parent.expression.name.text));
            if (sonucYolu) {
              apiHatasi.push(`${rel}:${satir(r)} ${ad}.renew() sonuç yolunda (belirsiz hatada token'ı düşürür)`);
              break;
            }
          }
        }
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  check("⭐ her deneme token'ı okur, onFailure + onSuccess'e bağlı; renew sonuç yolunda değil", apiHatasi.length === 0, apiHatasi.join(" · "));
  check("deneme taraması kör değil (≥ 30 useAttemptToken)", deneme >= 30, `${deneme} deneme`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
