'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getParam, setParams } from '@/lib/urlUtils';

// --- Types ---
interface PMRRecord {
    Site_ID_1: string;
    Site_ID: string;
    City: string;
    "FME Name": string;
    "Autual_PMR_Date": string;
    Status: string;
}

interface InventoryUpdate {
    site_id: string;
    updated_at: string;
    nfo_name: string | null;
}

interface NFOPerformanceData {
    fme_name: string;
    city: string;
    total_pmrs: number;
    same_day_submissions: number;
    next_day_submissions: number;
    within_week_submissions: number;
    late_submissions: number;
    no_submission: number;
    avg_days_delay: number;
}

interface WeeklyTrend {
    week_number: number;
    week_label: string;
    start_date: Date;
    end_date: Date;
    total_pmrs: number;
    same_day_count: number;
    next_day_count: number;
    within_week_count: number;
    late_count: number;
    no_submission_count: number;
    same_day_rate: number;
    within_week_rate: number;
    on_time_rate: number;
}

// --- Utility Functions ---
const months: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
};

const parsePMRDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = months[parts[1]];
    const year = 2000 + parseInt(parts[2], 10);
    if (isNaN(day) || month === undefined || isNaN(year)) return null;
    return new Date(year, month, day);
};

const formatDateShort = (date: Date): string => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()}-${monthNames[date.getMonth()]}`;
};

const getWeekNumber = (date: Date): number => {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
};

const getWeekRange = (year: number, weekNum: number): { start: Date; end: Date } => {
    const firstDayOfYear = new Date(year, 0, 1);
    const daysOffset = firstDayOfYear.getDay();
    const firstMonday = new Date(year, 0, 1 + (daysOffset === 0 ? 1 : 8 - daysOffset));
    
    const start = new Date(firstMonday);
    start.setDate(start.getDate() + (weekNum - 1) * 7);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    
    return { start, end };
};

const daysDifference = (date1: Date, date2: Date): number => {
    const diffTime = date2.getTime() - date1.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

// --- Component ---
export default function TrendingView() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // --- URL State ---
    const initialStartDate = getParam(searchParams, 'startDate', '2026-01-01');
    const initialEndDate = getParam(searchParams, 'endDate', '2026-01-31');
    const initialCity = getParam(searchParams, 'city', '');
    const initialNFO = getParam(searchParams, 'nfo', '');

    const [startDate, setStartDateState] = useState<string>(initialStartDate);
    const [endDate, setEndDateState] = useState<string>(initialEndDate);
    const [selectedCity, setSelectedCityState] = useState<string>(initialCity);
    const [selectedNFO, setSelectedNFOState] = useState<string>(initialNFO);

    const [cities, setCities] = useState<string[]>([]);
    const [fmeNames, setFmeNames] = useState<string[]>([]);
    const [cityFmeMap, setCityFmeMap] = useState<Map<string, string[]>>(new Map());

    const [nfoPerformance, setNfoPerformance] = useState<NFOPerformanceData[]>([]);
    const [weeklyTrends, setWeeklyTrends] = useState<WeeklyTrend[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [viewMode, setViewMode] = useState<'table' | 'chart'>('chart');
    const [selectedWeeks, setSelectedWeeks] = useState<number[]>([]);
    const [chartMetric, setChartMetric] = useState<'same_day_rate' | 'on_time_rate'>('same_day_rate');

    const updateUrlParams = useCallback((updates: Record<string, string>) => {
        setParams(router, pathname, searchParams, updates);
    }, [router, pathname, searchParams]);

    const setStartDate = (value: string) => { setStartDateState(value); updateUrlParams({ startDate: value }); };
    const setEndDate = (value: string) => { setEndDateState(value); updateUrlParams({ endDate: value }); };
    const setSelectedCity = (value: string) => { setSelectedCityState(value); updateUrlParams({ city: value }); };
    const setSelectedNFO = (value: string) => { setSelectedNFOState(value); updateUrlParams({ nfo: value }); };

    useEffect(() => {
        const urlStartDate = getParam(searchParams, 'startDate', '2026-01-01');
        const urlEndDate = getParam(searchParams, 'endDate', '2026-01-31');
        const urlCity = getParam(searchParams, 'city', '');
        const urlNFO = getParam(searchParams, 'nfo', '');
        if (urlStartDate !== startDate) setStartDateState(urlStartDate);
        if (urlEndDate !== endDate) setEndDateState(urlEndDate);
        if (urlCity !== selectedCity) setSelectedCityState(urlCity);
        if (urlNFO !== selectedNFO) setSelectedNFOState(urlNFO);
    }, [searchParams]);

    useEffect(() => {
        const fetchFilterOptions = async () => {
            const { data: cityFmeData } = await supabase
                .from('pmr_actual_2026')
                .select('City, "FME Name"')
                .not('City', 'is', null)
                .not('FME Name', 'is', null);

            if (cityFmeData) {
                setCities([...new Set(cityFmeData.map(r => r.City as string))].sort());
                setFmeNames([...new Set(cityFmeData.map(r => r['FME Name'] as string))].sort());
                const mapping = new Map<string, Set<string>>();
                cityFmeData.forEach(row => {
                    const city = row.City as string;
                    const fme = row['FME Name'] as string;
                    if (!mapping.has(city)) mapping.set(city, new Set());
                    mapping.get(city)!.add(fme);
                });
                const finalMap = new Map<string, string[]>();
                mapping.forEach((fmeSet, city) => finalMap.set(city, [...fmeSet].sort()));
                setCityFmeMap(finalMap);
            }
        };
        fetchFilterOptions();
    }, []);

    const filteredFmeNames = selectedCity ? cityFmeMap.get(selectedCity) || [] : fmeNames;

    useEffect(() => {
        if (selectedCity && selectedNFO) {
            const validFMEs = cityFmeMap.get(selectedCity) || [];
            if (!validFMEs.includes(selectedNFO)) setSelectedNFOState('');
        }
    }, [selectedCity, selectedNFO, cityFmeMap]);

    const fetchData = useCallback(async () => {
        if (!startDate || !endDate) return;
        setLoading(true);
        setError(null);

        try {
            const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
            const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
            const startDateObj = new Date(startYear, startMonth - 1, startDay);
            const endDateObj = new Date(endYear, endMonth - 1, endDay);

            let pmrQuery = supabase.from('pmr_actual_2026').select('Site_ID, Site_ID_1, City, "FME Name", "Autual_PMR_Date", Status').not('Autual_PMR_Date', 'is', null);
            if (selectedCity) pmrQuery = pmrQuery.eq('City', selectedCity);
            if (selectedNFO) pmrQuery = pmrQuery.eq('FME Name', selectedNFO);

            const { data: pmrData, error: pmrError } = await pmrQuery;
            if (pmrError) throw pmrError;

            const filteredPMRs = (pmrData || []).filter(p => {
                const date = parsePMRDate(p['Autual_PMR_Date']);
                return date && date >= startDateObj && date <= endDateObj;
            }) as PMRRecord[];

            if (filteredPMRs.length === 0) {
                setNfoPerformance([]); setWeeklyTrends([]); setLoading(false); return;
            }

            const allSiteIds = new Set<string>();
            filteredPMRs.forEach(p => {
                if (p.Site_ID_1) allSiteIds.add(p.Site_ID_1);
                if (p.Site_ID) allSiteIds.add(p.Site_ID);
                if (p.Site_ID && !p.Site_ID.startsWith('W')) allSiteIds.add(`W${p.Site_ID}`);
                if (p.Site_ID_1 && p.Site_ID_1.startsWith('W')) allSiteIds.add(p.Site_ID_1.substring(1));
            });

            const siteIdArray = Array.from(allSiteIds);
            const BATCH_SIZE = 100, PAGE_SIZE = 1000;
            const batches: string[][] = [];
            for (let i = 0; i < siteIdArray.length; i += BATCH_SIZE) batches.push(siteIdArray.slice(i, i + BATCH_SIZE));

            const fetchBatch = async (batch: string[]): Promise<InventoryUpdate[]> => {
                const results: InventoryUpdate[] = [];
                let hasMore = true, offset = 0;
                while (hasMore) {
                    const { data, error } = await supabase.from('main_inventory').select('site_id, updated_at, nfo_name').in('site_id', batch).range(offset, offset + PAGE_SIZE - 1);
                    if (error) throw new Error(error.message);
                    if (data && data.length > 0) { results.push(...(data as InventoryUpdate[])); offset += PAGE_SIZE; hasMore = data.length === PAGE_SIZE; }
                    else hasMore = false;
                }
                return results;
            };

            const inventoryData = (await Promise.all(batches.map(fetchBatch))).flat();
            const inventoryBySite = new Map<string, { earliest: Date | null; latest: Date | null }>();
            inventoryData.forEach(row => {
                const updateDate = row.updated_at ? new Date(row.updated_at) : null;
                if (!inventoryBySite.has(row.site_id)) inventoryBySite.set(row.site_id, { earliest: updateDate, latest: updateDate });
                else {
                    const existing = inventoryBySite.get(row.site_id)!;
                    if (updateDate) {
                        if (!existing.earliest || updateDate < existing.earliest) existing.earliest = updateDate;
                        if (!existing.latest || updateDate > existing.latest) existing.latest = updateDate;
                    }
                }
            });

            const findInventoryForSite = (siteId1: string, siteId: string) => {
                if (siteId1 && inventoryBySite.has(siteId1)) return inventoryBySite.get(siteId1);
                if (siteId && inventoryBySite.has(siteId)) return inventoryBySite.get(siteId);
                if (siteId && !siteId.startsWith('W') && inventoryBySite.has(`W${siteId}`)) return inventoryBySite.get(`W${siteId}`);
                if (siteId1 && siteId1.startsWith('W') && inventoryBySite.has(siteId1.substring(1))) return inventoryBySite.get(siteId1.substring(1));
                return null;
            };

            const nfoMap = new Map<string, NFOPerformanceData>();
            const weekMap = new Map<number, WeeklyTrend>();

            filteredPMRs.forEach(pmr => {
                const fmeName = pmr['FME Name'] || 'Unknown';
                const city = pmr.City || 'Unknown';
                const pmrDate = parsePMRDate(pmr['Autual_PMR_Date']);
                if (!pmrDate) return;

                if (!nfoMap.has(fmeName)) nfoMap.set(fmeName, { fme_name: fmeName, city, total_pmrs: 0, same_day_submissions: 0, next_day_submissions: 0, within_week_submissions: 0, late_submissions: 0, no_submission: 0, avg_days_delay: 0 });
                const nfoData = nfoMap.get(fmeName)!;
                nfoData.total_pmrs++;

                const weekNum = getWeekNumber(pmrDate);
                if (!weekMap.has(weekNum)) {
                    const { start, end } = getWeekRange(2026, weekNum);
                    weekMap.set(weekNum, { week_number: weekNum, week_label: `Week ${weekNum}`, start_date: start, end_date: end, total_pmrs: 0, same_day_count: 0, next_day_count: 0, within_week_count: 0, late_count: 0, no_submission_count: 0, same_day_rate: 0, within_week_rate: 0, on_time_rate: 0 });
                }
                const weekData = weekMap.get(weekNum)!;
                weekData.total_pmrs++;

                const siteInv = findInventoryForSite(pmr.Site_ID_1, pmr.Site_ID);
                const submissionDate = siteInv?.latest || null;

                if (submissionDate) {
                    const daysDelay = daysDifference(pmrDate, submissionDate);
                    if (daysDelay <= 0) { nfoData.same_day_submissions++; weekData.same_day_count++; }
                    else if (daysDelay === 1) { nfoData.next_day_submissions++; weekData.next_day_count++; }
                    else if (daysDelay <= 7) { nfoData.within_week_submissions++; weekData.within_week_count++; }
                    else { nfoData.late_submissions++; weekData.late_count++; }
                } else { nfoData.no_submission++; weekData.no_submission_count++; }
            });

            weekMap.forEach(week => {
                if (week.total_pmrs > 0) {
                    week.same_day_rate = (week.same_day_count / week.total_pmrs) * 100;
                    week.on_time_rate = ((week.same_day_count + week.next_day_count + week.within_week_count) / week.total_pmrs) * 100;
                    week.within_week_rate = week.on_time_rate;
                }
            });

            setNfoPerformance(Array.from(nfoMap.values()).sort((a, b) => b.total_pmrs - a.total_pmrs));
            setWeeklyTrends(Array.from(weekMap.values()).sort((a, b) => a.week_number - b.week_number));
            setSelectedWeeks(Array.from(weekMap.keys()).sort((a, b) => a - b));
        } catch (err) {
            console.error('Error:', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch data');
        } finally { setLoading(false); }
    }, [startDate, endDate, selectedCity, selectedNFO]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const toggleWeekSelection = (weekNum: number) => setSelectedWeeks(prev => prev.includes(weekNum) ? prev.filter(w => w !== weekNum) : [...prev, weekNum].sort((a, b) => a - b));

    const summaryStats = useMemo(() => {
        const total = nfoPerformance.reduce((s, n) => s + n.total_pmrs, 0);
        const sameDay = nfoPerformance.reduce((s, n) => s + n.same_day_submissions, 0);
        const nextDay = nfoPerformance.reduce((s, n) => s + n.next_day_submissions, 0);
        const withinWeek = nfoPerformance.reduce((s, n) => s + n.within_week_submissions, 0);
        const late = nfoPerformance.reduce((s, n) => s + n.late_submissions, 0);
        const noSubmission = nfoPerformance.reduce((s, n) => s + n.no_submission, 0);
        return { total, sameDay, nextDay, withinWeek, late, noSubmission, sameDayRate: total > 0 ? (sameDay / total) * 100 : 0, onTimeRate: total > 0 ? ((sameDay + nextDay + withinWeek) / total) * 100 : 0 };
    }, [nfoPerformance]);

    const selectedWeeksData = useMemo(() => weeklyTrends.filter(w => selectedWeeks.includes(w.week_number)), [weeklyTrends, selectedWeeks]);

    const weekChanges = useMemo(() => {
        if (selectedWeeksData.length < 2) return [];
        return selectedWeeksData.slice(1).map((week, idx) => {
            const prevWeek = selectedWeeksData[idx];
            return { from: prevWeek.week_label, to: week.week_label, sameDayChange: week.same_day_rate - prevWeek.same_day_rate, onTimeChange: week.on_time_rate - prevWeek.on_time_rate };
        });
    }, [selectedWeeksData]);

    const getMetricLabel = (metric: string) => metric === 'same_day_rate' ? 'Same Day Rate' : 'On-Time Rate (≤7 days)';

    return (
        <div className="min-h-screen bg-slate-50 pb-10">
            <div className="bg-white border-b border-slate-200 py-4 px-4 sm:px-6 mb-6">
                <div className="max-w-screen-2xl mx-auto">
                    <h2 className="text-xl font-semibold text-slate-900">NFO Performance Trending</h2>
                    <p className="text-sm text-slate-500 mt-1">Track submission timing trends across weeks</p>
                </div>
            </div>

            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">City</label>
                            <select value={selectedCity} onChange={(e) => setSelectedCity(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">All Cities</option>
                                {cities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">NFO</label>
                            <select value={selectedNFO} onChange={(e) => setSelectedNFO(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                <option value="">All NFOs</option>
                                {filteredFmeNames.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                {loading && <div className="flex justify-center items-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div><span className="ml-3 text-slate-600">Loading...</span></div>}
                {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6"><p className="text-red-800">{error}</p></div>}
                {!loading && !error && nfoPerformance.length === 0 && <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-10 text-center"><p className="text-slate-500">No data found.</p></div>}

                {!loading && nfoPerformance.length > 0 && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4"><p className="text-sm text-slate-500">Total PMRs</p><p className="text-2xl font-bold text-slate-900">{summaryStats.total}</p></div>
                            <div className="bg-green-50 rounded-lg shadow-sm border border-green-200 p-4"><p className="text-sm text-green-700">Same Day</p><p className="text-2xl font-bold text-green-800">{summaryStats.sameDay}</p><p className="text-xs text-green-600">{summaryStats.sameDayRate.toFixed(1)}%</p></div>
                            <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200 p-4"><p className="text-sm text-blue-700">Next Day</p><p className="text-2xl font-bold text-blue-800">{summaryStats.nextDay}</p></div>
                            <div className="bg-yellow-50 rounded-lg shadow-sm border border-yellow-200 p-4"><p className="text-sm text-yellow-700">Within Week</p><p className="text-2xl font-bold text-yellow-800">{summaryStats.withinWeek}</p></div>
                            <div className="bg-orange-50 rounded-lg shadow-sm border border-orange-200 p-4"><p className="text-sm text-orange-700">Late (&gt;7 days)</p><p className="text-2xl font-bold text-orange-800">{summaryStats.late}</p></div>
                            <div className="bg-red-50 rounded-lg shadow-sm border border-red-200 p-4"><p className="text-sm text-red-700">Not Submitted</p><p className="text-2xl font-bold text-red-800">{summaryStats.noSubmission}</p></div>
                        </div>

                        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow-lg p-6 mb-6 text-white">
                            <div className="flex items-center justify-between">
                                <div><p className="text-blue-100 text-sm">Overall On-Time Rate (≤7 days)</p><p className="text-4xl font-bold">{summaryStats.onTimeRate.toFixed(1)}%</p></div>
                                <div className="text-right"><p className="text-blue-100 text-sm">Same Day Rate</p><p className="text-2xl font-semibold">{summaryStats.sameDayRate.toFixed(1)}%</p></div>
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-6">
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex rounded-lg overflow-hidden border border-slate-300">
                                        <button onClick={() => setViewMode('chart')} className={`px-4 py-2 text-sm font-medium ${viewMode === 'chart' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>📈 Chart</button>
                                        <button onClick={() => setViewMode('table')} className={`px-4 py-2 text-sm font-medium ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>📊 Table</button>
                                    </div>
                                    {viewMode === 'chart' && <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value as 'same_day_rate' | 'on_time_rate')} className="px-3 py-2 border border-slate-300 rounded-md text-sm"><option value="same_day_rate">Same Day Rate</option><option value="on_time_rate">On-Time Rate (≤7 days)</option></select>}
                                </div>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-slate-700 mb-2">Select weeks to compare:</p>
                                <div className="flex flex-wrap gap-2">
                                    {weeklyTrends.map(week => <button key={week.week_number} onClick={() => toggleWeekSelection(week.week_number)} className={`px-3 py-1.5 text-sm rounded-full transition-colors ${selectedWeeks.includes(week.week_number) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{week.week_label}</button>)}
                                    <button onClick={() => setSelectedWeeks(weeklyTrends.map(w => w.week_number))} className="px-3 py-1.5 text-sm rounded-full bg-slate-700 text-white hover:bg-slate-800">Select All</button>
                                    <button onClick={() => setSelectedWeeks([])} className="px-3 py-1.5 text-sm rounded-full bg-slate-300 text-slate-700 hover:bg-slate-400">Clear</button>
                                </div>
                            </div>
                        </div>

                        {viewMode === 'chart' && selectedWeeksData.length > 0 && (
                            <div className="space-y-6">
                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Weekly {getMetricLabel(chartMetric)} Trend</h3>
                                    <div className="relative" style={{ height: '320px' }}>
                                        <svg className="w-full h-full" viewBox="0 0 800 320" preserveAspectRatio="xMidYMid meet">
                                            <defs><linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0.05" /></linearGradient></defs>
                                            {[0, 25, 50, 75, 100].map(val => <g key={val}><line x1="60" y1={260 - val * 2.2} x2="780" y2={260 - val * 2.2} stroke="#e2e8f0" strokeWidth="1" /><text x="50" y={265 - val * 2.2} textAnchor="end" className="text-xs fill-slate-500">{val}%</text></g>)}
                                            {selectedWeeksData.length > 1 && <path d={`M ${60} ${260 - selectedWeeksData[0][chartMetric] * 2.2} ${selectedWeeksData.map((week, i) => `L ${60 + (i / (selectedWeeksData.length - 1)) * 720} ${260 - week[chartMetric] * 2.2}`).join(' ')} L ${780} 260 L 60 260 Z`} fill="url(#areaGradient)" />}
                                            {selectedWeeksData.length > 1 && <path d={selectedWeeksData.map((week, i) => `${i === 0 ? 'M' : 'L'} ${60 + (i / (selectedWeeksData.length - 1)) * 720} ${260 - week[chartMetric] * 2.2}`).join(' ')} fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
                                            {selectedWeeksData.map((week, i) => {
                                                const x = selectedWeeksData.length === 1 ? 420 : 60 + (i / (selectedWeeksData.length - 1)) * 720;
                                                const y = 260 - week[chartMetric] * 2.2;
                                                return <g key={week.week_number}><circle cx={x} cy={y} r="8" fill="#3b82f6" stroke="white" strokeWidth="3" /><text x={x} y={y - 15} textAnchor="middle" className="text-sm font-bold fill-slate-700">{week[chartMetric].toFixed(1)}%</text><text x={x} y={285} textAnchor="middle" className="text-xs fill-slate-600">{week.week_label}</text><text x={x} y={300} textAnchor="middle" className="text-xs fill-slate-400">({week.total_pmrs})</text></g>;
                                            })}
                                        </svg>
                                    </div>
                                </div>

                                {weekChanges.length > 0 && (
                                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Week-over-Week Change</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {weekChanges.map((change, idx) => (
                                                <div key={idx} className="bg-slate-50 rounded-lg p-4">
                                                    <p className="text-sm text-slate-600 mb-2">{change.from} → {change.to}</p>
                                                    <div className="flex items-center gap-4">
                                                        <div><p className="text-xs text-slate-500">Same Day</p><p className={`text-lg font-bold ${change.sameDayChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change.sameDayChange >= 0 ? '↑' : '↓'} {Math.abs(change.sameDayChange).toFixed(1)}%</p></div>
                                                        <div><p className="text-xs text-slate-500">On-Time</p><p className={`text-lg font-bold ${change.onTimeChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change.onTimeChange >= 0 ? '↑' : '↓'} {Math.abs(change.onTimeChange).toFixed(1)}%</p></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Week Comparison</h3>
                                    <div className="space-y-4">
                                        {selectedWeeksData.map((week, idx) => (
                                            <div key={week.week_number} className="flex items-center gap-4">
                                                <div className="w-20 text-sm font-medium text-slate-700">{week.week_label}</div>
                                                <div className="flex-1"><div className="h-8 bg-slate-100 rounded-full overflow-hidden relative"><div className="absolute h-full bg-blue-200 rounded-full" style={{ width: `${week.on_time_rate}%` }} /><div className="absolute h-full rounded-full" style={{ width: `${week.same_day_rate}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} /></div></div>
                                                <div className="w-32 text-right"><span className="text-sm font-bold" style={{ color: CHART_COLORS[idx % CHART_COLORS.length] }}>{week.same_day_rate.toFixed(1)}%</span><span className="text-slate-400 mx-1">/</span><span className="text-sm text-blue-600">{week.on_time_rate.toFixed(1)}%</span></div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4 flex gap-6 text-sm"><div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-500 rounded"></div><span>Same Day</span></div><div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-200 rounded"></div><span>On-Time (≤7 days)</span></div></div>
                                </div>
                            </div>
                        )}

                        {viewMode === 'table' && (
                            <div className="space-y-6">
                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-50 border-b"><h3 className="text-lg font-semibold text-slate-900">Weekly Performance</h3></div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200">
                                            <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Week</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date Range</th><th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">PMRs</th><th className="px-4 py-3 text-center text-xs font-medium text-green-700 uppercase bg-green-50">Same Day</th><th className="px-4 py-3 text-center text-xs font-medium text-blue-700 uppercase bg-blue-50">Next Day</th><th className="px-4 py-3 text-center text-xs font-medium text-yellow-700 uppercase bg-yellow-50">Within Week</th><th className="px-4 py-3 text-center text-xs font-medium text-orange-700 uppercase bg-orange-50">Late</th><th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">On-Time %</th></tr></thead>
                                            <tbody className="divide-y divide-slate-200">{weeklyTrends.map((week, idx) => <tr key={week.week_number} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}><td className="px-4 py-3 text-sm font-medium text-slate-900">{week.week_label}</td><td className="px-4 py-3 text-sm text-slate-600">{formatDateShort(week.start_date)} - {formatDateShort(week.end_date)}</td><td className="px-4 py-3 text-sm text-center font-semibold">{week.total_pmrs}</td><td className="px-4 py-3 text-sm text-center bg-green-50"><span className="text-green-700 font-medium">{week.same_day_count}</span><span className="text-green-500 text-xs ml-1">({week.same_day_rate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-blue-50 text-blue-700">{week.next_day_count}</td><td className="px-4 py-3 text-sm text-center bg-yellow-50 text-yellow-700">{week.within_week_count}</td><td className="px-4 py-3 text-sm text-center bg-orange-50 text-orange-700">{week.late_count}</td><td className="px-4 py-3 text-center"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${week.on_time_rate >= 80 ? 'bg-green-100 text-green-800' : week.on_time_rate >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{week.on_time_rate.toFixed(1)}%</span></td></tr>)}</tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-50 border-b"><h3 className="text-lg font-semibold text-slate-900">NFO Performance</h3></div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200">
                                            <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">NFO</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">City</th><th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">PMRs</th><th className="px-4 py-3 text-center text-xs font-medium text-green-700 uppercase bg-green-50">Same Day</th><th className="px-4 py-3 text-center text-xs font-medium text-blue-700 uppercase bg-blue-50">Next Day</th><th className="px-4 py-3 text-center text-xs font-medium text-yellow-700 uppercase bg-yellow-50">Within Week</th><th className="px-4 py-3 text-center text-xs font-medium text-orange-700 uppercase bg-orange-50">Late</th><th className="px-4 py-3 text-center text-xs font-medium text-red-700 uppercase bg-red-50">No Submit</th><th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">On-Time %</th></tr></thead>
                                            <tbody className="divide-y divide-slate-200">{nfoPerformance.map((nfo, idx) => { const onTimeRate = nfo.total_pmrs > 0 ? ((nfo.same_day_submissions + nfo.next_day_submissions + nfo.within_week_submissions) / nfo.total_pmrs) * 100 : 0; return <tr key={nfo.fme_name} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}><td className="px-4 py-3 text-sm font-medium text-slate-900">{nfo.fme_name}</td><td className="px-4 py-3 text-sm text-slate-600">{nfo.city}</td><td className="px-4 py-3 text-sm text-center font-semibold">{nfo.total_pmrs}</td><td className="px-4 py-3 text-sm text-center bg-green-50 text-green-700 font-medium">{nfo.same_day_submissions}</td><td className="px-4 py-3 text-sm text-center bg-blue-50 text-blue-700">{nfo.next_day_submissions}</td><td className="px-4 py-3 text-sm text-center bg-yellow-50 text-yellow-700">{nfo.within_week_submissions}</td><td className="px-4 py-3 text-sm text-center bg-orange-50 text-orange-700">{nfo.late_submissions}</td><td className="px-4 py-3 text-sm text-center bg-red-50 text-red-700">{nfo.no_submission}</td><td className="px-4 py-3 text-center"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${onTimeRate >= 80 ? 'bg-green-100 text-green-800' : onTimeRate >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{onTimeRate.toFixed(1)}%</span></td></tr>; })}</tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
