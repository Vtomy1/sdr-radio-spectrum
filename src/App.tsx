import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ActiveSignal,
  DemodMode,
  ScannerConfig,
  ScannerMetrics,
  SimulatedStation,
  VfoState,
} from './types/radio';
import { rfEngine } from './services/rfEngine';
import { audioDsp } from './services/audioDsp';
import { scannerService } from './services/scannerService';
import { SpectrumDisplay } from './components/SpectrumDisplay';
import { RadioControls } from './components/RadioControls';
import { FrequencyScanner } from './components/FrequencyScanner';
import { SignalMeters } from './components/SignalMeters';
import { AudioRecordingsModal, RecordedAudioItem } from './components/AudioRecordingsModal';
import { HardwareSDRModal } from './components/HardwareSDRModal';
import {
  Radio,
  Disc,
  Usb,
  Volume2,
  VolumeX,
  Layers,
  Sparkles,
  Info,
  Maximize2,
  LayoutGrid,
} from 'lucide-react';

export default function App() {
  // --- VFO & Receiver State ---
  const [vfo, setVfo] = useState<VfoState>({
    frequencyMHz: 119.100, // Aviation Metro Tower default
    mode: 'AM',
    bandwidthHz: 8330,
    filterLowHz: 300,
    filterHighHz: 3000,
    rfGainDb: 24,
    squelchDbm: -78,
    volume: 0.7,
    isMuted: false,
    agcSpeed: 'med',
    noiseBlanker: false,
    activeVfo: 'A',
    vfoA: { frequencyMHz: 119.100, mode: 'AM', bandwidthHz: 8330 },
    vfoB: { frequencyMHz: 162.400, mode: 'NFM', bandwidthHz: 12500 },
  });

  // --- Real-Time Signal Reception Telemetry ---
  const [currentPowerDbm, setCurrentPowerDbm] = useState<number>(-98);
  const [currentSnrDb, setCurrentSnrDb] = useState<number>(0);
  const [currentStation, setCurrentStation] = useState<SimulatedStation | undefined>(undefined);
  const [isReceivingSignal, setIsReceivingSignal] = useState<boolean>(false);

  // --- Scanner State ---
  const [scannerMetrics, setScannerMetrics] = useState<ScannerMetrics>(scannerService.getMetrics());
  const [detectedSignals, setDetectedSignals] = useState<ActiveSignal[]>(scannerService.getActiveSignals());
  const [scannerConfig, setScannerConfig] = useState<ScannerConfig>(scannerService.getConfig());

  // --- Audio Recording & Modals ---
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordings, setRecordings] = useState<RecordedAudioItem[]>([]);
  const [isRecordingsModalOpen, setIsRecordingsModalOpen] = useState<boolean>(false);
  const [isHardwareModalOpen, setIsHardwareModalOpen] = useState<boolean>(false);
  const [usingHardware, setUsingHardware] = useState<boolean>(false);

  // --- Layout Views ---
  const [viewMode, setViewMode] = useState<'split' | 'scanner' | 'spectrum'>('split');
  const [audioStarted, setAudioStarted] = useState<boolean>(false);

  // Register scanner callbacks
  useEffect(() => {
    scannerService.setCallbacks(
      (metrics) => setScannerMetrics(metrics),
      (signals) => setDetectedSignals([...signals]),
      (tunedFreq) => {
        // When scanner tunes in scan-and-hold mode
        handleTuneFrequency(tunedFreq);
      }
    );
  }, []);

  // Update receiver DSP & Telemetry Loop
  useEffect(() => {
    const interval = window.setInterval(() => {
      // 1. Probe RF engine at current VFO frequency
      const probe = rfEngine.checkSignalAt(vfo.frequencyMHz, vfo.bandwidthHz / 1000);
      setCurrentPowerDbm(probe.powerDbm);
      setCurrentSnrDb(probe.snrDb);
      setCurrentStation(probe.station);

      const isSignalOpen = probe.powerDbm >= vfo.squelchDbm && probe.hasSignal;
      setIsReceivingSignal(isSignalOpen);

      // 2. Update Web Audio DSP
      if (audioStarted) {
        audioDsp.updateReceiverParams(
          vfo.mode,
          vfo.bandwidthHz,
          vfo.volume,
          vfo.isMuted,
          vfo.squelchDbm,
          probe.powerDbm,
          probe.station,
          0
        );
      }
    }, 60);

    return () => window.clearInterval(interval);
  }, [vfo, audioStarted]);

  // Audio start trigger on first user interaction
  const ensureAudioStarted = async () => {
    if (!audioStarted) {
      const ok = await audioDsp.initAudioContext();
      if (ok) setAudioStarted(true);
    }
  };

  // --- Tuning Handlers ---
  const handleTuneFrequency = useCallback(
    (newFreqMHz: number) => {
      ensureAudioStarted();
      setVfo((prev) => {
        const rounded = parseFloat(newFreqMHz.toFixed(4));
        const active = prev.activeVfo;
        return {
          ...prev,
          frequencyMHz: rounded,
          vfoA: active === 'A' ? { ...prev.vfoA, frequencyMHz: rounded } : prev.vfoA,
          vfoB: active === 'B' ? { ...prev.vfoB, frequencyMHz: rounded } : prev.vfoB,
        };
      });
    },
    [audioStarted]
  );

  const handleModeChange = (newMode: DemodMode) => {
    ensureAudioStarted();
    setVfo((prev) => {
      // Automatically choose sensible default bandwidth for the chosen mode
      let defaultBw = 12500;
      if (newMode === 'WFM') defaultBw = 180000;
      else if (newMode === 'AM') defaultBw = 6000;
      else if (newMode === 'USB' || newMode === 'LSB') defaultBw = 2400;
      else if (newMode === 'CW') defaultBw = 500;

      const active = prev.activeVfo;
      return {
        ...prev,
        mode: newMode,
        bandwidthHz: defaultBw,
        vfoA: active === 'A' ? { ...prev.vfoA, mode: newMode, bandwidthHz: defaultBw } : prev.vfoA,
        vfoB: active === 'B' ? { ...prev.vfoB, mode: newMode, bandwidthHz: defaultBw } : prev.vfoB,
      };
    });
  };

  const handleBandwidthChange = (bwHz: number) => {
    ensureAudioStarted();
    setVfo((prev) => ({
      ...prev,
      bandwidthHz: bwHz,
    }));
  };

  const handleRfGainChange = (gainDb: number) => {
    setVfo((prev) => ({ ...prev, rfGainDb: gainDb }));
  };

  const handleSquelchChange = (squelchDbm: number) => {
    setVfo((prev) => ({ ...prev, squelchDbm }));
  };

  const handleVolumeChange = (vol: number) => {
    ensureAudioStarted();
    setVfo((prev) => ({ ...prev, volume: vol, isMuted: false }));
  };

  const handleToggleMute = () => {
    ensureAudioStarted();
    setVfo((prev) => ({ ...prev, isMuted: !prev.isMuted }));
  };

  const handleToggleVfo = () => {
    ensureAudioStarted();
    setVfo((prev) => {
      const nextActive = prev.activeVfo === 'A' ? 'B' : 'A';
      const targetState = nextActive === 'A' ? prev.vfoA : prev.vfoB;
      return {
        ...prev,
        activeVfo: nextActive,
        frequencyMHz: targetState.frequencyMHz,
        mode: targetState.mode,
        bandwidthHz: targetState.bandwidthHz,
      };
    });
  };

  // --- Audio Recording ---
  const handleToggleRecording = () => {
    ensureAudioStarted();
    if (isRecording) {
      audioDsp.stopRecording();
      setIsRecording(false);
    } else {
      const started = audioDsp.startRecording((blob, url) => {
        const newRec: RecordedAudioItem = {
          id: `rec_${Date.now()}`,
          frequencyMHz: vfo.frequencyMHz,
          mode: vfo.mode,
          stationName: currentStation?.name,
          timestamp: Date.now(),
          durationSec: 10,
          blobUrl: url,
        };
        setRecordings((prev) => [newRec, ...prev]);
      });
      if (started) {
        setIsRecording(true);
      }
    }
  };

  const handleDeleteRecording = (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  };

  // --- Scanner Configuration Update ---
  const handleScannerConfigChange = (newCfg: Partial<ScannerConfig>) => {
    scannerService.updateConfig(newCfg);
    setScannerConfig(scannerService.getConfig());
  };

  const handleTuneToSignal = (signal: ActiveSignal) => {
    ensureAudioStarted();
    handleTuneFrequency(signal.frequencyMHz);
    handleModeChange(signal.modulation);
    handleBandwidthChange(signal.bandwidthKHz * 1000);
  };

  return (
    <div
      onClick={ensureAudioStarted}
      className="min-h-screen bg-[#080b10] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30"
    >
      {/* 
        Top Bar Contract: Exactly 3 Zones:
        Zone 1: Brand title (single text element wordmark)
        Zone 2: 4-6 text navigation links (single line, no pills)
        Zone 3: 1-2 primary actions
      */}
      <header className="flex items-center justify-between px-6 py-3.5 bg-[#0a0e17] border-b border-slate-800 shrink-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyan-400" />
          <a href="/" className="text-lg font-bold tracking-tight text-white font-mono">
            StratoSDR
          </a>
        </div>

        {/* Zone 2: 4-6 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => setViewMode('split')}
            className={`transition-colors hover:text-white ${
              viewMode === 'split' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Split Console
          </button>
          <button
            onClick={() => setViewMode('scanner')}
            className={`transition-colors hover:text-white ${
              viewMode === 'scanner' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Frequency Scanner ({detectedSignals.length})
          </button>
          <button
            onClick={() => setViewMode('spectrum')}
            className={`transition-colors hover:text-white ${
              viewMode === 'spectrum' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Spectrum Waterfall
          </button>
          <button
            onClick={() => setIsHardwareModalOpen(true)}
            className="transition-colors hover:text-white"
          >
            WebUSB Dongles
          </button>
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-3">
          {/* Intercepted Recordings Quick Button */}
          <button
            onClick={() => setIsRecordingsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap border border-slate-700/60"
          >
            <Disc className="w-3.5 h-3.5 text-rose-400" />
            <span>Recordings ({recordings.length})</span>
          </button>

          {/* Audio Engine Status Toggle */}
          <button
            onClick={() => {
              ensureAudioStarted();
              handleToggleMute();
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              vfo.isMuted || !audioStarted
                ? 'bg-slate-800 text-slate-400 border border-slate-700'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm shadow-cyan-900/40'
            }`}
          >
            {vfo.isMuted || !audioStarted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>{audioStarted && !vfo.isMuted ? 'Audio Active' : 'Start Audio'}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Stage */}
      <main className="flex-1 p-3 sm:p-4 max-w-[1700px] w-full mx-auto flex flex-col gap-4">
        {/* VIEW MODE 1: Split Console (Default balanced view) */}
        {viewMode === 'split' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
            {/* Left 7 Columns: Spectrum Waterfall & Radio Receiver Controls */}
            <div className="lg:col-span-7 flex flex-col gap-4">
              {/* Interactive Waterfall & Spectrum Analyzer */}
              <div className="h-[360px] sm:h-[420px] w-full">
                <SpectrumDisplay
                  centerFreqMHz={vfo.frequencyMHz}
                  demodMode={vfo.mode}
                  bandwidthHz={vfo.bandwidthHz}
                  rfGainDb={vfo.rfGainDb}
                  squelchThresholdDbm={vfo.squelchDbm}
                  scannerCurrentFreqMHz={scannerMetrics.currentFreqMHz}
                  isScanning={scannerMetrics.status === 'scanning' || scannerMetrics.status === 'holding'}
                  onTune={handleTuneFrequency}
                  onBandwidthChange={handleBandwidthChange}
                />
              </div>

              {/* Radio Controls, VFO, Modes & Volume */}
              <RadioControls
                vfo={vfo}
                currentSignalPowerDbm={currentPowerDbm}
                isReceivingSignal={isReceivingSignal}
                isRecording={isRecording}
                onFrequencyChange={handleTuneFrequency}
                onModeChange={handleModeChange}
                onBandwidthChange={handleBandwidthChange}
                onRfGainChange={handleRfGainChange}
                onSquelchChange={handleSquelchChange}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onToggleVfo={handleToggleVfo}
                onToggleRecording={handleToggleRecording}
              />

              {/* Calibrated S-Meter, RDS Decoder & Audio Oscilloscope */}
              <SignalMeters
                currentPowerDbm={currentPowerDbm}
                snrDb={currentSnrDb}
                station={currentStation}
                demodMode={vfo.mode}
                isReceiving={isReceivingSignal}
              />
            </div>

            {/* Right 5 Columns: Automated Frequency Scanner & Active Signals Registry */}
            <div className="lg:col-span-5 flex flex-col h-[750px] lg:h-auto min-h-[550px]">
              <FrequencyScanner
                metrics={scannerMetrics}
                signals={detectedSignals}
                config={scannerConfig}
                onConfigChange={handleScannerConfigChange}
                onTuneToSignal={handleTuneToSignal}
              />
            </div>
          </div>
        )}

        {/* VIEW MODE 2: Scanner Focused Layout */}
        {viewMode === 'scanner' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
            <div className="lg:col-span-8 flex flex-col min-h-[600px]">
              <FrequencyScanner
                metrics={scannerMetrics}
                signals={detectedSignals}
                config={scannerConfig}
                onConfigChange={handleScannerConfigChange}
                onTuneToSignal={handleTuneToSignal}
              />
            </div>

            <div className="lg:col-span-4 flex flex-col gap-4">
              <RadioControls
                vfo={vfo}
                currentSignalPowerDbm={currentPowerDbm}
                isReceivingSignal={isReceivingSignal}
                isRecording={isRecording}
                onFrequencyChange={handleTuneFrequency}
                onModeChange={handleModeChange}
                onBandwidthChange={handleBandwidthChange}
                onRfGainChange={handleRfGainChange}
                onSquelchChange={handleSquelchChange}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onToggleVfo={handleToggleVfo}
                onToggleRecording={handleToggleRecording}
              />

              <SignalMeters
                currentPowerDbm={currentPowerDbm}
                snrDb={currentSnrDb}
                station={currentStation}
                demodMode={vfo.mode}
                isReceiving={isReceivingSignal}
              />
            </div>
          </div>
        )}

        {/* VIEW MODE 3: Spectrum Waterfall Focused Layout */}
        {viewMode === 'spectrum' && (
          <div className="flex flex-col gap-4 flex-1">
            <div className="h-[520px] w-full">
              <SpectrumDisplay
                centerFreqMHz={vfo.frequencyMHz}
                demodMode={vfo.mode}
                bandwidthHz={vfo.bandwidthHz}
                rfGainDb={vfo.rfGainDb}
                squelchThresholdDbm={vfo.squelchDbm}
                scannerCurrentFreqMHz={scannerMetrics.currentFreqMHz}
                isScanning={scannerMetrics.status === 'scanning' || scannerMetrics.status === 'holding'}
                onTune={handleTuneFrequency}
                onBandwidthChange={handleBandwidthChange}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RadioControls
                vfo={vfo}
                currentSignalPowerDbm={currentPowerDbm}
                isReceivingSignal={isReceivingSignal}
                isRecording={isRecording}
                onFrequencyChange={handleTuneFrequency}
                onModeChange={handleModeChange}
                onBandwidthChange={handleBandwidthChange}
                onRfGainChange={handleRfGainChange}
                onSquelchChange={handleSquelchChange}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onToggleVfo={handleToggleVfo}
                onToggleRecording={handleToggleRecording}
              />

              <SignalMeters
                currentPowerDbm={currentPowerDbm}
                snrDb={currentSnrDb}
                station={currentStation}
                demodMode={vfo.mode}
                isReceiving={isReceivingSignal}
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer Info Strip */}
      <footer className="px-6 py-3 bg-[#0a0e17] border-t border-slate-800 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-slate-400 font-mono font-medium">StratoSDR Radio &amp; Frequency Scanner</span>
          <span aria-hidden="true">·</span>
          <span>Demodulation: WFM, NFM, AM, USB, LSB, CW</span>
          <span aria-hidden="true">·</span>
          <span>Web Audio API 44.1 kHz DSP</span>
        </div>

        <div className="flex items-center gap-4 text-slate-400 font-mono text-[11px]">
          <span>RF NOISE: -102 dBm</span>
          <span>IARU S-METER</span>
          <span>ACTIVE SIGNALS: {detectedSignals.length}</span>
        </div>
      </footer>

      {/* Audio Intercept Recordings Modal */}
      <AudioRecordingsModal
        isOpen={isRecordingsModalOpen}
        recordings={recordings}
        onClose={() => setIsRecordingsModalOpen(false)}
        onDelete={handleDeleteRecording}
      />

      {/* Hardware SDR WebUSB Modal */}
      <HardwareSDRModal
        isOpen={isHardwareModalOpen}
        onClose={() => setIsHardwareModalOpen(false)}
        usingHardware={usingHardware}
        onToggleHardware={setUsingHardware}
      />
    </div>
  );
}
