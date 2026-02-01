'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getParam, setParams } from '@/lib/urlUtils';

// --- Types ---
interface PMRPlan {
    Site_ID_1: string;
    Site_ID: string;
    Planned_PMR_Date: string;
    "Autual_PMR_Date": string;
    City: string;
    "FME Name": string;
    Status: string;
}

interface InventoryRow {
    site_id: string;
    category: string;
    tag_category: string | null;
    photo_category: string | null;
    serial_number: string | null;
    tag_id: string | null;
    tag_pic_url: string | null;
}

interface CategoryStats {
    total: number;
    filled: number;
}

interface SiteStats {
    site_id: string;
    planned_date: string;
    city: string;
    fme_name: string;
    categories: {
        'Enclosure-Active': CategoryStats;
        'Enclosure-Passive': CategoryStats;
        'RAN-Active': CategoryStats;
        'RAN-Passive': CategoryStats;
        'MW-Active': CategoryStats;
        'MW-Passive': CategoryStats;
    };
    totalRows: number;
    totalFilled: number;
    // Data quality metrics
    duplicate_serials: number;
    duplicate_tags: number;
    // Tag pictures metrics
    tag_pics_available: number;
    tag_pics_required: number;
}

type CategoryKey = keyof SiteStats['categories'];

const CATEGORIES: CategoryKey[] = [
    'Enclosure-Active',
    'Enclosure-Passive',
    'RAN-Active',
    'RAN-Passive',
    'MW-Active',
    'MW-Passive',
];

const CATEGORY_DISPLAY_NAMES: Record<CategoryKey, string> = {
    'Enclosure-Active': 'Enclosure Active',
    'Enclosure-Passive': 'Enclosure Passive',
    'RAN-Active': 'RAN Active',
    'RAN-Passive': 'RAN Passive',
    'MW-Active': 'MW Active',
    'MW-Passive': 'MW Passive',
};

// --- Component ---
export default function DashboardView() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // --- URL State Initialization ---
    const initialStartDate = getParam(searchParams, 'startDate', '2026-01-01');
    const initialEndDate = getParam(searchParams, 'endDate', '2026-01-31');
    const initialCity = getParam(searchParams, 'city', '');
    const initialFME = getParam(searchParams, 'fme', '');
    const initialMonth = getParam(searchParams, 'month', '1');
    const initialQuarter = getParam(searchParams, 'quarter', '');

    // Date range selection
    const [startDate, setStartDateState] = useState<string>(initialStartDate);
    const [endDate, setEndDateState] = useState<string>(initialEndDate);
    
    // Filters
    const [selectedCity, setSelectedCityState] = useState<string>(initialCity);
    const [selectedFME, setSelectedFMEState] = useState<string>(initialFME);
    const [cities, setCities] = useState<string[]>([]);
    const [fmeNames, setFmeNames] = useState<string[]>([]);
    const [cityFmeMap, setCityFmeMap] = useState<Map<string, string[]>>(new Map());
    
    // Month/Quarter selection
    const [selectedMonth, setSelectedMonthState] = useState<string>(initialMonth);
    const [selectedQuarter, setSelectedQuarterState] = useState<string>(initialQuarter);
    
    // Completion percentage filter (client-side only, not in URL)
    const [completionThreshold, setCompletionThreshold] = useState<'' | 'gte90' | '90' | '85' | '80' | '75' | '70' | '10'>('');
    const [filterByCategory, setFilterByCategory] = useState<'' | CategoryKey | 'overall'>('');

    // --- URL Update Helpers ---
    const updateUrlParams = useCallback((updates: Record<string, string>) => {
        setParams(router, pathname, searchParams, updates);
    }, [router, pathname, searchParams]);

    const setStartDate = (value: string) => {
        setStartDateState(value);
        updateUrlParams({ startDate: value });
    };

    const setEndDate = (value: string) => {
        setEndDateState(value);
        updateUrlParams({ endDate: value });
    };

    const setSelectedCity = (value: string) => {
        setSelectedCityState(value);
        updateUrlParams({ city: value });
    };

    const setSelectedFME = (value: string) => {
        setSelectedFMEState(value);
        updateUrlParams({ fme: value });
    };

    // Sync URL changes to state (handles browser back/forward)
    useEffect(() => {
        const urlStartDate = getParam(searchParams, 'startDate', '2026-01-01');
        const urlEndDate = getParam(searchParams, 'endDate', '2026-01-31');
        const urlCity = getParam(searchParams, 'city', '');
        const urlFME = getParam(searchParams, 'fme', '');
        const urlMonth = getParam(searchParams, 'month', '1');
        const urlQuarter = getParam(searchParams, 'quarter', '');

        if (urlStartDate !== startDate) setStartDateState(urlStartDate);
        if (urlEndDate !== endDate) setEndDateState(urlEndDate);
        if (urlCity !== selectedCity) setSelectedCityState(urlCity);
        if (urlFME !== selectedFME) setSelectedFMEState(urlFME);
        if (urlMonth !== selectedMonth) setSelectedMonthState(urlMonth);
        if (urlQuarter !== selectedQuarter) setSelectedQuarterState(urlQuarter);
    }, [searchParams]);
    
    // Data
    const [siteStats, setSiteStats] = useState<SiteStats[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Aggregated stats
    const [aggregatedStats, setAggregatedStats] = useState<{
        totalSites: number;
        submittedSites: number;  // Sites with completion > 10%
        pendingSites: number;    // Sites with completion <= 10%
        totalRows: number;
        totalFilled: number;
        byCategory: Record<CategoryKey, CategoryStats>;
        totalDuplicateSerials: number;
        totalDuplicateTags: number;
        totalTagPicsAvailable: number;
        totalTagPicsRequired: number;
    } | null>(null);

    // Fetch filter options on mount
    useEffect(() => {
        const fetchFilterOptions = async () => {
            // Fetch all city-FME combinations to build cascaded filter
            const { data: cityFmeData } = await supabase
                .from('pmr_actual_2026')
                .select('City, "FME Name"')
                .not('City', 'is', null)
                .not('FME Name', 'is', null);
            
            if (cityFmeData) {
                // Build city list
                const uniqueCities = [...new Set(cityFmeData.map(r => r.City as string))].sort();
                setCities(uniqueCities);
                
                // Build all FME names
                const allFME = [...new Set(cityFmeData.map(r => r['FME Name'] as string))].sort();
                setFmeNames(allFME);
                
                // Build city -> FME mapping
                const mapping = new Map<string, Set<string>>();
                cityFmeData.forEach(row => {
                    const city = row.City as string;
                    const fme = row['FME Name'] as string;
                    if (!mapping.has(city)) {
                        mapping.set(city, new Set());
                    }
                    mapping.get(city)!.add(fme);
                });
                
                // Convert Sets to sorted Arrays
                const finalMap = new Map<string, string[]>();
                mapping.forEach((fmeSet, city) => {
                    finalMap.set(city, [...fmeSet].sort());
                });
                setCityFmeMap(finalMap);
            }
        };
        fetchFilterOptions();
    }, []);
    
    // Get filtered NFO list based on selected city
    const filteredFmeNames = selectedCity 
        ? cityFmeMap.get(selectedCity) || []
        : fmeNames;
    
    // When city changes, reset NFO if not valid for new city
    useEffect(() => {
        if (selectedCity && selectedFME) {
            const validFMEs = cityFmeMap.get(selectedCity) || [];
            if (!validFMEs.includes(selectedFME)) {
                setSelectedFME('');
            }
        }
    }, [selectedCity, selectedFME, cityFmeMap]);

    // Parse D-Mon-YY format to Date object (e.g., "29-Jan-26" -> Date)
    const parsePMRDate = (dateStr: string): Date | null => {
        if (!dateStr) return null;
        const months: Record<string, number> = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        const parts = dateStr.split('-');
        if (parts.length !== 3) return null;
        const day = parseInt(parts[0], 10);
        const month = months[parts[1]];
        const year = 2000 + parseInt(parts[2], 10); // Assumes 20xx
        if (isNaN(day) || month === undefined || isNaN(year)) return null;
        return new Date(year, month, day);
    };

    // Check if a PMR date string falls within the selected range
    const isDateInRange = (dateStr: string, start: string, end: string): boolean => {
        const date = parsePMRDate(dateStr);
        if (!date) return false;
        const startDate = new Date(start);
        const endDate = new Date(end);
        return date >= startDate && date <= endDate;
    };

    const fetchDashboardData = useCallback(async () => {
        if (!startDate || !endDate) return;
        
        setLoading(true);
        setError(null);

        try {
            // 1. Fetch ALL PMR records then filter by date range client-side
            // (Date format in DB is D-Mon-YY which doesn't work with SQL date comparison)
            let query = supabase
                .from('pmr_actual_2026')
                .select('Site_ID, Site_ID_1, Planned_PMR_Date, \"Autual_PMR_Date\", City, \"FME Name\", Status');
            
            if (selectedCity) {
                query = query.eq('City', selectedCity);
            }
            if (selectedFME) {
                query = query.eq('FME Name', selectedFME);
            }
            
            const { data: allPlansData, error: plansError } = await query;

            if (plansError) {
                throw new Error(`Failed to fetch PMR records: ${plansError.message}`);
            }

            // Filter by date range client-side
            const plansData = (allPlansData || []).filter(p => 
                isDateInRange(p['Autual_PMR_Date'], startDate, endDate)
            );

            const plans = (plansData as unknown as PMRPlan[]) || [];

            if (plans.length === 0) {
                setSiteStats([]);
                setAggregatedStats(null);
                setLoading(false);
                return;
            }

            // 2. Collect all site IDs - use Site_ID_1 (W-format) as that's what inventory uses
            const allSiteIds = new Set<string>();
            plans.forEach(p => {
                // Primary: use Site_ID_1 (W2949 format) - this matches inventory
                if (p.Site_ID_1) allSiteIds.add(p.Site_ID_1);
                // Also add with W prefix if Site_ID is just digits
                if (p.Site_ID && !p.Site_ID.startsWith('W')) {
                    allSiteIds.add(`W${p.Site_ID}`);
                }
            });

            // 3. Fetch inventory data for these sites - use parallel fetching for speed
            const siteIdArray = Array.from(allSiteIds);
            const BATCH_SIZE = 100; // Sites per batch - larger batches, fewer parallel requests
            
            console.log('[Dashboard] Starting inventory fetch for', siteIdArray.length, 'sites');
            console.log('[Dashboard] Site IDs include W2949?', siteIdArray.includes('W2949'));
            
            // Create batches
            const batches: string[][] = [];
            for (let i = 0; i < siteIdArray.length; i += BATCH_SIZE) {
                batches.push(siteIdArray.slice(i, i + BATCH_SIZE));
            }
            
            // Fetch all batches in parallel (each batch may need pagination)
            const fetchBatch = async (batch: string[]): Promise<InventoryRow[]> => {
                const results: InventoryRow[] = [];
                let hasMore = true;
                let offset = 0;
                const PAGE_SIZE = 1000;
                
                while (hasMore) {
                    const { data, error } = await supabase
                        .from('main_inventory')
                        .select('site_id, category, tag_category, photo_category, serial_number, tag_id, tag_pic_url')
                        .in('site_id', batch)
                        .range(offset, offset + PAGE_SIZE - 1);
                    
                    if (error) throw new Error(`Fetch error: ${error.message}`);
                    
                    if (data && data.length > 0) {
                        results.push(...(data as InventoryRow[]));
                        offset += PAGE_SIZE;
                        hasMore = data.length === PAGE_SIZE;
                    } else {
                        hasMore = false;
                    }
                }
                return results;
            };
            
            // Execute all batches in parallel
            const batchResults = await Promise.all(batches.map(fetchBatch));
            const inventory = batchResults.flat();
            
            console.log('[Dashboard] Total inventory rows fetched:', inventory.length);
            
            // Check if W2949 is in the results
            const w2949Rows = inventory.filter(r => r.site_id === 'W2949');
            console.log('[Dashboard] W2949 rows found:', w2949Rows.length, w2949Rows);

            // 4. Group inventory by site_id
            const inventoryBySite = new Map<string, InventoryRow[]>();
            inventory.forEach(row => {
                if (!inventoryBySite.has(row.site_id)) {
                    inventoryBySite.set(row.site_id, []);
                }
                inventoryBySite.get(row.site_id)!.push(row);
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

            // 5. Calculate stats per site
            const results: SiteStats[] = plans.map(plan => {
                // Use Site_ID_1 (W-format) to match inventory
                const siteIdW = plan.Site_ID_1 || (plan.Site_ID ? `W${plan.Site_ID}` : '');
                const displayId = siteIdW || plan.Site_ID || 'Unknown';
                
                // Get rows for this site using W-format
                const allRows = inventoryBySite.get(siteIdW) || [];

                // Initialize category stats
                const categories: SiteStats['categories'] = {
                    'Enclosure-Active': { total: 0, filled: 0 },
                    'Enclosure-Passive': { total: 0, filled: 0 },
                    'RAN-Active': { total: 0, filled: 0 },
                    'RAN-Passive': { total: 0, filled: 0 },
                    'MW-Active': { total: 0, filled: 0 },
                    'MW-Passive': { total: 0, filled: 0 },
                };

                // Count rows per category
                allRows.forEach(row => {
                    const cat = row.category as CategoryKey;
                    if (cat && categories[cat]) {
                        categories[cat].total++;
                        // Row is "filled" if BOTH tag_category AND photo_category have values
                        if (row.tag_category && row.photo_category) {
                            categories[cat].filled++;
                        }
                    }
                });

                // Calculate totals
                let totalRows = 0;
                let totalFilled = 0;
                CATEGORIES.forEach(cat => {
                    totalRows += categories[cat].total;
                    totalFilled += categories[cat].filled;
                });

                // Calculate duplicates across ALL site rows
                const allSerials = allRows.map(r => r.serial_number);
                const allTags = allRows.map(r => r.tag_id);
                const duplicateSerials = countDuplicateValues(allSerials);
                const duplicateTags = countDuplicateValues(allTags);

                // Calculate tag pictures metrics
                // Exclude rows where tag_category or photo_category indicates no tag pic needed
                const rowsRequiringTagPic = allRows.filter(r => {
                    const tagCat = (r.tag_category || '').toLowerCase();
                    const photoCat = (r.photo_category || '').toLowerCase();
                    // Tag category exclusions
                    const excludedTagCategories = [
                        'item dismantled',
                        'tag not required & serial available',
                        'tag not required & serial is missing',
                        'tag not required'
                    ];
                    // Photo category exclusions
                    const excludedPhotoCategories = [
                        'item dismantled',
                        'photos not allowed'
                    ];
                    return !excludedTagCategories.includes(tagCat) && !excludedPhotoCategories.includes(photoCat);
                });
                
                const tagPicsAvailable = rowsRequiringTagPic.filter(r => r.tag_pic_url && r.tag_pic_url.trim() !== '').length;
                const tagPicsRequired = rowsRequiringTagPic.length;

                return {
                    site_id: displayId,
                    planned_date: plan['Autual_PMR_Date'] || plan.Planned_PMR_Date,
                    city: plan.City || '',
                    fme_name: plan['FME Name'] || '',
                    categories,
                    totalRows,
                    totalFilled,
                    duplicate_serials: duplicateSerials,
                    duplicate_tags: duplicateTags,
                    tag_pics_available: tagPicsAvailable,
                    tag_pics_required: tagPicsRequired,
                };
            });

            setSiteStats(results);

            // 6. Calculate aggregated stats
            const aggByCategory: Record<CategoryKey, CategoryStats> = {
                'Enclosure-Active': { total: 0, filled: 0 },
                'Enclosure-Passive': { total: 0, filled: 0 },
                'RAN-Active': { total: 0, filled: 0 },
                'RAN-Passive': { total: 0, filled: 0 },
                'MW-Active': { total: 0, filled: 0 },
                'MW-Passive': { total: 0, filled: 0 },
            };

            let aggTotalRows = 0;
            let aggTotalFilled = 0;
            let aggDuplicateSerials = 0;
            let aggDuplicateTags = 0;
            let aggTagPicsAvailable = 0;
            let aggTagPicsRequired = 0;
            let submittedSites = 0;  // Sites with completion > 10%
            let pendingSites = 0;    // Sites with completion <= 10%

            results.forEach(site => {
                CATEGORIES.forEach(cat => {
                    aggByCategory[cat].total += site.categories[cat].total;
                    aggByCategory[cat].filled += site.categories[cat].filled;
                });
                aggTotalRows += site.totalRows;
                aggTotalFilled += site.totalFilled;
                aggDuplicateSerials += site.duplicate_serials;
                aggDuplicateTags += site.duplicate_tags;
                aggTagPicsAvailable += site.tag_pics_available;
                aggTagPicsRequired += site.tag_pics_required;
                
                // Calculate site completion percentage for submitted/pending classification
                const siteCompletionPct = site.totalRows > 0 
                    ? (site.totalFilled / site.totalRows) * 100 
                    : 0;
                if (siteCompletionPct > 10) {
                    submittedSites++;
                } else {
                    pendingSites++;
                }
            });

            setAggregatedStats({
                totalSites: results.length,
                submittedSites,
                pendingSites,
                totalRows: aggTotalRows,
                totalFilled: aggTotalFilled,
                byCategory: aggByCategory,
                totalDuplicateSerials: aggDuplicateSerials,
                totalDuplicateTags: aggDuplicateTags,
                totalTagPicsAvailable: aggTagPicsAvailable,
                totalTagPicsRequired: aggTagPicsRequired,
            });

        } catch (err) {
            console.error('Dashboard Error:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, selectedCity, selectedFME]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    // Month options
    const MONTHS = [
        { value: '1', label: 'January', start: '2026-01-01', end: '2026-01-31' },
        { value: '2', label: 'February', start: '2026-02-01', end: '2026-02-28' },
        { value: '3', label: 'March', start: '2026-03-01', end: '2026-03-31' },
        { value: '4', label: 'April', start: '2026-04-01', end: '2026-04-30' },
        { value: '5', label: 'May', start: '2026-05-01', end: '2026-05-31' },
        { value: '6', label: 'June', start: '2026-06-01', end: '2026-06-30' },
        { value: '7', label: 'July', start: '2026-07-01', end: '2026-07-31' },
        { value: '8', label: 'August', start: '2026-08-01', end: '2026-08-31' },
        { value: '9', label: 'September', start: '2026-09-01', end: '2026-09-30' },
        { value: '10', label: 'October', start: '2026-10-01', end: '2026-10-31' },
        { value: '11', label: 'November', start: '2026-11-01', end: '2026-11-30' },
        { value: '12', label: 'December', start: '2026-12-01', end: '2026-12-31' },
    ];
    
    // Quarter options
    const QUARTERS = [
        { value: 'Q1', label: 'Q1 (Jan-Mar)', start: '2026-01-01', end: '2026-03-31' },
        { value: 'Q2', label: 'Q2 (Apr-Jun)', start: '2026-04-01', end: '2026-06-30' },
        { value: 'Q3', label: 'Q3 (Jul-Sep)', start: '2026-07-01', end: '2026-09-30' },
        { value: 'Q4', label: 'Q4 (Oct-Dec)', start: '2026-10-01', end: '2026-12-31' },
    ];
    
    // Handle month selection
    const handleMonthChange = (monthValue: string) => {
        const month = MONTHS.find(m => m.value === monthValue);
        if (month) {
            setSelectedMonthState(monthValue);
            setSelectedQuarterState('');
            setStartDateState(month.start);
            setEndDateState(month.end);
            updateUrlParams({ 
                month: monthValue, 
                quarter: '', 
                startDate: month.start, 
                endDate: month.end 
            });
        }
    };
    
    // Handle quarter selection
    const handleQuarterChange = (quarterValue: string) => {
        const quarter = QUARTERS.find(q => q.value === quarterValue);
        if (quarter) {
            setSelectedQuarterState(quarterValue);
            setSelectedMonthState('');
            setStartDateState(quarter.start);
            setEndDateState(quarter.end);
            updateUrlParams({ 
                quarter: quarterValue, 
                month: '', 
                startDate: quarter.start, 
                endDate: quarter.end 
            });
        }
    };

    const getPercentage = (filled: number, total: number): number => {
        return total > 0 ? Math.round((filled / total) * 100) : 0;
    };

    const getProgressColor = (percentage: number): string => {
        if (percentage >= 80) return 'bg-green-500';
        if (percentage >= 50) return 'bg-yellow-500';
        if (percentage >= 25) return 'bg-orange-500';
        return 'bg-red-500';
    };

    // Helper to check if an aggregated row passes the completion filter
    const passesCompletionFilter = (
        categories: Record<CategoryKey, CategoryStats>,
        totalFilled: number,
        totalRows: number
    ): boolean => {
        if (!filterByCategory || !completionThreshold) return true;
        
        let pct: number;
        
        if (filterByCategory === 'overall') {
            pct = getPercentage(totalFilled, totalRows);
        } else {
            const stats = categories[filterByCategory as CategoryKey];
            pct = getPercentage(stats.filled, stats.total);
        }
        
        // Handle gte90 (>=90%) separately
        if (completionThreshold === 'gte90') {
            return pct >= 90;
        }
        
        const threshold = parseInt(completionThreshold);
        return pct <= threshold;
    };

    // Filter siteStats based on completion filter
    const filteredSiteStats = siteStats.filter(site => 
        passesCompletionFilter(site.categories, site.totalFilled, site.totalRows)
    );

    // Compute filtered aggregated stats when filter is active
    const displayStats = React.useMemo(() => {
        if (!aggregatedStats) return null;
        
        // If no filter active, return original stats
        if (!filterByCategory || !completionThreshold) {
            return aggregatedStats;
        }

        // Recalculate stats based on filtered sites
        const aggByCategory: Record<CategoryKey, CategoryStats> = {
            'Enclosure-Active': { total: 0, filled: 0 },
            'Enclosure-Passive': { total: 0, filled: 0 },
            'RAN-Active': { total: 0, filled: 0 },
            'RAN-Passive': { total: 0, filled: 0 },
            'MW-Active': { total: 0, filled: 0 },
            'MW-Passive': { total: 0, filled: 0 },
        };

        let aggTotalRows = 0;
        let aggTotalFilled = 0;
        let aggDuplicateSerials = 0;
        let aggDuplicateTags = 0;
        let aggTagPicsAvailable = 0;
        let aggTagPicsRequired = 0;
        let submittedSites = 0;
        let pendingSites = 0;

        filteredSiteStats.forEach(site => {
            CATEGORIES.forEach(cat => {
                aggByCategory[cat].total += site.categories[cat].total;
                aggByCategory[cat].filled += site.categories[cat].filled;
            });
            aggTotalRows += site.totalRows;
            aggTotalFilled += site.totalFilled;
            aggDuplicateSerials += site.duplicate_serials;
            aggDuplicateTags += site.duplicate_tags;
            aggTagPicsAvailable += site.tag_pics_available;
            aggTagPicsRequired += site.tag_pics_required;
            
            const siteCompletionPct = site.totalRows > 0 
                ? (site.totalFilled / site.totalRows) * 100 
                : 0;
            if (siteCompletionPct > 10) {
                submittedSites++;
            } else {
                pendingSites++;
            }
        });

        return {
            totalSites: filteredSiteStats.length,
            submittedSites,
            pendingSites,
            totalRows: aggTotalRows,
            totalFilled: aggTotalFilled,
            byCategory: aggByCategory,
            totalDuplicateSerials: aggDuplicateSerials,
            totalDuplicateTags: aggDuplicateTags,
            totalTagPicsAvailable: aggTagPicsAvailable,
            totalTagPicsRequired: aggTagPicsRequired,
        };
    }, [aggregatedStats, filteredSiteStats, filterByCategory, completionThreshold]);

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4">

                {/* Header / Date Selection */}
                <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                    <h2 className="text-xl font-semibold text-slate-900 mb-4">PMR Completion Dashboard</h2>
                    
                    <div className="flex flex-wrap gap-4 items-end">
                        {/* Start Date */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Start Date</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* End Date */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">End Date</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* City Filter */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">City/Area</label>
                            <select
                                value={selectedCity}
                                onChange={(e) => setSelectedCity(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
                            >
                                <option value="">All Cities</option>
                                {cities.map(city => (
                                    <option key={city} value={city}>{city}</option>
                                ))}
                            </select>
                        </div>

                        {/* FME/NFO Filter - Cascaded based on City */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">NFO (FME)</label>
                            <select
                                value={selectedFME}
                                onChange={(e) => setSelectedFME(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
                            >
                                <option value="">All NFOs{selectedCity ? ` in ${selectedCity}` : ''}</option>
                                {filteredFmeNames.map(fme => (
                                    <option key={fme} value={fme}>{fme}</option>
                                ))}
                            </select>
                        </div>

                        {/* Month Filter */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Month</label>
                            <select
                                value={selectedMonth}
                                onChange={(e) => handleMonthChange(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[130px]"
                            >
                                <option value="">Select Month</option>
                                {MONTHS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Quarter Filter */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Quarter</label>
                            <select
                                value={selectedQuarter}
                                onChange={(e) => handleQuarterChange(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[140px]"
                            >
                                <option value="">Select Quarter</option>
                                {QUARTERS.map(q => (
                                    <option key={q.value} value={q.value}>{q.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Separator */}
                        <div className="h-10 w-px bg-slate-300 self-end"></div>

                        {/* Completion Filter - Category Selection */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Filter Category</label>
                            <select
                                value={filterByCategory}
                                onChange={(e) => setFilterByCategory(e.target.value as '' | CategoryKey | 'overall')}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-w-[140px]"
                            >
                                <option value="">Select Category</option>
                                <option value="overall">Overall</option>
                                {CATEGORIES.map(cat => (
                                    <option key={cat} value={cat}>{CATEGORY_DISPLAY_NAMES[cat]}</option>
                                ))}
                            </select>
                        </div>

                        {/* Completion Filter - Threshold */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Completion</label>
                            <select
                                value={completionThreshold}
                                onChange={(e) => setCompletionThreshold(e.target.value as '' | 'gte90' | '90' | '85' | '80' | '75' | '70' | '10')}
                                disabled={!filterByCategory}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <option value="">All</option>
                                <option value="gte90">≥ 90%</option>
                                <option value="90">≤ 90%</option>
                                <option value="85">≤ 85%</option>
                                <option value="80">≤ 80%</option>
                                <option value="75">≤ 75%</option>
                                <option value="70">≤ 70%</option>
                                <option value="10">≤ 10%</option>
                            </select>
                        </div>

                        {/* Clear Completion Filter */}
                        {(completionThreshold || filterByCategory) && (
                            <button
                                onClick={() => { 
                                    setCompletionThreshold('');
                                    setFilterByCategory('');
                                }}
                                className="px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors self-end"
                            >
                                Clear %
                            </button>
                        )}

                        {/* Clear Filters */}
                        {(selectedCity || selectedFME) && (
                            <button
                                onClick={() => { 
                                    setSelectedCityState(''); 
                                    setSelectedFMEState(''); 
                                    updateUrlParams({ city: '', fme: '' });
                                }}
                                className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                            >
                                Clear Filters
                            </button>
                        )}

                        {/* Refresh Button */}
                        <button
                            onClick={fetchDashboardData}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>

                    {/* Active Filters Display */}
                    {(selectedCity || selectedFME) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {selectedCity && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                                    City: {selectedCity}
                                    <button onClick={() => setSelectedCity('')} className="hover:text-blue-900">×</button>
                                </span>
                            )}
                            {selectedFME && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                                    NFO: {selectedFME.split(' ')[0]}...
                                    <button onClick={() => setSelectedFME('')} className="hover:text-green-900">×</button>
                                </span>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Aggregated Stats */}
                {displayStats && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-900">Overall Summary</h3>
                            {filterByCategory && completionThreshold && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                    Filtered: {filterByCategory === 'overall' ? 'Overall' : CATEGORY_DISPLAY_NAMES[filterByCategory as CategoryKey]} {completionThreshold === 'gte90' ? '≥ 90' : `≤ ${completionThreshold}`}%
                                </span>
                            )}
                        </div>
                        
                        {/* Top Level Stats */}
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-slate-900">{displayStats.totalSites}</div>
                                <div className="text-sm text-slate-600">Total Sites</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="flex flex-col gap-1">
                                    <div className="text-lg font-bold text-green-600">
                                        S: {displayStats.submittedSites}
                                    </div>
                                    <div className="text-lg font-bold text-orange-600">
                                        P: {displayStats.pendingSites}
                                    </div>
                                </div>
                                <div className="text-sm text-slate-600">Submitted / Pending</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-slate-900">{displayStats.totalRows}</div>
                                <div className="text-sm text-slate-600">Total Rows</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-green-600">{displayStats.totalFilled}</div>
                                <div className="text-sm text-slate-600">Completed Rows</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-blue-600">
                                    {getPercentage(displayStats.totalFilled, displayStats.totalRows)}%
                                </div>
                                <div className="text-sm text-slate-600">Overall Completion</div>
                            </div>
                            <div className={`rounded-lg p-4 ${displayStats.totalDuplicateSerials + displayStats.totalDuplicateTags > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                                <div className="flex flex-col gap-1">
                                    <div className={`text-lg font-bold ${displayStats.totalDuplicateSerials > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        S: {displayStats.totalDuplicateSerials > 0 ? displayStats.totalDuplicateSerials : '✓'}
                                    </div>
                                    <div className={`text-lg font-bold ${displayStats.totalDuplicateTags > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        T: {displayStats.totalDuplicateTags > 0 ? displayStats.totalDuplicateTags : '✓'}
                                    </div>
                                </div>
                                <div className="text-sm text-slate-600">Duplicates</div>
                            </div>
                            <div className={`rounded-lg p-4 ${displayStats.totalTagPicsAvailable === displayStats.totalTagPicsRequired ? 'bg-green-50' : 'bg-orange-50'}`}>
                                <div className={`text-2xl font-bold ${displayStats.totalTagPicsAvailable === displayStats.totalTagPicsRequired ? 'text-green-600' : 'text-orange-600'}`}>
                                    {displayStats.totalTagPicsAvailable}/{displayStats.totalTagPicsRequired}
                                </div>
                                <div className="text-sm text-slate-600">
                                    Tag Pictures ({displayStats.totalTagPicsRequired > 0 ? Math.round((displayStats.totalTagPicsAvailable / displayStats.totalTagPicsRequired) * 100) : 0}%)
                                </div>
                                {displayStats.totalTagPicsRequired - displayStats.totalTagPicsAvailable > 0 && (
                                    <div className="text-sm text-red-600 font-medium">
                                        {displayStats.totalTagPicsRequired - displayStats.totalTagPicsAvailable} missing
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Category Breakdown */}
                        <h4 className="text-md font-medium text-slate-800 mb-3">By Category</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                            {CATEGORIES.map(cat => {
                                const stats = displayStats.byCategory[cat];
                                const pct = getPercentage(stats.filled, stats.total);
                                return (
                                    <div key={cat} className="bg-slate-50 rounded-lg p-4">
                                        <div className="text-sm font-medium text-slate-700 mb-2">
                                            {CATEGORY_DISPLAY_NAMES[cat]}
                                        </div>
                                        <div className="flex items-baseline gap-1 mb-2">
                                            <span className="text-lg font-bold text-slate-900">{stats.filled}</span>
                                            <span className="text-sm text-slate-500">/ {stats.total}</span>
                                        </div>
                                        <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${getProgressColor(pct)} transition-all`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">{pct}%</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Area Performance Summary */}
                {siteStats.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-900">Area Performance</h3>
                            {filterByCategory && completionThreshold && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                    Filter: {filterByCategory === 'overall' ? 'Overall' : CATEGORY_DISPLAY_NAMES[filterByCategory as CategoryKey]} {completionThreshold === 'gte90' ? '≥ 90' : `≤ ${completionThreshold}`}%
                                </span>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">Area/City</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">Sites</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">NFOs</th>
                                        {CATEGORIES.map(cat => (
                                            <th key={cat} className="text-center px-3 py-3 font-medium text-slate-700 whitespace-nowrap text-xs">
                                                {CATEGORY_DISPLAY_NAMES[cat]}
                                            </th>
                                        ))}
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Total</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">Duplicates</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">Tag Pics</th>
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Completion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {(() => {
                                        // Aggregate by city
                                        const cityMap = new Map<string, {
                                            sites: Set<string>;
                                            nfos: Set<string>;
                                            categories: Record<CategoryKey, CategoryStats>;
                                            totalRows: number;
                                            totalFilled: number;
                                            duplicate_serials: number;
                                            duplicate_tags: number;
                                            tag_pics_available: number;
                                            tag_pics_required: number;
                                        }>();
                                        
                                        // Use filteredSiteStats to aggregate only sites that pass the filter
                                        filteredSiteStats.forEach(site => {
                                            const city = site.city || 'Unknown';
                                            if (!cityMap.has(city)) {
                                                cityMap.set(city, {
                                                    sites: new Set(),
                                                    nfos: new Set(),
                                                    categories: {
                                                        'Enclosure-Active': { total: 0, filled: 0 },
                                                        'Enclosure-Passive': { total: 0, filled: 0 },
                                                        'RAN-Active': { total: 0, filled: 0 },
                                                        'RAN-Passive': { total: 0, filled: 0 },
                                                        'MW-Active': { total: 0, filled: 0 },
                                                        'MW-Passive': { total: 0, filled: 0 },
                                                    },
                                                    totalRows: 0,
                                                    totalFilled: 0,
                                                    duplicate_serials: 0,
                                                    duplicate_tags: 0,
                                                    tag_pics_available: 0,
                                                    tag_pics_required: 0,
                                                });
                                            }
                                            const data = cityMap.get(city)!;
                                            data.sites.add(site.site_id);
                                            if (site.fme_name) data.nfos.add(site.fme_name);
                                            CATEGORIES.forEach(cat => {
                                                data.categories[cat].total += site.categories[cat].total;
                                                data.categories[cat].filled += site.categories[cat].filled;
                                            });
                                            data.totalRows += site.totalRows;
                                            data.totalFilled += site.totalFilled;
                                            data.duplicate_serials += site.duplicate_serials;
                                            data.duplicate_tags += site.duplicate_tags;
                                            data.tag_pics_available += site.tag_pics_available;
                                            data.tag_pics_required += site.tag_pics_required;
                                        });
                                        
                                        // Sort by completion percentage descending
                                        const sortedCities = Array.from(cityMap.entries())
                                            .sort((a, b) => {
                                                const pctA = a[1].totalRows > 0 ? a[1].totalFilled / a[1].totalRows : 0;
                                                const pctB = b[1].totalRows > 0 ? b[1].totalFilled / b[1].totalRows : 0;
                                                return pctB - pctA;
                                            });
                                        
                                        if (sortedCities.length === 0) {
                                            return (
                                                <tr>
                                                    <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                                                        No areas match the selected completion filter
                                                    </td>
                                                </tr>
                                            );
                                        }
                                        
                                        return sortedCities.map(([city, data]) => {
                                            const overallPct = getPercentage(data.totalFilled, data.totalRows);
                                            return (
                                                <tr key={city} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-medium text-slate-900">{city}</td>
                                                    <td className="px-3 py-3 text-center text-slate-700">{data.sites.size}</td>
                                                    <td className="px-3 py-3 text-center text-slate-700">{data.nfos.size}</td>
                                                    {CATEGORIES.map(cat => {
                                                        const stats = data.categories[cat];
                                                        const pct = getPercentage(stats.filled, stats.total);
                                                        return (
                                                            <td key={cat} className="px-3 py-3 text-center text-xs">
                                                                {stats.total > 0 ? (
                                                                    <span className={`${pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                                        {pct}%
                                                                    </span>
                                                                ) : '-'}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="px-4 py-3 text-center text-slate-700">
                                                        {data.totalFilled}/{data.totalRows}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <div className="flex flex-col items-center gap-0.5">
                                                            <span className={`text-xs font-medium ${data.duplicate_serials > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                                S: {data.duplicate_serials > 0 ? data.duplicate_serials : '✓'}
                                                            </span>
                                                            <span className={`text-xs font-medium ${data.duplicate_tags > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                                T: {data.duplicate_tags > 0 ? data.duplicate_tags : '✓'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        {data.tag_pics_required > 0 ? (
                                                            <div className="flex flex-col items-center">
                                                                <span className={`text-xs font-medium ${data.tag_pics_available === data.tag_pics_required ? 'text-green-600' : 'text-orange-600'}`}>
                                                                    {data.tag_pics_available}/{data.tag_pics_required}
                                                                </span>
                                                                {data.tag_pics_required - data.tag_pics_available > 0 && (
                                                                    <span className="text-xs text-red-600">
                                                                        {data.tag_pics_required - data.tag_pics_available} missing
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                                                                <div className={`h-full ${getProgressColor(overallPct)}`} style={{ width: `${overallPct}%` }} />
                                                            </div>
                                                            <span className={`text-sm font-medium ${overallPct >= 80 ? 'text-green-600' : overallPct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                                {overallPct}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* NFO Performance Summary */}
                {siteStats.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-900">NFO Performance</h3>
                            {filterByCategory && completionThreshold && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                    Filter: {filterByCategory === 'overall' ? 'Overall' : CATEGORY_DISPLAY_NAMES[filterByCategory as CategoryKey]} ≤ {completionThreshold}%
                                </span>
                            )}
                        </div>
                        <div className="overflow-x-auto max-h-96">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">NFO Name</th>
                                        <th className="text-left px-3 py-3 font-medium text-slate-700">Area</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">Sites</th>
                                        {CATEGORIES.map(cat => (
                                            <th key={cat} className="text-center px-3 py-3 font-medium text-slate-700 whitespace-nowrap text-xs">
                                                {CATEGORY_DISPLAY_NAMES[cat]}
                                            </th>
                                        ))}
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Total</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">Duplicates</th>
                                        <th className="text-center px-3 py-3 font-medium text-slate-700">Tag Pics</th>
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Completion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {(() => {
                                        // Aggregate by NFO
                                        const nfoMap = new Map<string, {
                                            cities: Set<string>;
                                            sites: Set<string>;
                                            categories: Record<CategoryKey, CategoryStats>;
                                            totalRows: number;
                                            totalFilled: number;
                                            duplicate_serials: number;
                                            duplicate_tags: number;
                                            tag_pics_available: number;
                                            tag_pics_required: number;
                                        }>();
                                        
                                        // Use filteredSiteStats to aggregate only sites that pass the filter
                                        filteredSiteStats.forEach(site => {
                                            const nfo = site.fme_name || 'Unknown';
                                            if (!nfoMap.has(nfo)) {
                                                nfoMap.set(nfo, {
                                                    cities: new Set(),
                                                    sites: new Set(),
                                                    categories: {
                                                        'Enclosure-Active': { total: 0, filled: 0 },
                                                        'Enclosure-Passive': { total: 0, filled: 0 },
                                                        'RAN-Active': { total: 0, filled: 0 },
                                                        'RAN-Passive': { total: 0, filled: 0 },
                                                        'MW-Active': { total: 0, filled: 0 },
                                                        'MW-Passive': { total: 0, filled: 0 },
                                                    },
                                                    totalRows: 0,
                                                    totalFilled: 0,
                                                    duplicate_serials: 0,
                                                    duplicate_tags: 0,
                                                    tag_pics_available: 0,
                                                    tag_pics_required: 0,
                                                });
                                            }
                                            const data = nfoMap.get(nfo)!;
                                            if (site.city) data.cities.add(site.city);
                                            data.sites.add(site.site_id);
                                            CATEGORIES.forEach(cat => {
                                                data.categories[cat].total += site.categories[cat].total;
                                                data.categories[cat].filled += site.categories[cat].filled;
                                            });
                                            data.totalRows += site.totalRows;
                                            data.totalFilled += site.totalFilled;
                                            data.duplicate_serials += site.duplicate_serials;
                                            data.duplicate_tags += site.duplicate_tags;
                                            data.tag_pics_available += site.tag_pics_available;
                                            data.tag_pics_required += site.tag_pics_required;
                                        });
                                        
                                        // Sort by completion percentage descending
                                        const sortedNFOs = Array.from(nfoMap.entries())
                                            .sort((a, b) => {
                                                const pctA = a[1].totalRows > 0 ? a[1].totalFilled / a[1].totalRows : 0;
                                                const pctB = b[1].totalRows > 0 ? b[1].totalFilled / b[1].totalRows : 0;
                                                return pctB - pctA;
                                            });
                                        
                                        if (sortedNFOs.length === 0) {
                                            return (
                                                <tr>
                                                    <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                                                        No NFOs match the selected completion filter
                                                    </td>
                                                </tr>
                                            );
                                        }
                                        
                                        return sortedNFOs.map(([nfo, data]) => {
                                            const overallPct = getPercentage(data.totalFilled, data.totalRows);
                                            return (
                                                <tr key={nfo} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-medium text-slate-900">{nfo}</td>
                                                    <td className="px-3 py-3 text-slate-600 text-xs">
                                                        {Array.from(data.cities).join(', ')}
                                                    </td>
                                                    <td className="px-3 py-3 text-center text-slate-700">{data.sites.size}</td>
                                                    {CATEGORIES.map(cat => {
                                                        const stats = data.categories[cat];
                                                        const pct = getPercentage(stats.filled, stats.total);
                                                        return (
                                                            <td key={cat} className="px-3 py-3 text-center text-xs">
                                                                {stats.total > 0 ? (
                                                                    <span className={`${pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                                        {pct}%
                                                                    </span>
                                                                ) : '-'}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="px-4 py-3 text-center text-slate-700">
                                                        {data.totalFilled}/{data.totalRows}
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <div className="flex flex-col items-center gap-0.5">
                                                            <span className={`text-xs font-medium ${data.duplicate_serials > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                                S: {data.duplicate_serials > 0 ? data.duplicate_serials : '✓'}
                                                            </span>
                                                            <span className={`text-xs font-medium ${data.duplicate_tags > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                                T: {data.duplicate_tags > 0 ? data.duplicate_tags : '✓'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        {data.tag_pics_required > 0 ? (
                                                            <div className="flex flex-col items-center">
                                                                <span className={`text-xs font-medium ${data.tag_pics_available === data.tag_pics_required ? 'text-green-600' : 'text-orange-600'}`}>
                                                                    {data.tag_pics_available}/{data.tag_pics_required}
                                                                </span>
                                                                {data.tag_pics_required - data.tag_pics_available > 0 && (
                                                                    <span className="text-xs text-red-600">
                                                                        {data.tag_pics_required - data.tag_pics_available} missing
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                                                                <div className={`h-full ${getProgressColor(overallPct)}`} style={{ width: `${overallPct}%` }} />
                                                            </div>
                                                            <span className={`text-sm font-medium ${overallPct >= 80 ? 'text-green-600' : overallPct >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                                {overallPct}%
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Per-Site Table */}
                {filteredSiteStats.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-slate-900">Site Details</h3>
                                <p className="text-sm text-slate-500">{filteredSiteStats.length} sites{filterByCategory && completionThreshold ? ' (filtered)' : ' in selected date range'}</p>
                            </div>
                            {filterByCategory && completionThreshold && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                    {filterByCategory === 'overall' ? 'Overall' : CATEGORY_DISPLAY_NAMES[filterByCategory as CategoryKey]} {completionThreshold === 'gte90' ? '≥ 90' : `≤ ${completionThreshold}`}%
                                </span>
                            )}
                        </div>
                        
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700 sticky left-0 bg-slate-50">Site ID</th>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">Planned Date</th>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">City</th>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">NFO</th>
                                        {CATEGORIES.map(cat => (
                                            <th key={cat} className="text-center px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                                                {CATEGORY_DISPLAY_NAMES[cat]}
                                            </th>
                                        ))}
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Total</th>
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">%</th>
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Duplicates</th>
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Tag Pics</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredSiteStats.map((site, idx) => {
                                        const overallPct = getPercentage(site.totalFilled, site.totalRows);
                                        return (
                                            <tr key={`${site.site_id}-${idx}`} className="hover:bg-slate-50">
                                                <td className="px-4 py-3 font-medium text-slate-900 sticky left-0 bg-white">
                                                    {site.site_id}
                                                </td>
                                                <td className="px-4 py-3 text-slate-600">{site.planned_date}</td>
                                                <td className="px-4 py-3 text-slate-600">{site.city}</td>
                                                <td className="px-4 py-3 text-slate-600 max-w-[150px] truncate" title={site.fme_name}>
                                                    {site.fme_name ? site.fme_name.split(' ').slice(0, 2).join(' ') : '-'}
                                                </td>
                                                {CATEGORIES.map(cat => {
                                                    const stats = site.categories[cat];
                                                    const pct = getPercentage(stats.filled, stats.total);
                                                    return (
                                                        <td key={cat} className="px-3 py-3 text-center">
                                                            {stats.total > 0 ? (
                                                                <div className="inline-flex flex-col items-center">
                                                                    <span className="text-slate-700">
                                                                        {stats.filled}/{stats.total}
                                                                    </span>
                                                                    <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                                                                        <div
                                                                            className={`h-full ${getProgressColor(pct)}`}
                                                                            style={{ width: `${pct}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-4 py-3 text-center font-medium text-slate-900">
                                                    {site.totalFilled}/{site.totalRows}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                                                        overallPct >= 80 ? 'bg-green-100 text-green-700' :
                                                        overallPct >= 50 ? 'bg-yellow-100 text-yellow-700' :
                                                        overallPct >= 25 ? 'bg-orange-100 text-orange-700' :
                                                        'bg-red-100 text-red-700'
                                                    }`}>
                                                        {overallPct}%
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span className={`text-xs font-medium ${site.duplicate_serials > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                            S: {site.duplicate_serials > 0 ? site.duplicate_serials : '✓'}
                                                        </span>
                                                        <span className={`text-xs font-medium ${site.duplicate_tags > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                            T: {site.duplicate_tags > 0 ? site.duplicate_tags : '✓'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {site.tag_pics_required > 0 ? (
                                                        <div className="flex flex-col items-center">
                                                            <span className={`font-medium ${
                                                                site.tag_pics_available === site.tag_pics_required ? 'text-green-600' : 
                                                                site.tag_pics_available < site.tag_pics_required ? 'text-orange-600' : 'text-slate-900'
                                                            }`}>
                                                                {site.tag_pics_available}/{site.tag_pics_required}
                                                            </span>
                                                            {site.tag_pics_required - site.tag_pics_available > 0 && (
                                                                <span className="text-xs text-red-600">
                                                                    {site.tag_pics_required - site.tag_pics_available} missing
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-400">-</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {!loading && siteStats.length === 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
                        <div className="text-slate-400 text-lg mb-2">No Data</div>
                        <p className="text-slate-500 text-sm">
                            No PMR plans found for the selected date range.
                            <br />
                            Try adjusting the dates or using a preset.
                        </p>
                    </div>
                )}

                {/* Loading State */}
                {loading && (
                    <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
                        <div className="text-blue-600 text-lg">Loading dashboard data...</div>
                    </div>
                )}

            </div>
        </main>
    );
}
