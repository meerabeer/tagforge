'use client';

import React, { useState, useRef } from 'react';

interface PreviewData {
    preview: boolean;
    totalRows: number;
    sampleRows: Record<string, string>[];
    columns: string[];
}

interface UploadResult {
    success: boolean;
    message: string;
    rowCount: number;
}

export default function PMRUploadModal({
    isOpen,
    onClose,
    onUploadComplete
}: {
    isOpen: boolean;
    onClose: () => void;
    onUploadComplete: () => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<UploadResult | null>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setError(null);
        setPreview(null);
        setResult(null);

        // Get preview
        setLoading(true);
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('preview', 'true');

            const response = await fetch('/api/pmr-upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Failed to parse CSV');
                return;
            }

            setPreview(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to preview file');
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setUploading(true);
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/pmr-upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Upload failed');
                return;
            }

            setResult(data);
            onUploadComplete();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setPreview(null);
        setError(null);
        setResult(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-700">
                    <div>
                        <h2 className="text-xl font-bold text-white">Upload PMR Data (CSV)</h2>
                        <p className="text-blue-100 text-sm mt-1">
                            This will <span className="font-semibold text-yellow-200">OVERWRITE</span> all existing PMR records
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                    {/* Success Message */}
                    {result && (
                        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center gap-3">
                                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h3 className="font-semibold text-green-800">Upload Successful!</h3>
                                    <p className="text-green-700">{result.message}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                            <div className="flex items-center gap-3">
                                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-red-700">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* File Input */}
                    {!result && (
                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Select CSV File
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv"
                                    onChange={handleFileSelect}
                                    className="block w-full text-sm text-slate-500
                                        file:mr-4 file:py-2 file:px-4
                                        file:rounded-lg file:border-0
                                        file:text-sm file:font-semibold
                                        file:bg-blue-50 file:text-blue-700
                                        hover:file:bg-blue-100
                                        cursor-pointer"
                                />
                                {loading && (
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 mt-2">
                                Required columns: Site_ID_1, Site_ID, Autual_PMR_Date, FME Name
                            </p>
                        </div>
                    )}

                    {/* Preview Table */}
                    {preview && !result && (
                        <div>
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="font-semibold text-slate-800">
                                    Preview ({preview.sampleRows.length} of {preview.totalRows} rows)
                                </h3>
                                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                                    ⚠️ {preview.totalRows} rows will replace existing data
                                </span>
                            </div>
                            
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto max-h-[300px]">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 sticky top-0">
                                            <tr>
                                                {preview.columns.map(col => (
                                                    <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap border-b">
                                                        {col}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {preview.sampleRows.map((row, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50">
                                                    {preview.columns.map(col => (
                                                        <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                                                            {row[col] || '-'}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Column Summary */}
                            <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                                <p className="text-sm text-slate-600">
                                    <span className="font-medium">Detected columns:</span>{' '}
                                    {preview.columns.join(', ')}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                    <button
                        onClick={handleClose}
                        className="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors font-medium"
                    >
                        {result ? 'Close' : 'Cancel'}
                    </button>
                    
                    {preview && !result && (
                        <button
                            onClick={handleUpload}
                            disabled={uploading}
                            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {uploading ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                    Overwrite & Upload ({preview.totalRows} rows)
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
