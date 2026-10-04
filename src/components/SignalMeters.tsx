import React, { useEffect, useRef, useState } from 'react';
import { SimulatedStation, DemodMode } from '../types/radio';
import { RfEngine } from '../services/rfEngine';
import { audioDsp } from '../services/audioDsp';
import { Activity, Radio, Cpu, Music } from 'lucide-react';

interface SignalMetersProps {
  currentPowerDbm: number;
  snrDb: number;
  station?: SimulatedStation;
  demodMode: DemodMode;
  isReceiving: boolean;
}

export const SignalMeters: React.FC<SignalMetersProps> = ({
  currentPowerDbm,
  snrDb,
  station,
  demodMode,
  isReceiving,
}) => {
  const needleCanvasRef = useRef<HTMLCanvasElement>(null);
  const oscCanvasRef = useRef<HTMLCanvasElement>(null);
  const needleFractionRef = useRef<number>(0.05);

  const [decodedMorse, setDecodedMorse] = useState<string>('');

  // Register CW decoder callback
  useEffect(() => {
    audioDsp.setMorseCallback((char) => {
      setDecodedMorse((prev) => {
        const next = prev + char;
        // Keep last 60 characters
        return next.length > 60 ? next.slice(-60) : next;
      });
    });
  }, []);

  // S-Meter calculation
  const sMeterData = RfEngine.dbmToSUnits(currentPowerDbm);

  // Smooth needle animation
  useEffect(() => {
    const canvas = needleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const renderNeedle = () => {
      const targetFraction = isReceiving ? sMeterData.fraction : 0.05;
      // Low pass filter damping for realistic analog ballistics
      needleFractionRef.current += (targetFraction - needleFractionRef.current) * 0.12;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Meter Face Background (Vintage warm amber/slate)
      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, w, h);

      // Arc parameters
      const centerX = w / 2;
      const centerY = h + 15;
      const radius = h * 0.95;

      const startAngle = Math.PI * 1.15;
      const endAngle = Math.PI * 1.85;
      const totalAngle = endAngle - startAngle;

      // Draw Main Gauge Arc
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.stroke();

      // Over S9 red arc
      const s9Angle = startAngle + totalAngle * 0.6;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, s9Angle, endAngle);
      ctx.stroke();

      // Draw Ticks & Labels (S1, S3, S5, S7, S9, +10, +20, +40, +60)
      const ticks = [
        { label: '1', norm: 0.08, isRed: false },
        { label: '3', norm: 0.20, isRed: false },
        { label: '5', norm: 0.33, isRed: false },
        { label: '7', norm: 0.46, isRed: false },
        { label: '9', norm: 0.60, isRed: false },
        { label: '+10', norm: 0.70, isRed: true },
        { label: '+20', norm: 0.80, isRed: true },
        { label: '+40', norm: 0.90, isRed: true },
        { label: '+60', norm: 1.00, isRed: true },
      ];

      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const t of ticks) {
        const angle = startAngle + totalAngle * t.norm;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const x1 = centerX + cos * (radius - 2);
        const y1 = centerY + sin * (radius - 2);
        const x2 = centerX + cos * (radius - 8);
        const y2 = centerY + sin * (radius - 8);

        ctx.strokeStyle = t.isRed ? '#f87171' : '#94a3b8';
        ctx.lineWidth = t.isRed ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const labelX = centerX + cos * (radius - 16);
        const labelY = centerY + sin * (radius - 16);
        ctx.fillStyle = t.isRed ? '#ef4444' : '#94a3b8';
        ctx.fillText(t.label, labelX, labelY);
      }

      // Draw Needle
      const currentAngle = startAngle + totalAngle * Math.max(0, Math.min(1, needleFractionRef.current));
      const needleTipX = centerX + Math.cos(currentAngle) * (radius - 4);
      const needleTipY = centerY + Math.sin(currentAngle) * (radius - 4);

      // Needle glow & line
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(needleTipX, needleTipY);
      ctx.stroke();

      // Needle center pivot cap
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      animId = requestAnimationFrame(renderNeedle);
    };

    animId = requestAnimationFrame(renderNeedle);
    return () => cancelAnimationFrame(animId);
  }, [sMeterData.fraction, isReceiving]);

  // Audio Oscilloscope Waveform render loop
  useEffect(() => {
    const canvas = oscCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const renderOsc = () => {
      const data = audioDsp.getAudioTimeDomainData();
      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = '#0a0e17';
      ctx.fillRect(0, 0, w, h);

      // Center baseline
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Waveform line
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isReceiving ? '#22c55e' : '#38bdf8';
      ctx.beginPath();

      const sliceWidth = w / data.length;
      let x = 0;

      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128.0;
        const y = (v * h) / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.stroke();

      animId = requestAnimationFrame(renderOsc);
    };

    animId = requestAnimationFrame(renderOsc);
    return () => cancelAnimationFrame(animId);
  }, [isReceiving]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* 1. Calibrated Analog S-Meter Panel */}
      <div className="bg-[#0a0e17] rounded-lg border border-slate-800 p-3 flex flex-col justify-between shadow-xl">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
          <span className="font-semibold text-slate-300">SIGNAL METER (IARU)</span>
          <span className="text-[10px] text-slate-500">CALIBRATED</span>
        </div>

        {/* Analog Needle Canvas */}
        <div className="relative w-full h-24 flex items-center justify-center overflow-hidden rounded bg-[#0b0f17] border border-slate-800/80">
          <canvas
            ref={needleCanvasRef}
            width={240}
            height={96}
            className="w-full h-full block"
          />
        </div>

        {/* Digital Readout */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 font-mono text-xs">
          <div>
            <span className="text-slate-500 text-[10px] block">SIGNAL LEVEL</span>
            <span
              className={`text-base font-bold ${
                sMeterData.isOver9 ? 'text-rose-400' : 'text-amber-400'
              }`}
            >
              {isReceiving ? sMeterData.label : 'S0'}
            </span>
          </div>

          <div className="text-center">
            <span className="text-slate-500 text-[10px] block">POWER (dBm)</span>
            <span className="text-sm font-semibold text-slate-200">
              {currentPowerDbm.toFixed(1)} dBm
            </span>
          </div>

          <div className="text-right">
            <span className="text-slate-500 text-[10px] block">SNR</span>
            <span className="text-sm font-semibold text-emerald-400">
              +{snrDb.toFixed(1)} dB
            </span>
          </div>
        </div>
      </div>

      {/* 2. Demodulation Info & RDS / CW Decoder Panel */}
      <div className="bg-[#0a0e17] rounded-lg border border-slate-800 p-3 flex flex-col justify-between shadow-xl">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
          <span className="font-semibold text-slate-300">
            {demodMode === 'CW' ? 'CW MORSE DECODER' : station?.rds ? 'RDS DATA SYSTEM' : 'STATION TELEMETRY'}
          </span>
          <span className="text-[10px] text-cyan-400">{demodMode}</span>
        </div>

        {/* Body content based on active mode/station */}
        <div className="flex-1 flex flex-col justify-center min-h-[96px] bg-[#0b0f17] rounded border border-slate-800/80 p-2.5">
          {demodMode === 'CW' ? (
            <div>
              <div className="text-[10px] font-mono text-slate-500 mb-1">LIVE DECODED MORSE:</div>
              <div className="font-mono text-xs text-amber-300 bg-slate-950 p-2 rounded border border-slate-800 break-words h-14 overflow-hidden">
                {decodedMorse || 'Waiting for CW carrier...'}
                <span className="animate-pulse">_</span>
              </div>
            </div>
          ) : station?.rds ? (
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-mono text-[10px]">STATION (PS):</span>
                <span className="font-mono font-bold text-amber-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  {station.rds.stationName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-mono text-[10px]">PROGRAM (PTY):</span>
                <span className="text-slate-300 font-sans">{station.rds.programType}</span>
              </div>
              <div className="text-[11px] text-cyan-300 font-sans truncate bg-slate-950 px-2 py-1 rounded border border-slate-800 mt-1">
                {station.rds.radioText}
              </div>
            </div>
          ) : station ? (
            <div className="space-y-1 text-xs font-sans">
              <div className="font-semibold text-slate-200">{station.name}</div>
              <div className="text-[11px] text-slate-400 line-clamp-2">{station.description}</div>
              {station.ctcssHz && (
                <div className="text-[10px] font-mono text-cyan-400 mt-1">
                  CTCSS Tone: {station.ctcssHz} Hz
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-slate-600 text-xs py-3 font-sans">
              Tune to an active station to decode RDS, Morse code, or telemetry.
            </div>
          )}
        </div>

        {/* Sub-status footer */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
          <span>SERVICE: {station?.category.toUpperCase() || 'UNIDENTIFIED'}</span>
          <span className={isReceiving ? 'text-emerald-400' : 'text-slate-600'}>
            {isReceiving ? 'CARRIER LOCK' : 'NO CARRIER'}
          </span>
        </div>
      </div>

      {/* 3. Audio Waveform Oscilloscope Panel */}
      <div className="bg-[#0a0e17] rounded-lg border border-slate-800 p-3 flex flex-col justify-between shadow-xl">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-1">
          <span className="font-semibold text-slate-300">DEMODULATED AUDIO OSCILLOSCOPE</span>
          <span className="text-[10px] text-slate-500">BASEBAND</span>
        </div>

        <div className="w-full h-24 rounded bg-[#0b0f17] border border-slate-800/80 overflow-hidden">
          <canvas
            ref={oscCanvasRef}
            width={240}
            height={96}
            className="w-full h-full block"
          />
        </div>

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 font-mono text-[11px] text-slate-400">
          <span>SAMPLING: 44.1 kHz</span>
          <span className="text-cyan-400 font-mono">
            {isReceiving ? 'AF OUTPUT OK' : 'MUTED'}
          </span>
        </div>
      </div>
    </div>
  );
};
