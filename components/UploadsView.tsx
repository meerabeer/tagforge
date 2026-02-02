'use client';

import React, { useState, useEffect, useRef } from 'react';

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

interface FORecord {
    id: number;
    site_id: string;
    region: string;
    technology: string;
    priority: string;
    created_at: string;
}

export default function UploadsView() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<UploadResult | null>(null);
    
    // Current data
    const [currentData, setCurrentData] = useState<FORecord[]>([]);
    const [fetchingData, setFetchingData] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Fetch current data on mount
    useEffect(() => {
        fetchCurrentData();
    }, []);

    const fetchCurrentData = async () => {
        setFetchingData(true);
        try {
            const response = await fetch('/api/uploads');
            const data = await response.json();
            if (response.ok) {
                setCurrentData(data.data || []);
            }
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setFetchingData(false);
        }
    };

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

            const response = await fetch('/api/uploads', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Failed to parse file');
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

            const response = await fetch('/api/uploads', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Upload failed');
                return;
            }

            setResult(data);
            setFile(null);
            setPreview(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            // Refresh the data
            fetchCurrentData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleReset = () => {
        setFile(null);
        setPreview(null);
        setError(null);
        setResult(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Filter current data by search term
    const filteredData = currentData.filter(row => 
        row.site_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.region?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.technology?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.priority?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-slate-50 pb-10">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 py-4 px-4 sm:px-6 mb-6">
                <div className="max-w-screen-2xl mx-auto">
                    <h2 className="text-xl font-semibold text-slate-900">Uploads</h2>
                    <p className="text-sm text-slate-500 mt-1">Upload and manage data files for FO database and other documents</p>
                </div>
            </div>

            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
                {/* Upload Section */}
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 mb-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">📤 Upload CSV/Excel File</h3>
                    
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                        <p className="text-sm text-amber-800">
                            <strong>⚠️ Warning:</strong> Uploading a file will <strong>OVERWRITE</strong> all existing data.
                        </p>
                        <p className="text-xs text-amber-700 mt-2">
                            Required columns: <code className="bg-amber-100 px-1 rounded">site_id</code>, <code className="bg-amber-100 px-1 rounded">region</code>, <code className="bg-amber-100 px-1 rounded">technology</code>, <code className="bg-amber-100 px-1 rounded">priority</code> (optional)
                        </p>
                    </div>

                    {/* File Input */}
                    <div className="flex items-center gap-4 mb-4">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.xlsx,.xls"
                            onChange={handleFileSelect}
                            className="block w-full text-sm text-slate-500
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-lg file:border-0
                                file:text-sm file:font-semibold
                                file:bg-blue-50 file:text-blue-700
                                hover:file:bg-blue-100
                                cursor-pointer"
                        />
                        {file && (
                            <button
                                onClick={handleReset}
                                className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg"
                            >
                                ✕ Clear
                            </button>
                        )}
                    </div>

                    {/* Loading */}
                    {loading && (
                        <div className="flex items-center gap-2 text-blue-600 mb-4">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                            <span className="text-sm">Parsing file...</span>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                            <p className="text-sm text-red-800">❌ {error}</p>
                        </div>
                    )}

                    {/* Preview */}
                    {preview && (
                        <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                                <h4 className="font-medium text-slate-900">
                                    Preview ({preview.totalRows} rows found)
                                </h4>
                                <p className="text-xs text-slate-500">Showing first 10 rows</p>
                            </div>
                            <div className="overflow-x-auto max-h-64">
                                <table className="min-w-full divide-y divide-slate-200">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            {preview.columns.map(col => (
                                                <th key={col} className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase">
                                                    {col}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 bg-white">
                                        {preview.sampleRows.map((row, idx) => (
                                            <tr key={idx}>
                                                {preview.columns.map(col => (
                                                    <td key={col} className="px-4 py-2 text-sm text-slate-900 whitespace-nowrap">
                                                        {row[col] || '-'}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                                <p className="text-sm text-slate-600">
                                    Ready to upload <strong>{preview.totalRows}</strong> records
                                </p>
                                <button
                                    onClick={handleUpload}
                                    disabled={uploading}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    {uploading ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                            Uploading...
                                        </>
                                    ) : (
                                        <>📤 Upload & Replace All Data</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Result */}
                    {result && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <p className="text-sm text-green-800">
                                ✅ {result.message}
                            </p>
                        </div>
                    )}
                </div>

                {/* Current Data Section */}
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold text-slate-900">📊 Current Data</h3>
                            <p className="text-sm text-slate-500">{currentData.length} records in database</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                                onClick={fetchCurrentData}
                                disabled={fetchingData}
                                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm text-slate-700"
                            >
                                🔄 Refresh
                            </button>
                        </div>
                    </div>

                    {fetchingData ? (
                        <div className="flex items-center justify-center py-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <span className="ml-3 text-slate-600">Loading data...</span>
                        </div>
                    ) : filteredData.length === 0 ? (
                        <div className="text-center py-10">
                            <p className="text-slate-500">
                                {currentData.length === 0 
                                    ? 'No data in database. Upload a CSV/Excel file to populate.'
                                    : 'No matching records found.'
                                }
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto max-h-[500px]">
                            <table className="min-w-full divide-y divide-slate-200">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Site ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Region</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Technology</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Priority</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Created At</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 bg-white">
                                    {filteredData.slice(0, 200).map((row) => (
                                        <tr key={row.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-3 text-sm font-medium text-slate-900">{row.site_id}</td>
                                            <td className="px-4 py-3 text-sm text-slate-600">{row.region || '-'}</td>
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                                    {row.technology || '-'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {row.priority ? (
                                                    <span className={`px-2 py-1 rounded text-xs ${
                                                        row.priority.toLowerCase() === 'high' ? 'bg-red-100 text-red-700' :
                                                        row.priority.toLowerCase() === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-green-100 text-green-700'
                                                    }`}>
                                                        {row.priority}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-500">
                                                {new Date(row.created_at).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredData.length > 200 && (
                                <div className="px-4 py-3 bg-slate-50 border-t text-sm text-slate-500 text-center">
                                    Showing first 200 of {filteredData.length} records
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
