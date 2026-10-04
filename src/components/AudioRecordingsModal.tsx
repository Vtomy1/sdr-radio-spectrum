import React from 'react';
import { X, Play, Download, Trash2, Radio, Disc } from 'lucide-react';

export interface RecordedAudioItem {
  id: string;
  frequencyMHz: number;
  mode: string;
  stationName?: string;
  timestamp: number;
  durationSec: number;
  blobUrl: string;
}

interface AudioRecordingsModalProps {
  isOpen: boolean;
  recordings: RecordedAudioItem[];
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const AudioRecordingsModal: React.FC<AudioRecordingsModalProps> = ({
  isOpen,
  recordings,
  onClose,
  onDelete,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#0a0e17] border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-[#0d1320] border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Disc className="w-5 h-5 text-rose-500" />
            <h3 className="font-semibold text-slate-100 text-sm">Intercepted Audio Transmissions</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Recordings List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {recordings.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs">
              <Disc className="w-8 h-8 text-slate-700 mx-auto mb-2" />
              <p className="font-medium text-slate-400">No recordings captured yet</p>
              <p className="mt-1 text-slate-600">
                Click "Record Audio" on the receiver panel while tuned to any frequency to save audio.
              </p>
            </div>
          ) : (
            recordings.map((rec) => (
              <div
                key={rec.id}
                className="bg-slate-900/80 border border-slate-800 rounded-lg p-3 flex flex-col gap-2 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-cyan-400">
                      {rec.frequencyMHz.toFixed(4)} MHz
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                      {rec.mode}
                    </span>
                    {rec.stationName && (
                      <span className="text-slate-200 font-medium">{rec.stationName}</span>
                    )}
                  </div>
                  <span className="text-slate-500 text-[10px]">
                    {new Date(rec.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <audio
                    src={rec.blobUrl}
                    controls
                    className="w-full h-8 accent-cyan-500 rounded bg-slate-950"
                  />

                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={rec.blobUrl}
                      download={`sdr_rx_${rec.frequencyMHz.toFixed(4)}mhz_${rec.timestamp}.webm`}
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                      title="Download audio file"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => onDelete(rec.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                      title="Delete recording"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#0d1320] border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
