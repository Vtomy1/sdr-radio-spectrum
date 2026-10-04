import { DemodMode, SimulatedStation } from '../types/radio';

export class AudioDspService {
  private ctx: AudioContext | null = null;
  private isStarted = false;

  // Audio Nodes
  private masterGain: GainNode | null = null;
  private squelchGain: GainNode | null = null;
  private rfNoiseGain: GainNode | null = null;
  private signalGain: GainNode | null = null;
  private bandpassFilter: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;

  // Synthetic signal sound generators
  private toneOscillator1: OscillatorNode | null = null;
  private toneOscillator2: OscillatorNode | null = null;
  private bfoOscillator: OscillatorNode | null = null;
  private noiseNode: AudioNode | null = null;

  // Station Audio Synth Loops
  private currentStationId: string | null = null;
  private cwInterval: number | null = null;
  private speechUtteranceTimer: number | null = null;
  private isSpeechActive = false;

  // Audio recording
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecordingAudio = false;
  private onRecordingCompleteCallback: ((blob: Blob, url: string) => void) | null = null;

  // CW Decoder callback
  private onMorseDecodedCallback: ((char: string) => void) | null = null;

  public async initAudioContext(): Promise<boolean> {
    if (this.ctx && this.ctx.state !== 'closed') {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return true;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      // Master output
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.6, this.ctx.currentTime);

      this.squelchGain = this.ctx.createGain();
      this.squelchGain.gain.setValueAtTime(0, this.ctx.currentTime);

      this.signalGain = this.ctx.createGain();
      this.signalGain.gain.setValueAtTime(0.5, this.ctx.currentTime);

      this.rfNoiseGain = this.ctx.createGain();
      this.rfNoiseGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

      // Audio bandpass filter
      this.bandpassFilter = this.ctx.createBiquadFilter();
      this.bandpassFilter.type = 'bandpass';
      this.bandpassFilter.frequency.setValueAtTime(1500, this.ctx.currentTime);
      this.bandpassFilter.Q.setValueAtTime(1.0, this.ctx.currentTime);

      // Analyser for oscilloscope & audio VU
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;

      // Setup RF noise generator (pinkish noise)
      this.setupNoiseGenerator();

      // Routing:
      // (RF Noise + Signal) -> SquelchGain -> BandpassFilter -> MasterGain -> Analyser -> Destination
      this.rfNoiseGain.connect(this.squelchGain);
      this.signalGain.connect(this.squelchGain);
      this.squelchGain.connect(this.bandpassFilter);
      this.bandpassFilter.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      // Audio recording branch
      try {
        this.mediaStreamDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this.mediaStreamDest);
      } catch (e) {
        console.warn('MediaStreamDestination not supported', e);
      }

      this.isStarted = true;
      return true;
    } catch (err) {
      console.error('AudioContext initialization failed:', err);
      return false;
    }
  }

  private setupNoiseGenerator() {
    if (!this.ctx || !this.rfNoiseGain) return;

    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
      b6 = white * 0.115926;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;
    whiteNoise.start(0);

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(3200, this.ctx.currentTime);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(this.rfNoiseGain);
    this.noiseNode = whiteNoise;
  }

  public updateReceiverParams(
    mode: DemodMode,
    bandwidthHz: number,
    volume: number,
    isMuted: boolean,
    squelchThresholdDbm: number,
    currentSignalPowerDbm: number,
    station: SimulatedStation | undefined,
    detuneDeltaKHz: number = 0
  ) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Master Volume & Mute
    if (this.masterGain) {
      const targetVol = isMuted ? 0 : Math.max(0, Math.min(1, volume));
      this.masterGain.gain.setTargetAtTime(targetVol, now, 0.03);
    }

    // 2. Bandpass filter tuning for modulation mode
    if (this.bandpassFilter) {
      let centerFreq = 1400;
      let q = 1.0;
      if (mode === 'CW') {
        centerFreq = 700;
        q = 4.0;
      } else if (mode === 'WFM') {
        centerFreq = 6000;
        q = 0.5;
      } else if (mode === 'AM' || mode === 'NFM') {
        centerFreq = Math.min(4500, bandwidthHz / 2);
        q = 1.2;
      } else if (mode === 'USB' || mode === 'LSB') {
        centerFreq = 1600;
        q = 1.8;
      }
      this.bandpassFilter.frequency.setTargetAtTime(centerFreq, now, 0.05);
      this.bandpassFilter.Q.setTargetAtTime(q, now, 0.05);
    }

    // 3. Squelch decision with hysteresis
    const isSignalOpen = currentSignalPowerDbm >= squelchThresholdDbm;
    if (this.squelchGain) {
      const targetSquelchGain = isSignalOpen ? 1.0 : 0.0;
      this.squelchGain.gain.setTargetAtTime(targetSquelchGain, now, 0.02);
    }

    // 4. Station Audio Synthesis
    if (!isSignalOpen || !station) {
      this.stopStationAudio();
      // RF noise is louder when no carrier is present
      if (this.rfNoiseGain) {
        this.rfNoiseGain.gain.setTargetAtTime(0.12, now, 0.05);
      }
      if (this.signalGain) {
        this.signalGain.gain.setTargetAtTime(0, now, 0.05);
      }
    } else {
      // Signal is present! Quieten the raw noise (FM quieting or AM AGC)
      if (this.rfNoiseGain) {
        const quieting = Math.max(0.01, 0.1 - (currentSignalPowerDbm - squelchThresholdDbm) * 0.005);
        this.rfNoiseGain.gain.setTargetAtTime(quieting, now, 0.05);
      }
      if (this.signalGain) {
        this.signalGain.gain.setTargetAtTime(0.5, now, 0.05);
      }

      if (this.currentStationId !== station.id) {
        this.startStationAudio(station, mode, detuneDeltaKHz);
      } else {
        this.modulateStationAudio(station, mode, detuneDeltaKHz);
      }
    }
  }

  private startStationAudio(station: SimulatedStation, mode: DemodMode, detuneKHz: number) {
    this.stopStationAudio();
    if (!this.ctx || !this.signalGain) return;

    this.currentStationId = station.id;

    if (station.audioVoiceType === 'cw' || mode === 'CW') {
      this.startMorseTone(station.morseText || 'CQ CQ DE SDR');
    } else if (station.audioVoiceType === 'weather') {
      this.startWeatherAudio(station);
    } else if (station.audioVoiceType === 'atc') {
      this.startAtcAudio(station, detuneKHz);
    } else if (station.audioVoiceType === 'music') {
      this.startMusicSynth(detuneKHz);
    } else if (station.audioVoiceType === 'time_signal') {
      this.startTimeSignal();
    } else {
      this.startRadioVoiceSynth(station, mode, detuneKHz);
    }
  }

  private modulateStationAudio(_station: SimulatedStation, mode: DemodMode, detuneKHz: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Carrier heterodyne whistle when detuned on AM or CW
    if (this.toneOscillator1 && (mode === 'AM' || mode === 'CW' || mode === 'USB' || mode === 'LSB')) {
      const whistleFreq = Math.abs(detuneKHz) * 1000;
      if (whistleFreq > 50 && whistleFreq < 4000) {
        this.toneOscillator1.frequency.setTargetAtTime(whistleFreq, now, 0.05);
      }
    }
  }

  private stopStationAudio() {
    this.currentStationId = null;

    if (this.cwInterval) {
      clearInterval(this.cwInterval);
      this.cwInterval = null;
    }

    if (this.speechUtteranceTimer) {
      window.clearTimeout(this.speechUtteranceTimer);
      this.speechUtteranceTimer = null;
    }

    if (this.toneOscillator1) {
      try {
        this.toneOscillator1.stop();
        this.toneOscillator1.disconnect();
      } catch {
        // ignore
      }
      this.toneOscillator1 = null;
    }

    if (this.toneOscillator2) {
      try {
        this.toneOscillator2.stop();
        this.toneOscillator2.disconnect();
      } catch {
        // ignore
      }
      this.toneOscillator2 = null;
    }

    if (this.bfoOscillator) {
      try {
        this.bfoOscillator.stop();
        this.bfoOscillator.disconnect();
      } catch {
        // ignore
      }
      this.bfoOscillator = null;
    }

    if ('speechSynthesis' in window && this.isSpeechActive) {
      window.speechSynthesis.cancel();
      this.isSpeechActive = false;
    }
  }

  // --- Morse Code Synth & Live CW Decoder ---
  private startMorseTone(text: string) {
    if (!this.ctx || !this.signalGain) return;

    const MORSE_MAP: Record<string, string> = {
      A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.',
      G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..',
      M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
      S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
      Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---',
      '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...',
      '8': '---..', '9': '----.', ' ': ' ', '/': '-..-.',
    };

    const morsePattern = text
      .toUpperCase()
      .split('')
      .map((char) => MORSE_MAP[char] || '')
      .join(' ');

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(750, this.ctx.currentTime);

    const gate = this.ctx.createGain();
    gate.gain.setValueAtTime(0, this.ctx.currentTime);

    osc.connect(gate);
    gate.connect(this.signalGain);
    osc.start();
    this.toneOscillator1 = osc;

    // Play dits and dahs periodically
    const ditMs = 80;
    let charIdx = 0;
    let patternIdx = 0;

    const scheduleNextMorse = () => {
      if (!this.toneOscillator1 || !this.ctx) return;
      if (patternIdx >= morsePattern.length) {
        patternIdx = 0;
        charIdx = 0;
      }

      const sym = morsePattern[patternIdx];
      const now = this.ctx.currentTime;
      let nextDelay = ditMs;

      if (sym === '.') {
        gate.gain.setValueAtTime(0.4, now);
        gate.gain.setValueAtTime(0, now + ditMs / 1000);
        nextDelay = ditMs * 2;
      } else if (sym === '-') {
        gate.gain.setValueAtTime(0.4, now);
        gate.gain.setValueAtTime(0, now + (ditMs * 3) / 1000);
        nextDelay = ditMs * 4;
      } else if (sym === ' ') {
        gate.gain.setValueAtTime(0, now);
        nextDelay = ditMs * 3;
        // Trigger decoded char callback
        if (charIdx < text.length && this.onMorseDecodedCallback) {
          this.onMorseDecodedCallback(text[charIdx]);
          charIdx++;
        }
      }

      patternIdx++;
      this.cwInterval = window.setTimeout(scheduleNextMorse, nextDelay);
    };

    scheduleNextMorse();
  }

  // --- Music Synthesizer for FM Broadcast Stations ---
  private startMusicSynth(detuneKHz: number) {
    if (!this.ctx || !this.signalGain) return;

    // Nice warm musical chords arpeggiating simulating a radio song
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'sine';

    const notes = [220, 261.63, 329.63, 392.00, 440, 523.25]; // Am7 pentatonic
    let noteIndex = 0;

    osc1.frequency.setValueAtTime(notes[0], this.ctx.currentTime);
    osc2.frequency.setValueAtTime(notes[2], this.ctx.currentTime);

    const musicGain = this.ctx.createGain();
    musicGain.gain.setValueAtTime(0.25, this.ctx.currentTime);

    osc1.connect(musicGain);
    osc2.connect(musicGain);
    musicGain.connect(this.signalGain);

    osc1.start();
    osc2.start();
    this.toneOscillator1 = osc1;
    this.toneOscillator2 = osc2;

    this.cwInterval = window.setInterval(() => {
      if (!this.ctx || !this.toneOscillator1 || !this.toneOscillator2) return;
      noteIndex = (noteIndex + 1) % notes.length;
      const targetNote1 = notes[noteIndex];
      const targetNote2 = notes[(noteIndex + 2) % notes.length];
      this.toneOscillator1.frequency.setTargetAtTime(targetNote1, this.ctx.currentTime, 0.08);
      this.toneOscillator2.frequency.setTargetAtTime(targetNote2, this.ctx.currentTime, 0.08);
    }, 450);
  }

  // --- NOAA Weather Voice Speech Synthesis ---
  private startWeatherAudio(station: SimulatedStation) {
    this.startRadioVoiceSynth(station, 'NFM', 0);

    const weatherPhrases = [
      `This is National Weather Service station ${station.name}. Coastal waters forecast. Winds southwest 10 to 15 knots. Waves 2 to 4 feet. Barometer 30.08 inches.`,
      `Regional temperature 68 degrees. Relative humidity 62 percent. Skies partly cloudy. Outlook for tonight: patchy fog after midnight.`,
      `Hazardous weather outlook: no hazardous marine conditions expected across the coastal listening area today.`,
    ];

    let phraseIdx = 0;
    const playNextWeatherPhrase = () => {
      if (!this.currentStationId || station.id !== this.currentStationId) return;
      if (!('speechSynthesis' in window)) return;

      const phrase = weatherPhrases[phraseIdx % weatherPhrases.length];
      phraseIdx++;

      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.pitch = 0.95;
      utterance.rate = 1.05; // Robotic official tone
      utterance.volume = 0.65;

      utterance.onend = () => {
        this.isSpeechActive = false;
        this.speechUtteranceTimer = window.setTimeout(playNextWeatherPhrase, 4000);
      };

      utterance.onerror = () => {
        this.isSpeechActive = false;
        this.speechUtteranceTimer = window.setTimeout(playNextWeatherPhrase, 6000);
      };

      this.isSpeechActive = true;
      window.speechSynthesis.speak(utterance);
    };

    this.speechUtteranceTimer = window.setTimeout(playNextWeatherPhrase, 800);
  }

  // --- Aviation ATC Dialogue Synthesis ---
  private startAtcAudio(station: SimulatedStation, _detuneKHz: number) {
    this.startRadioVoiceSynth(station, 'AM', 0);

    const atcPhrases = [
      `Skyhawk 42Echo, turn right heading 270, contact Seattle approach 124.2.`,
      `Delta 844, hold short of runway 16 Right for landing Boeing 737.`,
      `Cactus 115 heavy, wind 240 at 8 knots, runway 28 Left, cleared to land.`,
      `November 817 Uniform, squawk 4212 and ident, radar contact 5 miles east.`,
    ];

    let phraseIdx = 0;
    const playNextAtc = () => {
      if (!this.currentStationId || station.id !== this.currentStationId) return;
      if (!('speechSynthesis' in window)) return;

      const phrase = atcPhrases[phraseIdx % atcPhrases.length];
      phraseIdx++;

      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.pitch = 1.1;
      utterance.rate = 1.25; // Rapid pilot/ATC delivery
      utterance.volume = 0.65;

      utterance.onend = () => {
        this.isSpeechActive = false;
        this.speechUtteranceTimer = window.setTimeout(playNextAtc, 6000);
      };

      utterance.onerror = () => {
        this.isSpeechActive = false;
      };

      this.isSpeechActive = true;
      window.speechSynthesis.speak(utterance);
    };

    this.speechUtteranceTimer = window.setTimeout(playNextAtc, 1000);
  }

  // --- Generic Voice / Radio Carrier Sub-Oscillators ---
  private startRadioVoiceSynth(_station: SimulatedStation, mode: DemodMode, _detuneKHz: number) {
    if (!this.ctx || !this.signalGain) return;

    // Authentic carrier hum / formant filters
    const osc = this.ctx.createOscillator();
    osc.type = mode === 'WFM' ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(mode === 'WFM' ? 19000 : 380, this.ctx.currentTime); // 19kHz pilot or voice formant

    const formantFilter = this.ctx.createBiquadFilter();
    formantFilter.type = 'bandpass';
    formantFilter.frequency.setValueAtTime(850, this.ctx.currentTime);
    formantFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);

    const carrierGain = this.ctx.createGain();
    carrierGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

    osc.connect(formantFilter);
    formantFilter.connect(carrierGain);
    carrierGain.connect(this.signalGain);

    osc.start();
    this.toneOscillator1 = osc;
  }

  // --- Atomic Clock Time Signal (WWV / CHU) ---
  private startTimeSignal() {
    if (!this.ctx || !this.signalGain) return;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, this.ctx.currentTime);

    const tickGain = this.ctx.createGain();
    tickGain.gain.setValueAtTime(0, this.ctx.currentTime);

    osc.connect(tickGain);
    tickGain.connect(this.signalGain);
    osc.start();
    this.toneOscillator1 = osc;

    // 1000 Hz 5ms tick every second
    this.cwInterval = window.setInterval(() => {
      if (!this.ctx || !tickGain) return;
      const now = this.ctx.currentTime;
      tickGain.gain.setValueAtTime(0.4, now);
      tickGain.gain.setValueAtTime(0, now + 0.02);
    }, 1000);
  }

  // --- Demodulated Audio Waveform & FFT Data for UI ---
  public getAudioTimeDomainData(): Uint8Array {
    if (!this.analyser) {
      return new Uint8Array(256);
    }
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  // --- Audio Recording Features ---
  public startRecording(onComplete: (blob: Blob, url: string) => void): boolean {
    if (!this.ctx || !this.mediaStreamDest) return false;

    try {
      this.recordedChunks = [];
      this.onRecordingCompleteCallback = onComplete;
      this.mediaRecorder = new MediaRecorder(this.mediaStreamDest.stream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        if (this.onRecordingCompleteCallback) {
          this.onRecordingCompleteCallback(audioBlob, audioUrl);
        }
      };

      this.mediaRecorder.start(250);
      this.isRecordingAudio = true;
      return true;
    } catch (e) {
      console.error('Failed to start audio recording:', e);
      return false;
    }
  }

  public stopRecording() {
    if (this.mediaRecorder && this.isRecordingAudio) {
      this.mediaRecorder.stop();
      this.isRecordingAudio = false;
    }
  }

  public getIsRecording(): boolean {
    return this.isRecordingAudio;
  }

  public setMorseCallback(cb: (char: string) => void) {
    this.onMorseDecodedCallback = cb;
  }
}

export const audioDsp = new AudioDspService();
