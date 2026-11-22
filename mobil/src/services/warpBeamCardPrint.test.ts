// A6 levent kartı basımı (S5t): sıralı alım, tek pencere, düşen kart adıyla, iptal hata değil.
import { apiClient } from './api';
import { printHtmlReported } from './printHtml';
import { printWarpBeamCards } from './warpBeamCardPrint';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('./printHtml', () => ({ printHtmlReported: jest.fn() }));
const getMock = apiClient.get as jest.Mock;
const printMock = printHtmlReported as jest.Mock;

const page = (n: string) => `<!doctype html><html><head><style>@page{size:A6}</style></head><body><b>${n}</b></body></html>`;

beforeEach(() => {
  getMock.mockReset();
  printMock.mockReset();
  printMock.mockResolvedValue({});
});

it('kartlar backend HTML ucundan sırayla alınır, TEK pencerede birleşik basılır', async () => {
  getMock.mockImplementation((url: string) => Promise.resolve({ data: page(url.includes('wb1') ? 'LV-7' : 'LV-8') }));
  const out = await printWarpBeamCards([{ id: 'wb1', beamNo: 'LV-7' }, { id: 'wb2', beamNo: 'LV-8' }]);
  expect(getMock.mock.calls.map((c) => c[0])).toEqual(['/printed-documents/WARP_BEAM_CARD/wb1/html', '/printed-documents/WARP_BEAM_CARD/wb2/html']);
  expect(printMock).toHaveBeenCalledTimes(1);
  const [opts, subject] = printMock.mock.calls[0];
  expect(opts.html).toContain('LV-7');
  expect(opts.html).toContain('LV-8');
  expect(opts.html).toContain('page-break-after:always');
  expect(subject).toMatchObject({ subjectKind: 'BELGE', docType: 'WARP_BEAM_CARD', subjectTable: 'warp_beams', subjectId: 'wb1', subjectNo: 'LV-7 +1' });
  expect(out).toEqual({ printed: 2, cancelled: false, failed: [] });
});

it('alınamayan kart sessiz düşmez; kalanlar basılır', async () => {
  getMock.mockImplementation((url: string) => (url.includes('wb1') ? Promise.reject(new Error('LV-7 iptal edilmiş')) : Promise.resolve({ data: page('LV-8') })));
  const out = await printWarpBeamCards([{ id: 'wb1', beamNo: 'LV-7' }, { id: 'wb2', beamNo: 'LV-8' }]);
  expect(out.printed).toBe(1);
  expect(out.failed).toEqual([{ beamNo: 'LV-7', reason: 'LV-7 iptal edilmiş' }]);
  expect(printMock.mock.calls[0][1]).toMatchObject({ subjectId: 'wb2', subjectNo: 'LV-8' });
});

it('hiçbiri alınamazsa pencere açılmaz; pencere iptali hata değildir', async () => {
  getMock.mockRejectedValue(new Error('ağ'));
  expect((await printWarpBeamCards([{ id: 'wb1', beamNo: 'LV-7' }])).printed).toBe(0);
  expect(printMock).not.toHaveBeenCalled();
  getMock.mockResolvedValue({ data: page('LV-7') });
  printMock.mockRejectedValue(new Error('Printing did not complete'));
  expect(await printWarpBeamCards([{ id: 'wb1', beamNo: 'LV-7' }])).toEqual({ printed: 0, cancelled: true, failed: [] });
});
