import { bytesToBase64, incomingScanItems, scanDataUri } from './incomingScans';

describe('incomingScanItems', () => {
  it('her tarama bir satır; başlık belge no + evrak no, çok sayfada sayfa no', () => {
    const items = incomingScanItems([
      { id: 'n1', noteNo: 'GB-0001', senderDocNo: ' A-77 ', scans: [
        { id: 's1', pageNo: 1, regionNo: null, mimeType: 'image/jpeg', contentState: 'FULL' },
        { id: 's2', pageNo: 2, regionNo: 1, mimeType: 'image/jpeg', contentState: 'REDUCED' },
      ] },
      { id: 'n2', noteNo: 'GB-0002', senderDocNo: null, scans: [{ id: 's3', pageNo: 1, regionNo: null, mimeType: 'image/jpeg' }] },
    ]);
    expect(items.map((i) => [i.scanId, i.title, i.subtitle, i.viewable])).toEqual([
      ['s1', 'Gelen belge · GB-0001 · Evrak A-77', 'Sayfa 1', true],
      ['s2', 'Gelen belge · GB-0001 · Evrak A-77', 'Sayfa 2.1', true],
      ['s3', 'Gelen belge · GB-0002', '', true],
    ]);
  });
  it('silinmiş fotoğraf ve PDF açılmaz, sebebi yazar', () => {
    const items = incomingScanItems([{ id: 'n', noteNo: 'GB-9', senderDocNo: null, scans: [
      { id: 'p', pageNo: 1, regionNo: null, mimeType: 'image/jpeg', contentState: 'PURGED' },
      { id: 'd', pageNo: 2, regionNo: null, mimeType: 'application/pdf', contentState: 'FULL' },
    ] }]);
    expect(items.map((i) => [i.viewable, i.blockedReason])).toEqual([
      [false, 'Fotoğraf saklama ayarı gereği silindi'],
      [false, 'PDF — panelden açılır'],
    ]);
  });
  it('veri yoksa boş', () => {
    expect(incomingScanItems(undefined)).toEqual([]);
    expect(incomingScanItems([])).toEqual([]);
  });
});

describe('bytesToBase64 / scanDataUri', () => {
  const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  it('üç dolgu durumunda Buffer ile aynı', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) expect(bytesToBase64(enc(s))).toBe(Buffer.from(s, 'latin1').toString('base64'));
    const bin = new Uint8Array([0, 255, 128, 7, 250]);
    expect(bytesToBase64(bin)).toBe(Buffer.from(bin).toString('base64'));
  });
  it('görüntü olmayan tür jpeg varsayılır, görüntü türü korunur', () => {
    expect(scanDataUri('image/png', enc('a'))).toBe('data:image/png;base64,YQ==');
    expect(scanDataUri('application/octet-stream', enc('a'))).toBe('data:image/jpeg;base64,YQ==');
  });
});
