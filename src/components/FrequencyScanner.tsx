import React, { useState } from 'react';
import { ActiveSignal, RadioBand, ScanMode, ScannerConfig, ScannerMetrics } from '../types/radio';
import { RADIO_BANDS } from '../services/stationDatabase';
import { scannerService } from '../services/scannerService';
import {
  Play,
  Pause,
  Square,
  Search,
  Download,
  Trash2,
  Radio,
  Volume2,
  Bookmark,
  BookmarkCheck,
  ShieldAlert,
  Zap,
  Filter,
  CheckCircle2,
  Clock,
  Activity,
} from 'lucide-react';

interface FrequencyScannerProps {
  metrics: ScannerMetrics;
  signals: ActiveSignal[];
  config: ScannerConfig;
  onConfigChange: (config: Partial<ScannerConfig>) => void;
  onTuneToSignal: (signal: ActiveSignal) => void;
  onStartRecordingSnippet?: (signal: ActiveSignal) => void;
}

export const FrequencyScanner: React.FC<FrequencyScannerProps> = ({
  metrics,
  signals,
  config,
  onConfigChange,
  onTuneToSignal,
}) => {
  const [selectedPresetId, setSelectedPresetId] = useState<string>('airband_vhf');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [minSnrFilter, setMinSnrFilter] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'signals' | 'config'>('signals');

  // Handle Preset Selection
  const handleSelectBand = (band: RadioBand) => {
    setSelectedPresetId(band.id);
    onConfigChange({
      startFreqMHz: band.minFreqMHz,
      stopFreqMHz: band.maxFreqMHz,
      stepKHz: band.defaultStepKHz,
    });
  };

  const handleStartScan = () => {
    scannerService.startScan();
  };

  const handlePauseScan = () => {
    scannerService.pauseScan();
  };

  const handleResumeScan = () => {
    scannerService.resumeScan();
  };

  const handleStopScan = () => {
    scannerService.stopScan();
  };

  const handleClearSignals = () => {
    scannerService.clearDetectedSignals();
  };

  const handleExportCsv = () => {
    const csvContent = scannerService.exportSignalsToCsv();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `stratosdr_scan_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    const jsonContent = scannerService.exportSignalsToJson();
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `stratosdr_scan_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter signals
  const filteredSignals = signals.filter((s) => {
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
    if (s.snrDb < minSnrFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchFreq = s.frequencyMHz.toFixed(4).includes(q);
      const matchName = s.name.toLowerCase().includes(q);
      const matchCat = s.category.toLowerCase().includes(q);
      const matchMod = s.modulation.toLowerCase().includes(q);
      const matchRds = s.rdsInfo ? s.rdsInfo.stationName.toLowerCase().includes(q) : false;
      return matchFreq || matchName || matchCat || matchMod || matchRds;
    }
    return true;
  });

  const liveActiveCount = signals.filter((s) => s.isCurrentlyTransmitting).length;

  return (
    <div className="flex flex-col h-full bg-[#0a0e17] rounded-lg border border-slate-800 overflow-hidden shadow-2xl">
      {/* Header: Scanner Status & Scan Controller Ribbon */}
      <div className="p-3 bg-[#0d131f] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand title & Scan status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-cyan-400" />
            <h2 className="font-semibold text-slate-100 tracking-tight text-sm">
              Frequency Scanner &amp; Signal Detector
            </h2>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-2">
            {metrics.status === 'scanning' && (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                SCANNING
              </span>
            )}
            {metrics.status === 'holding' && (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/30">
                <Clock className="w-3.5 h-3.5" />
                HOLD {metrics.currentHoldRemainingSec.toFixed(1)}s
              </span>
            )}
            {metrics.status === 'paused' && (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono bg-slate-700/50 text-slate-300 border border-slate-600">
                PAUSED
              </span>
            )}
            {metrics.status === 'idle' && (
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono bg-slate-800/40 text-slate-400">
                STANDBY
              </span>
            )}
          </div>
        </div>

        {/* Right: Primary Scan Execution Buttons */}
        <div className="flex items-center gap-2">
          {metrics.status === 'idle' && (
            <button
              onClick={handleStartScan}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-medium text-xs shadow-lg shadow-cyan-900/30 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Scan</span>
            </button>
          )}

          {metrics.status === 'scanning' && (
            <button
              onClick={handlePauseScan}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium text-xs transition-colors"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause</span>
            </button>
          )}

          {metrics.status === 'paused' && (
            <button
              onClick={handleResumeScan}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-xs transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Resume</span>
            </button>
          )}

          {metrics.status !== 'idle' && (
            <button
              onClick={handleStopScan}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600/80 hover:bg-rose-600 text-white rounded font-medium text-xs transition-colors"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          )}

          {/* Toggle between signals list and scan config */}
          <div className="flex items-center bg-slate-800/60 p-0.5 rounded border border-slate-700">
            <button
              onClick={() => setActiveTab('signals')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === 'signals' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active Signals ({signals.length})
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === 'config' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Scan Parameters
            </button>
          </div>
        </div>
      </div>

      {/* Progress & Live Telemetry Bar */}
      <div className="bg-[#0b0f19] px-3 py-2 border-b border-slate-800/80 text-xs">
        <div className="flex items-center justify-between font-mono mb-1.5 text-slate-300">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">CURRENT FREQ:</span>
            <span className="text-cyan-400 font-bold text-sm">
              {metrics.currentFreqMHz.toFixed(4)} MHz
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">CHANNELS:</span>
            <span className="text-slate-200 font-semibold">{metrics.channelsScannedTotal}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-slate-400">DETECTED:</span>
            <span className="text-emerald-400 font-bold">{metrics.signalsFoundCount} Signals</span>
            <span className="text-slate-600">·</span>
            <span className="text-cyan-300 font-semibold">{liveActiveCount} Live RX</span>
          </div>
        </div>

        {/* Real-time sweep progress bar */}
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-75 ease-out rounded-full"
            style={{ width: `${Math.max(1, metrics.progressPercent)}%` }}
          />
        </div>
      </div>

      {/* Main Tab Content */}
      {activeTab === 'config' ? (
        /* Configuration & Range Setup View */
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {/* Preset Band Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              QUICK BAND PRESETS (CLICK TO LOAD FREQUENCY RANGE)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {RADIO_BANDS.map((band) => {
                const isSelected = selectedPresetId === band.id;
                return (
                  <button
                    key={band.id}
                    onClick={() => handleSelectBand(band)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500/60 shadow-md shadow-cyan-950/40'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="font-semibold text-xs text-slate-200 flex items-center justify-between">
                      <span>{band.name}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-[11px] font-mono text-cyan-400/90 mt-1">
                      {band.minFreqMHz} - {band.maxFreqMHz} MHz
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Step: {band.defaultStepKHz} kHz · {band.defaultMode}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Exact Frequency Boundaries & Step Size */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0d1320] p-3.5 rounded-lg border border-slate-800">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                START FREQUENCY (MHz)
              </label>
              <input
                type="number"
                step="0.001"
                value={config.startFreqMHz}
                onChange={(e) => onConfigChange({ startFreqMHz: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-sm text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                STOP FREQUENCY (MHz)
              </label>
              <input
                type="number"
                step="0.001"
                value={config.stopFreqMHz}
                onChange={(e) => onConfigChange({ stopFreqMHz: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-sm text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                CHANNEL STEP SIZE
              </label>
              <select
                value={config.stepKHz}
                onChange={(e) => onConfigChange({ stepKHz: parseFloat(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 font-mono text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value={1}>1.0 kHz (Fine CW/SSB)</option>
                <option value={5}>5.0 kHz (HF Shortwave)</option>
                <option value={6.25}>6.25 kHz (PMR446)</option>
                <option value={8.33}>8.33 kHz (Aviation ICAO)</option>
                <option value={10}>10.0 kHz (CB Radio / AM)</option>
                <option value={12.5}>12.5 kHz (VHF Marine / Ham)</option>
                <option value={20}>20.0 kHz (Ham 2m)</option>
                <option value={25}>25.0 kHz (Airband / Marine)</option>
                <option value={50}>50.0 kHz (Wide Step)</option>
                <option value={100}>100.0 kHz (FM Commercial)</option>
                <option value={200}>200.0 kHz (US FM Broadcast)</option>
              </select>
            </div>
          </div>

          {/* Squelch Sensitivity & Hold Timing Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0d1320] p-3.5 rounded-lg border border-slate-800">
            {/* Detection Squelch Threshold Slider */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
                <span>SIGNAL SENSITIVITY THRESHOLD</span>
                <span className="text-amber-400 font-bold">{config.thresholdDbm} dBm</span>
              </div>
              <input
                type="range"
                min="-105"
                max="-45"
                step="1"
                value={config.thresholdDbm}
                onChange={(e) => onConfigChange({ thresholdDbm: parseInt(e.target.value) })}
                className="w-full accent-cyan-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
                <span>-105 dBm (Max Sensitive)</span>
                <span>-45 dBm (Strong Only)</span>
              </div>
            </div>

            {/* Scan Mode */}
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                SCAN BEHAVIOR MODE
              </label>
              <select
                value={config.mode}
                onChange={(e) => onConfigChange({ mode: e.target.value as ScanMode })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="scan-and-hold">Scan &amp; Hold (Pause on Signal to Listen)</option>
                <option value="search-and-log">Search &amp; Log (Continuous Spectrum Survey)</option>
              </select>
            </div>

            {/* Hold Time & Scan Speed */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  HOLD TIME
                </label>
                <select
                  value={config.holdTimeSec}
                  onChange={(e) => onConfigChange({ holdTimeSec: parseFloat(e.target.value) })}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value={1}>1.0 sec</option>
                  <option value={2}>2.0 sec</option>
                  <option value={3}>3.0 sec</option>
                  <option value={5}>5.0 sec</option>
                  <option value={10}>10.0 sec</option>
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  SWEEP SPEED
                </label>
                <select
                  value={config.scanSpeed}
                  onChange={(e) => onConfigChange({ scanSpeed: e.target.value as ScannerConfig['scanSpeed'] })}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="slow">Slow (8 st/s)</option>
                  <option value="normal">Normal (22 st/s)</option>
                  <option value="turbo">Turbo (50 st/s)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Detected Active Signals Registry / Table View */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Filter & Search Bar */}
          <div className="p-2.5 bg-[#0b101c] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search frequency, callsign, service name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-800 rounded pl-8 pr-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-2 py-1 text-xs focus:outline-none"
              >
                <option value="all">All Services</option>
                <option value="aviation">Aviation</option>
                <option value="weather">Weather</option>
                <option value="broadcast">Broadcast FM</option>
                <option value="marine">Marine</option>
                <option value="amateur">Amateur Ham</option>
                <option value="shortwave">Shortwave</option>
                <option value="util">Utility / CB</option>
              </select>
            </div>

            {/* Min SNR Filter */}
            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-[11px] font-mono">SNR &ge;</span>
              <select
                value={minSnrFilter}
                onChange={(e) => setMinSnrFilter(parseInt(e.target.value))}
                className="bg-slate-900 border border-slate-800 text-slate-300 rounded px-1.5 py-1 text-xs focus:outline-none"
              >
                <option value={0}>Any</option>
                <option value={10}>10 dB</option>
                <option value={20}>20 dB</option>
                <option value={30}>30 dB</option>
              </select>
            </div>

            {/* Export & Clear Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleExportCsv}
                disabled={signals.length === 0}
                title="Export detected signals to CSV"
                className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded text-xs transition-colors"
              >
                <Download className="w-3 h-3" />
                <span>CSV</span>
              </button>
              <button
                onClick={handleExportJson}
                disabled={signals.length === 0}
                title="Export detected signals to JSON"
                className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded text-xs transition-colors"
              >
                <Download className="w-3 h-3" />
                <span>JSON</span>
              </button>
              <button
                onClick={handleClearSignals}
                disabled={signals.length === 0}
                title="Clear detected signals list"
                className="p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-800 disabled:opacity-30 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Signals Table / List */}
          <div className="flex-1 overflow-y-auto">
            {filteredSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6 text-slate-500">
                <Radio className="w-8 h-8 text-slate-700 mb-2 stroke-[1.5]" />
                <p className="text-sm font-medium text-slate-400">No signals detected yet</p>
                <p className="text-xs text-slate-600 max-w-sm mt-1">
                  Start scanning or adjust the frequency range and sensitivity threshold to discover active transmitters.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-[#0d131f] border-b border-slate-800 font-mono text-[11px] text-slate-400 z-10">
                  <tr>
                    <th className="py-2 px-3">FREQUENCY</th>
                    <th className="py-2 px-3">STATION / LABEL</th>
                    <th className="py-2 px-2">BAND</th>
                    <th className="py-2 px-2">MODE</th>
                    <th className="py-2 px-3">SIGNAL / SNR</th>
                    <th className="py-2 px-2">STATUS</th>
                    <th className="py-2 px-3 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                  {filteredSignals.map((signal) => {
                    const isTransmitting = signal.isCurrentlyTransmitting;
                    return (
                      <tr
                        key={signal.id}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          signal.isLockedOut ? 'opacity-40 bg-slate-950/40' : ''
                        }`}
                      >
                        {/* Frequency Column */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5 font-bold text-cyan-300 text-sm">
                            <span>{signal.frequencyMHz.toFixed(4)}</span>
                            <span className="text-[10px] text-slate-500 font-normal">MHz</span>
                          </div>
                          {signal.rdsInfo && (
                            <div className="text-[10px] text-amber-400/90 font-sans truncate max-w-[140px]">
                              RDS: {signal.rdsInfo.stationName}
                            </div>
                          )}
                        </td>

                        {/* Station Name & Description */}
                        <td className="py-2 px-3 font-sans">
                          <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                            <span className="truncate max-w-[180px]">{signal.name}</span>
                            {signal.isBookmarked && (
                              <BookmarkCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            )}
                          </div>
                          {signal.details && (
                            <div className="text-[11px] text-slate-400 truncate max-w-[220px]">
                              {signal.details}
                            </div>
                          )}
                        </td>

                        {/* Category */}
                        <td className="py-2 px-2 font-sans text-xs">
                          <span className="capitalize text-slate-400">{signal.category}</span>
                        </td>

                        {/* Modulation & Bandwidth */}
                        <td className="py-2 px-2">
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-cyan-400 border border-slate-700">
                            {signal.modulation}
                          </span>
                        </td>

                        {/* Signal Strength & SNR */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            {/* Mini Signal Meter Bar */}
                            <div className="w-14 h-2 bg-slate-800 rounded-sm overflow-hidden flex">
                              <div
                                className={`h-full ${
                                  signal.signalStrengthDbm > -60
                                    ? 'bg-emerald-400'
                                    : signal.signalStrengthDbm > -80
                                    ? 'bg-cyan-400'
                                    : 'bg-amber-400'
                                }`}
                                style={{
                                  width: `${Math.max(
                                    5,
                                    Math.min(100, ((signal.signalStrengthDbm - -110) / 70) * 100)
                                  )}%`,
                                }}
                              />
                            </div>
                            <span className="text-[11px] text-slate-200">
                              {signal.signalStrengthDbm} dBm
                            </span>
                            <span className="text-[10px] text-emerald-400">
                              +{signal.snrDb}dB
                            </span>
                          </div>
                        </td>

                        {/* Status (Live vs Idle) */}
                        <td className="py-2 px-2">
                          {isTransmitting ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-sans text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                              <span>Live</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-sans text-slate-500">Idle</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Tune Button */}
                            <button
                              onClick={() => onTuneToSignal(signal)}
                              className="px-2.5 py-1 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40 rounded text-xs font-sans font-medium transition-colors"
                              title="Tune SDR receiver to this frequency"
                            >
                              Tune
                            </button>

                            {/* Bookmark Button */}
                            <button
                              onClick={() => scannerService.toggleBookmark(signal.frequencyMHz)}
                              className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                                signal.isBookmarked ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
                              }`}
                              title={signal.isBookmarked ? 'Remove Bookmark' : 'Add to Bookmarks'}
                            >
                              <Bookmark className="w-3.5 h-3.5" />
                            </button>

                            {/* Lockout / Ignore Button */}
                            <button
                              onClick={() => scannerService.toggleLockout(signal.frequencyMHz)}
                              className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                                signal.isLockedOut ? 'text-rose-400' : 'text-slate-500 hover:text-slate-300'
                              }`}
                              title={signal.isLockedOut ? 'Unlock frequency' : 'Lockout from future scans'}
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
