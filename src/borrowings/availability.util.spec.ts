import { DemandInterval, peakConcurrentDemand } from './availability.util';

const h = (hour: number) => new Date(Date.UTC(2026, 10, 10, hour));
const iv = (s: number, e: number, quantity = 1): DemandInterval => ({ start: h(s), end: h(e), quantity });

describe('peakConcurrentDemand', () => {
  it('tanpa interval -> 0', () => {
    expect(peakConcurrentDemand([], h(8), h(18))).toBe(0);
  });
  it('overlap dihitung bersamaan', () => {
    expect(peakConcurrentDemand([iv(10, 12), iv(11, 13)], h(8), h(18))).toBe(2);
  });
  it('batas menempel (12:00 selesai, 12:00 mulai) TIDAK overlap', () => {
    expect(peakConcurrentDemand([iv(10, 12), iv(12, 14)], h(8), h(18))).toBe(1);
  });
  it('dua request yang tidak saling overlap tidak dijumlahkan walau sama-sama overlap dengan window', () => {
    // window 08-18; A 08-10 (qty 2) dan B 14-16 (qty 2): puncak = 2, bukan 4
    expect(peakConcurrentDemand([iv(8, 10, 2), iv(14, 16, 2)], h(8), h(18))).toBe(2);
  });
  it('quantity ikut dijumlahkan', () => {
    expect(peakConcurrentDemand([iv(10, 12, 2), iv(11, 13, 3)], h(10), h(13))).toBe(5);
  });
  it('interval dipotong sesuai window (bagian di luar window diabaikan)', () => {
    expect(peakConcurrentDemand([iv(6, 9, 4), iv(9, 11, 1)], h(9), h(11))).toBe(1);
  });
  it('interval di luar window diabaikan', () => {
    expect(peakConcurrentDemand([iv(1, 2, 9)], h(9), h(11))).toBe(0);
  });
});
