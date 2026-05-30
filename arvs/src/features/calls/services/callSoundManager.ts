/**
 * CallSoundManager
 *
 * Premium sound generator for video call signaling.
 * Uses native Web Audio API to synthesize telephone sounds in real-time,
 * bypassing heavy MP3 files and ensuring 100% offline reliability.
 */

class CallSoundManager {
  private audioCtx: AudioContext | null = null;
  private ringtoneInterval: any = null;
  private ringbackInterval: any = null;

  private initCtx(): void {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
  }

  /**
   * Starts playing the incoming ringtone.
   * Modulates dual-tone E5 (659Hz) and G#5 (830Hz) chord chime.
   * Cadence: 2 seconds ring, 1 second pause.
   */
  startIncomingRingtone(): void {
    this.stopAll();
    this.initCtx();
    if (!this.audioCtx) return;

    const playPulse = () => {
      if (!this.audioCtx) return;

      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659, this.audioCtx.currentTime); // E5

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(830, this.audioCtx.currentTime); // G#5

      gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      // Soft fade in (prevent pops)
      gain.gain.linearRampToValueAtTime(0.2, this.audioCtx.currentTime + 0.15);
      // Pulse length: 2 seconds
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime + 1.85);
      gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 2.00);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc1.start();
      osc2.start();

      osc1.stop(this.audioCtx.currentTime + 2.0);
      osc2.stop(this.audioCtx.currentTime + 2.0);
    };

    // Play immediately, then every 3 seconds (2s ring + 1s pause)
    playPulse();
    this.ringtoneInterval = setInterval(playPulse, 3000);
  }

  /**
   * Starts playing the outgoing ringback tone.
   * Modulates a standard soft pulsed sine-wave (425Hz).
   * Cadence: 1.2 seconds ring, 2.8 seconds pause.
   */
  startOutgoingRingback(): void {
    this.stopAll();
    this.initCtx();
    if (!this.audioCtx) return;

    const playPulse = () => {
      if (!this.audioCtx) return;

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(425, this.audioCtx.currentTime);

      gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, this.audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime + 1.1);
      gain.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 1.2);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 1.25);
    };

    // Play immediately, then every 4 seconds (1.2s tone + 2.8s pause)
    playPulse();
    this.ringbackInterval = setInterval(playPulse, 4000);
  }

  /**
   * Stops all active audio ringtones and ringbacks.
   */
  stopAll(): void {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval);
      this.ringbackInterval = null;
    }
    if (this.audioCtx && this.audioCtx.state === 'running') {
      void this.audioCtx.suspend();
    }
  }
}

export const callSoundManager = new CallSoundManager();
