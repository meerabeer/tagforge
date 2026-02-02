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

interface InventoryRow {
    site_id: string;
    updated_at: string | null;
    tag_category: string | null;
    photo_category: string | null;
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
    next_day_rate: number;
    within_week_rate: number;
}

// Weekly trend by Area or NFO
interface EntityWeeklyTrend {
    entity_name: string; // City name or NFO name
    entity_type: 'area' | 'nfo';
    weeks: Map<number, {
        week_number: number;
        total_pmrs: number;
        same_day_count: number;
        next_day_count: number;
        within_week_count: number;
        late_count: number;
        no_submission_count: number;
        same_day_rate: number;
        within_week_rate: number;
    }>;
    // Aggregated performance
    total_pmrs: number;
    avg_same_day_rate: number;
    avg_within_week_rate: number;
    performance_status: 'excellent' | 'good' | 'needs_improvement' | 'problematic';
}

// Performance thresholds
const PERFORMANCE_THRESHOLDS = {
    excellent: { same_day: 80, within_week: 95 },     // ≥80% same day OR ≥95% within week
    good: { same_day: 60, within_week: 85 },          // ≥60% same day OR ≥85% within week  
    needs_improvement: { same_day: 40, within_week: 70 }, // ≥40% same day OR ≥70% within week
    // Below needs_improvement = problematic
};

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

// Get week number based on Monday-start weeks (consistent with getWeekRange)
const getWeekNumber = (date: Date): number => {
    const year = date.getFullYear();
    const firstDayOfYear = new Date(year, 0, 1);
    const daysOffset = firstDayOfYear.getDay();
    // First Monday of the year (for 2026, Jan 1 is Thursday, so first Monday is Jan 5)
    const firstMonday = new Date(year, 0, 1 + (daysOffset === 0 ? 1 : 8 - daysOffset));
    
    // If date is before first Monday, return 0 (will be filtered/handled separately)
    if (date < firstMonday) {
        return 0;
    }
    
    const daysSinceFirstMonday = Math.floor((date.getTime() - firstMonday.getTime()) / 86400000);
    return Math.floor(daysSinceFirstMonday / 7) + 1;
};

const getWeekRange = (year: number, weekNum: number): { start: Date; end: Date } => {
    const firstDayOfYear = new Date(year, 0, 1);
    const daysOffset = firstDayOfYear.getDay();
    const firstMonday = new Date(year, 0, 1 + (daysOffset === 0 ? 1 : 8 - daysOffset));
    
    // Week 0 is Jan 1 to day before first Monday
    if (weekNum === 0) {
        return { 
            start: firstDayOfYear, 
            end: new Date(firstMonday.getTime() - 86400000) // Day before first Monday
        };
    }
    
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

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#64748b'];

const getPerformanceStatus = (sameDayRate: number, withinWeekRate: number): 'excellent' | 'good' | 'needs_improvement' | 'problematic' => {
    if (sameDayRate >= PERFORMANCE_THRESHOLDS.excellent.same_day || withinWeekRate >= PERFORMANCE_THRESHOLDS.excellent.within_week) return 'excellent';
    if (sameDayRate >= PERFORMANCE_THRESHOLDS.good.same_day || withinWeekRate >= PERFORMANCE_THRESHOLDS.good.within_week) return 'good';
    if (sameDayRate >= PERFORMANCE_THRESHOLDS.needs_improvement.same_day || withinWeekRate >= PERFORMANCE_THRESHOLDS.needs_improvement.within_week) return 'needs_improvement';
    return 'problematic';
};

const getStatusColor = (status: string) => {
    switch (status) {
        case 'excellent': return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' };
        case 'good': return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' };
        case 'needs_improvement': return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' };
        case 'problematic': return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' };
        default: return { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' };
    }
};

const getStatusLabel = (status: string) => {
    switch (status) {
        case 'excellent': return '🌟 Excellent';
        case 'good': return '✅ Good';
        case 'needs_improvement': return '⚠️ Needs Improvement';
        case 'problematic': return '🔴 Problematic';
        default: return status;
    }
};

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
    const [chartMetric, setChartMetric] = useState<'same_day_rate' | 'within_week_rate'>('same_day_rate');

    // New: Entity-wise trending data
    const [areaWeeklyTrends, setAreaWeeklyTrends] = useState<EntityWeeklyTrend[]>([]);
    const [nfoWeeklyTrends, setNfoWeeklyTrends] = useState<EntityWeeklyTrend[]>([]);
    
    // Slicer selections for chart
    const [selectedAreasForChart, setSelectedAreasForChart] = useState<string[]>([]);
    const [selectedNFOsForChart, setSelectedNFOsForChart] = useState<string[]>([]);
    const [chartViewMode, setChartViewMode] = useState<'overall' | 'area' | 'nfo' | 'comparison'>('overall');
    const [performanceFilter, setPerformanceFilter] = useState<'all' | 'excellent' | 'good' | 'needs_improvement' | 'problematic'>('all');
    
    // Highlighted entity for focus (when clicking legend or slicer)
    const [highlightedEntity, setHighlightedEntity] = useState<string | null>(null);

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

            // 1. Fetch PMR records with Actual Date in range
            let pmrQuery = supabase.from('pmr_actual_2026').select('Site_ID, Site_ID_1, City, "FME Name", "Autual_PMR_Date", Status').not('Autual_PMR_Date', 'is', null);
            if (selectedCity) pmrQuery = pmrQuery.eq('City', selectedCity);
            if (selectedNFO) pmrQuery = pmrQuery.eq('FME Name', selectedNFO);

            const { data: pmrData, error: pmrError } = await pmrQuery;
            if (pmrError) throw pmrError;

            // Filter by actual date range (matching NFO Performance logic)
            const filteredPMRs = (pmrData || []).filter(p => {
                const date = parsePMRDate(p['Autual_PMR_Date']);
                return date && date >= startDateObj && date <= endDateObj;
            }) as PMRRecord[];

            if (filteredPMRs.length === 0) {
                setNfoPerformance([]); setWeeklyTrends([]); setAreaWeeklyTrends([]); setNfoWeeklyTrends([]); setLoading(false); return;
            }

            // 2. Collect site IDs (use W-format to match inventory)
            const allSiteIds = new Set<string>();
            filteredPMRs.forEach(p => {
                if (p.Site_ID_1) allSiteIds.add(p.Site_ID_1);
                if (p.Site_ID && !p.Site_ID.startsWith('W')) allSiteIds.add(`W${p.Site_ID}`);
            });

            const siteIdArray = Array.from(allSiteIds);
            const BATCH_SIZE = 100, PAGE_SIZE = 1000;
            const batches: string[][] = [];
            for (let i = 0; i < siteIdArray.length; i += BATCH_SIZE) batches.push(siteIdArray.slice(i, i + BATCH_SIZE));

            // 3. Fetch inventory rows with tag_category & photo_category (matching NFO Performance)
            const fetchBatch = async (batch: string[]): Promise<InventoryRow[]> => {
                const results: InventoryRow[] = [];
                let hasMore = true, offset = 0;
                while (hasMore) {
                    const { data, error } = await supabase
                        .from('main_inventory')
                        .select('site_id, updated_at, tag_category, photo_category')
                        .in('site_id', batch)
                        .range(offset, offset + PAGE_SIZE - 1);
                    if (error) throw new Error(error.message);
                    if (data && data.length > 0) { 
                        results.push(...(data as InventoryRow[])); 
                        offset += PAGE_SIZE; 
                        hasMore = data.length === PAGE_SIZE; 
                    } else hasMore = false;
                }
                return results;
            };

            const inventoryData = (await Promise.all(batches.map(fetchBatch))).flat();
            
            // 4. Group inventory by site and calculate completion
            // Submission = 100% complete (ALL rows have both tag_category AND photo_category)
            const siteSubmissionMap = new Map<string, { isSubmitted: boolean; latestUpdateDate: Date | null }>();
            
            // Group rows by site
            const rowsBySite = new Map<string, InventoryRow[]>();
            inventoryData.forEach(row => {
                if (!rowsBySite.has(row.site_id)) rowsBySite.set(row.site_id, []);
                rowsBySite.get(row.site_id)!.push(row);
            });
            
            // Calculate submission status per site (matching NFO Performance: >10% completion = submitted)
            rowsBySite.forEach((rows, siteId) => {
                const totalRows = rows.length;
                const filledRows = rows.filter(r => r.tag_category && r.photo_category);
                const completionPct = totalRows > 0 ? (filledRows.length / totalRows) * 100 : 0;
                const isSubmitted = completionPct > 10; // Match NFO Performance logic
                
                // Get latest updated_at from filled rows only if submitted
                let latestUpdateDate: Date | null = null;
                if (isSubmitted && filledRows.length > 0) {
                    filledRows.forEach(r => {
                        if (r.updated_at) {
                            const d = new Date(r.updated_at);
                            if (!latestUpdateDate || d > latestUpdateDate) latestUpdateDate = d;
                        }
                    });
                }
                
                siteSubmissionMap.set(siteId, { isSubmitted, latestUpdateDate });
            });

            // Helper to find submission for a site
            const findSubmissionForSite = (siteId1: string, siteId: string) => {
                const wId = siteId1 || (siteId && !siteId.startsWith('W') ? `W${siteId}` : siteId);
                if (wId && siteSubmissionMap.has(wId)) return siteSubmissionMap.get(wId);
                return null;
            };

            // 5. Process each PMR and calculate timing
            const nfoMap = new Map<string, NFOPerformanceData>();
            const weekMap = new Map<number, WeeklyTrend>();
            
            // New: Track weekly data by Area and NFO
            const areaWeekMap = new Map<string, Map<number, { total: number; same_day: number; next_day: number; within_week: number; late: number; no_submission: number }>>();
            const nfoWeekMap = new Map<string, { city: string; weeks: Map<number, { total: number; same_day: number; next_day: number; within_week: number; late: number; no_submission: number }> }>();

            filteredPMRs.forEach(pmr => {
                const fmeName = pmr['FME Name'] || 'Unknown';
                const city = pmr.City || 'Unknown';
                const pmrDate = parsePMRDate(pmr['Autual_PMR_Date']);
                if (!pmrDate) return;

                // Initialize NFO data
                if (!nfoMap.has(fmeName)) {
                    nfoMap.set(fmeName, { 
                        fme_name: fmeName, 
                        city, 
                        total_pmrs: 0, 
                        same_day_submissions: 0, 
                        next_day_submissions: 0,
                        within_week_submissions: 0, 
                        late_submissions: 0, 
                        no_submission: 0 
                    });
                }
                const nfoData = nfoMap.get(fmeName)!;
                nfoData.total_pmrs++;

                // Initialize week data
                const weekNum = getWeekNumber(pmrDate);
                if (!weekMap.has(weekNum)) {
                    const { start, end } = getWeekRange(2026, weekNum);
                    weekMap.set(weekNum, { 
                        week_number: weekNum, 
                        week_label: weekNum === 0 ? 'Pre-Week' : `Week ${weekNum}`, 
                        start_date: start, 
                        end_date: end, 
                        total_pmrs: 0, 
                        same_day_count: 0, 
                        next_day_count: 0,
                        within_week_count: 0, 
                        late_count: 0, 
                        no_submission_count: 0, 
                        same_day_rate: 0, 
                        next_day_rate: 0,
                        within_week_rate: 0 
                    });
                }
                const weekData = weekMap.get(weekNum)!;
                weekData.total_pmrs++;

                // Check submission status
                const siteSubmission = findSubmissionForSite(pmr.Site_ID_1, pmr.Site_ID);
                
                // Determine submission category
                let submissionCategory: 'same_day' | 'next_day' | 'within_week' | 'late' | 'no_submission' = 'no_submission';
                
                if (siteSubmission?.isSubmitted && siteSubmission.latestUpdateDate) {
                    // Site is submitted - calculate delay
                    const daysDelay = daysDifference(pmrDate, siteSubmission.latestUpdateDate);
                    
                    if (daysDelay <= 0) { 
                        submissionCategory = 'same_day';
                        nfoData.same_day_submissions++; 
                        weekData.same_day_count++; 
                    } else if (daysDelay === 1) { 
                        submissionCategory = 'next_day';
                        nfoData.next_day_submissions++; 
                        weekData.next_day_count++; 
                    } else if (daysDelay <= 7) { 
                        submissionCategory = 'within_week';
                        nfoData.within_week_submissions++; 
                        weekData.within_week_count++; 
                    } else { 
                        submissionCategory = 'late';
                        nfoData.late_submissions++; 
                        weekData.late_count++; 
                    }
                } else { 
                    nfoData.no_submission++; 
                    weekData.no_submission_count++; 
                }
                
                // Track by Area (City)
                if (!areaWeekMap.has(city)) {
                    areaWeekMap.set(city, new Map());
                }
                const areaWeeks = areaWeekMap.get(city)!;
                if (!areaWeeks.has(weekNum)) {
                    areaWeeks.set(weekNum, { total: 0, same_day: 0, next_day: 0, within_week: 0, late: 0, no_submission: 0 });
                }
                const areaWeekData = areaWeeks.get(weekNum)!;
                areaWeekData.total++;
                if (submissionCategory === 'same_day') areaWeekData.same_day++;
                else if (submissionCategory === 'next_day') areaWeekData.next_day++;
                else if (submissionCategory === 'within_week') areaWeekData.within_week++;
                else if (submissionCategory === 'late') areaWeekData.late++;
                else areaWeekData.no_submission++;
                
                // Track by NFO
                if (!nfoWeekMap.has(fmeName)) {
                    nfoWeekMap.set(fmeName, { city, weeks: new Map() });
                }
                const nfoWeeks = nfoWeekMap.get(fmeName)!;
                if (!nfoWeeks.weeks.has(weekNum)) {
                    nfoWeeks.weeks.set(weekNum, { total: 0, same_day: 0, next_day: 0, within_week: 0, late: 0, no_submission: 0 });
                }
                const nfoWeekData = nfoWeeks.weeks.get(weekNum)!;
                nfoWeekData.total++;
                if (submissionCategory === 'same_day') nfoWeekData.same_day++;
                else if (submissionCategory === 'next_day') nfoWeekData.next_day++;
                else if (submissionCategory === 'within_week') nfoWeekData.within_week++;
                else if (submissionCategory === 'late') nfoWeekData.late++;
                else nfoWeekData.no_submission++;
            });

            // 6. Calculate rates
            weekMap.forEach(week => {
                if (week.total_pmrs > 0) {
                    week.same_day_rate = (week.same_day_count / week.total_pmrs) * 100;
                    week.next_day_rate = (week.next_day_count / week.total_pmrs) * 100;
                    // within_week_rate is cumulative: same_day + next_day + within_week (2-7)
                    week.within_week_rate = ((week.same_day_count + week.next_day_count + week.within_week_count) / week.total_pmrs) * 100;
                }
            });

            // 7. Build Area-wise weekly trends with performance status
            const areaEntityTrends: EntityWeeklyTrend[] = [];
            areaWeekMap.forEach((weeks, areaName) => {
                const entityWeeks = new Map<number, { week_number: number; total_pmrs: number; same_day_count: number; next_day_count: number; within_week_count: number; late_count: number; no_submission_count: number; same_day_rate: number; within_week_rate: number }>();
                let totalPmrs = 0, totalSameDay = 0, totalNextDay = 0, totalWithinWeek = 0;
                
                weeks.forEach((data, weekNum) => {
                    const sameDayRate = data.total > 0 ? (data.same_day / data.total) * 100 : 0;
                    const withinWeekRate = data.total > 0 ? ((data.same_day + data.next_day + data.within_week) / data.total) * 100 : 0;
                    entityWeeks.set(weekNum, {
                        week_number: weekNum,
                        total_pmrs: data.total,
                        same_day_count: data.same_day,
                        next_day_count: data.next_day,
                        within_week_count: data.within_week,
                        late_count: data.late,
                        no_submission_count: data.no_submission,
                        same_day_rate: sameDayRate,
                        within_week_rate: withinWeekRate
                    });
                    totalPmrs += data.total;
                    totalSameDay += data.same_day;
                    totalNextDay += data.next_day;
                    totalWithinWeek += data.within_week;
                });
                
                const avgSameDayRate = totalPmrs > 0 ? (totalSameDay / totalPmrs) * 100 : 0;
                const avgWithinWeekRate = totalPmrs > 0 ? ((totalSameDay + totalNextDay + totalWithinWeek) / totalPmrs) * 100 : 0;
                
                areaEntityTrends.push({
                    entity_name: areaName,
                    entity_type: 'area',
                    weeks: entityWeeks,
                    total_pmrs: totalPmrs,
                    avg_same_day_rate: avgSameDayRate,
                    avg_within_week_rate: avgWithinWeekRate,
                    performance_status: getPerformanceStatus(avgSameDayRate, avgWithinWeekRate)
                });
            });
            
            // 8. Build NFO-wise weekly trends with performance status
            const nfoEntityTrends: EntityWeeklyTrend[] = [];
            nfoWeekMap.forEach((nfoData, nfoName) => {
                const entityWeeks = new Map<number, { week_number: number; total_pmrs: number; same_day_count: number; next_day_count: number; within_week_count: number; late_count: number; no_submission_count: number; same_day_rate: number; within_week_rate: number }>();
                let totalPmrs = 0, totalSameDay = 0, totalNextDay = 0, totalWithinWeek = 0;
                
                nfoData.weeks.forEach((data, weekNum) => {
                    const sameDayRate = data.total > 0 ? (data.same_day / data.total) * 100 : 0;
                    const withinWeekRate = data.total > 0 ? ((data.same_day + data.next_day + data.within_week) / data.total) * 100 : 0;
                    entityWeeks.set(weekNum, {
                        week_number: weekNum,
                        total_pmrs: data.total,
                        same_day_count: data.same_day,
                        next_day_count: data.next_day,
                        within_week_count: data.within_week,
                        late_count: data.late,
                        no_submission_count: data.no_submission,
                        same_day_rate: sameDayRate,
                        within_week_rate: withinWeekRate
                    });
                    totalPmrs += data.total;
                    totalSameDay += data.same_day;
                    totalNextDay += data.next_day;
                    totalWithinWeek += data.within_week;
                });
                
                const avgSameDayRate = totalPmrs > 0 ? (totalSameDay / totalPmrs) * 100 : 0;
                const avgWithinWeekRate = totalPmrs > 0 ? ((totalSameDay + totalNextDay + totalWithinWeek) / totalPmrs) * 100 : 0;
                
                nfoEntityTrends.push({
                    entity_name: nfoName,
                    entity_type: 'nfo',
                    weeks: entityWeeks,
                    total_pmrs: totalPmrs,
                    avg_same_day_rate: avgSameDayRate,
                    avg_within_week_rate: avgWithinWeekRate,
                    performance_status: getPerformanceStatus(avgSameDayRate, avgWithinWeekRate)
                });
            });

            setNfoPerformance(Array.from(nfoMap.values()).sort((a, b) => b.total_pmrs - a.total_pmrs));
            setWeeklyTrends(Array.from(weekMap.values()).sort((a, b) => a.week_number - b.week_number));
            setSelectedWeeks(Array.from(weekMap.keys()).sort((a, b) => a - b));
            setAreaWeeklyTrends(areaEntityTrends.sort((a, b) => b.total_pmrs - a.total_pmrs));
            setNfoWeeklyTrends(nfoEntityTrends.sort((a, b) => b.total_pmrs - a.total_pmrs));
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
        const withinWeek2to7 = nfoPerformance.reduce((s, n) => s + n.within_week_submissions, 0);
        const late = nfoPerformance.reduce((s, n) => s + n.late_submissions, 0);
        const noSubmission = nfoPerformance.reduce((s, n) => s + n.no_submission, 0);
        const withinWeekTotal = sameDay + nextDay + withinWeek2to7; // cumulative: 0 + 1 + 2-7 days
        return { 
            total, 
            sameDay, 
            nextDay,
            withinWeek: withinWeekTotal, 
            late, 
            noSubmission, 
            sameDayRate: total > 0 ? (sameDay / total) * 100 : 0, 
            nextDayRate: total > 0 ? (nextDay / total) * 100 : 0,
            withinWeekRate: total > 0 ? (withinWeekTotal / total) * 100 : 0 
        };
    }, [nfoPerformance]);

    const selectedWeeksData = useMemo(() => weeklyTrends.filter(w => selectedWeeks.includes(w.week_number)), [weeklyTrends, selectedWeeks]);

    const weekChanges = useMemo(() => {
        if (selectedWeeksData.length < 2) return [];
        return selectedWeeksData.slice(1).map((week, idx) => {
            const prevWeek = selectedWeeksData[idx];
            return { from: prevWeek.week_label, to: week.week_label, sameDayChange: week.same_day_rate - prevWeek.same_day_rate, withinWeekChange: week.within_week_rate - prevWeek.within_week_rate };
        });
    }, [selectedWeeksData]);

    // Filter entity trends by performance status
    const filteredAreaTrends = useMemo(() => {
        let filtered = areaWeeklyTrends;
        if (performanceFilter !== 'all') {
            filtered = filtered.filter(a => a.performance_status === performanceFilter);
        }
        return filtered;
    }, [areaWeeklyTrends, performanceFilter]);

    const filteredNfoTrends = useMemo(() => {
        let filtered = nfoWeeklyTrends;
        if (performanceFilter !== 'all') {
            filtered = filtered.filter(n => n.performance_status === performanceFilter);
        }
        return filtered;
    }, [nfoWeeklyTrends, performanceFilter]);

    // Get entities selected for chart display
    const chartEntities = useMemo(() => {
        const entities: EntityWeeklyTrend[] = [];
        if (chartViewMode === 'area' || chartViewMode === 'comparison') {
            const areasToShow = selectedAreasForChart.length > 0 
                ? filteredAreaTrends.filter(a => selectedAreasForChart.includes(a.entity_name))
                : filteredAreaTrends.slice(0, 5); // Default to top 5
            entities.push(...areasToShow);
        }
        if (chartViewMode === 'nfo' || chartViewMode === 'comparison') {
            const nfosToShow = selectedNFOsForChart.length > 0
                ? filteredNfoTrends.filter(n => selectedNFOsForChart.includes(n.entity_name))
                : filteredNfoTrends.slice(0, 5); // Default to top 5
            entities.push(...nfosToShow);
        }
        return entities;
    }, [chartViewMode, selectedAreasForChart, selectedNFOsForChart, filteredAreaTrends, filteredNfoTrends]);

    // Toggle area selection for chart
    const toggleAreaForChart = (areaName: string) => {
        setSelectedAreasForChart(prev => 
            prev.includes(areaName) 
                ? prev.filter(a => a !== areaName) 
                : [...prev, areaName]
        );
    };

    // Toggle NFO selection for chart
    const toggleNfoForChart = (nfoName: string) => {
        setSelectedNFOsForChart(prev => 
            prev.includes(nfoName) 
                ? prev.filter(n => n !== nfoName) 
                : [...prev, nfoName]
        );
    };

    const getMetricLabel = (metric: string) => metric === 'same_day_rate' ? 'Same Day Rate' : 'Within Week Rate (≤7 days)';

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
                            <div className="bg-green-50 rounded-lg shadow-sm border border-green-200 p-4"><p className="text-sm text-green-700">Same Day (0)</p><p className="text-2xl font-bold text-green-800">{summaryStats.sameDay}</p><p className="text-xs text-green-600">{summaryStats.sameDayRate.toFixed(1)}%</p></div>
                            <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200 p-4"><p className="text-sm text-blue-700">Next Day (1)</p><p className="text-2xl font-bold text-blue-800">{summaryStats.nextDay}</p><p className="text-xs text-blue-600">{summaryStats.nextDayRate.toFixed(1)}%</p></div>
                            <div className="bg-yellow-50 rounded-lg shadow-sm border border-yellow-200 p-4"><p className="text-sm text-yellow-700">Within Week (≤7)</p><p className="text-2xl font-bold text-yellow-800">{summaryStats.withinWeek}</p><p className="text-xs text-yellow-600">{summaryStats.withinWeekRate.toFixed(1)}%</p></div>
                            <div className="bg-orange-50 rounded-lg shadow-sm border border-orange-200 p-4"><p className="text-sm text-orange-700">Late (&gt;7)</p><p className="text-2xl font-bold text-orange-800">{summaryStats.late}</p></div>
                            <div className="bg-red-50 rounded-lg shadow-sm border border-red-200 p-4"><p className="text-sm text-red-700">Not Submitted</p><p className="text-2xl font-bold text-red-800">{summaryStats.noSubmission}</p></div>
                        </div>

                        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg shadow-lg p-6 mb-6 text-white">
                            <div className="flex items-center justify-between">
                                <div><p className="text-blue-100 text-sm">Within Week Rate (≤7 days)</p><p className="text-4xl font-bold">{summaryStats.withinWeekRate.toFixed(1)}%</p></div>
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
                                    {viewMode === 'chart' && <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value as 'same_day_rate' | 'within_week_rate')} className="px-3 py-2 border border-slate-300 rounded-md text-sm"><option value="same_day_rate">Same Day Rate</option><option value="within_week_rate">Within Week Rate (≤7 days)</option></select>}
                                    {viewMode === 'chart' && (
                                        <div className="flex rounded-lg overflow-hidden border border-slate-300">
                                            <button onClick={() => setChartViewMode('overall')} className={`px-3 py-2 text-sm ${chartViewMode === 'overall' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Overall</button>
                                            <button onClick={() => setChartViewMode('area')} className={`px-3 py-2 text-sm ${chartViewMode === 'area' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Area-wise</button>
                                            <button onClick={() => setChartViewMode('nfo')} className={`px-3 py-2 text-sm ${chartViewMode === 'nfo' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>NFO-wise</button>
                                            <button onClick={() => setChartViewMode('comparison')} className={`px-3 py-2 text-sm ${chartViewMode === 'comparison' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>Compare</button>
                                        </div>
                                    )}
                                </div>
                                {viewMode === 'chart' && (
                                    <select value={performanceFilter} onChange={(e) => setPerformanceFilter(e.target.value as typeof performanceFilter)} className="px-3 py-2 border border-slate-300 rounded-md text-sm">
                                        <option value="all">All Performance</option>
                                        <option value="excellent">🌟 Excellent Only</option>
                                        <option value="good">✅ Good Only</option>
                                        <option value="needs_improvement">⚠️ Needs Improvement</option>
                                        <option value="problematic">🔴 Problematic Only</option>
                                    </select>
                                )}
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
                            <div className="flex gap-6">
                                {/* Main Chart Area */}
                                <div className="flex-1 space-y-6">
                                    {/* Overall Trend (default view) */}
                                    {chartViewMode === 'overall' && (
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
                                    )}

                                    {/* Area-wise or NFO-wise or Comparison Multi-line Chart */}
                                    {(chartViewMode === 'area' || chartViewMode === 'nfo' || chartViewMode === 'comparison') && chartEntities.length > 0 && (
                                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                            <h3 className="text-lg font-semibold text-slate-900 mb-4">
                                                {chartViewMode === 'area' ? 'Area-wise' : chartViewMode === 'nfo' ? 'NFO-wise' : 'Area & NFO Comparison'} {getMetricLabel(chartMetric)} Trend
                                            </h3>
                                            <div className="relative" style={{ height: '400px' }}>
                                                <svg className="w-full h-full" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
                                                    {/* Grid lines */}
                                                    {[0, 25, 50, 75, 100].map(val => (
                                                        <g key={val}>
                                                            <line x1="60" y1={340 - val * 3} x2="750" y2={340 - val * 3} stroke="#e2e8f0" strokeWidth="1" />
                                                            <text x="50" y={345 - val * 3} textAnchor="end" className="text-xs fill-slate-500">{val}%</text>
                                                        </g>
                                                    ))}
                                                    
                                                    {/* Draw line for each entity */}
                                                    {chartEntities.map((entity, entityIdx) => {
                                                        const color = CHART_COLORS[entityIdx % CHART_COLORS.length];
                                                        const weekNums = selectedWeeks.sort((a, b) => a - b);
                                                        const points: { x: number; y: number; rate: number; weekNum: number }[] = [];
                                                        
                                                        weekNums.forEach((weekNum, weekIdx) => {
                                                            const weekData = entity.weeks.get(weekNum);
                                                            if (weekData) {
                                                                const rate = chartMetric === 'same_day_rate' ? weekData.same_day_rate : weekData.within_week_rate;
                                                                const x = weekNums.length === 1 ? 400 : 60 + (weekIdx / (weekNums.length - 1)) * 690;
                                                                const y = 340 - rate * 3;
                                                                points.push({ x, y, rate, weekNum });
                                                            }
                                                        });
                                                        
                                                        if (points.length === 0) return null;
                                                        
                                                        // Calculate opacity based on highlight state
                                                        const isHighlighted = highlightedEntity === entity.entity_name;
                                                        const isDimmed = highlightedEntity !== null && !isHighlighted;
                                                        const opacity = isDimmed ? 0.15 : 1;
                                                        const strokeWidth = isHighlighted ? 4 : 2.5;
                                                        const pointRadius = isHighlighted ? 7 : 5;
                                                        
                                                        return (
                                                            <g 
                                                                key={entity.entity_name} 
                                                                style={{ opacity, transition: 'opacity 0.2s ease' }}
                                                                className="cursor-pointer"
                                                                onClick={() => setHighlightedEntity(isHighlighted ? null : entity.entity_name)}
                                                            >
                                                                {/* Line */}
                                                                {points.length > 1 && (
                                                                    <path
                                                                        d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                                                                        fill="none"
                                                                        stroke={color}
                                                                        strokeWidth={strokeWidth}
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                        strokeDasharray={entity.entity_type === 'nfo' ? '5,3' : '0'}
                                                                    />
                                                                )}
                                                                {/* Points with values on highlight */}
                                                                {points.map((p, i) => (
                                                                    <g key={i}>
                                                                        <circle cx={p.x} cy={p.y} r={pointRadius} fill={color} stroke="white" strokeWidth="2" />
                                                                        {isHighlighted && (
                                                                            <text x={p.x} y={p.y - 12} textAnchor="middle" className="text-xs font-bold" fill={color}>
                                                                                {p.rate.toFixed(0)}%
                                                                            </text>
                                                                        )}
                                                                    </g>
                                                                ))}
                                                            </g>
                                                        );
                                                    })}
                                                    
                                                    {/* X-axis labels (weeks) */}
                                                    {selectedWeeks.sort((a, b) => a - b).map((weekNum, i) => {
                                                        const x = selectedWeeks.length === 1 ? 400 : 60 + (i / (selectedWeeks.length - 1)) * 690;
                                                        const weekLabel = weekNum === 0 ? 'Pre-Week' : `Week ${weekNum}`;
                                                        return (
                                                            <text key={weekNum} x={x} y={365} textAnchor="middle" className="text-xs fill-slate-600">
                                                                {weekLabel}
                                                            </text>
                                                        );
                                                    })}
                                                </svg>
                                            </div>
                                            
                                            {/* Legend - Clickable */}
                                            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                                                {chartEntities.map((entity, idx) => {
                                                    const color = CHART_COLORS[idx % CHART_COLORS.length];
                                                    const statusColors = getStatusColor(entity.performance_status);
                                                    const isHighlighted = highlightedEntity === entity.entity_name;
                                                    const isDimmed = highlightedEntity !== null && !isHighlighted;
                                                    return (
                                                        <button 
                                                            key={entity.entity_name} 
                                                            onClick={() => setHighlightedEntity(isHighlighted ? null : entity.entity_name)}
                                                            className={`flex items-center gap-2 px-2 py-1.5 rounded border-2 transition-all cursor-pointer hover:scale-105 ${
                                                                isHighlighted 
                                                                    ? 'ring-2 ring-offset-1 shadow-md' 
                                                                    : isDimmed 
                                                                        ? 'opacity-40' 
                                                                        : 'hover:shadow-sm'
                                                            } ${statusColors.bg}`}
                                                            style={{ 
                                                                borderColor: isHighlighted ? color : 'transparent',
                                                                outlineColor: isHighlighted ? color : 'transparent'
                                                            }}
                                                        >
                                                            <div 
                                                                className="w-4 h-1 flex-shrink-0" 
                                                                style={{ 
                                                                    backgroundColor: entity.entity_type === 'nfo' ? 'transparent' : color,
                                                                    borderBottom: entity.entity_type === 'nfo' ? `3px dashed ${color}` : 'none',
                                                                    height: entity.entity_type === 'nfo' ? '0' : '4px'
                                                                }}
                                                            />
                                                            <span className={`text-xs font-medium ${statusColors.text} truncate max-w-[120px]`}>
                                                                {entity.entity_name}
                                                            </span>
                                                            <span className="text-xs" style={{ color }}>
                                                                {entity.entity_type === 'area' ? '📍' : '👤'}
                                                            </span>
                                                            <span className="text-xs font-bold" style={{ color }}>
                                                                {(chartMetric === 'same_day_rate' ? entity.avg_same_day_rate : entity.avg_within_week_rate).toFixed(0)}%
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                                {highlightedEntity && (
                                                    <button 
                                                        onClick={() => setHighlightedEntity(null)}
                                                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium"
                                                    >
                                                        ✕ Clear Focus
                                                    </button>
                                                )}
                                            </div>
                                            <div className="mt-2 text-xs text-slate-500">
                                                <span className="mr-4">━ Solid = Area</span>
                                                <span className="mr-4">┄ Dashed = NFO</span>
                                                <span className="text-blue-600">💡 Click legend or line to focus</span>
                                            </div>
                                        </div>
                                    )}

                                    {(chartViewMode === 'area' || chartViewMode === 'nfo' || chartViewMode === 'comparison') && chartEntities.length === 0 && (
                                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-10 text-center">
                                            <p className="text-slate-500">Select areas or NFOs from the slicer panel on the right to see trends.</p>
                                        </div>
                                    )}

                                    {weekChanges.length > 0 && chartViewMode === 'overall' && (
                                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                            <h3 className="text-lg font-semibold text-slate-900 mb-4">Week-over-Week Change</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {weekChanges.map((change, idx) => (
                                                    <div key={idx} className="bg-slate-50 rounded-lg p-4">
                                                        <p className="text-sm text-slate-600 mb-2">{change.from} → {change.to}</p>
                                                        <div className="flex items-center gap-4">
                                                            <div><p className="text-xs text-slate-500">Same Day</p><p className={`text-lg font-bold ${change.sameDayChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change.sameDayChange >= 0 ? '↑' : '↓'} {Math.abs(change.sameDayChange).toFixed(1)}%</p></div>
                                                            <div><p className="text-xs text-slate-500">Within Week</p><p className={`text-lg font-bold ${change.withinWeekChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>{change.withinWeekChange >= 0 ? '↑' : '↓'} {Math.abs(change.withinWeekChange).toFixed(1)}%</p></div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {chartViewMode === 'overall' && (
                                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                            <h3 className="text-lg font-semibold text-slate-900 mb-4">Week Comparison</h3>
                                            <div className="space-y-4">
                                                {selectedWeeksData.map((week, idx) => (
                                                    <div key={week.week_number} className="flex items-center gap-4">
                                                        <div className="w-20 text-sm font-medium text-slate-700">{week.week_label}</div>
                                                        <div className="flex-1"><div className="h-8 bg-slate-100 rounded-full overflow-hidden relative"><div className="absolute h-full bg-blue-200 rounded-full" style={{ width: `${week.within_week_rate}%` }} /><div className="absolute h-full rounded-full" style={{ width: `${week.same_day_rate}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} /></div></div>
                                                        <div className="w-32 text-right"><span className="text-sm font-bold" style={{ color: CHART_COLORS[idx % CHART_COLORS.length] }}>{week.same_day_rate.toFixed(1)}%</span><span className="text-slate-400 mx-1">/</span><span className="text-sm text-blue-600">{week.within_week_rate.toFixed(1)}%</span></div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-4 flex gap-6 text-sm"><div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-500 rounded"></div><span>Same Day</span></div><div className="flex items-center gap-2"><div className="w-4 h-4 bg-blue-200 rounded"></div><span>Within Week (≤7 days)</span></div></div>
                                        </div>
                                    )}
                                    
                                    {/* Performance Summary Cards for Area/NFO view */}
                                    {(chartViewMode === 'area' || chartViewMode === 'nfo' || chartViewMode === 'comparison') && (
                                        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
                                            <h3 className="text-lg font-semibold text-slate-900 mb-4">Performance Summary</h3>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                                                    <p className="text-2xl font-bold text-green-700">{(chartViewMode === 'nfo' ? filteredNfoTrends : chartViewMode === 'area' ? filteredAreaTrends : [...filteredAreaTrends, ...filteredNfoTrends]).filter(e => e.performance_status === 'excellent').length}</p>
                                                    <p className="text-xs text-green-600">🌟 Excellent</p>
                                                </div>
                                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                                                    <p className="text-2xl font-bold text-blue-700">{(chartViewMode === 'nfo' ? filteredNfoTrends : chartViewMode === 'area' ? filteredAreaTrends : [...filteredAreaTrends, ...filteredNfoTrends]).filter(e => e.performance_status === 'good').length}</p>
                                                    <p className="text-xs text-blue-600">✅ Good</p>
                                                </div>
                                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                                                    <p className="text-2xl font-bold text-yellow-700">{(chartViewMode === 'nfo' ? filteredNfoTrends : chartViewMode === 'area' ? filteredAreaTrends : [...filteredAreaTrends, ...filteredNfoTrends]).filter(e => e.performance_status === 'needs_improvement').length}</p>
                                                    <p className="text-xs text-yellow-600">⚠️ Needs Work</p>
                                                </div>
                                                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                                                    <p className="text-2xl font-bold text-red-700">{(chartViewMode === 'nfo' ? filteredNfoTrends : chartViewMode === 'area' ? filteredAreaTrends : [...filteredAreaTrends, ...filteredNfoTrends]).filter(e => e.performance_status === 'problematic').length}</p>
                                                    <p className="text-xs text-red-600">🔴 Problematic</p>
                                                </div>
                                            </div>
                                            <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded">
                                                <strong>Criteria:</strong> Excellent (≥80% same-day OR ≥95% within-week) • Good (≥60% OR ≥85%) • Needs Improvement (≥40% OR ≥70%) • Problematic (below thresholds)
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Right Side Slicer Panel */}
                                {(chartViewMode === 'area' || chartViewMode === 'nfo' || chartViewMode === 'comparison') && (
                                    <div className="w-72 flex-shrink-0 space-y-4">
                                        {/* Area Slicer */}
                                        {(chartViewMode === 'area' || chartViewMode === 'comparison') && (
                                            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="font-semibold text-slate-900 text-sm">📍 Areas ({filteredAreaTrends.length})</h4>
                                                    <div className="flex gap-1">
                                                        <button 
                                                            onClick={() => setSelectedAreasForChart(filteredAreaTrends.map(a => a.entity_name))}
                                                            className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                                                        >All</button>
                                                        <button 
                                                            onClick={() => { setSelectedAreasForChart([]); setHighlightedEntity(null); }}
                                                            className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                                                        >Clear</button>
                                                    </div>
                                                </div>
                                                <div className="max-h-48 overflow-y-auto space-y-1">
                                                    {filteredAreaTrends.map((area, idx) => {
                                                        const statusColors = getStatusColor(area.performance_status);
                                                        const isSelected = selectedAreasForChart.includes(area.entity_name);
                                                        const isHighlighted = highlightedEntity === area.entity_name;
                                                        const color = CHART_COLORS[idx % CHART_COLORS.length];
                                                        return (
                                                            <div 
                                                                key={area.entity_name} 
                                                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-all ${
                                                                    isHighlighted 
                                                                        ? 'shadow-md scale-[1.02]' 
                                                                        : isSelected 
                                                                            ? 'bg-blue-50 border border-blue-200' 
                                                                            : 'hover:bg-slate-50'
                                                                }`}
                                                                style={{ 
                                                                    border: isHighlighted ? `2px solid ${color}` : undefined,
                                                                    boxShadow: isHighlighted ? `0 0 0 2px ${color}40` : undefined,
                                                                    backgroundColor: isHighlighted ? `${color}15` : undefined
                                                                }}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => toggleAreaForChart(area.entity_name)}
                                                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <div 
                                                                    className="w-3 h-3 rounded-full flex-shrink-0" 
                                                                    style={{ backgroundColor: color }}
                                                                />
                                                                <div 
                                                                    className="flex-1 min-w-0"
                                                                    onClick={() => {
                                                                        if (isSelected) {
                                                                            setHighlightedEntity(isHighlighted ? null : area.entity_name);
                                                                        }
                                                                    }}
                                                                >
                                                                    <p className={`text-xs font-medium truncate ${isHighlighted ? 'text-slate-900' : 'text-slate-700'}`}>{area.entity_name}</p>
                                                                    <p className={`text-xs ${statusColors.text}`}>{area.avg_same_day_rate.toFixed(0)}% same-day</p>
                                                                </div>
                                                                <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors.bg} ${statusColors.text}`}>
                                                                    {area.performance_status === 'excellent' ? '🌟' : area.performance_status === 'good' ? '✅' : area.performance_status === 'needs_improvement' ? '⚠️' : '🔴'}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* NFO Slicer */}
                                        {(chartViewMode === 'nfo' || chartViewMode === 'comparison') && (
                                            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="font-semibold text-slate-900 text-sm">👤 NFOs ({filteredNfoTrends.length})</h4>
                                                    <div className="flex gap-1">
                                                        <button 
                                                            onClick={() => setSelectedNFOsForChart(filteredNfoTrends.slice(0, 10).map(n => n.entity_name))}
                                                            className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                                                        >Top 10</button>
                                                        <button 
                                                            onClick={() => { setSelectedNFOsForChart([]); setHighlightedEntity(null); }}
                                                            className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded"
                                                        >Clear</button>
                                                    </div>
                                                </div>
                                                <div className="max-h-64 overflow-y-auto space-y-1">
                                                    {filteredNfoTrends.map((nfo, idx) => {
                                                        const statusColors = getStatusColor(nfo.performance_status);
                                                        const isSelected = selectedNFOsForChart.includes(nfo.entity_name);
                                                        const isHighlighted = highlightedEntity === nfo.entity_name;
                                                        const color = CHART_COLORS[idx % CHART_COLORS.length];
                                                        return (
                                                            <div 
                                                                key={nfo.entity_name} 
                                                                className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-all ${
                                                                    isHighlighted 
                                                                        ? 'shadow-md scale-[1.02]' 
                                                                        : isSelected 
                                                                            ? 'bg-indigo-50 border border-indigo-200' 
                                                                            : 'hover:bg-slate-50'
                                                                }`}
                                                                style={{ 
                                                                    border: isHighlighted ? `2px solid ${color}` : undefined,
                                                                    boxShadow: isHighlighted ? `0 0 0 2px ${color}40` : undefined,
                                                                    backgroundColor: isHighlighted ? `${color}15` : undefined
                                                                }}
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => toggleNfoForChart(nfo.entity_name)}
                                                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                                />
                                                                <div 
                                                                    className="w-3 h-3 rounded-full flex-shrink-0 border-2 border-dashed" 
                                                                    style={{ borderColor: color }}
                                                                />
                                                                <div 
                                                                    className="flex-1 min-w-0"
                                                                    onClick={() => {
                                                                        if (isSelected) {
                                                                            setHighlightedEntity(isHighlighted ? null : nfo.entity_name);
                                                                        }
                                                                    }}
                                                                >
                                                                    <p className={`text-xs font-medium truncate ${isHighlighted ? 'text-slate-900' : 'text-slate-700'}`}>{nfo.entity_name}</p>
                                                                    <p className={`text-xs ${statusColors.text}`}>{nfo.avg_same_day_rate.toFixed(0)}% same-day</p>
                                                                </div>
                                                                <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors.bg} ${statusColors.text}`}>
                                                                    {nfo.performance_status === 'excellent' ? '🌟' : nfo.performance_status === 'good' ? '✅' : nfo.performance_status === 'needs_improvement' ? '⚠️' : '🔴'}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Quick Actions */}
                                        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                                            <p className="text-xs font-medium text-slate-700 mb-2">Quick Select:</p>
                                            <div className="space-y-1">
                                                <button 
                                                    onClick={() => {
                                                        if (chartViewMode === 'area' || chartViewMode === 'comparison') {
                                                            setSelectedAreasForChart(filteredAreaTrends.filter(a => a.performance_status === 'problematic').map(a => a.entity_name));
                                                        }
                                                        if (chartViewMode === 'nfo' || chartViewMode === 'comparison') {
                                                            setSelectedNFOsForChart(filteredNfoTrends.filter(n => n.performance_status === 'problematic').map(n => n.entity_name));
                                                        }
                                                    }}
                                                    className="w-full text-xs px-2 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                                                >
                                                    🔴 Show Problematic Only
                                                </button>
                                                <button 
                                                    onClick={() => {
                                                        if (chartViewMode === 'area' || chartViewMode === 'comparison') {
                                                            setSelectedAreasForChart(filteredAreaTrends.filter(a => a.performance_status === 'excellent').map(a => a.entity_name));
                                                        }
                                                        if (chartViewMode === 'nfo' || chartViewMode === 'comparison') {
                                                            setSelectedNFOsForChart(filteredNfoTrends.filter(n => n.performance_status === 'excellent').map(n => n.entity_name));
                                                        }
                                                    }}
                                                    className="w-full text-xs px-2 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded"
                                                >
                                                    🌟 Show Top Performers
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {viewMode === 'table' && (
                            <div className="space-y-6">
                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-50 border-b"><h3 className="text-lg font-semibold text-slate-900">Weekly Performance</h3></div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200">
                                            <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Week</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date Range</th><th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">PMRs</th><th className="px-4 py-3 text-center text-xs font-medium text-green-700 uppercase bg-green-50">Same Day (0)</th><th className="px-4 py-3 text-center text-xs font-medium text-blue-700 uppercase bg-blue-50">Next Day (1)</th><th className="px-4 py-3 text-center text-xs font-medium text-yellow-700 uppercase bg-yellow-50">Within Week (≤7)</th><th className="px-4 py-3 text-center text-xs font-medium text-orange-700 uppercase bg-orange-50">Late (&gt;7)</th><th className="px-4 py-3 text-center text-xs font-medium text-red-700 uppercase bg-red-50">No Submit</th></tr></thead>
                                            <tbody className="divide-y divide-slate-200">{weeklyTrends.map((week, idx) => { const withinWeekTotal = week.same_day_count + week.next_day_count + week.within_week_count; return <tr key={week.week_number} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}><td className="px-4 py-3 text-sm font-medium text-slate-900">{week.week_label}</td><td className="px-4 py-3 text-sm text-slate-600">{formatDateShort(week.start_date)} - {formatDateShort(week.end_date)}</td><td className="px-4 py-3 text-sm text-center font-semibold">{week.total_pmrs}</td><td className="px-4 py-3 text-sm text-center bg-green-50"><span className="text-green-700 font-medium">{week.same_day_count}</span><span className="text-green-500 text-xs ml-1">({week.same_day_rate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-blue-50"><span className="text-blue-700 font-medium">{week.next_day_count}</span><span className="text-blue-500 text-xs ml-1">({week.next_day_rate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-yellow-50"><span className="text-yellow-700 font-medium">{withinWeekTotal}</span><span className="text-yellow-500 text-xs ml-1">({week.within_week_rate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-orange-50 text-orange-700">{week.late_count}</td><td className="px-4 py-3 text-sm text-center bg-red-50 text-red-700">{week.no_submission_count}</td></tr>; })}</tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-50 border-b"><h3 className="text-lg font-semibold text-slate-900">NFO Performance</h3></div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200">
                                            <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">NFO</th><th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">City</th><th className="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase">PMRs</th><th className="px-4 py-3 text-center text-xs font-medium text-green-700 uppercase bg-green-50">Same Day (0)</th><th className="px-4 py-3 text-center text-xs font-medium text-blue-700 uppercase bg-blue-50">Next Day (1)</th><th className="px-4 py-3 text-center text-xs font-medium text-yellow-700 uppercase bg-yellow-50">Within Week (≤7)</th><th className="px-4 py-3 text-center text-xs font-medium text-orange-700 uppercase bg-orange-50">Late (&gt;7)</th><th className="px-4 py-3 text-center text-xs font-medium text-red-700 uppercase bg-red-50">No Submit</th></tr></thead>
                                            <tbody className="divide-y divide-slate-200">{nfoPerformance.map((nfo, idx) => { const sameDayRate = nfo.total_pmrs > 0 ? (nfo.same_day_submissions / nfo.total_pmrs) * 100 : 0; const nextDayRate = nfo.total_pmrs > 0 ? (nfo.next_day_submissions / nfo.total_pmrs) * 100 : 0; const withinWeekTotal = nfo.same_day_submissions + nfo.next_day_submissions + nfo.within_week_submissions; const withinWeekRate = nfo.total_pmrs > 0 ? (withinWeekTotal / nfo.total_pmrs) * 100 : 0; return <tr key={nfo.fme_name} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}><td className="px-4 py-3 text-sm font-medium text-slate-900">{nfo.fme_name}</td><td className="px-4 py-3 text-sm text-slate-600">{nfo.city}</td><td className="px-4 py-3 text-sm text-center font-semibold">{nfo.total_pmrs}</td><td className="px-4 py-3 text-sm text-center bg-green-50"><span className="text-green-700 font-medium">{nfo.same_day_submissions}</span><span className="text-green-500 text-xs ml-1">({sameDayRate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-blue-50"><span className="text-blue-700 font-medium">{nfo.next_day_submissions}</span><span className="text-blue-500 text-xs ml-1">({nextDayRate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-yellow-50"><span className="text-yellow-700 font-medium">{withinWeekTotal}</span><span className="text-yellow-500 text-xs ml-1">({withinWeekRate.toFixed(0)}%)</span></td><td className="px-4 py-3 text-sm text-center bg-orange-50 text-orange-700">{nfo.late_submissions}</td><td className="px-4 py-3 text-sm text-center bg-red-50 text-red-700">{nfo.no_submission}</td></tr>; })}</tbody>
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
