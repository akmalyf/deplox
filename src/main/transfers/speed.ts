/** Exponential moving average of bytes/second, sampled at most every 250 ms. */
export class SpeedMeter {
  private lastBytes = 0
  private lastAt = 0
  value = 0

  constructor(startBytes = 0) {
    this.lastBytes = startBytes
    this.lastAt = performance.now()
  }

  update(bytes: number): number {
    const now = performance.now()
    const dt = now - this.lastAt
    if (dt < 250) return this.value
    const inst = ((bytes - this.lastBytes) * 1000) / dt
    this.value = this.value ? this.value * 0.7 + inst * 0.3 : inst
    this.lastBytes = bytes
    this.lastAt = now
    return this.value
  }
}
