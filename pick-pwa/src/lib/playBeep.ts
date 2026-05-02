function playTone(
  frequency: number,
  durationMs: number,
  type: OscillatorType = "square",
  gainValue = 0.1,
) {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    void 0;
  }
}

/** 掃描／確認成功時短促提示音 */
export function playSuccessBeep() {
  playTone(784, 70, "sine", 0.14);
}

export function playErrorBeep(durationMs = 220, frequency = 880) {
  playTone(frequency, durationMs, "square", 0.12);
}
