'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getParam, setParams } from '@/lib/urlUtils';
import ImagePreviewModal from '@/components/ImagePreviewModal';

interface InventoryRow {
    id: string;
    site_id: string;
    category: string | null;
    equipment_type: string | null;
    product_name: string | null;
    product_number: string | null;
    serial_number: string | null;
    tag_id: string | null;
    tag_category: string | null;
    serial_pic_url: string | null;
    tag_pic_url: string | null;
    created_by_name: string | null;
    updated_by_name: string | null;
    updated_at: string | null;
    sheet_source: string | null;
    planned_date?: string; // Fetched separately
}

export default function AnalystView() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // Initial state from URL
    const initialSite = getParam(searchParams, 'site', '');
    const initialSerial = getParam(searchParams, 'serial', '');

    // Data State
    const [data, setData] = useState<InventoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [totalCount, setTotalCount] = useState(0);

    // Pagination State
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    // Filter State
    const [searchSite, setSearchSite] = useState(initialSite);
    const [searchSerial, setSearchSerial] = useState(initialSerial);
    const [debouncedSearch, setDebouncedSearch] = useState({ site: initialSite, serial: initialSerial });

    // Preview State
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');

    // CSV Export State
    const [exporting, setExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);

    // Update URL function
    const updateUrl = (newFilters: { site: string; serial: string }) => {
        setParams(router, pathname, searchParams, {
            site: newFilters.site,
            serial: newFilters.serial
        });
    };

    // Sync URL changes to State (Handle Back/Forward)
    useEffect(() => {
        const siteParam = getParam(searchParams, 'site', '');
        const serialParam = getParam(searchParams, 'serial', '');

        // Only update if different to avoid loops
        if (siteParam !== searchSite || serialParam !== searchSerial) {
            setSearchSite(siteParam);
            setSearchSerial(serialParam);
            setDebouncedSearch({ site: siteParam, serial: serialParam });
        }
    }, [searchParams]); // Depend on searchParams

    // Debounce effect & URL update
    useEffect(() => {
        const timer = setTimeout(() => {
            const newFilters = { site: searchSite, serial: searchSerial };
            setDebouncedSearch(newFilters);
            updateUrl(newFilters);
            setPage(1); // Reset to page 1 on search change
        }, 500);
        return () => clearTimeout(timer);
    }, [searchSite, searchSerial]);

    // Fetch Data
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('v_main_inventory_audit')
                .select('*', { count: 'exact' });

            // Apply Filters
            if (debouncedSearch.site) {
                query = query.ilike('site_id', `%${debouncedSearch.site}%`);
            }
            if (debouncedSearch.serial) {
                query = query.ilike('serial_number', `%${debouncedSearch.serial}%`);
            }

            // Pagination
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            const { data: rows, count, error } = await query
                .order('updated_at', { ascending: false })
                .range(from, to);

            if (error) throw error;

            let finalRows = (rows as InventoryRow[]) || [];

            // Fetch Actual PMR Dates for these sites
            if (finalRows.length > 0) {
                const siteIds = Array.from(new Set(finalRows.map(r => r.site_id)));
                const { data: plans } = await supabase
                    .from('pmr_actual_2026')
                    .select('Site_ID_1, \"Autual_PMR_Date\"')
                    .in('Site_ID_1', siteIds);

                if (plans) {
                    const planMap = new Map();
                    plans.forEach((p: any) => planMap.set(p.Site_ID_1, p['Autual_PMR_Date']));

                    finalRows = finalRows.map(r => ({
                        ...r,
                        planned_date: planMap.get(r.site_id)
                    }));
                }
            }

            setData(finalRows);
            setTotalCount(count || 0);

        } catch (err) {
            console.error('Error fetching analyst data:', err);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, debouncedSearch]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Handlers
    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= Math.ceil(totalCount / pageSize)) {
            setPage(newPage);
        }
    };

    const openPreview = (url: string | null, title: string) => {
        if (!url) return;
        setPreviewUrl(url);
        setPreviewTitle(title);
    };

    const downloadCsv = async () => {
        setExporting(true);
        setExportProgress(0);

        try {
            const BATCH_SIZE = 1000;
            let fetchedCount = 0;
            let allRows: any[] = [];
            let hasMore = true;
            let offset = 0;

            // Build base query
            const buildQuery = () => {
                let q = supabase.from('v_main_inventory_audit').select('site_id, category, equipment_type, product_name, product_number, serial_number, tag_id, tag_category, serial_pic_url, tag_pic_url, sheet_source, updated_at, created_by_name, updated_by_name');
                if (debouncedSearch.site) q = q.ilike('site_id', `%${debouncedSearch.site}%`);
                if (debouncedSearch.serial) q = q.ilike('serial_number', `%${debouncedSearch.serial}%`);
                return q;
            };

            // Get total specific to this export
            let countQuery = supabase.from('v_main_inventory_audit').select('*', { count: 'exact', head: true });
            if (debouncedSearch.site) countQuery = countQuery.ilike('site_id', `%${debouncedSearch.site}%`);
            if (debouncedSearch.serial) countQuery = countQuery.ilike('serial_number', `%${debouncedSearch.serial}%`);
            const { count } = await countQuery;
            const totalToFetch = count || 0;

            while (hasMore) {
                const { data: batch, error } = await buildQuery()
                    .range(offset, offset + BATCH_SIZE - 1)
                    .order('updated_at', { ascending: false });

                if (error) throw error;

                if (!batch || batch.length === 0) {
                    hasMore = false;
                } else {
                    allRows = [...allRows, ...batch];
                    fetchedCount += batch.length;
                    offset += BATCH_SIZE;
                    setExportProgress(Math.round((fetchedCount / totalToFetch) * 100));
                    if (batch.length < BATCH_SIZE) hasMore = false;
                }
            }

            // Convert to CSV
            const headers = ['Site ID', 'Category', 'Equipment', 'Product', 'Prod #', 'Serial', 'Tag ID', 'Tag Cat', 'Serial Photo', 'Tag Photo', 'Source', 'Updated', 'Created By', 'Updated By'];
            const csvRows = allRows.map(r => [
                r.site_id,
                r.category,
                r.equipment_type,
                r.product_name,
                r.product_number,
                r.serial_number,
                r.tag_id,
                r.tag_category,
                r.serial_pic_url,
                r.tag_pic_url,
                r.sheet_source,
                r.updated_at,
                r.created_by_name,
                r.updated_by_name
            ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')); // Escape quotes

            const csvContent = [headers.join(','), ...csvRows].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const dateStr = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15); // YYYYMMDDTHHMM
            link.setAttribute('download', `tagforge_inventory_${dateStr}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed. Check console.');
        } finally {
            setExporting(false);
            setExportProgress(0);
        }
    };

    const totalPages = Math.ceil(totalCount / pageSize);

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4">

                {/* Controls */}
                <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 shadow-sm">
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-end md:items-center">

                        {/* Find */}
                        <div className="flex gap-3 flex-1 w-full md:w-auto">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">SITE ID</label>
                                <input
                                    type="text"
                                    value={searchSite}
                                    onChange={e => setSearchSite(e.target.value)}
                                    placeholder="e.g. W50..."
                                    className="px-3 py-1.5 border border-slate-300 rounded text-sm w-32 md:w-40"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">SERIAL #</label>
                                <input
                                    type="text"
                                    value={searchSerial}
                                    onChange={e => setSearchSerial(e.target.value)}
                                    placeholder="Contains..."
                                    className="px-3 py-1.5 border border-slate-300 rounded text-sm w-40 md:w-56"
                                />
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-4">
                            <div className="text-right">
                                <div className="text-sm text-slate-500">
                                    Total Rows: <span className="font-semibold text-slate-900">{totalCount}</span>
                                </div>
                            </div>

                            <button
                                onClick={downloadCsv}
                                disabled={exporting || loading}
                                className="px-4 py-2 bg-slate-800 text-white rounded-md text-sm font-medium hover:bg-slate-900 disabled:opacity-50 flex items-center gap-2"
                            >
                                {exporting ? (
                                    <>Downloading {exportProgress}%</>
                                ) : (
                                    <>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        Download CSV
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
                                <tr>
                                    <th className="px-4 py-3 border-b">Site ID</th>
                                    <th className="px-4 py-3 border-b">Planned</th>
                                    <th className="px-4 py-3 border-b">Category</th>
                                    <th className="px-4 py-3 border-b">Equipment</th>
                                    <th className="px-4 py-3 border-b">Product</th>
                                    <th className="px-4 py-3 border-b">Serial #</th>
                                    <th className="px-4 py-3 border-b text-center">Serial Photo</th>
                                    <th className="px-4 py-3 border-b">Tag ID</th>
                                    <th className="px-4 py-3 border-b text-center">Tag Photo</th>
                                    <th className="px-4 py-3 border-b">Tag Category</th>
                                    <th className="px-4 py-3 border-b">Source</th>
                                    <th className="px-4 py-3 border-b">Audit</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                            Loading inventory data...
                                        </td>
                                    </tr>
                                ) : data.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                                            No records found matching your filters.
                                        </td>
                                    </tr>
                                ) : (
                                    data.map(row => (
                                        <tr key={row.id} className="hover:bg-slate-50">
                                            <td className="px-4 py-2 font-medium text-slate-900">{row.site_id}</td>
                                            <td className="px-4 py-2 text-slate-500 text-xs">
                                                {row.planned_date ? new Date(row.planned_date).toLocaleDateString() : '-'}
                                            </td>
                                            <td className="px-4 py-2 text-slate-600">{row.category}</td>
                                            <td className="px-4 py-2 text-slate-600">{row.equipment_type}</td>
                                            <td className="px-4 py-2 text-slate-600">
                                                <div className="flex flex-col">
                                                    <span>{row.product_name}</span>
                                                    <span className="text-xs text-slate-400 font-mono">{row.product_number}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 font-mono text-blue-700">{row.serial_number}</td>
                                            <td className="px-4 py-2 text-center">
                                                {row.serial_pic_url ? (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => openPreview(row.serial_pic_url, 'Serial Photo')}
                                                            className="text-xs text-blue-600 hover:text-blue-800 underline font-medium"
                                                        >
                                                            Preview
                                                        </button>
                                                        <a
                                                            href={row.serial_pic_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-slate-400 hover:text-slate-600"
                                                            title="Open in new tab"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                            </svg>
                                                        </a>
                                                    </div>
                                                ) : <span className="text-slate-300">-</span>}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-slate-600">{row.tag_id}</td>
                                            <td className="px-4 py-2 text-center">
                                                {row.tag_pic_url ? (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => openPreview(row.tag_pic_url, 'Tag Photo')}
                                                            className="text-xs text-blue-600 hover:text-blue-800 underline font-medium"
                                                        >
                                                            Preview
                                                        </button>
                                                        <a
                                                            href={row.tag_pic_url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-slate-400 hover:text-slate-600"
                                                            title="Open in new tab"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                            </svg>
                                                        </a>
                                                    </div>
                                                ) : <span className="text-slate-300">-</span>}
                                            </td>
                                            <td className="px-4 py-2 text-slate-600">{row.tag_category || '-'}</td>
                                            <td className="px-4 py-2 text-slate-600">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${row.sheet_source === 'manual_edited' || row.sheet_source === 'manual_added'
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-slate-100 text-slate-800'
                                                    }`}>
                                                    {row.sheet_source || 'Original'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-xs text-slate-500">
                                                <div><span className="font-semibold">Upd:</span> {row.updated_by_name}</div>
                                                <div><span className="font-semibold">By:</span> {row.created_by_name}</div>
                                                <div className="text-slate-400 mt-0.5">{row.updated_at ? new Date(row.updated_at).toLocaleDateString() : '-'}</div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="border-t border-slate-200 px-4 py-3 bg-slate-50 flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div className="text-sm text-slate-600">
                            Showing page <span className="font-semibold">{page}</span> of <span className="font-semibold">{totalPages || 1}</span>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 uppercase font-semibold mr-2">Rows per page:</span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setPage(1);
                                }}
                                className="border border-slate-300 rounded text-sm px-2 py-1"
                            >
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                            </select>

                            <div className="ml-4 flex gap-1">
                                <button
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={page === 1}
                                    className="px-3 py-1 border border-slate-300 rounded bg-white text-sm hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={page >= totalPages}
                                    className="px-3 py-1 border border-slate-300 rounded bg-white text-sm hover:bg-slate-50 disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <ImagePreviewModal
                isOpen={!!previewUrl}
                imageUrl={previewUrl}
                title={previewTitle}
                onClose={() => setPreviewUrl(null)}
            />
        </main>
    );
}
