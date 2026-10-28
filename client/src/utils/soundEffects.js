/**
 * Web Audio Synthesizer & Native Mobile Haptics Engine.
 * Generates Apple-style harmonic chimes and physical tactile vibrations with zero external MP3 assets.
 */

let audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Sound Preferences in LocalStorage
export function isSoundEnabled() {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('quickdrop:sound_enabled') !== 'false';
}

export function setSoundEnabled(enabled) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('quickdrop:sound_enabled', enabled ? 'true' : 'false');
  }
}

/**
 * Play a warm dual-tone chord when peers successfully pair.
 */
export function playConnectSound() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.08, now);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  masterGain.connect(ctx.destination);

  // C5 (523.25 Hz) + G5 (783.99 Hz)
  [523.25, 783.99].forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.5);
  });
}

/**
 * Play a light spatial tone when file transmission begins.
 */
export function playSendSound() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.06, now);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  masterGain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.25);
  osc.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.3);
}

/**
 * Play a high-harmonic glass bell chime when transfer finishes and SHA-256 verifies.
 */
export function playSuccessSound() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.12, now);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  masterGain.connect(ctx.destination);

  // E6 (1318.5 Hz) + B6 (1975.5 Hz) bell resonance
  [1318.5, 1975.5].forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.06);
    osc.connect(masterGain);
    osc.start(now + idx * 0.06);
    osc.stop(now + 0.7);
  });
}

/**
 * Play a subtle soft tap when a chat message arrives.
 */
export function playMessageSound() {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.06, now);
  masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  masterGain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(659.25, now); // E5
  osc.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.2);
}

/**
 * Native Mobile Haptic Patterns (Vibration API)
 */
export function hapticTap() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(15);
  }
}

export function hapticSuccess() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([25, 40, 30]);
  }
}

export function hapticError() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([60, 40, 60]);
  }
}
