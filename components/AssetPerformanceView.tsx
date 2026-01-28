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
    City: string;
    FME_Name: string;
}

interface InventoryRow {
    site_id: string;
    category: string;
    tag_category: string | null;
    photo_category: string | null;
}

// Extended inventory row with NFO info for CSV export
interface InventoryRowWithNFO extends InventoryRow {
    fme_name: string;
    city: string;
    planned_date: string;
    serial_number?: string;
    tag_id?: string;
    product_name?: string;
}

type CategoryKey = 'Enclosure-Active' | 'Enclosure-Passive' | 'RAN-Active' | 'RAN-Passive' | 'MW-Active' | 'MW-Passive';

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

// Asset performance data structure
interface AssetCategoryData {
    category: CategoryKey;
    total: number;
    byTagCategory: Record<string, number>;
    byPhotoCategory: Record<string, number>;
}

// --- Component ---
export default function AssetPerformanceView() {
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

    // Data states
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [assetData, setAssetData] = useState<AssetCategoryData[]>([]);
    const [tagCategoryOptions, setTagCategoryOptions] = useState<string[]>([]);
    const [photoCategoryOptions, setPhotoCategoryOptions] = useState<string[]>([]);
    const [totalSites, setTotalSites] = useState(0);

    // CSV Download states
    const [showDownloadModal, setShowDownloadModal] = useState(false);
    const [selectedTagCatsForDownload, setSelectedTagCatsForDownload] = useState<Set<string>>(new Set());
    const [selectedPhotoCatsForDownload, setSelectedPhotoCatsForDownload] = useState<Set<string>>(new Set());
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [rawInventoryData, setRawInventoryData] = useState<InventoryRowWithNFO[]>([]);

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

    // Sync URL changes to state
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

    // Fetch filter options on mount
    useEffect(() => {
        const fetchFilterOptions = async () => {
            const { data: cityFmeData } = await supabase
                .from('pmr_plan_2026_sheet1')
                .select('City, FME_Name')
                .not('City', 'is', null)
                .not('FME_Name', 'is', null);
            
            if (cityFmeData) {
                const uniqueCities = [...new Set(cityFmeData.map(r => r.City as string))].sort();
                setCities(uniqueCities);
                
                const allFME = [...new Set(cityFmeData.map(r => r.FME_Name as string))].sort();
                setFmeNames(allFME);
                
                const mapping = new Map<string, Set<string>>();
                cityFmeData.forEach(row => {
                    const city = row.City as string;
                    const fme = row.FME_Name as string;
                    if (!mapping.has(city)) mapping.set(city, new Set());
                    mapping.get(city)!.add(fme);
                });
                
                const finalMap = new Map<string, string[]>();
                mapping.forEach((fmeSet, city) => {
                    finalMap.set(city, [...fmeSet].sort());
                });
                setCityFmeMap(finalMap);
            }
        };
        fetchFilterOptions();
    }, []);

    // Load tag and photo category options
    useEffect(() => {
        const loadCategoryOptions = async () => {
            const [tagRes, photoRes] = await Promise.all([
                supabase.from('tag_category_helper').select('value').order('sort_order', { ascending: true }),
                supabase.from('photo_category_helper').select('value').order('sort_order', { ascending: true })
            ]);
            if (tagRes.data) {
                setTagCategoryOptions(tagRes.data.map(r => r.value));
            }
            if (photoRes.data) {
                setPhotoCategoryOptions(photoRes.data.map(r => r.value));
            }
        };
        loadCategoryOptions();
    }, []);

    // Get filtered NFO list based on selected city
    const filteredFmeNames = selectedCity 
        ? cityFmeMap.get(selectedCity) || []
        : fmeNames;

    // When city changes, reset NFO if not valid
    useEffect(() => {
        if (selectedCity && selectedFME) {
            const validFMEs = cityFmeMap.get(selectedCity) || [];
            if (!validFMEs.includes(selectedFME)) {
                setSelectedFME('');
            }
        }
    }, [selectedCity, selectedFME, cityFmeMap]);

    // Fetch asset performance data
    const fetchAssetData = useCallback(async () => {
        if (!startDate || !endDate) return;
        
        setLoading(true);
        setError(null);

        try {
            // 1. Fetch PMR plans within date range with optional filters
            let query = supabase
                .from('pmr_plan_2026_sheet1')
                .select('Site_ID, Site_ID_1, Planned_PMR_Date, City, FME_Name')
                .gte('Planned_PMR_Date', startDate)
                .lte('Planned_PMR_Date', endDate);
            
            if (selectedCity) query = query.eq('City', selectedCity);
            if (selectedFME) query = query.eq('FME_Name', selectedFME);
            
            const { data: plansData, error: plansError } = await query.order('Planned_PMR_Date', { ascending: true });

            if (plansError) throw new Error(`Failed to fetch PMR plans: ${plansError.message}`);

            const plans = (plansData as unknown as PMRPlan[]) || [];

            if (plans.length === 0) {
                setAssetData([]);
                setTotalSites(0);
                setRawInventoryData([]);
                setLoading(false);
                return;
            }

            // 2. Collect all site IDs and build site -> NFO mapping
            const allSiteIds = new Set<string>();
            const siteToNFOMap = new Map<string, { fme_name: string; city: string; planned_date: string }>();
            plans.forEach(p => {
                const siteId = p.Site_ID_1 || (p.Site_ID && !p.Site_ID.startsWith('W') ? `W${p.Site_ID}` : p.Site_ID);
                if (siteId) {
                    allSiteIds.add(siteId);
                    siteToNFOMap.set(siteId, {
                        fme_name: p.FME_Name || '',
                        city: p.City || '',
                        planned_date: p.Planned_PMR_Date || ''
                    });
                }
            });

            setTotalSites(allSiteIds.size);

            // 3. Fetch inventory data
            const siteIdArray = Array.from(allSiteIds);
            const BATCH_SIZE = 100;
            
            const batches: string[][] = [];
            for (let i = 0; i < siteIdArray.length; i += BATCH_SIZE) {
                batches.push(siteIdArray.slice(i, i + BATCH_SIZE));
            }
            
            const fetchBatch = async (batch: string[]): Promise<InventoryRow[]> => {
                const results: InventoryRow[] = [];
                let hasMore = true;
                let offset = 0;
                const PAGE_SIZE = 1000;
                
                while (hasMore) {
                    const { data, error } = await supabase
                        .from('main_inventory')
                        .select('site_id, category, tag_category, photo_category, serial_number, tag_id, product_name')
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
            
            const batchResults = await Promise.all(batches.map(fetchBatch));
            const inventory = batchResults.flat();

            // Helper to normalize category names (handle case/spacing/wording differences)
            const normalizeCategory = (value: string): string => {
                return value
                    .toLowerCase()
                    .replace(/\s+/g, ' ')  // normalize spaces
                    .replace(/\band\b/g, '&')  // normalize "and" to "&"
                    .trim();
            };

            // Helper to get preferred display name (prefer "&" over "and")
            const getPreferredDisplayName = (existing: string | undefined, newValue: string): string => {
                if (!existing) return newValue.trim();
                // Prefer version with "&" over "and"
                if (existing.includes(' and ') && newValue.includes('&')) {
                    return newValue.trim();
                }
                return existing;
            };

            // 4. Calculate asset performance data per category
            // First pass: collect all variations and map to normalized form
            const tagNormalizedMap = new Map<string, string>(); // normalized -> display form
            const photoNormalizedMap = new Map<string, string>();

            inventory.forEach(row => {
                if (row.tag_category) {
                    const normalized = normalizeCategory(row.tag_category);
                    // Prefer "&" version over "and" version
                    const currentDisplay = tagNormalizedMap.get(normalized);
                    tagNormalizedMap.set(normalized, getPreferredDisplayName(currentDisplay, row.tag_category));
                }
                if (row.photo_category) {
                    const normalized = normalizeCategory(row.photo_category);
                    const currentDisplay = photoNormalizedMap.get(normalized);
                    photoNormalizedMap.set(normalized, getPreferredDisplayName(currentDisplay, row.photo_category));
                }
            });

            const assetPerformance: AssetCategoryData[] = CATEGORIES.map(cat => {
                const catRows = inventory.filter(row => row.category === cat);
                const byTag: Record<string, number> = {};
                const byPhoto: Record<string, number> = {};
                
                catRows.forEach(row => {
                    // Use normalized key but display form for counting
                    const tagRaw = row.tag_category || 'Not Set';
                    const tagNormalized = tagRaw === 'Not Set' ? 'Not Set' : normalizeCategory(tagRaw);
                    const tagDisplay = tagRaw === 'Not Set' ? 'Not Set' : (tagNormalizedMap.get(tagNormalized) || tagRaw);
                    byTag[tagDisplay] = (byTag[tagDisplay] || 0) + 1;
                    
                    const photoRaw = row.photo_category || 'Not Set';
                    const photoNormalized = photoRaw === 'Not Set' ? 'Not Set' : normalizeCategory(photoRaw);
                    const photoDisplay = photoRaw === 'Not Set' ? 'Not Set' : (photoNormalizedMap.get(photoNormalized) || photoRaw);
                    byPhoto[photoDisplay] = (byPhoto[photoDisplay] || 0) + 1;
                });
                
                return {
                    category: cat,
                    total: catRows.length,
                    byTagCategory: byTag,
                    byPhotoCategory: byPhoto,
                };
            });

            setAssetData(assetPerformance);

            // Store raw inventory data with NFO info for CSV export
            const inventoryWithNFO: InventoryRowWithNFO[] = inventory.map(row => {
                const nfoInfo = siteToNFOMap.get(row.site_id) || { fme_name: '', city: '', planned_date: '' };
                // Normalize the category names for display
                const tagRaw = row.tag_category || '';
                const tagNormalized = tagRaw ? normalizeCategory(tagRaw) : '';
                const tagDisplay = tagRaw ? (tagNormalizedMap.get(tagNormalized) || tagRaw) : '';
                
                const photoRaw = row.photo_category || '';
                const photoNormalized = photoRaw ? normalizeCategory(photoRaw) : '';
                const photoDisplay = photoRaw ? (photoNormalizedMap.get(photoNormalized) || photoRaw) : '';
                
                return {
                    ...row,
                    tag_category: tagDisplay || null,
                    photo_category: photoDisplay || null,
                    fme_name: nfoInfo.fme_name,
                    city: nfoInfo.city,
                    planned_date: nfoInfo.planned_date,
                };
            });
            setRawInventoryData(inventoryWithNFO);

        } catch (err) {
            console.error('Asset Performance Error:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, selectedCity, selectedFME]);

    useEffect(() => {
        fetchAssetData();
    }, [fetchAssetData]);

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

    const QUARTERS = [
        { value: 'Q1', label: 'Q1 (Jan-Mar)', start: '2026-01-01', end: '2026-03-31' },
        { value: 'Q2', label: 'Q2 (Apr-Jun)', start: '2026-04-01', end: '2026-06-30' },
        { value: 'Q3', label: 'Q3 (Jul-Sep)', start: '2026-07-01', end: '2026-09-30' },
        { value: 'Q4', label: 'Q4 (Oct-Dec)', start: '2026-10-01', end: '2026-12-31' },
    ];

    const handleMonthChange = (monthValue: string) => {
        setSelectedMonthState(monthValue);
        setSelectedQuarterState('');
        updateUrlParams({ month: monthValue, quarter: '' });
        
        if (monthValue) {
            const month = MONTHS.find(m => m.value === monthValue);
            if (month) {
                setStartDateState(month.start);
                setEndDateState(month.end);
                updateUrlParams({ startDate: month.start, endDate: month.end });
            }
        }
    };

    const handleQuarterChange = (quarterValue: string) => {
        setSelectedQuarterState(quarterValue);
        setSelectedMonthState('');
        updateUrlParams({ quarter: quarterValue, month: '' });
        
        if (quarterValue) {
            const quarter = QUARTERS.find(q => q.value === quarterValue);
            if (quarter) {
                setStartDateState(quarter.start);
                setEndDateState(quarter.end);
                updateUrlParams({ startDate: quarter.start, endDate: quarter.end });
            }
        }
    };

    // Calculate totals
    const totalRows = assetData.reduce((sum, cat) => sum + cat.total, 0);

    // Get all unique tag and photo categories from data
    const allTagCategories = new Set<string>();
    const allPhotoCategories = new Set<string>();
    assetData.forEach(cat => {
        Object.keys(cat.byTagCategory).forEach(k => allTagCategories.add(k));
        Object.keys(cat.byPhotoCategory).forEach(k => allPhotoCategories.add(k));
    });

    // Helper to get color for category values
    const getTagCategoryColor = (category: string): string => {
        if (category === 'Not Set') return 'text-red-600 bg-red-50';
        if (category.toLowerCase().includes('missing')) return 'text-orange-600 bg-orange-50';
        if (category.toLowerCase().includes('available') || category.toLowerCase().includes('visible')) return 'text-green-600 bg-green-50';
        if (category.toLowerCase().includes('dismantled')) return 'text-slate-500 bg-slate-100';
        if (category.toLowerCase().includes('crane')) return 'text-purple-600 bg-purple-50';
        return 'text-blue-600 bg-blue-50';
    };

    // Toggle tag category selection for download
    const toggleTagCatSelection = (cat: string) => {
        setSelectedTagCatsForDownload(prev => {
            const newSet = new Set(prev);
            if (newSet.has(cat)) {
                newSet.delete(cat);
            } else {
                newSet.add(cat);
            }
            return newSet;
        });
    };

    // Toggle photo category selection for download
    const togglePhotoCatSelection = (cat: string) => {
        setSelectedPhotoCatsForDownload(prev => {
            const newSet = new Set(prev);
            if (newSet.has(cat)) {
                newSet.delete(cat);
            } else {
                newSet.add(cat);
            }
            return newSet;
        });
    };

    // Select/deselect all tag categories
    const selectAllTagCats = () => {
        if (selectedTagCatsForDownload.size === allTagCategories.size) {
            setSelectedTagCatsForDownload(new Set());
        } else {
            setSelectedTagCatsForDownload(new Set(allTagCategories));
        }
    };

    // Select/deselect all photo categories
    const selectAllPhotoCats = () => {
        if (selectedPhotoCatsForDownload.size === allPhotoCategories.size) {
            setSelectedPhotoCatsForDownload(new Set());
        } else {
            setSelectedPhotoCatsForDownload(new Set(allPhotoCategories));
        }
    };

    // Normalize for comparison (lowercase, & vs and)
    const normalizeCatForComparison = (value: string): string => {
        return value.toLowerCase().replace(/\s+/g, ' ').replace(/\band\b/g, '&').trim();
    };

    // Download CSV with filtered data
    const downloadCSV = () => {
        if (selectedTagCatsForDownload.size === 0 && selectedPhotoCatsForDownload.size === 0) {
            alert('Please select at least one tag category or photo category to download.');
            return;
        }

        setDownloadLoading(true);

        try {
            // Normalize selected categories for comparison
            const normalizedTagCats = new Set([...selectedTagCatsForDownload].map(normalizeCatForComparison));
            const normalizedPhotoCats = new Set([...selectedPhotoCatsForDownload].map(normalizeCatForComparison));

            // Filter data based on selected categories
            const filteredData = rawInventoryData.filter(row => {
                const tagMatch = selectedTagCatsForDownload.size === 0 || 
                    (row.tag_category && normalizedTagCats.has(normalizeCatForComparison(row.tag_category))) ||
                    (!row.tag_category && normalizedTagCats.has(normalizeCatForComparison('Not Set')));
                
                const photoMatch = selectedPhotoCatsForDownload.size === 0 || 
                    (row.photo_category && normalizedPhotoCats.has(normalizeCatForComparison(row.photo_category))) ||
                    (!row.photo_category && normalizedPhotoCats.has(normalizeCatForComparison('Not Set')));
                
                // If both types selected, row must match at least one from each
                if (selectedTagCatsForDownload.size > 0 && selectedPhotoCatsForDownload.size > 0) {
                    return tagMatch && photoMatch;
                }
                // If only one type selected, match that type
                return tagMatch || photoMatch;
            });

            if (filteredData.length === 0) {
                alert('No data matches the selected criteria.');
                setDownloadLoading(false);
                return;
            }

            // Create CSV content
            const headers = ['Site ID', 'NFO Name', 'City', 'PMR Date', 'Equipment Category', 'Product Name', 'Serial Number', 'Tag ID', 'Tag Category', 'Photo Category'];
            const csvRows = [headers.join(',')];

            filteredData.forEach(row => {
                const values = [
                    row.site_id || '',
                    `"${(row.fme_name || '').replace(/"/g, '""')}"`,
                    `"${(row.city || '').replace(/"/g, '""')}"`,
                    row.planned_date || '',
                    row.category || '',
                    `"${(row.product_name || '').replace(/"/g, '""')}"`,
                    `"${(row.serial_number || '').replace(/"/g, '""')}"`,
                    `"${(row.tag_id || '').replace(/"/g, '""')}"`,
                    `"${(row.tag_category || 'Not Set').replace(/"/g, '""')}"`,
                    `"${(row.photo_category || 'Not Set').replace(/"/g, '""')}"`,
                ];
                csvRows.push(values.join(','));
            });

            const csvContent = csvRows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            
            // Generate filename with filters
            const dateStr = new Date().toISOString().split('T')[0];
            const tagStr = selectedTagCatsForDownload.size > 0 ? `_tag${selectedTagCatsForDownload.size}` : '';
            const photoStr = selectedPhotoCatsForDownload.size > 0 ? `_photo${selectedPhotoCatsForDownload.size}` : '';
            link.download = `asset_performance${tagStr}${photoStr}_${dateStr}.csv`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setShowDownloadModal(false);
        } catch (err) {
            console.error('CSV download error:', err);
            alert('Failed to download CSV. Please try again.');
        } finally {
            setDownloadLoading(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4">

                {/* Header / Filters */}
                <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                    <h2 className="text-xl font-semibold text-slate-900 mb-4">Asset Performance</h2>
                    
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

                        {/* NFO Filter */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">NFO</label>
                            <select
                                value={selectedFME}
                                onChange={(e) => setSelectedFME(e.target.value)}
                                className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
                            >
                                <option value="">All NFOs</option>
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
                            onClick={fetchAssetData}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>

                        {/* Download CSV Button */}
                        {assetData.length > 0 && (
                            <button
                                onClick={() => setShowDownloadModal(true)}
                                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors flex items-center gap-2"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                Download CSV
                            </button>
                        )}
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
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                                    NFO: {selectedFME}
                                    <button onClick={() => setSelectedFME('')} className="hover:text-blue-900">×</button>
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

                {/* Summary Stats */}
                {assetData.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Summary</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-slate-900">{totalSites}</div>
                                <div className="text-sm text-slate-600">Total Sites</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-slate-900">{totalRows}</div>
                                <div className="text-sm text-slate-600">Total Assets</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-blue-600">{allTagCategories.size}</div>
                                <div className="text-sm text-slate-600">Tag Categories</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-4">
                                <div className="text-2xl font-bold text-purple-600">{allPhotoCategories.size}</div>
                                <div className="text-sm text-slate-600">Photo Categories</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Tag Category by Equipment Type */}
                {assetData.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Tag Category Distribution</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">Tag Category</th>
                                        {CATEGORIES.map(cat => (
                                            <th key={cat} className="text-center px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                                                {CATEGORY_DISPLAY_NAMES[cat]}
                                            </th>
                                        ))}
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {/* Sort by putting "Not Set" first, then alphabetically */}
                                    {[...allTagCategories].sort((a, b) => {
                                        if (a === 'Not Set') return -1;
                                        if (b === 'Not Set') return 1;
                                        return a.localeCompare(b);
                                    }).map(tagCat => {
                                        const rowTotal = assetData.reduce((sum, cat) => sum + (cat.byTagCategory[tagCat] || 0), 0);
                                        return (
                                            <tr key={tagCat} className="hover:bg-slate-50">
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${getTagCategoryColor(tagCat)}`}>
                                                        {tagCat}
                                                    </span>
                                                </td>
                                                {assetData.map(catData => (
                                                    <td key={catData.category} className="px-3 py-3 text-center text-slate-700">
                                                        {catData.byTagCategory[tagCat] || 0}
                                                    </td>
                                                ))}
                                                <td className="px-4 py-3 text-center font-semibold text-slate-900">
                                                    {rowTotal}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Total row */}
                                    <tr className="bg-slate-100 font-semibold">
                                        <td className="px-4 py-3 text-slate-700">Total</td>
                                        {assetData.map(catData => (
                                            <td key={catData.category} className="px-3 py-3 text-center text-slate-900">
                                                {catData.total}
                                            </td>
                                        ))}
                                        <td className="px-4 py-3 text-center text-slate-900">{totalRows}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Photo Category by Equipment Type */}
                {assetData.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-6 mb-4 shadow-sm">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">Photo Category Distribution</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="text-left px-4 py-3 font-medium text-slate-700">Photo Category</th>
                                        {CATEGORIES.map(cat => (
                                            <th key={cat} className="text-center px-3 py-3 font-medium text-slate-700 whitespace-nowrap">
                                                {CATEGORY_DISPLAY_NAMES[cat]}
                                            </th>
                                        ))}
                                        <th className="text-center px-4 py-3 font-medium text-slate-700">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {[...allPhotoCategories].sort((a, b) => {
                                        if (a === 'Not Set') return -1;
                                        if (b === 'Not Set') return 1;
                                        return a.localeCompare(b);
                                    }).map(photoCat => {
                                        const rowTotal = assetData.reduce((sum, cat) => sum + (cat.byPhotoCategory[photoCat] || 0), 0);
                                        return (
                                            <tr key={photoCat} className="hover:bg-slate-50">
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${getTagCategoryColor(photoCat)}`}>
                                                        {photoCat}
                                                    </span>
                                                </td>
                                                {assetData.map(catData => (
                                                    <td key={catData.category} className="px-3 py-3 text-center text-slate-700">
                                                        {catData.byPhotoCategory[photoCat] || 0}
                                                    </td>
                                                ))}
                                                <td className="px-4 py-3 text-center font-semibold text-slate-900">
                                                    {rowTotal}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {/* Total row */}
                                    <tr className="bg-slate-100 font-semibold">
                                        <td className="px-4 py-3 text-slate-700">Total</td>
                                        {assetData.map(catData => (
                                            <td key={catData.category} className="px-3 py-3 text-center text-slate-900">
                                                {catData.total}
                                            </td>
                                        ))}
                                        <td className="px-4 py-3 text-center text-slate-900">{totalRows}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {!loading && assetData.length === 0 && (
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
                        <div className="text-blue-600 text-lg">Loading asset performance data...</div>
                    </div>
                )}

            </div>

            {/* Download CSV Modal */}
            {showDownloadModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex justify-between items-center">
                                <h3 className="text-lg font-semibold text-slate-900">Download CSV - Select Categories</h3>
                                <button
                                    onClick={() => setShowDownloadModal(false)}
                                    className="text-slate-400 hover:text-slate-600"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <p className="text-sm text-slate-600 mt-2">
                                Select the Tag Categories and/or Photo Categories you want to include in the CSV export.
                                The CSV will include Site ID, NFO Name, City, PMR Date, Equipment Category, Product Name, Serial Number, Tag ID, and the selected categories.
                            </p>
                        </div>
                        
                        <div className="p-6 overflow-y-auto max-h-[60vh]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Tag Categories Selection */}
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="font-medium text-slate-800">Tag Categories</h4>
                                        <button
                                            onClick={selectAllTagCats}
                                            className="text-xs text-blue-600 hover:text-blue-800"
                                        >
                                            {selectedTagCatsForDownload.size === allTagCategories.size ? 'Deselect All' : 'Select All'}
                                        </button>
                                    </div>
                                    <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-md p-3">
                                        {[...allTagCategories].sort((a, b) => {
                                            if (a === 'Not Set') return -1;
                                            if (b === 'Not Set') return 1;
                                            return a.localeCompare(b);
                                        }).map(cat => {
                                            const count = assetData.reduce((sum, d) => sum + (d.byTagCategory[cat] || 0), 0);
                                            return (
                                                <label key={cat} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTagCatsForDownload.has(cat)}
                                                        onChange={() => toggleTagCatSelection(cat)}
                                                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className={`text-sm px-2 py-0.5 rounded ${getTagCategoryColor(cat)}`}>
                                                        {cat}
                                                    </span>
                                                    <span className="text-xs text-slate-500">({count})</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2 text-xs text-slate-500">
                                        {selectedTagCatsForDownload.size} of {allTagCategories.size} selected
                                    </div>
                                </div>

                                {/* Photo Categories Selection */}
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="font-medium text-slate-800">Photo Categories</h4>
                                        <button
                                            onClick={selectAllPhotoCats}
                                            className="text-xs text-blue-600 hover:text-blue-800"
                                        >
                                            {selectedPhotoCatsForDownload.size === allPhotoCategories.size ? 'Deselect All' : 'Select All'}
                                        </button>
                                    </div>
                                    <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-200 rounded-md p-3">
                                        {[...allPhotoCategories].sort((a, b) => {
                                            if (a === 'Not Set') return -1;
                                            if (b === 'Not Set') return 1;
                                            return a.localeCompare(b);
                                        }).map(cat => {
                                            const count = assetData.reduce((sum, d) => sum + (d.byPhotoCategory[cat] || 0), 0);
                                            return (
                                                <label key={cat} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedPhotoCatsForDownload.has(cat)}
                                                        onChange={() => togglePhotoCatSelection(cat)}
                                                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span className={`text-sm px-2 py-0.5 rounded ${getTagCategoryColor(cat)}`}>
                                                        {cat}
                                                    </span>
                                                    <span className="text-xs text-slate-500">({count})</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2 text-xs text-slate-500">
                                        {selectedPhotoCatsForDownload.size} of {allPhotoCategories.size} selected
                                    </div>
                                </div>
                            </div>

                            {/* Filter logic explanation */}
                            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
                                <strong>Note:</strong> If you select categories from both Tag and Photo, only rows matching at least one selected Tag Category AND at least one selected Photo Category will be included.
                                If you only select from one type, all rows matching that selection will be included.
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowDownloadModal(false)}
                                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={downloadCSV}
                                disabled={downloadLoading || (selectedTagCatsForDownload.size === 0 && selectedPhotoCatsForDownload.size === 0)}
                                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                {downloadLoading ? (
                                    <>
                                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Downloading...
                                    </>
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
            )}
        </main>
    );
}
