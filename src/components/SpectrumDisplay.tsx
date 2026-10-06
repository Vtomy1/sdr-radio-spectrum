import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ColorMap, DemodMode, PeakHistoryItem } from '../types/radio';
import { rfEngine } from '../services/rfEngine';
import { ZoomIn, ZoomOut, MoveLeft, MoveRight, Sliders, Palette, Eye, History, RotateCcw } from 'lucide-react';

interface SpectrumDisplayProps {
  centerFreqMHz: number;
  demodMode: DemodMode;
  bandwidthHz: number;
  rfGainDb: number;
  squelchThresholdDbm: number;
  scannerCurrentFreqMHz?: number;
  isScanning?: boolean;
  onTune: (freqMHz: number) => void;
  onBandwidthChange?: (bwHz: number) => void;
}

export const SpectrumDisplay: React.FC<SpectrumDisplayProps> = ({
  centerFreqMHz,
  demodMode,
  bandwidthHz,
  rfGainDb,
  squelchThresholdDbm,
  scannerCurrentFreqMHz,
  isScanning,
  onTune,
}) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport Span and Zoom
  const [baseSpanMHz, setBaseSpanMHz] = useState<number>(2.0); // 2 MHz default visible span
  const [zoomFactor, setZoomFactor] = useState<number>(1); // 1x to 8x
  const [colorMap, setColorMap] = useState<ColorMap>('turbo');
  const [waterfallSpeed, setWaterfallSpeed] = useState<number>(2); // 1=slow, 2=med, 3=fast
  const [minDb, setMinDb] = useState<number>(-115);
  const [maxDb, setMaxDb] = useState<number>(-30);
  const [showPeakHold, setShowPeakHold] = useState<boolean>(true);
  const [hoverData, setHoverData] = useState<{ freqMHz: number; dbm: number; x: number; y: number } | null>(null);

  // Peak History Tracking (Last 5 detected peaks)
  const [peakHistory, setPeakHistory] = useState<PeakHistoryItem[]>([]);
  const peakHistoryRef = useRef<PeakHistoryItem[]>([]);
  peakHistoryRef.current = peakHistory;
  const lastPeakLogTimeRef = useRef<number>(0);

  const visibleSpanMHz = baseSpanMHz / zoomFactor;

  // Waterfall offscreen buffer
  const waterfallHistoryRef = useRef<ImageData | null>(null);
  const peakHoldBufferRef = useRef<Float32Array | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const frameCountRef = useRef<number>(0);

  // Color lookup table cached for speed
  const lutRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(256 * 4));

  // Build color palette lookup table
  const updateColorLut = useCallback((scheme: ColorMap) => {
    const lut = lutRef.current;
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r = 0, g = 0, b = 0;

      if (scheme === 'turbo') {
        // Turbo approximation
        r = Math.min(255, Math.max(0, Math.floor(255 * (0.1357 + t * (4.597 - t * (15.2 + t * (-8.8 + t * 24.8)))))));
        g = Math.min(255, Math.max(0, Math.floor(255 * (0.0914 + t * (2.185 + t * (4.8 - t * 6.5))))));
        b = Math.min(255, Math.max(0, Math.floor(255 * (0.1067 + t * (12.5 - t * (30.0 - t * 20.0))))));
        if (t < 0.15) { r = 10; g = 15; b = Math.floor(t * 1200); }
      } else if (scheme === 'viridis') {
        r = Math.floor(255 * Math.min(1, Math.max(0, -0.17 + 1.25 * t * t)));
        g = Math.floor(255 * Math.min(1, Math.max(0, 0.05 + 0.9 * Math.sin(t * Math.PI))));
        b = Math.floor(255 * Math.min(1, Math.max(0, 0.35 + 0.65 * (1 - t))));
      } else if (scheme === 'inferno') {
        r = Math.floor(255 * Math.min(1, Math.max(0, t * 1.8)));
        g = Math.floor(255 * Math.min(1, Math.max(0, (t - 0.25) * 1.6)));
        b = Math.floor(255 * Math.min(1, Math.max(0, (t - 0.5) * 2.2)));
      } else if (scheme === 'green') {
        // Phosphor Green CRT
        r = Math.floor(20 * t);
        g = Math.floor(255 * t);
        b = Math.floor(40 * t);
      } else {
        // Ocean Cyan/Blue
        r = Math.floor(20 + t * 40);
        g = Math.floor(80 + t * 175);
        b = Math.floor(140 + t * 115);
      }

      const idx = i * 4;
      lut[idx] = Math.max(0, Math.min(255, r));
      lut[idx + 1] = Math.max(0, Math.min(255, g));
      lut[idx + 2] = Math.max(0, Math.min(255, b));
      lut[idx + 3] = 255;
    }
  }, []);

  useEffect(() => {
    updateColorLut(colorMap);
  }, [colorMap, updateColorLut]);

  // Main Render Loop
  useEffect(() => {
    const specCanvas = spectrumCanvasRef.current;
    const wfCanvas = waterfallCanvasRef.current;
    if (!specCanvas || !wfCanvas) return;

    const specCtx = specCanvas.getContext('2d');
    const wfCtx = wfCanvas.getContext('2d');
    if (!specCtx || !wfCtx) return;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;
      frameCountRef.current++;

      const width = specCanvas.width;
      const specHeight = specCanvas.height;
      const wfHeight = wfCanvas.height;

      if (width === 0 || specHeight === 0 || wfHeight === 0) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // 1. Compute FFT bins from RF Engine
      const numBins = Math.min(1024, width);
      const fftData = rfEngine.generateFftFrame(centerFreqMHz, visibleSpanMHz, numBins, rfGainDb);

      // Peak Hold buffer maintenance
      if (!peakHoldBufferRef.current || peakHoldBufferRef.current.length !== numBins) {
        peakHoldBufferRef.current = new Float32Array(fftData);
      } else {
        for (let i = 0; i < numBins; i++) {
          if (fftData[i] > peakHoldBufferRef.current[i]) {
            peakHoldBufferRef.current[i] = fftData[i];
          } else {
            // Decay peak hold slowly
            peakHoldBufferRef.current[i] -= 0.15;
          }
        }
      }

      // --- Draw Spectrum Analyzer (Top Canvas) ---
      specCtx.fillStyle = '#0a0e17';
      specCtx.fillRect(0, 0, width, specHeight);

      // Grid Lines & dBm scale
      specCtx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
      specCtx.lineWidth = 1;
      const dbStep = 15;
      for (let db = maxDb; db >= minDb; db -= dbStep) {
        const y = ((maxDb - db) / (maxDb - minDb)) * specHeight;
        specCtx.beginPath();
        specCtx.moveTo(0, y);
        specCtx.lineTo(width, y);
        specCtx.stroke();

        specCtx.fillStyle = '#64748b';
        specCtx.font = '10px "JetBrains Mono", monospace';
        specCtx.fillText(`${db} dBm`, 8, Math.max(12, y - 4));
      }

      // Frequency Vertical Grid Lines
      const numFreqTicks = 8;
      const startFreq = centerFreqMHz - visibleSpanMHz / 2;
      for (let i = 0; i <= numFreqTicks; i++) {
        const x = (i / numFreqTicks) * width;
        const tickFreq = startFreq + (i / numFreqTicks) * visibleSpanMHz;
        specCtx.beginPath();
        specCtx.moveTo(x, 0);
        specCtx.lineTo(x, specHeight);
        specCtx.stroke();

        specCtx.fillStyle = '#475569';
        specCtx.font = '10px "JetBrains Mono", monospace';
        const label = tickFreq.toFixed(3);
        const textWidth = specCtx.measureText(label).width;
        specCtx.fillText(label, Math.max(4, Math.min(width - textWidth - 4, x - textWidth / 2)), specHeight - 6);
      }

      // Squelch Line
      const squelchY = ((maxDb - squelchThresholdDbm) / (maxDb - minDb)) * specHeight;
      if (squelchY >= 0 && squelchY <= specHeight) {
        specCtx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
        specCtx.setLineDash([4, 4]);
        specCtx.beginPath();
        specCtx.moveTo(0, squelchY);
        specCtx.lineTo(width, squelchY);
        specCtx.stroke();
        specCtx.setLineDash([]);

        specCtx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        specCtx.font = '9px "JetBrains Mono", monospace';
        specCtx.fillText(`SQL ${squelchThresholdDbm} dBm`, width - 85, squelchY - 3);
      }

      // Tuning Filter Passband (Shaded Box)
      const centerScreenX = width / 2;
      const bwRatio = (bandwidthHz / 1000000) / visibleSpanMHz;
      const bwPixelWidth = Math.max(6, bwRatio * width);
      const halfBwX = bwPixelWidth / 2;

      // Passband box
      specCtx.fillStyle = 'rgba(6, 182, 212, 0.12)';
      specCtx.fillRect(centerScreenX - halfBwX, 0, bwPixelWidth, specHeight);
      specCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
      specCtx.strokeRect(centerScreenX - halfBwX, 0, bwPixelWidth, specHeight);

      // Center tuning needle (red hair)
      specCtx.strokeStyle = '#ef4444';
      specCtx.lineWidth = 1.5;
      specCtx.beginPath();
      specCtx.moveTo(centerScreenX, 0);
      specCtx.lineTo(centerScreenX, specHeight);
      specCtx.stroke();

      // Scanner Active Frequency Marker (when scanning is active)
      if (isScanning && scannerCurrentFreqMHz !== undefined) {
        const scanOffset = scannerCurrentFreqMHz - startFreq;
        const scanX = (scanOffset / visibleSpanMHz) * width;
        if (scanX >= 0 && scanX <= width) {
          specCtx.strokeStyle = '#22c55e';
          specCtx.lineWidth = 2;
          specCtx.beginPath();
          specCtx.moveTo(scanX, 0);
          specCtx.lineTo(scanX, specHeight);
          specCtx.stroke();

          specCtx.fillStyle = '#22c55e';
          specCtx.beginPath();
          specCtx.moveTo(scanX - 5, 0);
          specCtx.lineTo(scanX + 5, 0);
          specCtx.lineTo(scanX, 8);
          specCtx.fill();
        }
      }

      // Peak Hold Curve
      if (showPeakHold && peakHoldBufferRef.current) {
        specCtx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
        specCtx.lineWidth = 1;
        specCtx.beginPath();
        for (let i = 0; i < numBins; i++) {
          const x = (i / (numBins - 1)) * width;
          const db = peakHoldBufferRef.current[i];
          const y = ((maxDb - db) / (maxDb - minDb)) * specHeight;
          if (i === 0) specCtx.moveTo(x, y);
          else specCtx.lineTo(x, y);
        }
        specCtx.stroke();
      }

      // Live FFT Spectrum Curve with Gradient Fill
      const grad = specCtx.createLinearGradient(0, 0, 0, specHeight);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.85)');
      grad.addColorStop(0.5, 'rgba(14, 165, 233, 0.45)');
      grad.addColorStop(1, 'rgba(2, 132, 199, 0.03)');

      specCtx.beginPath();
      specCtx.moveTo(0, specHeight);
      let peakDbm = -999;
      let peakBin = 0;

      for (let i = 0; i < numBins; i++) {
        const x = (i / (numBins - 1)) * width;
        const db = fftData[i];
        if (db > peakDbm) {
          peakDbm = db;
          peakBin = i;
        }
        const y = Math.max(0, Math.min(specHeight, ((maxDb - db) / (maxDb - minDb)) * specHeight));
        if (i === 0) specCtx.lineTo(x, y);
        else specCtx.lineTo(x, y);
      }
      specCtx.lineTo(width, specHeight);
      specCtx.closePath();

      specCtx.fillStyle = grad;
      specCtx.fill();

      // Top stroke of FFT
      specCtx.strokeStyle = '#38bdf8';
      specCtx.lineWidth = 1.5;
      specCtx.beginPath();
      for (let i = 0; i < numBins; i++) {
        const x = (i / (numBins - 1)) * width;
        const y = Math.max(0, Math.min(specHeight, ((maxDb - fftData[i]) / (maxDb - minDb)) * specHeight));
        if (i === 0) specCtx.moveTo(x, y);
        else specCtx.lineTo(x, y);
      }
      specCtx.stroke();

      // Peak readout bubble and Peak History Tracking
      if (peakDbm > minDb + 10) {
        const peakFreq = parseFloat((startFreq + (peakBin / numBins) * visibleSpanMHz).toFixed(4));
        const peakX = (peakBin / numBins) * width;
        const peakY = ((maxDb - peakDbm) / (maxDb - minDb)) * specHeight;

        specCtx.fillStyle = '#f59e0b';
        specCtx.beginPath();
        specCtx.arc(peakX, peakY, 3, 0, Math.PI * 2);
        specCtx.fill();

        specCtx.font = '10px "JetBrains Mono", monospace';
        specCtx.fillStyle = '#fcd34d';
        const label = `${peakFreq.toFixed(4)} MHz (${Math.round(peakDbm)} dBm)`;
        const lx = Math.max(10, Math.min(width - 150, peakX + 6));
        const ly = Math.max(16, peakY - 6);
        specCtx.fillText(label, lx, ly);

        // Check for Peak History Recording (throttled to ~300ms)
        const now = Date.now();
        if (now - lastPeakLogTimeRef.current > 300) {
          lastPeakLogTimeRef.current = now;
          const currentList = peakHistoryRef.current;
          const existingIndex = currentList.findIndex(
            (p) => Math.abs(p.frequencyMHz - peakFreq) < 0.02
          );

          if (existingIndex === 0) {
            // It's already the most recent peak - refresh power & timestamp
            if (now - currentList[0].timestamp > 1500 || peakDbm > currentList[0].powerDbm) {
              const updated = [...currentList];
              updated[0] = {
                ...updated[0],
                powerDbm: Math.round(peakDbm * 10) / 10,
                timestamp: now,
              };
              setPeakHistory(updated);
            }
          } else {
            // New distinct peak detected
            const probe = rfEngine.checkSignalAt(peakFreq, 25);
            const newItem: PeakHistoryItem = {
              id: `peak_${peakFreq}_${now}`,
              frequencyMHz: peakFreq,
              powerDbm: Math.round(peakDbm * 10) / 10,
              snrDb: Math.max(3, Math.round((peakDbm - minDb) * 10) / 10),
              timestamp: now,
              label: probe.station?.name,
              category: probe.station?.category,
            };

            const filtered = currentList.filter(
              (p) => Math.abs(p.frequencyMHz - peakFreq) >= 0.02
            );
            const nextList = [newItem, ...filtered].slice(0, 5);
            setPeakHistory(nextList);
          }
        }
      }

      // Draw Peak History Markers on Spectrum Graph
      const historyList = peakHistoryRef.current;
      for (let idx = 0; idx < historyList.length; idx++) {
        const item = historyList[idx];
        if (item.frequencyMHz >= startFreq && item.frequencyMHz <= startFreq + visibleSpanMHz) {
          const hX = ((item.frequencyMHz - startFreq) / visibleSpanMHz) * width;
          const isCurrentVfo = Math.abs(centerFreqMHz - item.frequencyMHz) < 0.012;

          // Vertical indicator line down from top
          specCtx.strokeStyle = isCurrentVfo ? 'rgba(6, 182, 212, 0.6)' : 'rgba(245, 158, 11, 0.45)';
          specCtx.lineWidth = 1;
          specCtx.setLineDash([2, 3]);
          specCtx.beginPath();
          specCtx.moveTo(hX, 16);
          specCtx.lineTo(hX, specHeight - 16);
          specCtx.stroke();
          specCtx.setLineDash([]);

          // Tag flag at top of canvas
          specCtx.fillStyle = isCurrentVfo ? '#0891b2' : '#b45309';
          specCtx.beginPath();
          specCtx.moveTo(hX - 9, 0);
          specCtx.lineTo(hX + 9, 0);
          specCtx.lineTo(hX + 9, 12);
          specCtx.lineTo(hX, 16);
          specCtx.lineTo(hX - 9, 12);
          specCtx.closePath();
          specCtx.fill();

          specCtx.font = '8px "JetBrains Mono", monospace';
          specCtx.fillStyle = '#ffffff';
          specCtx.textAlign = 'center';
          specCtx.fillText(`#${idx + 1}`, hX, 9);
          specCtx.textAlign = 'left';
        }
      }

      // --- Draw Waterfall (Bottom Canvas) ---
      // Update waterfall at requested speed
      const updateInterval = waterfallSpeed === 3 ? 1 : waterfallSpeed === 2 ? 2 : 4;
      if (frameCountRef.current % updateInterval === 0) {
        // Scroll canvas down by 1px
        wfCtx.drawImage(wfCanvas, 0, 0, width, wfHeight - 1, 0, 1, width, wfHeight - 1);

        // Generate top 1px scanline
        const scanline = wfCtx.createImageData(width, 1);
        const data = scanline.data;
        const lut = lutRef.current;

        for (let x = 0; x < width; x++) {
          const binIdx = Math.floor((x / width) * numBins);
          const db = fftData[binIdx];
          const norm = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
          const colorIdx = Math.floor(norm * 255) * 4;

          const pixelIdx = x * 4;
          data[pixelIdx] = lut[colorIdx];
          data[pixelIdx + 1] = lut[colorIdx + 1];
          data[pixelIdx + 2] = lut[colorIdx + 2];
          data[pixelIdx + 3] = 255;
        }

        wfCtx.putImageData(scanline, 0, 0);
      }

      // Overlay tuning line on waterfall as subtle guide
      wfCtx.fillStyle = 'rgba(239, 68, 68, 0.4)';
      wfCtx.fillRect(centerScreenX - 0.5, 0, 1, 6);

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [
    centerFreqMHz,
    visibleSpanMHz,
    demodMode,
    bandwidthHz,
    rfGainDb,
    squelchThresholdDbm,
    scannerCurrentFreqMHz,
    isScanning,
    minDb,
    maxDb,
    showPeakHold,
    waterfallSpeed,
  ]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !spectrumCanvasRef.current || !waterfallCanvasRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const totalH = Math.floor(rect.height);
      const specH = Math.floor(totalH * 0.48);
      const wfH = totalH - specH - 2;

      spectrumCanvasRef.current.width = w;
      spectrumCanvasRef.current.height = specH;
      waterfallCanvasRef.current.width = w;
      waterfallCanvasRef.current.height = wfH;
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Click & Drag on Spectrum or Waterfall to Tune
  const handlePointerTune = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    if (width <= 0) return;

    const startFreq = centerFreqMHz - visibleSpanMHz / 2;
    const clickedFreq = startFreq + (x / width) * visibleSpanMHz;

    // Magnetic snap if clicked near a tracked peak history marker
    const snappedPeak = peakHistoryRef.current.find((item) => {
      const hX = ((item.frequencyMHz - startFreq) / visibleSpanMHz) * width;
      return Math.abs(x - hX) <= 12;
    });

    if (snappedPeak) {
      onTune(snappedPeak.frequencyMHz);
    } else {
      onTune(parseFloat(clickedFreq.toFixed(4)));
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;

    const startFreq = centerFreqMHz - visibleSpanMHz / 2;
    const freq = startFreq + (x / width) * visibleSpanMHz;

    // Estimate dBm based on vertical position if in spectrum section
    const specHeight = rect.height * 0.48;
    let dbm = minDb;
    if (y <= specHeight) {
      dbm = maxDb - (y / specHeight) * (maxDb - minDb);
    }

    setHoverData({
      freqMHz: freq,
      dbm: Math.round(dbm),
      x,
      y,
    });
  };

  const handlePointerLeave = () => {
    setHoverData(null);
  };

  const handleZoom = (direction: 'in' | 'out') => {
    setZoomFactor((prev) => {
      if (direction === 'in') return Math.min(16, prev * 2);
      return Math.max(1, prev / 2);
    });
  };

  const handlePan = (direction: 'left' | 'right') => {
    const shift = (visibleSpanMHz / 4) * (direction === 'left' ? -1 : 1);
    onTune(parseFloat((centerFreqMHz + shift).toFixed(4)));
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0e17] rounded-lg border border-slate-800 overflow-hidden shadow-2xl">
      {/* Top Toolbar: Spectrum HUD Controls */}
      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-[#0f1523] border-b border-slate-800 text-xs">
        {/* Left: Span & Zoom Readout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono text-slate-300">
            <span className="text-slate-400">SPAN:</span>
            <span className="text-cyan-400 font-semibold">{visibleSpanMHz.toFixed(3)} MHz</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400">ZOOM:</span>
            <span className="text-amber-400 font-semibold">{zoomFactor}x</span>
          </div>

          {/* Quick Span Presets */}
          <div className="hidden sm:flex items-center gap-1">
            {[0.5, 1.0, 2.0, 5.0].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setBaseSpanMHz(s);
                  setZoomFactor(1);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                  baseSpanMHz === s && zoomFactor === 1
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-800/50'
                }`}
              >
                {s}M
              </button>
            ))}
          </div>
        </div>

        {/* Middle: Navigation / Zoom Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handlePan('left')}
            title="Pan Left"
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
          >
            <MoveLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleZoom('in')}
            title="Zoom In"
            className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleZoom('out')}
            title="Zoom Out"
            className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handlePan('right')}
            title="Pan Right"
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
          >
            <MoveRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Display Customization */}
        <div className="flex items-center gap-2">
          {/* Peak Hold Toggle */}
          <button
            onClick={() => setShowPeakHold(!showPeakHold)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              showPeakHold ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Peak</span>
          </button>

          {/* Color Scheme Picker */}
          <div className="flex items-center gap-1 text-slate-400">
            <Palette className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={colorMap}
              onChange={(e) => setColorMap(e.target.value as ColorMap)}
              className="bg-slate-800/80 text-slate-300 text-[11px] rounded px-1.5 py-0.5 border border-slate-700 focus:outline-none"
            >
              <option value="turbo">Turbo</option>
              <option value="viridis">Viridis</option>
              <option value="inferno">Inferno</option>
              <option value="green">CRT Green</option>
              <option value="ocean">Ocean</option>
            </select>
          </div>

          {/* Speed Toggle */}
          <button
            onClick={() => setWaterfallSpeed((s) => (s % 3) + 1)}
            title="Waterfall Speed"
            className="px-1.5 py-0.5 text-[11px] font-mono bg-slate-800/80 text-slate-300 rounded border border-slate-700 hover:bg-slate-700"
          >
            WF: {waterfallSpeed === 3 ? 'FAST' : waterfallSpeed === 2 ? 'MED' : 'SLOW'}
          </button>
        </div>
      </div>

      {/* Peak Frequency History Ribbon: Last 5 Detected Peaks */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0b101c] border-b border-slate-800/80 text-xs overflow-x-auto min-h-[34px]">
        <div className="flex items-center gap-2 overflow-x-auto py-0.5">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 shrink-0 mr-1">
            <History className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="font-semibold text-slate-300 tracking-tight">HISTORY:</span>
          </div>

          {peakHistory.length === 0 ? (
            <span className="text-[11px] text-slate-500 font-sans italic">
              Monitoring spectrum · Last 5 active peak frequencies will appear here for 1-click recall
            </span>
          ) : (
            <div className="flex items-center gap-1.5 flex-nowrap">
              {peakHistory.map((item, idx) => {
                const isTuned = Math.abs(centerFreqMHz - item.frequencyMHz) < 0.01;
                return (
                  <button
                    key={item.id}
                    onClick={() => onTune(item.frequencyMHz)}
                    title={`Click to revert receiver to ${item.frequencyMHz.toFixed(4)} MHz (${item.powerDbm} dBm)${item.label ? ` - ${item.label}` : ''}`}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-xs transition-all border whitespace-nowrap cursor-pointer active:scale-95 ${
                      isTuned
                        ? 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300 shadow-sm shadow-cyan-950'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className={`text-[10px] font-bold ${isTuned ? 'text-cyan-400' : 'text-slate-500'}`}>
                      #{idx + 1}
                    </span>
                    <span className="font-bold text-slate-100">
                      {item.frequencyMHz.toFixed(4)}
                    </span>
                    <span className="text-[10px] text-slate-500 font-sans">MHz</span>
                    <span
                      className={`text-[10px] ${
                        item.powerDbm > -65
                          ? 'text-emerald-400'
                          : item.powerDbm > -85
                          ? 'text-amber-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {Math.round(item.powerDbm)} dBm
                    </span>
                    {item.label && (
                      <span className="text-[10px] font-sans text-slate-400 max-w-[90px] truncate hidden md:inline">
                        {item.label}
                      </span>
                    )}
                    {isTuned && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {peakHistory.length > 0 && (
          <button
            onClick={() => setPeakHistory([])}
            title="Clear peak frequency history"
            className="flex items-center gap-1 text-[11px] font-mono text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded hover:bg-slate-800/80 transition-colors shrink-0 ml-2"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
      </div>

      {/* Main Spectrum & Waterfall Interactive Viewport */}
      <div
        ref={containerRef}
        onClick={handlePointerTune}
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        className="relative flex-1 w-full overflow-hidden cursor-crosshair flex flex-col"
      >
        {/* Top Half: FFT Spectrum Analyzer Canvas */}
        <canvas ref={spectrumCanvasRef} className="w-full block" />

        {/* Divider hairline between Spectrum & Waterfall */}
        <div className="w-full h-[2px] bg-slate-800/90 relative z-10" />

        {/* Bottom Half: Waterfall Canvas */}
        <canvas ref={waterfallCanvasRef} className="w-full flex-1 block" />

        {/* Hover Crosshair Info HUD */}
        {hoverData && (
          <div
            className="absolute pointer-events-none px-2 py-1 bg-slate-950/90 border border-cyan-500/40 rounded text-[11px] font-mono text-cyan-300 shadow-xl backdrop-blur-sm z-30"
            style={{
              left: Math.min(hoverData.x + 12, (containerRef.current?.clientWidth || 300) - 150),
              top: Math.max(8, hoverData.y - 25),
            }}
          >
            <span>{hoverData.freqMHz.toFixed(4)} MHz</span>
            <span className="text-slate-400 mx-1">·</span>
            <span className="text-amber-400">{hoverData.dbm} dBm</span>
          </div>
        )}

        {/* Tuning Info Center HUD Tag */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 bg-slate-900/80 border border-slate-700/80 rounded font-mono text-[11px] text-slate-300 pointer-events-none z-20 flex items-center gap-2 shadow-md">
          <span className="text-red-400 font-bold">VFO:</span>
          <span className="text-white font-semibold">{centerFreqMHz.toFixed(4)} MHz</span>
          <span className="text-slate-500">|</span>
          <span className="text-cyan-400">{demodMode}</span>
          <span className="text-slate-400">({(bandwidthHz / 1000).toFixed(1)} kHz)</span>
        </div>
      </div>
    </div>
  );
};
