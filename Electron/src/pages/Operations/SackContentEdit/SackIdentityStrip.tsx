import { Boxes, Hash, Layers, MessageSquareText, Package, Pencil, Ruler, Scale, ScrollText, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EditorTarget } from "./types";

/**
 * Çuval editörü KİMLİK ŞERİDİ — operatörün çuvala girince ilk gördüğü üç şey:
 * cari · parti · ambalaj no (saha isteği 2026-09-22: "daha belirgin gözüksün").
 * Küçük rozet değil, etiketli hücre: başlık soluk-küçük, değer büyük-kalın; ambalaj
 * numarası en büyük (fiziksel çuvala yazılan sayı budur). Cari ve parti hücreleri
 * TIKLANABİLİR (`onCustomer` / `onLot` verilirse): "Müşteri" ve "Partiye Al" ayrı
 * düğme olmaktan çıktı — değiştirmek istediğin şeye dokunursun. Şube ve ihracat kodu
 * ikincil, rozet olarak kalır.
 */
export function SackIdentityStrip({
  target,
  stats,
  note,
  onCustomer,
  onLot,
  onPackageNo,
  onNote,
  lotMode = true,
}: {
  target: EditorTarget;
  /** İçerik sayıları — verilirse kimlik hücrelerinin ÖNÜNDE aynı kutu diliyle çizilir. */
  stats?: { rolls: number; meters: number; kg: number | null; swatches: number };
  /** Çuval notu (içerik yanıtından); `undefined` = henüz yüklenmedi. */
  note?: string | null;
  /** Verilmezse hücre salt-okunur (kilitli çuval). */
  onCustomer?: () => void;
  onLot?: () => void;
  /** Ambalaj no'yu ez — yalnız partideki çuvalda. */
  onPackageNo?: () => void;
  onNote?: () => void;
  lotMode?: boolean;
}) {
  const partisiz = !target.packingGroupName;
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {stats && <StatCells stats={stats} />}
      <Hucre icon={UserRound} label="Cari" muted={!target.customerName} onClick={onCustomer} title={onCustomer ? "Cari / şube değiştir" : undefined}>
        {target.customerName ?? "Müşterisiz (genel stok)"}
      </Hucre>
      <Hucre
        icon={Boxes}
        label={lotMode ? "Parti" : "Grup"}
        muted={partisiz}
        onClick={onLot}
        title={onLot ? (partisiz ? (lotMode ? "Bir sevk partisine al" : "Bir hazırlık grubuna al") : lotMode ? "Başka partiye taşı (yeni ambalaj no)" : "Başka gruba taşı") : undefined}
      >
        {target.packingGroupName ?? (onLot ? (lotMode ? "Partiye Al" : "Gruba Al") : "—")}
      </Hucre>
      <Hucre
        icon={Hash}
        label="Ambalaj No"
        muted={target.packageNo == null}
        big
        onClick={target.packingGroupId ? onPackageNo : undefined}
        title={target.packingGroupId && onPackageNo ? "Ambalaj numarasını değiştir" : undefined}
      >
        {target.packageNo ?? "—"}
      </Hucre>
      {note !== undefined && (
        <Hucre icon={MessageSquareText} label="Çuval notu" muted={!note} onClick={onNote} title={note ? `${note}${onNote ? "\n\n(düzenlemek için tıkla)" : ""}` : onNote ? "Çuval notu ekle" : undefined} wide>
          {note || "—"}
        </Hucre>
      )}
      {(target.branchName || target.branchCode) && (
        <div className="flex flex-col justify-center gap-1">
          {target.branchName && <Badge variant="secondary" className="text-[10px]">{target.branchName}</Badge>}
          {target.branchCode && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/40 font-mono text-[10px] text-amber-600"
              title="Şube ihracat kodu — sevk belgesinde 'İhracat Kodu' olarak basılır"
            >
              İhracat Kodu: {target.branchCode}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

/** İçerik sayıları: Top · Metraj · Kg · (Kartela) + ayraç. */
function StatCells({ stats }: { stats: { rolls: number; meters: number; kg: number | null; swatches: number } }) {
  return (
    <>
      <Hucre icon={ScrollText} label="Top" muted={stats.rolls === 0} compact>
        {stats.rolls}
      </Hucre>
      <Hucre icon={Ruler} label="Metraj" muted={stats.rolls === 0} compact>
        {fmtM(stats.meters)} m
      </Hucre>
      <Hucre icon={Scale} label="Kg" muted={stats.kg == null} compact title={stats.kg == null ? "Tartılmadı" : undefined}>
        {stats.kg != null ? fmtM(stats.kg) : "—"}
      </Hucre>
      {stats.swatches > 0 && (
        <Hucre icon={Layers} label="Kartela" compact>
          {stats.swatches}
        </Hucre>
      )}
      <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
    </>
  );
}

/** Çuval numarası — başlıkta aynı kutu diliyle (h1 içine konur; kırıntı gizli). */
export function SackNoBox({ sackNo }: { sackNo: string }) {
  return (
    <Hucre icon={Package} label="Çuval No" mono>
      {sackNo}
    </Hucre>
  );
}

/** Kutulu kimlik hücresi — parti listesi/çuval listesi başlıkları da aynı dili kullanır. */
export { Hucre as KimlikKutusu };

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

function Hucre({
  icon: Icon,
  label,
  children,
  muted,
  big,
  compact,
  mono,
  wide,
  title,
  onClick,
}: {
  icon: typeof UserRound;
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  big?: boolean;
  mono?: boolean;
  /** Sayı hücresi — dar (min genişlik yok). */
  compact?: boolean;
  /** Metin hücresi (not gibi) — geniş ama sınırlı, taşarsa kırpılır. */
  wide?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const cls = cn(
    "rounded-md border bg-muted/30 px-3 py-1.5 text-left",
    compact ? "min-w-[4.5rem]" : wide ? "min-w-[7rem] max-w-[22rem]" : "min-w-[7rem]",
    muted && "border-dashed",
    onClick && "group cursor-pointer transition-colors hover:border-primary/60 hover:bg-primary/5",
  );
  const body = (
    <>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
        {onClick && <Pencil className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className={cn("truncate leading-tight tabular-nums", big ? "text-2xl font-semibold" : wide ? "text-sm font-medium" : "text-base font-semibold", mono && "font-mono", muted && "font-normal text-muted-foreground")}>
        {children}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} title={title} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}
