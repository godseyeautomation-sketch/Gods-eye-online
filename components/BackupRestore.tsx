import React, { useRef, useState } from 'react';
import { DownloadCloud, UploadCloud, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { exportOPFSToZip, importOPFSFromZip } from '../utils/opfsBackup';
import { useBrain } from '../context/BrainContext';

export const BackupRestore: React.FC = () => {
    const { isConnected, connectBrain } = useBrain();
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [statusMatch, setStatusMatch] = useState<'success' | 'error' | null>(null);
    const [statusText, setStatusText] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleExport = async () => {
        if (!isConnected) await connectBrain();

        setIsExporting(true);
        setStatusMatch(null);
        setStatusText('Compressing Brain Data...');

        try {
            const success = await exportOPFSToZip();
            if (success) {
                setStatusMatch('success');
                setStatusText('Export complete! Your Brain is safe.');
            } else {
                throw new Error('Export failed to generate zip.');
            }
        } catch (err: any) {
            setStatusMatch('error');
            setStatusText(err.message || 'Export failed.');
        } finally {
            setIsExporting(false);
            setTimeout(() => setStatusMatch(null), 5000);
        }
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm('WARNING: Importing a new Brain will overwrite your current local data. Continue?')) {
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        if (!isConnected) await connectBrain();

        setIsImporting(true);
        setStatusMatch(null);
        setStatusText('Restoring Local Brain...');

        try {
            const success = await importOPFSFromZip(file);
            if (success) {
                setStatusMatch('success');
                setStatusText('Brain successfully restored! Reloading...');
                setTimeout(() => window.location.reload(), 1500); // Reload to re-initialize OPFS
            } else {
                throw new Error('Failed to unpack Brain backup.');
            }
        } catch (err: any) {
            setStatusMatch('error');
            setStatusText(err.message || 'Import failed.');
            setIsImporting(false);
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="bg-surface/50 border border-border-base rounded-2xl p-6 backdrop-blur-md space-y-4">
            <div>
                <h3 className="text-lg font-bold text-white mb-2">Local Brain Portability</h3>
                <p className="text-sm text-text-secondary">
                    Your generated assets and AI memory are stored securely in this browser's filesystem (OPFS).
                    Export a backup to safely move your Brain to a new computer or browser.
                </p>
            </div>

            <div className="flex items-center gap-4 pt-4">
                <button
                    onClick={handleExport}
                    disabled={isExporting || isImporting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-brand text-bg rounded-xl font-semibold hover:bg-brand/90 transition-all disabled:opacity-50"
                >
                    {isExporting ? <Loader2 size={18} className="animate-spin" /> : <DownloadCloud size={18} />}
                    Export Brain
                </button>

                <button
                    onClick={handleImportClick}
                    disabled={isExporting || isImporting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-surface-light border border-border-base text-white rounded-xl font-semibold hover:bg-white/5 transition-all disabled:opacity-50"
                >
                    {isImporting ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
                    Import Backup
                </button>
                <input
                    type="file"
                    accept=".zip"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleImportFile}
                />
            </div>

            {statusMatch && (
                <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${statusMatch === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                    {statusMatch === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    {statusText}
                </div>
            )}
        </div>
    );
};
