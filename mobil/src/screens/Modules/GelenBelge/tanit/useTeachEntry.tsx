// K30-A1 tanıtma girişinin durumu (TeachBanner'dan ayrıldı): izin, foto, tanıtım durumu, modal ve kayıt sonrası doldurma.
// Kayıt sonrası belge yeni şablonla yeniden okutulur; sunucu yeniden okumazsa (satırlı taslak, 409) önizleme değerleri forma dolar.
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import type { PickerOption } from '../../../../components/PickerModal';
import { usePermissions } from '../../../../hooks/usePermission';
import { inboundDocService, type ReadTanitim } from '../../../../services/inboundDoc.service';
import { lowerTr } from '../../../../utils/trCase';
import { approvalDetailKey } from '../useApprovalCard';
import type { DocRow, WoRowsState } from '../woCreate/useWoRows';
import { localPagesFor } from './localPages';
import TeachModal from './TeachModal';
import { teachPages } from './teachPages';
import type { TeachSaved } from './useTeachModal';

export interface TeachEntryInput {
  row: DocRow;
  wo: Pick<WoRowsState, 'rereadRow' | 'applyTaught'>;
  tanitim: ReadTanitim | undefined;
  customers: readonly PickerOption[];
}

export interface TeachEntry {
  /** null = giriş çizilmez (izin yok / eski sunucu / kayıtlı / detay yok). */
  /** system = hazır şablonla tanındı: "Yeniden tanıt" yeni tip açar (hazır şablon düzenlenmez). */
  kind: 'untaught' | 'taught' | 'system' | null;
  templateName: string | null;
  noPhoto: boolean;
  open: () => void;
  modal: React.ReactElement | null;
  /** Tanıtma penceresi açık (başka modal üstüne açılmasın). */
  teaching?: boolean;
}

const PDF_MIME = 'application/pdf';
const norm = (t: string) => lowerTr(t).replace(/\s+/g, ' ').trim();

export function useTeachEntry({ row, wo, tanitim: served, customers }: TeachEntryInput): TeachEntry {
  const { has } = usePermissions();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const allowed = has('gelen-belge:template') && has('gelen-belge:read');
  // Yerelde tanıtılan (yeniden okutulamayan) belgede sunucu özeti hâlâ "tanıtılmamış" der; giriş yerel durumu çizer.
  const tanitim: ReadTanitim | undefined = row.taught ? { durum: 'TANITILDI', sablonKodu: row.taught.code, sablonAdi: row.taught.name } : served;
  const done = row.result?.kind === 'OPENED' || row.result?.kind === 'DRAFT';
  const none: TeachEntry = { kind: null, templateName: null, noPhoto: true, open: () => {}, modal: null };
  if (!allowed || !tanitim || done || !row.detail) return none;
  const pages = teachPages(row.detail, localPagesFor((row.detail.scans ?? []).map((s) => s.sha256)));
  const code = tanitim.durum === 'TANITILDI' ? tanitim.sablonKodu : null;

  const refill = async (r: TeachSaved) => {
    const scans = (row.detail?.scans ?? []).filter((s) => s.status === 'READ' && s.mimeType !== PDF_MIME);
    let requeued = 0;
    for (const s of scans) {
      try {
        await inboundDocService.requeueScan(s.id);
        requeued += 1;
      } catch {
        // 409 (satırlı taslak / taslak değil) ya da okuyucu yok → aşağıda yerel doldurma.
      }
    }
    if (requeued > 0) {
      qc.removeQueries({ queryKey: approvalDetailKey(row.noteId) });
      wo.rereadRow(row.noteId);
      Toast.show({ type: 'info', text1: 'Belge yeni şablonla yeniden okunuyor', text2: 'Okuma bitince form yeniden dolar.' });
      return;
    }
    const owner = r.fields.musteri ? customers.find((c) => norm(c.label) === norm(r.fields.musteri!)) : undefined;
    wo.applyTaught(row.noteId, r.fields, owner?.value ?? null, { code: r.code, name: r.name });
    Toast.show({ type: 'info', text1: 'Form yeni şablonla okunan değerlerle güncellendi', text2: 'Belge yeniden okunamadı (satırları taslakta); değerleri kontrol edin.' });
  };

  const noPhoto = pages.length === 0;
  return {
    kind: tanitim.durum === 'TANITILMAMIS' ? 'untaught' : tanitim.durum === 'SISTEM' ? 'system' : 'taught',
    templateName: tanitim.durum === 'TANITILMAMIS' ? null : tanitim.sablonAdi,
    noPhoto,
    open: () => setOpen(true),
    teaching: open,
    modal: noPhoto ? null : <TeachModal visible={open} pages={pages} code={code} onDismiss={() => setOpen(false)} onSaved={(r) => void refill(r)} />,
  };
}
