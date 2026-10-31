/** Masraf kategorisi patron uygulamasına özet olarak gider (D4-H2, S15 a) — kişi adı yazılmasın diye form ipucu. */
export const EXPENSE_CATEGORY_PRIVACY_HINT =
  "Kategori patron uygulamasında masraf özeti olarak görünür; kişi adı yazmayın (ör. \"Maaş\" yazın, çalışanın adını değil).";

export function CategoryPrivacyHint({ active }: { active: boolean }) {
  if (!active) return null;
  return <p className="mt-1 text-xs text-muted-foreground" data-testid="kategori-kisi-adi-ipucu">{EXPENSE_CATEGORY_PRIVACY_HINT}</p>;
}
