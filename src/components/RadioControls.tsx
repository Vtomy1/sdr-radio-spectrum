import React, { useState } from 'react';
import { DemodMode, VfoState } from '../types/radio';
import {
  Volume2,
  VolumeX,
  Radio,
  Sliders,
  Disc,
  Square,
  ArrowRightLeft,
  Zap,
  Shield,
  Activity,
} from 'lucide-react';

interface RadioControlsProps {
  vfo: VfoState;
  currentSignalPowerDbm: number;
  isReceivingSignal: boolean;
  isRecording: boolean;
  onFrequencyChange: (freqMHz: number) => void;
  onModeChange: (mode: DemodMode) => void;
  onBandwidthChange: (bandwidthHz: number) => void;
  onRfGainChange: (gainDb: number) => void;
  onSquelchChange: (squelchDbm: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onToggleVfo: () => void;
  onToggleRecording: () => void;
}

export const RadioControls: React.FC<RadioControlsProps> = ({
  vfo,
  currentSignalPowerDbm,
  isReceivingSignal,
  isRecording,
  onFrequencyChange,
  onModeChange,
  onBandwidthChange,
  onRfGainChange,
  onSquelchChange,
  onVolumeChange,
  onToggleMute,
  onToggleVfo,
  onToggleRecording,
}) => {
  const [directFreqInput, setDirectFreqInput] = useState<string>('');
  const [isEditingFreq, setIsEditingFreq] = useState<boolean>(false);

  // Format frequency to 7-segment style text: e.g. "119.100 000"
  const freqMHz = vfo.frequencyMHz;
  const mhzPart = Math.floor(freqMHz);
  const remainder = Math.round((freqMHz - mhzPart) * 1000000);
  const khzPart = Math.floor(remainder / 1000).toString().padStart(3, '0');
  const hzPart = (remainder % 1000).toString().padStart(3, '0');

  const handleStep = (stepDeltaMHz: number) => {
    const newFreq = Math.max(0.1, Math.min(2000, parseFloat((freqMHz + stepDeltaMHz).toFixed(6))));
    onFrequencyChange(newFreq);
  };

  const handleDirectFreqSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(directFreqInput);
    if (!isNaN(val) && val > 0 && val < 3000) {
      onFrequencyChange(val);
      setIsEditingFreq(false);
      setDirectFreqInput('');
    }
  };

  // Preset bandwidths based on current mode
  const getBandwidthPresets = (mode: DemodMode): number[] => {
    switch (mode) {
      case 'WFM':
        return [120000, 180000, 240000];
      case 'NFM':
        return [8330, 12500, 25000];
      case 'AM':
        return [3000, 6000, 9000];
      case 'USB':
      case 'LSB':
        return [1800, 2400, 3000];
      case 'CW':
        return [250, 500, 1000];
      default:
        return [3000, 6000, 12500];
    }
  };

  const modes: DemodMode[] = ['WFM', 'NFM', 'AM', 'USB', 'LSB', 'CW', 'DSB'];

  return (
    <div className="bg-[#0a0e17] rounded-lg border border-slate-800 p-3.5 space-y-4 shadow-xl">
      {/* Top Header: VFO Display & Tuning */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#0d1320] p-3 rounded-lg border border-slate-800/80">
        {/* VFO Selector & Status */}
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-900 p-0.5 rounded border border-slate-700">
            <button
              onClick={() => vfo.activeVfo !== 'A' && onToggleVfo()}
              className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
                vfo.activeVfo === 'A'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              VFO A
            </button>
            <button
              onClick={() => vfo.activeVfo !== 'B' && onToggleVfo()}
              className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
                vfo.activeVfo === 'B'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              VFO B
            </button>
          </div>

          {/* Squelch / Carrier Reception Indicator */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-all ${
              isReceivingSignal
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-950'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isReceivingSignal ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="font-semibold">{isReceivingSignal ? 'RX ACTIVE' : 'SQUELCHED'}</span>
          </div>
        </div>

        {/* Large Tactical Digital Frequency Readout */}
        <div className="relative">
          {isEditingFreq ? (
            <form onSubmit={handleDirectFreqSubmit} className="flex items-center gap-1">
              <input
                type="number"
                step="0.001"
                autoFocus
                placeholder="e.g. 119.1"
                value={directFreqInput}
                onChange={(e) => setDirectFreqInput(e.target.value)}
                onBlur={() => setIsEditingFreq(false)}
                className="bg-slate-950 border border-cyan-500 rounded px-3 py-1 text-xl font-mono text-cyan-300 w-40 text-right focus:outline-none"
              />
              <span className="text-xs font-mono text-slate-400">MHz</span>
            </form>
          ) : (
            <div
              onClick={() => {
                setDirectFreqInput(freqMHz.toString());
                setIsEditingFreq(true);
              }}
              title="Click to type exact frequency"
              className="flex items-baseline gap-1 font-mono cursor-pointer group bg-slate-950/80 px-4 py-1.5 rounded-lg border border-slate-700/80 hover:border-cyan-500/60 transition-colors shadow-inner"
            >
              <span className="text-3xl font-extrabold text-cyan-400 tracking-wider">
                {mhzPart}
              </span>
              <span className="text-cyan-500 text-2xl font-bold">.</span>
              <span className="text-2xl font-bold text-cyan-300">{khzPart}</span>
              <span className="text-lg font-semibold text-cyan-500/80">{hzPart}</span>
              <span className="text-xs font-mono text-slate-400 ml-1">MHz</span>
            </div>
          )}
        </div>

        {/* Audio Recording Controller */}
        <div>
          <button
            onClick={onToggleRecording}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all ${
              isRecording
                ? 'bg-rose-600 text-white animate-pulse shadow-md shadow-rose-950'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
          >
            {isRecording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Disc className="w-3.5 h-3.5 text-rose-500" />}
            <span>{isRecording ? 'REC ACTIVE' : 'Record Audio'}</span>
          </button>
        </div>
      </div>

      {/* Stepping Grid (+/- 1M, 100k, 10k, 1k) */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#0b0f19] p-2 rounded-lg border border-slate-800 text-[11px] font-mono">
        <span className="text-slate-400 font-sans mr-1">TUNE STEP:</span>

        {/* Down Steps */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleStep(-1)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            -1M
          </button>
          <button
            onClick={() => handleStep(-0.1)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            -100k
          </button>
          <button
            onClick={() => handleStep(-0.01)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            -10k
          </button>
          <button
            onClick={() => handleStep(-0.001)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            -1k
          </button>
        </div>

        <div className="h-4 w-[1px] bg-slate-800" />

        {/* Up Steps */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleStep(0.001)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            +1k
          </button>
          <button
            onClick={() => handleStep(0.01)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            +10k
          </button>
          <button
            onClick={() => handleStep(0.1)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            +100k
          </button>
          <button
            onClick={() => handleStep(1)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700/60 active:scale-95"
          >
            +1M
          </button>
        </div>
      </div>

      {/* Demodulation Modes & Bandwidth Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Demodulation Modes */}
        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1.5">
            DEMODULATION MODE
          </label>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
            {modes.map((m) => {
              const isActive = vfo.mode === m;
              return (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className={`py-1.5 rounded font-mono text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-900/30'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700/60'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter Bandwidth */}
        <div>
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1.5">
            <span>FILTER BANDWIDTH</span>
            <span className="text-cyan-400 font-bold">
              {(vfo.bandwidthHz / 1000).toFixed(1)} kHz
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min="200"
              max={vfo.mode === 'WFM' ? 280000 : 25000}
              step="100"
              value={vfo.bandwidthHz}
              onChange={(e) => onBandwidthChange(parseInt(e.target.value))}
              className="flex-1 accent-cyan-500 cursor-pointer"
            />
            {/* Quick Presets for Current Mode */}
            <div className="flex gap-1">
              {getBandwidthPresets(vfo.mode).map((bw) => (
                <button
                  key={bw}
                  onClick={() => onBandwidthChange(bw)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    vfo.bandwidthHz === bw
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {bw >= 1000 ? `${(bw / 1000).toFixed(0)}k` : `${bw}Hz`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Squelch & RF Gain Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#0d1320] p-3 rounded-lg border border-slate-800/80 text-xs">
        {/* Squelch Slider */}
        <div>
          <div className="flex items-center justify-between font-mono text-slate-400 mb-1">
            <span>AUDIO SQUELCH</span>
            <span className="text-amber-400 font-bold">{vfo.squelchDbm} dBm</span>
          </div>
          <input
            type="range"
            min="-110"
            max="-40"
            step="1"
            value={vfo.squelchDbm}
            onChange={(e) => onSquelchChange(parseInt(e.target.value))}
            className="w-full accent-amber-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
            <span>-110 dBm</span>
            <span>Signal: {currentSignalPowerDbm} dBm</span>
            <span>-40 dBm</span>
          </div>
        </div>

        {/* RF Gain Slider */}
        <div>
          <div className="flex items-center justify-between font-mono text-slate-400 mb-1">
            <span>RF GAIN</span>
            <span className="text-cyan-400 font-bold">{vfo.rfGainDb} dB</span>
          </div>
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={vfo.rfGainDb}
            onChange={(e) => onRfGainChange(parseInt(e.target.value))}
            className="w-full accent-cyan-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-0.5">
            <span>0 dB (Min)</span>
            <span>20 dB (Nom)</span>
            <span>50 dB (Max)</span>
          </div>
        </div>

        {/* Volume & Audio Output */}
        <div>
          <div className="flex items-center justify-between font-mono text-slate-400 mb-1">
            <span>VOLUME</span>
            <span className="text-slate-200 font-bold">
              {vfo.isMuted ? 'MUTED' : `${Math.round(vfo.volume * 100)}%`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleMute}
              className={`p-1.5 rounded transition-colors ${
                vfo.isMuted
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              {vfo.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={vfo.isMuted ? 0 : vfo.volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="flex-1 accent-cyan-500 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
