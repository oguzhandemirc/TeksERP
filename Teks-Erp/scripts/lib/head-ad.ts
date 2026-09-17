// =============================================================================
// "Bu ad HEAD'de zaten var mıydı?" — nedensellik daraltmasının tek okuyucusu
// =============================================================================
// `test_identifier_language` (mandal) ihlali dosyaya DOKUNANA değil ÜRETENE yazmak için
// HEAD'deki kopyayı okur. Yeni (HEAD'de olmayan, sahnelenmiş) dosyada `git show HEAD:…`
// meşru olarak düşer ve cevap "yok"tur — ama git'in `fatal: path … not in HEAD` stderr'i
// kapı çıktısına sızıyordu: hüküm doğru, çıktı kirli (9b ölçtü 2026-09-17). Stderr yutulur;
// hata dalı zaten "HEAD'de yok" demektir, sessiz değil ANLAMLIDIR.
// =============================================================================
import { git } from "./git";

/** Bildirilen tanımlayıcılar — yorum ve dize İÇERİĞİ sayılmaz (mandalla aynı desen). */
export const BILDIRIM = /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

export function yorumsuz(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** O dosyanın HEAD'deki hâlinde bu ad zaten var mıydı? Dosya HEAD'de yoksa (yeni dosya) → false, gürültüsüz. */
export function headdeVarMi(dosya: string, ad: string, cwd: string): boolean {
  try {
    const ham = git(["show", `HEAD:${dosya}`], { cwd, stdio: "yut" });
    for (const m of yorumsuz(ham).matchAll(BILDIRIM)) if (m[1] === ad) return true;
    return false;
  } catch {
    // Dosya HEAD'de yok (yeni dosya) ⇒ ad da yok. Yeni dosya bu commit'in eseridir,
    // ihlali ona yazmak DOĞRUDUR — `fatal` satırı ise okuyana hiçbir şey söylemez.
    return false;
  }
}
