// =============================================================================
// PORTFÖY ÖZETİ — DURUM × PARA BİRİMİ
// =============================================================================
// ⚠️ PARA BİRİMLERİ TOPLANMAZ ve tek bir "toplam" rakamı BASILMAZ. 1.000 USD ile
// 30.000 TL'yi toplamak matematiksel olarak anlamsızdır; TL karşılıklarını
// toplamak ise DAHA KÖTÜDÜR — her çek kendi damgalanmış kuruyla saklanır, yani
// çıkan rakam "bugünkü kurla" sanılan ama aslında geçmiş kurların karışımı olan
// bir sayı olurdu. Backend `summary` ucu da tam bu gerekçeyle kırılım döner.
//
// ⚠️ İSTEMCİDE TOPLAMA HİÇ YOK: backend `groupBy(status, currency, kind)` ile
// döndüğü için her satır ZATEN benzersiz bir kovanın toplamıdır. Kartlar bu
// satırları yalnız yerleştirir. Kovaları birleştirmek (ör. "elimizde + bankada")
// JS float aritmetiği demekti ve para bu projede istemcide hesaplanmaz.
//
// ⚠️ YALNIZ CANLI KOVALAR: tahsil/karşılıksız/iade/ödendi/iptal PORTFÖY DEĞİL
// GEÇMİŞTİR; onların yeri raporlardır. Portföy ekranının tek sorusu "elimde ne
// var, sırada ne var".
// =============================================================================
import { Landmark, Undo2, Wallet, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "../service";
import type { Currency } from "../service";
import { toNum, type ChequeKind, type ChequeStatus, type ChequeSummaryRow } from "./service";

interface Bucket {
  kind: ChequeKind;
  status: ChequeStatus;
  title: string;
  hint: string;
  icon: typeof Wallet;
  tone: string;
}

const BUCKETS: Bucket[] = [
  {
    kind: "RECEIVED",
    status: "PORTFOLIO",
    title: "Elimizde",
    hint: "Alınan, henüz bankaya verilmemiş",
    icon: Wallet,
    tone: "text-amber-600 dark:text-amber-500",
  },
  {
    kind: "RECEIVED",
    status: "AT_BANK",
    title: "Bankada",
    hint: "Tahsile verildi, para henüz gelmedi",
    icon: Landmark,
    tone: "text-sky-600 dark:text-sky-400",
  },
  {
    kind: "RECEIVED",
    status: "ENDORSED",
    title: "Ciro Edilen",
    hint: "Başkasına devredildi, karşılıksız çıkabilir",
    icon: Undo2,
    tone: "text-violet-600 dark:text-violet-400",
  },
  {
    kind: "ISSUED",
    status: "ISSUED",
    title: "Verdiğimiz",
    hint: "Kendi çekimiz, henüz ödenmedi",
    icon: ArrowUpRight,
    tone: "text-rose-600 dark:text-rose-400",
  },
];

interface Props {
  rows: ChequeSummaryRow[];
  isLoading: boolean;
  /**
   * Özet isteği düştüyse kartlar ÇİZİLMEZ.
   *
   * ⚠️ Hata hâlinde `rows` boş dizidir ve o dizi "0 adet · —" olarak basılırsa
   * ekran, portföyde hiç çek olmadığını SÖYLER. Sayı gösteren bir yüzeyde en
   * kötü davranış budur: kullanıcı boş kovaya bakıp çekini yeniden girer.
   */
  isError?: boolean;
  /** Kart tıklanınca listeyi o kovaya daraltır — özet ile liste aynı şeyi göstersin. */
  onSelect: (kind: ChequeKind, status: ChequeStatus) => void;
  /** Şu an seçili kova ("KIND:STATUS") — yoksa hiçbiri vurgulanmaz. */
  activeKey: string | null;
}

export function ChequeSummaryCards({ rows, isLoading, isError, onSelect, activeKey }: Props) {
  if (isLoading) {
    return <p className="mb-4 text-sm text-muted-foreground">Portföy özeti yükleniyor…</p>;
  }
  if (isError) {
    return (
      <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Portföy özeti yüklenemedi — kovalardaki adet ve tutarlar bu yüzden gösterilmiyor (sıfır oldukları
        anlamına GELMEZ).
      </div>
    );
  }

  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {BUCKETS.map((b) => {
        const lines = rows.filter((r) => r.kind === b.kind && r.status === b.status);
        const count = lines.reduce((sum, r) => sum + r.count, 0); // adet — para değil, toplanır
        const active = activeKey === `${b.kind}:${b.status}`;
        const Icon = b.icon;
        return (
          <button
            key={`${b.kind}:${b.status}`}
            type="button"
            onClick={() => onSelect(b.kind, b.status)}
            className={cn(
              "rounded-md border p-3 text-left transition-colors hover:bg-muted/50",
              active && "border-primary bg-primary/5",
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4", b.tone)} />
              <span className="text-sm font-semibold">{b.title}</span>
              <span className="ml-auto text-xs text-muted-foreground">{count} adet</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{b.hint}</p>
            <div className="mt-2 flex flex-col gap-0.5">
              {lines.length === 0 ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                lines.map((r) => (
                  <span key={r.currency} className="text-sm font-medium">
                    {money(toNum(r.amount), r.currency as Currency)}
                  </span>
                ))
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
