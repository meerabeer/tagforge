'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getParam, setParams } from '@/lib/urlUtils';

// --- Types ---
interface PMRPlan {
    Site_ID_1: string; // W2470
    Site_ID: string;   // 2470
    Planned_PMR_Date: string; // "YYYY-MM-DD"
    FME_Name: string | null;
    Site_Type: string | null;
}

interface InventoryRow {
    site_id: string;
    sheet_source: string | null;
    updated_at: string | null;
    serial_number: string | null;
    tag_id: string | null;
    tag_pic_url: string | null;
    tag_category: string | null;
    photo_category: string | null;
}

interface PMRRow {
    site_id: string;
    planned_date: string;
    status: 'Submitted' | 'Pending';
    submission_count: number;
    total_rows: number;
    last_submission_date: string | null;
    fme_name: string | null;
    site_type: string | null;
    // Data quality metrics
    duplicate_serials: number;
    duplicate_tags: number;
    // Tag pictures metrics
    tag_pics_available: number;
    tag_pics_required: number;
}

// --- Component ---
export default function PMRView() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // --- URL State Initialization ---
    const initialDate = getParam(searchParams, 'date', new Date().toISOString().split('T')[0]);

    const [selectedDate, setSelectedDateState] = useState<string>(initialDate);
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<PMRRow[]>([]);
    const [stats, setStats] = useState({ total: 0, submitted: 0, percentage: 0 });

    // --- URL Update Helper ---
    const setSelectedDate = (value: string) => {
        setSelectedDateState(value);
        setParams(router, pathname, searchParams, { date: value });
    };

    // Sync URL changes to state (handles browser back/forward)
    useEffect(() => {
        const urlDate = getParam(searchParams, 'date', new Date().toISOString().split('T')[0]);
        if (urlDate !== selectedDate) {
            setSelectedDateState(urlDate);
        }
    }, [searchParams]);

    const fetchData = useCallback(async () => {
        if (!selectedDate) return;
        setLoading(true);

        try {
            // 1. Fetch Plans for the date
            // Using precise column names based on user feedback (Site_ID_1, Site_ID)
            // Assuming Planned_Date exists. If not, this query will fail.
            const { data: plansData, error: plansError } = await supabase
                .from('pmr_plan_2026_sheet1')
                .select('Site_ID, Site_ID_1, Planned_PMR_Date, FME_Name, Site_Type')
                .eq('Planned_PMR_Date', selectedDate);

            if (plansError) {
                console.error('Error fetching plans:', plansError);
                if (plansError.code === '42703') { // Undefined column
                    alert(`Database schema mismatch. Please check column names. Expecting: "Site_ID", "Site_ID_1", "Planned_Date".\nDetails: ${plansError.message}`);
                }
                setLoading(false);
                return;
            }

            const plans = (plansData as unknown as PMRPlan[]) || [];

            if (plans.length === 0) {
                setRows([]);
                setStats({ total: 0, submitted: 0, percentage: 0 });
                setLoading(false);
                return;
            }

            // 2. Fetch Submissions for these sites
            // Collect all possible Site IDs (both W and non-W formats)
            const allSiteIds = new Set<string>();
            plans.forEach(p => {
                if (p.Site_ID_1) allSiteIds.add(p.Site_ID_1);
                if (p.Site_ID) allSiteIds.add(p.Site_ID);
            });

            const { data: subsData, error: subsError } = await supabase
                .from('main_inventory')
                .select('site_id, sheet_source, updated_at, serial_number, tag_id, tag_pic_url, tag_category, photo_category')
                .in('site_id', Array.from(allSiteIds));

            if (subsError) throw subsError;

            const submissions = (subsData as InventoryRow[]) || [];

            // Map submissions by site_id for easy lookup
            const submissionsMap = new Map<string, InventoryRow[]>();
            submissions.forEach(s => {
                if (!submissionsMap.has(s.site_id)) {
                    submissionsMap.set(s.site_id, []);
                }
                submissionsMap.get(s.site_id)!.push(s);
            });

            // Helper function to count how many values appear more than once
            const countDuplicateValues = (values: (string | null)[]): number => {
                const nonNullValues = values.filter(v => v && v.trim() !== '');
                const countMap = new Map<string, number>();
                nonNullValues.forEach(v => {
                    countMap.set(v!, (countMap.get(v!) || 0) + 1);
                });
                // Count how many values appear more than once
                let duplicateValueCount = 0;
                countMap.forEach((count) => {
                    if (count > 1) {
                        duplicateValueCount += count; // Count all instances of duplicates
                    }
                });
                return duplicateValueCount;
            };

            // Build rows
            const results: PMRRow[] = plans.map(p => {
                // Check both IDs (W and non-W)
                const subsW = p.Site_ID_1 ? (submissionsMap.get(p.Site_ID_1) || []) : [];
                const subsNoW = p.Site_ID ? (submissionsMap.get(p.Site_ID) || []) : [];
                const siteRows = [...subsW, ...subsNoW];

                // Calculate stats
                const totalRows = siteRows.length;
                const manualRows = siteRows.filter(r =>
                    r.sheet_source &&
                    // Check for variations of 'manual'
                    r.sheet_source.toLowerCase().includes('manual')
                );
                const isSubmitted = manualRows.length > 0;

                // Calculate duplicates across ALL site rows (not just manual)
                // This shows if data is duplicated between original and manual entries
                const allSerials = siteRows.map(r => r.serial_number);
                const allTags = siteRows.map(r => r.tag_id);
                const duplicateSerials = countDuplicateValues(allSerials);
                const duplicateTags = countDuplicateValues(allTags);

                // Calculate tag pictures metrics for ALL site rows
                // Exclude rows where tag_category is "Item dismantled", "Tag not required" variants
                const rowsRequiringTagPic = siteRows.filter(r => {
                    const tagCat = (r.tag_category || '').toLowerCase();
                    const photoCat = (r.photo_category || '').toLowerCase();
                    // Exclusions: "item dismantled", "tag not required" variants - no tag pic required
                    const excludedTagCategories = [
                        'item dismantled',
                        'tag not required & serial available',
                        'tag not required & serial is missing',
                        'tag not required'
                    ];
                    return !excludedTagCategories.includes(tagCat) && photoCat !== 'item dismantled';
                });
                
                const tagPicsAvailable = rowsRequiringTagPic.filter(r => r.tag_pic_url && r.tag_pic_url.trim() !== '').length;
                const tagPicsRequired = rowsRequiringTagPic.length;

                // Prefer W format for display
                const displayId = p.Site_ID_1 || p.Site_ID || 'Unknown';

                return {
                    site_id: displayId,
                    planned_date: p.Planned_PMR_Date,
                    status: isSubmitted ? 'Submitted' : 'Pending',
                    submission_count: manualRows.length,
                    total_rows: totalRows,
                    last_submission_date: isSubmitted && manualRows[0].updated_at ? manualRows[0].updated_at : null,
                    fme_name: p.FME_Name || null,
                    site_type: p.Site_Type || null,
                    duplicate_serials: duplicateSerials,
                    duplicate_tags: duplicateTags,
                    tag_pics_available: tagPicsAvailable,
                    tag_pics_required: tagPicsRequired
                };
            });

            setRows(results);

            // Calc stats
            const total = results.length;
            const submittedCount = results.filter(r => r.status === 'Submitted').length;
            setStats({
                total,
                submitted: submittedCount,
                percentage: total > 0 ? Math.round((submittedCount / total) * 100) : 0
            });

        } catch (err) {
            console.error('PMR View Error:', err);
        } finally {
            setLoading(false);
        }
    }, [selectedDate]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4">

                {/* Header / Controls */}
                <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                    <div className="flex flex-col md:flex-row gap-6 items-end justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800 mb-1">PMR Planner Tracking</h2>
                            <p className="text-sm text-slate-500">Monitor NFO submissions against planned schedule</p>

                            <div className="mt-4">
                                <label className="block text-xs font-semibold text-slate-500 mb-1">SELECT DATE</label>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="px-4 py-2 border border-slate-300 rounded-md text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="flex gap-4 w-full md:w-auto">
                            <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg flex-1 min-w-[120px] text-center">
                                <div className="text-2xl font-bold text-blue-700">{stats.total}</div>
                                <div className="text-xs text-blue-600 font-medium uppercase mt-1">Planned Sites</div>
                            </div>
                            <div className={`border p-4 rounded-lg flex-1 min-w-[120px] text-center ${stats.percentage === 100 ? 'bg-green-50 border-green-100' : 'bg-slate-50 border-slate-200'
                                }`}>
                                <div className={`text-2xl font-bold ${stats.percentage === 100 ? 'text-green-700' : 'text-slate-700'
                                    }`}>
                                    {stats.submitted}
                                </div>
                                <div className="text-xs text-slate-500 font-medium uppercase mt-1">Submitted</div>
                            </div>
                            <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex-1 min-w-[120px] text-center">
                                <div className="text-2xl font-bold text-slate-700">{stats.percentage}%</div>
                                <div className="text-xs text-slate-500 font-medium uppercase mt-1">Completion</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
                            <tr>
                                <th className="px-6 py-4 border-b">Site ID</th>
                                <th className="px-6 py-4 border-b">Site Type</th>
                                <th className="px-6 py-4 border-b">NFO Name</th>
                                <th className="px-6 py-4 border-b">Planned Date</th>
                                <th className="px-6 py-4 border-b text-center">Status</th>
                                <th className="px-6 py-4 border-b text-center">Changes</th>
                                <th className="px-6 py-4 border-b text-center">Duplicates</th>
                                <th className="px-6 py-4 border-b text-center">Tag Pictures</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">Loading plan data...</td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">No planned sites found for this date.</td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.site_id} className="hover:bg-slate-50">
                                        <td className="px-6 py-3 font-medium text-slate-900">{row.site_id}</td>
                                        <td className="px-6 py-3 text-slate-600">{row.site_type || '-'}</td>
                                        <td className="px-6 py-3 text-slate-600">{row.fme_name || '-'}</td>
                                        <td className="px-6 py-3 text-slate-600">{row.planned_date}</td>
                                        <td className="px-6 py-3 text-center">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${row.status === 'Submitted'
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-red-100 text-red-800'
                                                }`}>
                                                {row.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-center text-slate-600">
                                            {row.submission_count > 0 ? (
                                                <div className="flex flex-col items-center">
                                                    <span className="font-semibold text-slate-900">
                                                        {row.submission_count} / {row.total_rows}
                                                    </span>
                                                    <span className="text-xs text-slate-500">
                                                        ({row.total_rows > 0 ? Math.round((row.submission_count / row.total_rows) * 100) : 0}%)
                                                    </span>
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-3 text-center">
                                            {row.submission_count > 0 ? (
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className={`text-xs font-medium ${row.duplicate_serials > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                        S: {row.duplicate_serials > 0 ? `${row.duplicate_serials} dup` : '✓'}
                                                    </span>
                                                    <span className={`text-xs font-medium ${row.duplicate_tags > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                        T: {row.duplicate_tags > 0 ? `${row.duplicate_tags} dup` : '✓'}
                                                    </span>
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-3 text-center">
                                            {row.submission_count > 0 ? (
                                                <div className="flex flex-col items-center">
                                                    <span className={`font-semibold ${row.tag_pics_available === row.tag_pics_required && row.tag_pics_required > 0 ? 'text-green-600' : row.tag_pics_available < row.tag_pics_required ? 'text-orange-600' : 'text-slate-900'}`}>
                                                        {row.tag_pics_available} / {row.tag_pics_required}
                                                    </span>
                                                    {row.tag_pics_required > 0 && (
                                                        <span className="text-xs text-slate-500">
                                                            ({Math.round((row.tag_pics_available / row.tag_pics_required) * 100)}%)
                                                        </span>
                                                    )}
                                                    {row.tag_pics_available < row.tag_pics_required && (
                                                        <span className="text-xs text-orange-500">
                                                            {row.tag_pics_required - row.tag_pics_available} missing
                                                        </span>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

            </div>
        </main>
    );
}
