import { SimulatedStation } from '../types/radio';
import { SIMULATED_STATIONS } from './stationDatabase';

export class RfEngine {
  private stations: SimulatedStation[] = [...SIMULATED_STATIONS];
  private noiseFloorBaseDbm: number = -102; // Average thermal noise floor in dBm
  private stationStates: Map<string, { isKeyed: boolean; lastStateChange: number }> = new Map();

  constructor() {
    this.initStationKeying();
  }

  private initStationKeying() {
    const now = Date.now();
    for (const station of this.stations) {
      this.stationStates.set(station.id, {
        isKeyed: Math.random() < station.dutyCycle,
        lastStateChange: now - Math.random() * (station.cyclePeriodSec * 1000),
      });
    }
  }

  /**
   * Updates intermittent transmitter keying state based on duty cycle and time.
   */
  public updateTransmitters() {
    const now = Date.now();
    for (const station of this.stations) {
      if (station.dutyCycle >= 1.0) {
        // Continuous transmission (e.g. Broadcast FM, NOAA, Time signal)
        this.stationStates.set(station.id, { isKeyed: true, lastStateChange: now });
        continue;
      }

      const state = this.stationStates.get(station.id);
      if (!state) continue;

      const elapsed = now - state.lastStateChange;
      const periodMs = station.cyclePeriodSec * 1000;

      if (state.isKeyed && elapsed > periodMs * station.dutyCycle) {
        // Key down / unkey
        this.stationStates.set(station.id, { isKeyed: false, lastStateChange: now });
      } else if (!state.isKeyed && elapsed > periodMs * (1 - station.dutyCycle)) {
        // Key up
        this.stationStates.set(station.id, { isKeyed: true, lastStateChange: now });
      }
    }
  }

  public getStationById(id: string): SimulatedStation | undefined {
    return this.stations.find((s) => s.id === id);
  }

  public getStations(): SimulatedStation[] {
    return this.stations;
  }

  public addCustomStation(station: SimulatedStation) {
    this.stations.push(station);
    this.stationStates.set(station.id, { isKeyed: true, lastStateChange: Date.now() });
  }

  /**
   * Checks if an active signal is present at a specific frequency within a tolerance window.
   */
  public checkSignalAt(
    freqMHz: number,
    bandwidthKHz: number = 25
  ): {
    hasSignal: boolean;
    station?: SimulatedStation;
    powerDbm: number;
    snrDb: number;
    isKeyed: boolean;
  } {
    this.updateTransmitters();

    // Noise floor with slight frequency-dependent jitter
    const noise = this.noiseFloorBaseDbm + (Math.sin(freqMHz * 10) * 1.5) + (Math.random() * 2 - 1);
    let highestPower = noise;
    let matchingStation: SimulatedStation | undefined;
    let isCurrentlyKeyed = false;

    for (const station of this.stations) {
      const deltaKHz = Math.abs(station.frequencyMHz - freqMHz) * 1000;
      const combinedBw = (station.bandwidthKHz + bandwidthKHz) / 2;

      if (deltaKHz < combinedBw) {
        const state = this.stationStates.get(station.id);
        const keyed = state ? state.isKeyed : true;

        if (keyed) {
          // Attenuation based on distance from center
          const normalizedDist = deltaKHz / combinedBw;
          const rollOffDb = normalizedDist * normalizedDist * 20; // 20 dB drop at edges
          const currentPower = station.nominalPowerDbm - rollOffDb + (Math.random() * 1.5 - 0.75);

          if (currentPower > highestPower) {
            highestPower = currentPower;
            matchingStation = station;
            isCurrentlyKeyed = true;
          }
        }
      }
    }

    const snr = Math.max(0, highestPower - noise);
    return {
      hasSignal: isCurrentlyKeyed && snr > 3,
      station: matchingStation,
      powerDbm: Math.round(highestPower * 10) / 10,
      snrDb: Math.round(snr * 10) / 10,
      isKeyed: isCurrentlyKeyed,
    };
  }

  /**
   * Generates a realistic FFT power buffer (dBm) for a given center frequency and span.
   */
  public generateFftFrame(
    centerFreqMHz: number,
    spanMHz: number,
    numBins: number,
    rfGainDb: number = 20
  ): Float32Array {
    this.updateTransmitters();
    const bins = new Float32Array(numBins);
    const startFreq = centerFreqMHz - spanMHz / 2;
    const endFreq = centerFreqMHz + spanMHz / 2;
    const binWidthMHz = spanMHz / numBins;

    // 1. Generate base noise floor with slight RF passband curve & Gaussian jitter
    const gainOffset = (rfGainDb - 20) * 0.8;
    for (let i = 0; i < numBins; i++) {
      // Gentle SDR front-end analog filter roll-off near Nyquist edges
      const normalizedPos = (i / numBins) * 2 - 1; // -1 to 1
      const frontEndCurve = Math.pow(normalizedPos, 4) * -6; // 6dB roll-off at edges

      // Pink/Gaussian noise component
      const randNoise = (Math.random() + Math.random() + Math.random() - 1.5) * 3;
      bins[i] = this.noiseFloorBaseDbm + gainOffset + frontEndCurve + randNoise;
    }

    // 2. Overlay visible active stations in this frequency window
    for (const station of this.stations) {
      if (station.frequencyMHz < startFreq - 0.5 || station.frequencyMHz > endFreq + 0.5) {
        continue;
      }

      const state = this.stationStates.get(station.id);
      const isKeyed = state ? state.isKeyed : true;
      if (!isKeyed) continue;

      const centerBin = Math.round((station.frequencyMHz - startFreq) / binWidthMHz);
      const bwInBins = Math.max(2, Math.round((station.bandwidthKHz / 1000) / binWidthMHz));
      const peakPower = station.nominalPowerDbm + gainOffset;

      const halfSpanBins = Math.ceil(bwInBins * 2);
      const minBin = Math.max(0, centerBin - halfSpanBins);
      const maxBin = Math.min(numBins - 1, centerBin + halfSpanBins);

      for (let b = minBin; b <= maxBin; b++) {
        const binDist = Math.abs(b - centerBin);
        const normDist = binDist / (bwInBins / 2);

        let signalShapeDb = 0;
        if (normDist <= 1.0) {
          // Inside passband (flat top with slight ripple)
          signalShapeDb = -Math.pow(normDist, 2) * 2;
        } else {
          // Sharp skirt roll-off (40 dB/decade)
          signalShapeDb = -2 - Math.pow(normDist - 1, 1.8) * 35;
        }

        const signalLevel = peakPower + signalShapeDb + (Math.random() * 1.2 - 0.6);
        // Power addition in dB
        if (signalLevel > bins[b]) {
          bins[b] = signalLevel;
        }
      }
    }

    return bins;
  }

  /**
   * Converts dBm to standard IARU S-Meter reading (0 to 15, where 9 = S9, 10 = +10dB, 15 = +60dB).
   */
  public static dbmToSUnits(dbm: number): {
    sUnit: number; // 0 to 9, or above 9
    label: string;
    isOver9: boolean;
    overDb: number;
    fraction: number; // 0.0 to 1.0 for analog meter gauge
  } {
    // S9 calibrated at -73 dBm (HF) / -93 dBm (VHF/UHF standard).
    // Let's use VHF standard: S9 = -93 dBm, S1 = -141 dBm (6 dB per S-unit)
    const s9Threshold = -85;

    if (dbm <= -127) {
      return { sUnit: 0, label: 'S0', isOver9: false, overDb: 0, fraction: 0.05 };
    }

    if (dbm <= s9Threshold) {
      // Below or at S9
      const sVal = Math.max(0, Math.min(9, Math.round((dbm - (-127)) / 4.67)));
      const fraction = (sVal / 9) * 0.6; // 0% to 60% of meter face
      return {
        sUnit: sVal,
        label: `S${sVal}`,
        isOver9: false,
        overDb: 0,
        fraction: Math.max(0.05, Math.min(0.6, fraction)),
      };
    } else {
      // Above S9 (+10 to +60 dB)
      const overDb = Math.min(60, Math.round(dbm - s9Threshold));
      const fraction = 0.6 + (overDb / 60) * 0.38; // 60% to 98% of meter face
      return {
        sUnit: 9,
        label: `S9+${overDb}dB`,
        isOver9: true,
        overDb,
        fraction: Math.min(0.98, fraction),
      };
    }
  }
}

export const rfEngine = new RfEngine();
