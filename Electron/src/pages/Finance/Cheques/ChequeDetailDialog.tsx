// =============================================================================
// ÇEK DETAYI + OLAY DEFTERİ
// =============================================================================
// ⚠️ BU EKRANIN ASIL İŞİ ZAMAN ÇİZELGESİDİR. Modelin tamamı APPEND-ONLY bir
// defter üzerine kurulu: `Cheque.status` yalnız SON satırın özetidir, gerçek
// tarihçe `ChequeEvent`'tedir. Kullanıcı "bu çeke ne oldu" sorusunu ancak
// buradan cevaplayabilir — durum rozeti ona "bankada" der ama ne zaman
// verildiğini, kimin verdiğini, arada ciro edilip edilmediğini söylemez.
//
// ⚠️ SIRALAMA BACKEND'İNDİR (`eventDate asc`) ve burada YENİDEN SIRALANMAZ.
// Zinciri tersine çevirmek ("en yeni üstte") okunamaz yapardı: her satır bir
// öncekinin durumundan devralır (`fromStatus → toStatus`).
//
// ⚠️ SALT OKUNUR. Buradan işlem yapılmaz; aksiyonlar liste satırındaki menüde
// yaşar ve tek yerde durur. İki ayrı yerden aynı geçişi tetiklemek, hangisinin
// güncel veriye baktığı belirsiz iki yol demekti.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { money } from "../service";
import type { Currency } from "../service";
import { getCheque, toNum } from "./service";
import {
  DOCTYPE_LABEL,
  EVENT_DOT,
  EVENT_LABEL,
  KIND_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  cariName,
} from "./labels";
import { fmtDate } from "./dates";

interface Props {
  chequeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Bilgi satırı — boş değer daima "—", boş string değil. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

export function ChequeDetailDialog({ chequeId, open, onOpenChange }: Props) {
  const q = useQuery({
    queryKey: ["finance", "cheque", chequeId],
    queryFn: () => getCheque(chequeId),
    enabled: open,
  });

  const c = q.data;
  const allocated = c ? toNum(c.allocatedTotal) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {c ? `${c.docNo} — ${DOCTYPE_LABEL[c.docType]} (${KIND_LABEL[c.kind]})` : "Çek / Senet"}
          </DialogTitle>
          <DialogDescription>
            Kaydın bugünkü durumu ve baştan sona olay geçmişi. Bu ekran salt okunurdur.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          // ⚠️ "Bulunamadı" DEMEYİZ: istek düşmüş olabilir (ağ/izin/modül kapalı)
          // ve kaydın var olmadığını söylemek, kullanıcıyı çeki yeniden girmeye
          // iter. İki cümle iki farklı iş adımına götürür.
          <p className="py-8 text-center text-sm text-destructive">
            Kayıt yüklenemedi — bağlantı ya da yetki sorunu olabilir. Kaydın silindiği anlamına gelmez.
          </p>
        ) : !c ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Kayıt bulunamadı.</p>
        ) : (
          <div className="max-h-[64vh] space-y-4 overflow-auto pr-1">
            <div className="flex items-center gap-2">
              <Badge className={STATUS_BADGE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              <span className="text-sm font-medium">
                {money(toNum(c.amount), c.currency as Currency)}
              </span>
              {c.currency !== "TRY" && (
                <span className="text-xs text-muted-foreground">
                  ≈ {money(toNum(c.amountTry), "TRY")} (kur {toNum(c.exchangeRate).toFixed(4)})
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-3">
              <Field label="Cari" value={cariName(c.cari)} />
              <Field label="Keşideci" value={c.drawerName ?? ""} />
              <Field label="Seri no" value={c.serialNo ?? ""} />
              <Field label="Keşide tarihi" value={fmtDate(c.issueDate)} />
              <Field label="Vade" value={fmtDate(c.dueDate)} />
              <Field
                label="Banka / şube"
                value={[c.bankName, c.branchName].filter(Boolean).join(" · ")}
              />
              <Field label="Ciro edilen" value={c.endorsedToCari ? cariName(c.endorsedToCari) : ""} />
              <Field label="İşlem gören hesap" value={c.bankAccount?.name ?? ""} />
              <Field
                label="Faturaya kapatılan"
                value={allocated > 0 ? money(allocated, c.currency as Currency) : ""}
              />
              {c.notes && (
                <div className="col-span-2 sm:col-span-3">
                  <Field label="Not" value={c.notes} />
                </div>
              )}
              {c.cancelReason && (
                <div className="col-span-2 sm:col-span-3">
                  <Field label="İptal sebebi" value={c.cancelReason} />
                </div>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Olay geçmişi</h3>
              {c.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Kayıtlı olay yok.</p>
              ) : (
                <ol className="space-y-0">
                  {c.events.map((e, i) => (
                    <li key={e.id} className="flex gap-3">
                      {/* Nokta + dikey çizgi: zincirin sürekliliğini gösterir;
                          son satırda çizgi çizilmez (defterin sonu). */}
                      <div className="flex flex-col items-center">
                        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", EVENT_DOT[e.type])} />
                        {i < c.events.length - 1 && <span className="w-px flex-1 bg-border" />}
                      </div>
                      <div className="pb-4">
                        <div className="text-sm font-medium">{EVENT_LABEL[e.type]}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(e.eventDate)}
                          {" · "}
                          {e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}
                          {STATUS_LABEL[e.toStatus]}
                        </div>
                        {/* Ayraçlı TEK cümle: parçaları yan yana basmak (eski hâli)
                            iki alan birden doluyken "Karşı taraf: XBanka: Y" gibi
                            okunamaz bir satır üretiyordu. */}
                        {(() => {
                          const meta = [
                            e.counterCari ? `Karşı taraf: ${cariName(e.counterCari)}` : null,
                            e.bankAccount ? `Banka: ${e.bankAccount.name}` : null,
                            e.cashBox ? `Kasa: ${e.cashBox.name}` : null,
                          ].filter(Boolean);
                          return meta.length > 0 ? (
                            <div className="text-xs text-muted-foreground">{meta.join(" · ")}</div>
                          ) : null;
                        })()}
                        {e.notes && <div className="text-xs">{e.notes}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
