'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

// Define which params each tab cares about
const TAB_PARAMS: Record<string, string[]> = {
    '/nfo': ['site', 'tab'],
    '/analyst': ['site', 'serial'],
    '/pmr': ['date'],
    '/dashboard': ['startDate', 'endDate', 'city', 'fme', 'month', 'quarter'],
    '/asset-performance': ['startDate', 'endDate', 'city', 'fme', 'month', 'quarter'],
    '/suggestions': ['status'],
    '/trending': ['startDate', 'endDate', 'city', 'nfo'],
    '/uploads': [],
};

// Storage keys for preserving params per tab
const STORAGE_KEY_PREFIX = 'tagforge_tab_params_';

export default function AppHeaderTabs() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { profile, loading } = useAuth();
    const mountedRef = useRef(false);

    // Determine active tab based on path prefix
    const isDashboard = pathname?.startsWith('/dashboard');
    const isAssetPerformance = pathname?.startsWith('/asset-performance');
    const isSuggestions = pathname?.startsWith('/suggestions');
    const isTrending = pathname?.startsWith('/trending');
    const isAnalyst = pathname?.startsWith('/analyst');
    const isPMR = pathname?.startsWith('/pmr');
    const isUploads = pathname?.startsWith('/uploads');
    const isNFO = !isAnalyst && !isPMR && !isSuggestions && !isDashboard && !isAssetPerformance && !isTrending && !isUploads;

    // Get current tab path
    const currentTabPath = isDashboard ? '/dashboard' : 
                          isAssetPerformance ? '/asset-performance' :
                          isSuggestions ? '/suggestions' :
                          isTrending ? '/trending' : 
                          isUploads ? '/uploads' :
                          isAnalyst ? '/analyst' : 
                          isPMR ? '/pmr' : '/nfo';

    // Mark as mounted after first render
    useEffect(() => {
        mountedRef.current = true;
    }, []);

    // Save current tab's params to sessionStorage
    useEffect(() => {
        if (!mountedRef.current) return;
        
        const relevantParams = TAB_PARAMS[currentTabPath] || [];
        const paramsToSave: Record<string, string> = {};
        
        relevantParams.forEach(param => {
            const value = searchParams.get(param);
            if (value) {
                paramsToSave[param] = value;
            }
        });
        
        // Only save if there are params to save
        if (Object.keys(paramsToSave).length > 0) {
            sessionStorage.setItem(
                STORAGE_KEY_PREFIX + currentTabPath, 
                JSON.stringify(paramsToSave)
            );
        }
    }, [searchParams, currentTabPath]);

    // Build URL for a tab, restoring saved params
    const buildTabUrl = (tabPath: string): string => {
        if (typeof window === 'undefined') return tabPath;
        
        try {
            const savedParams = sessionStorage.getItem(STORAGE_KEY_PREFIX + tabPath);
            if (savedParams) {
                const params = JSON.parse(savedParams);
                const paramString = new URLSearchParams(params).toString();
                return paramString ? `${tabPath}?${paramString}` : tabPath;
            }
        } catch {
            // Ignore errors from sessionStorage
        }
        return tabPath;
    };

    return (
        <div className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4">

                    {/* Branding */}
                    <div>
                        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">TagForge</h1>
                        <p className="text-sm text-slate-500">Site inventory management system</p>
                        {!loading && profile && (
                            <div className="text-xs text-blue-600 font-medium mt-1">
                                Logged in as: {profile.full_name}
                            </div>
                        )}
                    </div>

                    {/* Navigation Tabs */}
                    <nav className="flex space-x-1 bg-slate-100 p-1 rounded-lg">
                        <Link
                            href={buildTabUrl('/nfo')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isNFO
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            NFO
                        </Link>
                        <Link
                            href={buildTabUrl('/analyst')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isAnalyst
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Analyst
                        </Link>
                        <Link
                            href={buildTabUrl('/pmr')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isPMR
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Plans
                        </Link>
                        <Link
                            href={buildTabUrl('/dashboard')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isDashboard
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            NFO Performance
                        </Link>
                        <Link
                            href={buildTabUrl('/trending')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isTrending
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Trending
                        </Link>
                        <Link
                            href={buildTabUrl('/asset-performance')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isAssetPerformance
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Asset Performance
                        </Link>
                        <Link
                            href={buildTabUrl('/suggestions')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isSuggestions
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Suggestions
                        </Link>
                        <Link
                            href={buildTabUrl('/uploads')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isUploads
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Uploads
                        </Link>
                    </nav>
                </div>
            </div>
        </div>
    );
}
