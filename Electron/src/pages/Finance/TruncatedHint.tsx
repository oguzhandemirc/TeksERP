// Kırpılmış liste uyarısı — alt çubukta, sayacın yanında (ayrı satır değil; kullanıcı 2026-11-23).
// KIRPMA SESSİZ DEĞİL: Ön Muhasebe listelerinde kesilen liste "kayıt yok" sanılır ve mükerrer girişe yol açar.
export function TruncatedHint({ text = "Liste kırpıldı — filtreyle daraltın" }: { text?: string }) {
  return <span className="text-amber-700 dark:text-amber-500">{text}</span>;
}
