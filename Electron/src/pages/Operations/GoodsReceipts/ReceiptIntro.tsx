// Mal kabul üst açıklaması — "Adet"in anlamı satır türüne göre değişir: kumaşta kaç top (her biri barkodlu),
// iplikte kaç ayrı iplik defter satırı (her biri yazılan kg'de); sarfta adet yok. Açıklama yalnız bulunan türleri anlatır.
import type { ReceiptLineKind } from "./receiptLineColumns";

export function receiptIntroKind(kinds: readonly ReceiptLineKind[]): "FABRIC" | "YARN" | "MIXED" {
  const fabric = kinds.includes("FABRIC");
  const yarn = kinds.includes("YARN");
  if (yarn && fabric) return "MIXED";
  return yarn ? "YARN" : "FABRIC";
}

export function ReceiptIntro({ kinds }: { kinds: readonly ReceiptLineKind[] }) {
  const k = receiptIntroKind(kinds);
  return (
    <span data-testid="receipt-intro" data-kind={k}>
      {k === "FABRIC" ? (
        <>Aynı üründen birden fazla top geldiyse <b>Adet</b> yazmanız yeter — her top kendi barkoduyla ayrı ayrı doğar. </>
      ) : k === "YARN" ? (
        <>İplikte <b>Adet</b>, kaç ayrı iplik defter satırı doğacağıdır — her biri satıra yazılan kg'dedir. </>
      ) : (
        <><b>Adet</b>: kumaşta kaç top (her top kendi barkoduyla doğar); iplikte kaç ayrı defter satırı (her biri yazılan kg'de). </>
      )}
      Benzer bir satır için <b>kopyala</b> düğmesini kullanın.
    </span>
  );
}
