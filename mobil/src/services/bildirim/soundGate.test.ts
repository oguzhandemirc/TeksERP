// Bekçi: bildirim sesi tekilliği — ilk okuma çalmaz, aynı satır iki kez çalmaz, sayaç artınca yeniden çalar,
// karar sunucunun `sesli` alanından (istemci sessiz saat/kanal hesabı yapmaz).
import { resetSoundGate, takeSoundCandidates } from './soundGate';
import type { InboxItem } from './types';

const item = (id: string, sayac = 1, sesli = true): InboxItem => ({
  id, tur: 'dokuma.levent-bitiyor', sinif: 'BILDIRIM', altTur: 'KOSUL', grup: 'Dokuma', baslik: 'b', govde: '', tabletRota: null,
  konu: { tip: 'x', id: null }, sayac, sonAn: '2026-10-26T08:00:00Z', okunduAn: null, erteleBitis: null, cozulduAn: null, sesli,
});

beforeEach(() => resetSoundGate());

it('ilk okuma yalnız işaretler (açılışta eski satırlar çalmaz)', () => {
  expect(takeSoundCandidates([item('a')])).toEqual([]);
  expect(takeSoundCandidates([item('a')])).toEqual([]);
});

it('yeni satır bir kez çalar; ikinci okuma (başka ekranın başlığı) çalmaz', () => {
  takeSoundCandidates([]);
  expect(takeSoundCandidates([item('b')]).map((i) => i.id)).toEqual(['b']);
  expect(takeSoundCandidates([item('b')])).toEqual([]);
});

it('birleşen satırın sayacı artınca yeniden çalar', () => {
  takeSoundCandidates([item('c')]);
  expect(takeSoundCandidates([item('c', 2)]).map((i) => i.sayac)).toEqual([2]);
});

it('sesli=false (sessiz saat / ses ayarı kapalı) → çalmaz', () => {
  takeSoundCandidates([]);
  expect(takeSoundCandidates([item('d', 1, false)])).toEqual([]);
});
