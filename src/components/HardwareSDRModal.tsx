import React, { useState } from 'react';
import { X, Cpu, CheckCircle2, AlertCircle, Usb, Radio, ExternalLink } from 'lucide-react';

interface HardwareSDRModalProps {
  isOpen: boolean;
  onClose: () => void;
  usingHardware: boolean;
  onToggleHardware: (useHw: boolean) => void;
}

export const HardwareSDRModal: React.FC<HardwareSDRModalProps> = ({
  isOpen,
  onClose,
  usingHardware,
  onToggleHardware,
}) => {
  const [deviceStatus, setDeviceStatus] = useState<string>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const hasWebUsb = typeof navigator !== 'undefined' && 'usb' in navigator;

  const handleRequestDevice = async () => {
    if (!hasWebUsb) {
      setErrorMessage('WebUSB is not supported in this browser environment. Using high-fidelity RF DSP simulation.');
      return;
    }

    try {
      setDeviceStatus('requesting');
      setErrorMessage(null);

      // Known SDR USB vendor/product IDs:
      // Realtek RTL2832U: 0x0BDA:0x2838, 0x0BDA:0x2832
      // HackRF: 0x1D50:0x6089
      // Airspy: 0x1D50:0x60A1
      const usbNav = navigator as unknown as {
        usb: { requestDevice: (options: { filters: Array<{ vendorId: number }> }) => Promise<unknown> };
      };
      const device = await usbNav.usb.requestDevice({
        filters: [
          { vendorId: 0x0bda }, // Realtek RTL-SDR
          { vendorId: 0x1d50 }, // HackRF / Airspy / OpenMoko
        ],
      });

      if (device) {
        setDeviceStatus('connected');
        onToggleHardware(true);
      }
    } catch (err) {
      console.warn('USB Device request error:', err);
      setErrorMessage((err as Error).message || 'No compatible USB SDR device was selected.');
      setDeviceStatus('idle');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0a0e17] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-[#0d1320] border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Usb className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-slate-100 text-sm">Hardware SDR &amp; WebUSB Device Manager</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs text-slate-300">
          <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-slate-400">ACTIVE SDR SOURCE:</span>
              <span className="font-mono font-bold text-cyan-400">
                {usingHardware ? 'RTL-SDR WebUSB Live' : 'Simulated RF DSP Engine'}
              </span>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              StratoSDR runs a real-time RF physics simulation across FM, Airband, NOAA, Marine, Ham, and Shortwave bands with authentic carrier models and audio synthesis. You can also interface directly with physical USB SDR dongles.
            </p>
          </div>

          {/* WebUSB Support & Connection */}
          <div className="space-y-3">
            <h4 className="font-semibold text-slate-200 text-xs">Supported Hardware:</h4>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <div className="text-slate-200 font-bold">RTL2832U / RTL-SDR</div>
                <div className="text-slate-500">USB ID 0x0BDA:0x2838</div>
              </div>
              <div className="p-2 bg-slate-900 rounded border border-slate-800">
                <div className="text-slate-200 font-bold">HackRF One / Airspy</div>
                <div className="text-slate-500">USB ID 0x1D50:0x6089</div>
              </div>
            </div>

            {errorMessage && (
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded text-[11px] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-between p-3 bg-[#0d1320] rounded-lg border border-slate-800">
              <div className="space-y-0.5">
                <div className="text-slate-200 font-medium">Browser WebUSB API:</div>
                <div className="font-mono text-[11px] text-slate-400">
                  {hasWebUsb ? 'Detected & Supported' : 'Unavailable in this browser'}
                </div>
              </div>

              <button
                onClick={handleRequestDevice}
                disabled={!hasWebUsb}
                className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded font-medium text-xs transition-colors flex items-center gap-1.5"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>Connect USB SDR</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0d1320] border-t border-slate-800 flex justify-between items-center">
          <button
            onClick={() => onToggleHardware(false)}
            className="text-xs text-slate-400 hover:text-slate-200 underline"
          >
            Switch to Simulated RF Mode
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
