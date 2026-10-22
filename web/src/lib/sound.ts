// Optional, opt-in sound cues. No audio assets: short WebAudio tones only, created lazily after a user gesture (which
// opening the table guarantees). Off by default; the preference lives in localStorage and is read on every cue so a
// toggle takes effect at once. Everything is wrapped so a blocked AudioContext never throws into the game.

let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try { return localStorage.getItem('allin.sound') === '1'; } catch { return false; }
}
export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem('allin.sound', on ? '1' : '0'); } catch { /* ignore */ }
}

function tone(freqs: number[], ms: number, gain: number): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator(); const g = ctx!.createGain();
      osc.type = 'sine'; osc.frequency.value = f;
      const t0 = now + i * (ms / 1000) * 0.5;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
      osc.connect(g); g.connect(ctx!.destination);
      osc.start(t0); osc.stop(t0 + ms / 1000 + 0.02);
    });
  } catch { /* audio unavailable */ }
}

/** A gentle two-note cue for "it's your turn"; a brighter triad for "you won". No-op unless the preference is on. */
export function playCue(kind: 'turn' | 'win'): void {
  if (!soundEnabled()) return;
  if (kind === 'turn') tone([523.25, 784], 160, 0.08);
  else tone([659.25, 880, 1046.5], 220, 0.09);
}
