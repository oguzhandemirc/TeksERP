// =============================================================================
// TESLİM BORDROSU DİYALOĞU — iki alan sorar, üç çıktıyı tek spec'ten verir
// =============================================================================
// ⚠️ HİÇBİR ŞEY KAYDETMEZ. Bordro anlık bir çıktıdır (bkz. `chequeBordro.ts`
// başlığı): sunucuya istek gitmez, çekin durumu değişmez, olay defterine satır
// yazılmaz. Bu yüzden yazma izni (`finance:cheque`) de ARANMAZ — dosya, ekranı
// zaten açabilen kişinin gördüğü listenin taşınabilir hâlidir (portföy dışa
// aktarımıyla aynı gerekçe). Diyalog bunu kullanıcıya da söyler; "bordroyu
// bastım, çekler bankaya verilmiş sayılır mı?" sorusu ekranda cevaplanmalı.
//
// ⚠️ ÜÇ ÇIKTI DA `ReportExportBar`'DAN: Excel · PDF · Yazdır tek
// `ReportExportSpec`'ten türer. Bordroya özel bir "yazdır" yolu açmak, bir
// gün Excel'i güncelleyip kâğıdı unutmak demekti.
//
// ⚠️ KAPALI DÜĞMENİN SEBEBİ EKRANDA YAZAR. Seçim kabul edilemezse
// (`bordroBlockReason`) düğmeler kapanır VE cümle basılır; üretici de aynı
// yüklemle fail-closed reddeder — ekran nezaket, üretici settir.
// =============================================================================
import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportExportBar } from "@/pages/Reports/_components";
import { bordroBlockReason, buildChequeBordro, totalsByCurrency } from "./chequeBordro";
import { KIND_LABEL } from "./labels";
import { parseYmdLocal, ymd } from "./dates";
import type { ChequeRow } from "./service";

interface Props {
  /** SEÇİLİ satırlar — ekrandaki listeden gelir. */
  rows: ChequeRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChequeBordroDialog({ rows, open, onOpenChange }: Props) {
  const [place, setPlace] = useState("");
  const [dateYmd, setDateYmd] = useState(() => ymd(new Date()));

  const blocked = bordroBlockReason(rows);
  // Tarih kutusu KULLANICI TARAFINDAN TEMİZLENEBİLİR ve boş değeri sessizce
  // "bugün" saymak, kâğıda yanlış bir düzenleme tarihi basardı (bkz. dates.ts:
  // eski hâli boş değeri 1 Ocak 1900'e çeviriyordu).
  const dateOk = Boolean(parseYmdLocal(dateYmd));
  const ready = !blocked && dateOk;

  const buckets = totalsByCurrency(rows);
  const kindLabel = rows[0] ? KIND_LABEL[rows[0].kind] : "";

  // Spec TIKLANDIĞINDA kurulur; hazır değilse `null` döner ve düğmeler zaten
  // kapalıdır (üreticiyi bu durumda ÇAĞIRMAYIZ — o fırlatmak üzere yazıldı).
  const spec = () => (ready ? buildChequeBordro({ rows, place, dateYmd }) : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Teslim Bordrosu</DialogTitle>
          <DialogDescription>
            {rows.length} kayıt seçili{kindLabel ? ` · ${kindLabel} çek/senet` : ""}. Bordro bir
            TESLİM TUTANAĞIDIR: yazdırmak çekin durumunu DEĞİŞTİRMEZ, hiçbir kayıt oluşturmaz.
            Çekleri gerçekten bankaya verdiyseniz ayrıca satır menüsünden “Bankaya Ver” işlemini
            yapın.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {blocked}
          </div>
        ) : (
          <div className="rounded-md border px-3 py-2 text-xs">
            {buckets.map((b) => (
              <div key={b.currency}>
                <span className="text-muted-foreground">{b.currency}</span>{" "}
                <strong>
                  {b.total.toLocaleString("tr-TR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>{" "}
                <span className="text-muted-foreground">({b.count} adet)</span>
              </div>
            ))}
            {buckets.length > 1 && (
              <p className="mt-1 text-muted-foreground">
                Farklı para birimleri toplanmaz — bordroda tek toplam yerine para birimi bazlı
                toplamlar basılır.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Teslim edilen yer / banka (opsiyonel)</Label>
            <Input
              className="mt-1"
              placeholder="Örn: Ziraat Bankası — Merkez Şubesi"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Serbest metindir, kâğıdın başlığına basılır. Boş bırakılırsa o satır hiç basılmaz.
            </p>
          </div>
          <div>
            <Label>Bordro tarihi</Label>
            <Input
              type="date"
              className="mt-1"
              value={dateYmd}
              onChange={(e) => setDateYmd(e.target.value)}
            />
            {!dateOk && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                Bordro tarihi gerekli — kâğıdın düzenlenme günü olarak basılır.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <ReportExportBar disabled={!ready} buildSpec={spec} />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
