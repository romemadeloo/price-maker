import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (text: string, mode: 'replace' | 'append') => void;
}

/**
 * A paste target for clipboard data. Pasting straight into the grid works too;
 * this exists for large blocks and for browsers that block programmatic reads.
 */
export default function ImportDialog({ open, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');

  if (!open) return null;

  const rowCount = text.trim() === '' ? 0 : text.trim().split(/\r?\n/).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col gap-3 rounded-lg border border-slate-300 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Paste expected price table</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Paste tab-separated data from Google Sheets/Excel, or comma-separated CSV. Include the header row (Size,
            Base Area, then the quantity columns) to set the quantity columns automatically.
          </p>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Size\tBase Area\t10\t20\t30\n10*10\t100\t1,900\t3,600\t5,300'}
          className="min-h-[240px] flex-1 resize-none rounded-md border border-slate-300 p-2 font-mono text-xs outline-none focus:border-blue-500"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              Replace table
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} />
              Append rows
            </label>
            <span className="text-slate-500">{rowCount.toLocaleString()} line(s)</span>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-default" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={text.trim() === ''}
              onClick={() => {
                onImport(text, mode);
                setText('');
                onClose();
              }}
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
