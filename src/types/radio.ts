/**
 * Software Defined Radio (SDR) Core Type Definitions
 */

export type DemodMode = 'WFM' | 'NFM' | 'AM' | 'USB' | 'LSB' | 'CW' | 'DSB';

export type ScanStatus = 'idle' | 'scanning' | 'holding' | 'paused';

export type ScanMode = 'scan-and-hold' | 'search-and-log' | 'memory-scan';

export type ColorMap = 'turbo' | 'viridis' | 'inferno' | 'green' | 'ocean';

export interface RadioBand {
  id: string;
  name: string;
  shortName: string;
  minFreqMHz: number;
  maxFreqMHz: number;
  defaultStepKHz: number;
  defaultMode: DemodMode;
  defaultBandwidthHz: number;
  description: string;
  category: 'broadcast' | 'aviation' | 'weather' | 'marine' | 'amateur' | 'shortwave' | 'util';
}

export interface ActiveSignal {
  id: string;
  frequencyMHz: number;
  name: string;
  category: string;
  modulation: DemodMode;
  bandwidthKHz: number;
  signalStrengthDbm: number;
  snrDb: number;
  firstDetected: number;
  lastActive: number;
  hitCount: number;
  isLockedOut: boolean;
  isBookmarked: boolean;
  isCurrentlyTransmitting: boolean;
  rdsInfo?: {
    stationName: string;
    radioText: string;
    programType: string;
  };
  details?: string;
  ctcssHz?: number;
  audioRecordingUrl?: string;
}

export interface SimulatedStation {
  id: string;
  frequencyMHz: number;
  name: string;
  category: 'broadcast' | 'aviation' | 'weather' | 'marine' | 'amateur' | 'shortwave' | 'util';
  modulation: DemodMode;
  bandwidthKHz: number;
  nominalPowerDbm: number; // e.g. -45 dBm for strong, -80 for weak
  dutyCycle: number; // 0.0 - 1.0 (1.0 = continuous broadcast like FM/NOAA, 0.4 = periodic ATC/ham)
  cyclePeriodSec: number; // period of on/off keying
  rds?: {
    stationName: string;
    radioText: string;
    programType: string;
  };
  ctcssHz?: number;
  morseText?: string;
  audioVoiceType?: 'atc' | 'weather' | 'music' | 'cw' | 'ssb_voice' | 'chatter' | 'time_signal';
  description: string;
}

export interface ScannerConfig {
  mode: ScanMode;
  startFreqMHz: number;
  stopFreqMHz: number;
  stepKHz: number;
  thresholdDbm: number;
  holdTimeSec: number;
  scanSpeed: 'slow' | 'normal' | 'turbo'; // 8, 24, 60 steps/sec
}

export interface ScannerMetrics {
  status: ScanStatus;
  currentFreqMHz: number;
  progressPercent: number;
  channelsScannedTotal: number;
  signalsFoundCount: number;
  sweepStartTime: number | null;
  currentHoldRemainingSec: number;
}

export interface VfoState {
  frequencyMHz: number;
  mode: DemodMode;
  bandwidthHz: number;
  filterLowHz: number;
  filterHighHz: number;
  rfGainDb: number;
  squelchDbm: number;
  volume: number;
  isMuted: boolean;
  agcSpeed: 'off' | 'slow' | 'med' | 'fast';
  noiseBlanker: boolean;
  activeVfo: 'A' | 'B';
  vfoA: { frequencyMHz: number; mode: DemodMode; bandwidthHz: number };
  vfoB: { frequencyMHz: number; mode: DemodMode; bandwidthHz: number };
}
