export interface DemandInterval {
  start: Date;
  end: Date;
  quantity: number;
}

/**
 * Puncak permintaan yang bersamaan (concurrent) di dalam [windowStart, windowEnd).
 * Interval setengah-terbuka: yang berakhir tepat saat interval lain mulai TIDAK overlap.
 * Lebih akurat daripada menjumlahkan semua yang overlap dengan window
 * (dua request yang tidak saling overlap tidak dihitung dobel).
 */
export function peakConcurrentDemand(
  intervals: DemandInterval[],
  windowStart: Date,
  windowEnd: Date,
): number {
  const ws = windowStart.getTime();
  const we = windowEnd.getTime();
  const events: Array<[number, number]> = [];
  for (const interval of intervals) {
    const start = Math.max(interval.start.getTime(), ws);
    const end = Math.min(interval.end.getTime(), we);
    if (start >= end) continue;
    events.push([start, interval.quantity], [end, -interval.quantity]);
  }
  // Pada waktu yang sama, proses "selesai" (negatif) sebelum "mulai".
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > peak) peak = current;
  }
  return peak;
}
