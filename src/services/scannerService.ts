import { ActiveSignal, ScanMode, ScannerConfig, ScannerMetrics } from '../types/radio';
import { rfEngine } from './rfEngine';

export class ScannerService {
  private config: ScannerConfig = {
    mode: 'scan-and-hold',
    startFreqMHz: 118.0,
    stopFreqMHz: 137.0,
    stepKHz: 25,
    thresholdDbm: -78,
    holdTimeSec: 3,
    scanSpeed: 'normal',
  };

  private metrics: ScannerMetrics = {
    status: 'idle',
    currentFreqMHz: 118.0,
    progressPercent: 0,
    channelsScannedTotal: 0,
    signalsFoundCount: 0,
    sweepStartTime: null,
    currentHoldRemainingSec: 0,
  };

  private activeSignals: Map<string, ActiveSignal> = new Map();
  private lockedOutFrequencies: Set<string> = new Set(); // format: "119.1000"
  private scanTimer: number | null = null;
  private holdTimer: number | null = null;

  // Listeners
  private onMetricsChange: ((metrics: ScannerMetrics) => void) | null = null;
  private onSignalsChange: ((signals: ActiveSignal[]) => void) | null = null;
  private onTuneRequested: ((freqMHz: number) => void) | null = null;

  constructor() {
    this.metrics.currentFreqMHz = this.config.startFreqMHz;
  }

  public setCallbacks(
    onMetrics: (m: ScannerMetrics) => void,
    onSignals: (s: ActiveSignal[]) => void,
    onTune: (f: number) => void
  ) {
    this.onMetricsChange = onMetrics;
    this.onSignalsChange = onSignals;
    this.onTuneRequested = onTune;
  }

  public updateConfig(newConfig: Partial<ScannerConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (this.metrics.status === 'idle') {
      this.metrics.currentFreqMHz = this.config.startFreqMHz;
      this.metrics.progressPercent = 0;
      this.notifyMetrics();
    }
  }

  public getConfig(): ScannerConfig {
    return { ...this.config };
  }

  public getMetrics(): ScannerMetrics {
    return { ...this.metrics };
  }

  public getActiveSignals(): ActiveSignal[] {
    return Array.from(this.activeSignals.values()).sort((a, b) => b.lastActive - a.lastActive);
  }

  public startScan() {
    if (this.metrics.status === 'scanning' || this.metrics.status === 'holding') return;

    this.clearTimers();
    this.metrics.status = 'scanning';
    this.metrics.sweepStartTime = Date.now();
    this.metrics.currentFreqMHz = Math.max(
      this.config.startFreqMHz,
      Math.min(this.config.stopFreqMHz, this.metrics.currentFreqMHz)
    );
    this.notifyMetrics();

    this.scheduleNextStep();
  }

  public pauseScan() {
    if (this.metrics.status === 'idle') return;
    this.clearTimers();
    this.metrics.status = 'paused';
    this.notifyMetrics();
  }

  public resumeScan() {
    if (this.metrics.status !== 'paused') return;
    this.metrics.status = 'scanning';
    this.notifyMetrics();
    this.scheduleNextStep();
  }

  public stopScan() {
    this.clearTimers();
    this.metrics.status = 'idle';
    this.metrics.currentHoldRemainingSec = 0;
    this.notifyMetrics();
  }

  public clearTimers() {
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.holdTimer !== null) {
      window.clearInterval(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private getStepIntervalMs(): number {
    switch (this.config.scanSpeed) {
      case 'turbo':
        return 20; // 50 steps/sec
      case 'slow':
        return 120; // 8 steps/sec
      case 'normal':
      default:
        return 45; // ~22 steps/sec
    }
  }

  private scheduleNextStep() {
    if (this.metrics.status !== 'scanning') return;
    const interval = this.getStepIntervalMs();
    this.scanTimer = window.setTimeout(() => this.executeScanStep(), interval);
  }

  private executeScanStep() {
    if (this.metrics.status !== 'scanning') return;

    const currentFreq = this.metrics.currentFreqMHz;
    const freqKey = currentFreq.toFixed(4);

    // Check RF engine for signal at this frequency
    const channelBwKHz = this.config.stepKHz;
    const probe = rfEngine.checkSignalAt(currentFreq, channelBwKHz);

    this.metrics.channelsScannedTotal++;

    // Calculate progress
    const range = this.config.stopFreqMHz - this.config.startFreqMHz;
    if (range > 0) {
      this.metrics.progressPercent = Math.min(
        100,
        Math.max(0, ((currentFreq - this.config.startFreqMHz) / range) * 100)
      );
    }

    const isLockedOut = this.lockedOutFrequencies.has(freqKey);
    const signalDetected = probe.hasSignal && probe.powerDbm >= this.config.thresholdDbm && !isLockedOut;

    if (signalDetected) {
      this.recordDetectedSignal(currentFreq, probe);

      if (this.config.mode === 'scan-and-hold') {
        // Halt and hold on active frequency
        this.metrics.status = 'holding';
        this.metrics.currentHoldRemainingSec = this.config.holdTimeSec;
        this.notifyMetrics();

        // Tune SDR to this frequency
        if (this.onTuneRequested) {
          this.onTuneRequested(currentFreq);
        }

        // Start countdown hold timer
        this.holdTimer = window.setInterval(() => {
          this.metrics.currentHoldRemainingSec -= 0.5;
          if (this.metrics.currentHoldRemainingSec <= 0) {
            this.clearTimers();
            this.advanceFrequency();
            this.metrics.status = 'scanning';
            this.notifyMetrics();
            this.scheduleNextStep();
          } else {
            this.notifyMetrics();
          }
        }, 500);

        return;
      }
    }

    // Advance to next frequency
    this.advanceFrequency();
    this.notifyMetrics();
    this.scheduleNextStep();
  }

  private advanceFrequency() {
    const stepMHz = this.config.stepKHz / 1000;
    let nextFreq = this.metrics.currentFreqMHz + stepMHz;

    // Round to step precision to avoid floating point drift
    const decimals = this.config.stepKHz < 10 ? 4 : 3;
    nextFreq = parseFloat(nextFreq.toFixed(decimals));

    if (nextFreq > this.config.stopFreqMHz) {
      // Loop back to start
      nextFreq = this.config.startFreqMHz;
    }
    this.metrics.currentFreqMHz = nextFreq;
  }

  private recordDetectedSignal(
    freqMHz: number,
    probe: {
      hasSignal: boolean;
      station?: ReturnType<typeof rfEngine.checkSignalAt>['station'];
      powerDbm: number;
      snrDb: number;
    }
  ) {
    const freqKey = freqMHz.toFixed(4);
    const now = Date.now();

    const existing = this.activeSignals.get(freqKey);
    if (existing) {
      existing.signalStrengthDbm = probe.powerDbm;
      existing.snrDb = probe.snrDb;
      existing.lastActive = now;
      existing.hitCount++;
      existing.isCurrentlyTransmitting = true;
      if (probe.station) {
        existing.name = probe.station.name;
        existing.category = probe.station.category;
        existing.modulation = probe.station.modulation;
        existing.bandwidthKHz = probe.station.bandwidthKHz;
        if (probe.station.rds) {
          existing.rdsInfo = probe.station.rds;
        }
      }
    } else {
      const station = probe.station;
      const newSignal: ActiveSignal = {
        id: `sig_${freqKey}_${now}`,
        frequencyMHz: freqMHz,
        name: station ? station.name : `Signal @ ${freqKey} MHz`,
        category: station ? station.category : 'Detected Carrier',
        modulation: station ? station.modulation : 'NFM',
        bandwidthKHz: station ? station.bandwidthKHz : this.config.stepKHz,
        signalStrengthDbm: probe.powerDbm,
        snrDb: probe.snrDb,
        firstDetected: now,
        lastActive: now,
        hitCount: 1,
        isLockedOut: false,
        isBookmarked: false,
        isCurrentlyTransmitting: true,
        rdsInfo: station?.rds,
        details: station?.description,
      };
      this.activeSignals.set(freqKey, newSignal);
      this.metrics.signalsFoundCount++;
    }

    this.notifySignals();
  }

  public toggleLockout(freqMHz: number): boolean {
    const key = freqMHz.toFixed(4);
    let isLocked = false;
    if (this.lockedOutFrequencies.has(key)) {
      this.lockedOutFrequencies.delete(key);
      isLocked = false;
    } else {
      this.lockedOutFrequencies.add(key);
      isLocked = true;
    }

    const signal = this.activeSignals.get(key);
    if (signal) {
      signal.isLockedOut = isLocked;
      this.notifySignals();
    }
    return isLocked;
  }

  public toggleBookmark(freqMHz: number): boolean {
    const key = freqMHz.toFixed(4);
    const signal = this.activeSignals.get(key);
    if (signal) {
      signal.isBookmarked = !signal.isBookmarked;
      this.notifySignals();
      return signal.isBookmarked;
    }
    return false;
  }

  public clearDetectedSignals() {
    this.activeSignals.clear();
    this.metrics.signalsFoundCount = 0;
    this.notifySignals();
    this.notifyMetrics();
  }

  public exportSignalsToCsv(): string {
    const list = this.getActiveSignals();
    const headers = [
      'Frequency (MHz)',
      'Station / Label',
      'Category',
      'Modulation',
      'Signal (dBm)',
      'SNR (dB)',
      'Hit Count',
      'First Detected',
      'Last Heard',
    ];
    const rows = list.map((s) => [
      s.frequencyMHz.toFixed(4),
      `"${s.name.replace(/"/g, '""')}"`,
      s.category,
      s.modulation,
      s.signalStrengthDbm,
      s.snrDb,
      s.hitCount,
      new Date(s.firstDetected).toISOString(),
      new Date(s.lastActive).toISOString(),
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  public exportSignalsToJson(): string {
    return JSON.stringify(this.getActiveSignals(), null, 2);
  }

  private notifyMetrics() {
    if (this.onMetricsChange) {
      this.onMetricsChange({ ...this.metrics });
    }
  }

  private notifySignals() {
    if (this.onSignalsChange) {
      this.onSignalsChange(this.getActiveSignals());
    }
  }
}

export const scannerService = new ScannerService();
