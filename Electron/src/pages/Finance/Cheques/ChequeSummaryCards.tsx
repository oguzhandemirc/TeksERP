// =============================================================================
// PORTFÖY ÖZETİ — DURUM × PARA BİRİMİ  (+ VADE KOVASI KARTI)
// =============================================================================
// ⚠️ PARA BİRİMLERİ TOPLANMAZ ve tek bir "toplam" rakamı BASILMAZ. 1.000 USD ile
// 30.000 TL'yi toplamak matematiksel olarak anlamsızdır; TL karşılıklarını
// toplamak ise DAHA KÖTÜDÜR — her çek kendi damgalanmış kuruyla saklanır, yani
// çıkan rakam "bugünkü kurla" sanılan ama aslında geçmiş kurların karışımı olan
// bir sayı olurdu. Backend `summary` / `due-summary` uçları da tam bu gerekçeyle
// kırılım döner.
//
// ⚠️ İSTEMCİDE TOPLAMA HİÇ YOK: backend `groupBy(status, currency, kind)` ile
// döndüğü için her satır ZATEN benzersiz bir kovanın toplamıdır. Kartlar bu
// satırları yalnız yerleştirir. Kovaları birleştirmek (ör. "elimizde + bankada")
// JS float aritmetiği demekti ve para bu projede istemcide hesaplanmaz.
//
// ⚠️ YALNIZ CANLI KOVALAR: tahsil/karşılıksız/iade/ödendi/iptal PORTFÖY DEĞİL
// GEÇMİŞTİR; onların yeri raporlardır. Portföy ekranının tek sorusu "elimde ne
// var, sırada ne var".
//
// ── VADE KARTI (H4) ─────────────────────────────────────────────────────────
// ⚠️ VADE KOVASI DURUM KOVASI DEĞİLDİR ve dört durum kartıyla aynı satırda
// durması bu yüzden bilinçli bir karardır: soru "elimde ne var" değil "SIRADA
// ne var". İki satır bilgi taşır — vadesi GEÇMİŞ ve YAKLAŞAN — çünkü ikisi ayrı
// aksiyon üretir (biri tahsilat takibi, diğeri planlama).
//
// ⚠️ KARTIN SORDUĞU SORU İLE LİSTENİN GÖSTERDİĞİ AYNI KÜME OLMALI. Vade
// kovaları CİRO EDİLMİŞ çeği DIŞLAR (alacak üçüncü tarafa geçti), listenin
// varsayılan "canlı olanlar" süzgeci ise ONU İÇERİR. Bu yüzden karta tıklamak
// yalnız vade aralığını değil, DURUM süzgecini de kurar ve o listeyi backend'in
// döndürdüğü `liveStatuses`ten üretir — istemcide ikinci bir durum listesi
// yazmak, kart "3 çek" derken listede 4 satır çıkması demekti.
//
// ⚠️ EŞİK ("7 gün") İSTEMCİDE YAZILI DEĞİL, `soonDays` olarak backend'den gelir
// ve satır rengini veren `dueTone` ile aynı eşiktir. Kart "3 yaklaşan" derken
// listede 4 satır amber yanarsa kullanıcı hangisinin doğru olduğunu bilemez.
//
// ⚠️ `onSelectDue` OPSİYONELDİR: verilmezse kart bilgi kutusu olarak çizilir,
// TIKLANABİLİR GÖRÜNMEZ (buton değil `div`). Hiçbir şey yapmayan bir buton,
// olmayan bir yolu vaat etmektir.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Landmark, Undo2, Wallet, ArrowUpRight, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getChequeDueSummary,
  type ChequeDueBucket,
  type ChequeDueSummary,
} from "@/pages/Reports/Finance/chequeDueService";
import { money } from "../service";
import type { Currency } from "../service";
import { LIVE_STATUS } from "./ChequeFilterBar";
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

/** Vade kartından listeye geçen süzgeç yaması — dört alan da BİRLİKTE değişir. */
export interface ChequeDueFilterPatch {
  status: string;
  kind: string;
  dueFrom: string;
  dueTo: string;
}

/** Kartın iki satırı — liste süzgecinin anahtarı da budur. */
export type ChequeDueSelection = Extract<ChequeDueBucket, "OVERDUE" | "SOON">;

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
  /**
   * Vade satırına tıklanınca uygulanacak süzgeç yaması. VERİLMEZSE vade kartı
   * salt-okunur çizilir (bkz. dosya başlığı).
   */
  onSelectDue?: (patch: ChequeDueFilterPatch, selection: ChequeDueSelection | null) => void;
  /** Şu an seçili vade satırı — yoksa hiçbiri vurgulanmaz. */
  activeDueKey?: ChequeDueSelection | null;
}

export function ChequeSummaryCards({
  rows,
  isLoading,
  isError,
  onSelect,
  activeKey,
  onSelectDue,
  activeDueKey,
}: Props) {
  // Vade özeti AYRI bir sorudur (zaman kovaları ↔ durum kovaları) ve kendi
  // ucundan gelir. Sorgu anahtarı `["finance", ...]` ile başlar → sayfanın
  // geçiş sonrası `invalidateQueries({ queryKey: ["finance"] })` çağrısı bu
  // kartı da tazeler; ayrı bir anahtar uzayı seçmek, tahsil edilen çekin
  // vade kartında asılı kalması demekti.
  const dueQ = useQuery({
    queryKey: ["finance", "cheques", "due-summary"],
    queryFn: () => getChequeDueSummary(),
  });

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
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
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

      <DueCard
        data={dueQ.data}
        isLoading={dueQ.isLoading}
        isError={dueQ.isError}
        onSelectDue={onSelectDue}
        activeDueKey={activeDueKey ?? null}
      />
    </div>
  );
}

interface DueCardProps {
  data: ChequeDueSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  onSelectDue?: (patch: ChequeDueFilterPatch, selection: ChequeDueSelection | null) => void;
  activeDueKey: ChequeDueSelection | null;
}

function DueCard({ data, isLoading, isError, onSelectDue, activeDueKey }: DueCardProps) {
  // ⚠️ HATA "SIFIR" DİYE BASILMAZ (dört kartla aynı kural): "vadesi geçmiş çek
  // yok" cümlesi, istek düştüğünde SÖYLENEBİLECEK EN KÖTÜ ŞEYDİR — tam da takip
  // edilmesi gereken alacağı görünmez yapar.
  if (isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />
          <span className="font-semibold">Vade özeti</span>
        </div>
        <p className="mt-1 text-[11px]">
          Yüklenemedi — vadesi geçmiş/yaklaşan çek OLMADIĞI anlamına gelmez.
        </p>
      </div>
    );
  }

  const sum = (bucket: ChequeDueBucket) => (data?.buckets ?? []).filter((b) => b.bucket === bucket);
  const overdue = sum("OVERDUE");
  const soon = sum("SOON");
  const soonDays = data?.soonDays ?? 0;

  /**
   * Liste süzgecini kurar.
   *
   * Durum listesi backend'in `liveStatuses`inden üretilir (tek kaynak; bkz.
   * dosya başlığı). Aynı satıra ikinci kez tıklamak süzgeci VARSAYILANA döndürür
   * — seçilebilen her şey geri alınabilmeli (durum kartlarıyla aynı davranış).
   */
  const select = (selection: ChequeDueSelection) => {
    if (!onSelectDue || !data) return;
    if (activeDueKey === selection) {
      onSelectDue({ status: LIVE_STATUS, kind: "", dueFrom: "", dueTo: "" }, null);
      return;
    }
    const statuses = [...new Set(Object.values(data.liveStatuses).flat())].join(",");
    const patch =
      selection === "OVERDUE"
        ? { status: statuses, kind: "", dueFrom: "", dueTo: shiftDay(data.today, -1) }
        : { status: statuses, kind: "", dueFrom: data.today, dueTo: shiftDay(data.today, soonDays) };
    onSelectDue(patch, selection);
  };

  const clickable = Boolean(onSelectDue && data);

  return (
    <div
      className={cn(
        "rounded-md border p-3",
        (overdue.length > 0 || activeDueKey === "OVERDUE") && "border-destructive/40",
      )}
    >
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-destructive" />
        <span className="text-sm font-semibold">Vade durumu</span>
        {isLoading ? <span className="ml-auto text-xs text-muted-foreground">…</span> : null}
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {/* Kapsam farkı SÖYLENİR: ciro edilen çek yukarıdaki kartta VAR, burada YOK. */}
        Ciro edilenler hariç — alacak üçüncü tarafa geçti
      </p>

      <div className="mt-2 flex flex-col gap-1">
        <DueLine
          label="Vadesi geçmiş"
          rows={overdue}
          tone="text-destructive"
          active={activeDueKey === "OVERDUE"}
          clickable={clickable}
          onClick={() => select("OVERDUE")}
        />
        <DueLine
          label={soonDays > 0 ? `${soonDays} gün içinde` : "Yaklaşan"}
          rows={soon}
          tone="text-amber-700 dark:text-amber-500"
          active={activeDueKey === "SOON"}
          clickable={clickable}
          onClick={() => select("SOON")}
        />
      </div>
    </div>
  );
}

interface DueLineProps {
  label: string;
  rows: Array<{ kind: ChequeKind; currency: string; count: number; amount: string }>;
  tone: string;
  active: boolean;
  clickable: boolean;
  onClick: () => void;
}

function DueLine({ label, rows, tone, active, clickable, onClick }: DueLineProps) {
  const count = rows.reduce((n, r) => n + r.count, 0);
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={cn("text-xs font-medium", count > 0 && tone)}>{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">{count} adet</span>
      </div>
      {rows.length === 0 ? (
        <span className="text-xs text-muted-foreground">—</span>
      ) : (
        rows.map((r) => (
          <span key={`${r.kind}-${r.currency}`} className={cn("text-xs tabular-nums", tone)}>
            {money(toNum(r.amount), r.currency as Currency)}
          </span>
        ))
      )}
    </>
  );

  // Tıklanabilir DEĞİLSE `div` çizilir: gri bir buton da olsa, tıklanınca
  // hiçbir şey olmayan bir düğme olmayan bir yolu vaat eder.
  return clickable ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col rounded border px-2 py-1 text-left transition-colors hover:bg-muted/50",
        active && "border-primary bg-primary/5",
      )}
    >
      {body}
    </button>
  ) : (
    <div className="flex flex-col rounded border border-transparent px-2 py-1">{body}</div>
  );
}

/**
 * Takvim günü anahtarına gün ekler (`YYYY-MM-DD`).
 *
 * ⚠️ Çıpa BACKEND'İN `today`'idir (fabrika takvim günü) — istemcide `new Date()`
 * ile gün kesmek, kartın saydığı kümeyi listenin süzdüğü kümeden ayırabilirdi.
 * Aritmetik saf UTC'dir: girdi saat taşımayan bir takvim anahtarıdır.
 */
function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
