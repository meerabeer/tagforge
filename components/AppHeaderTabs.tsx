'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function AppHeaderTabs() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { profile, loading } = useAuth();

    // Determine active tab based on path prefix
    const isAnalyst = pathname?.startsWith('/analyst');
    const isNFO = !isAnalyst;

    // Preserve 'site' parameter when switching tabs
    const siteParam = searchParams.get('site');
    const queryFooter = siteParam ? `?site=${encodeURIComponent(siteParam)}` : '';

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
                            href={`/nfo${queryFooter}`}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isNFO
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            NFO
                        </Link>
                        <Link
                            href={`/analyst${queryFooter}`}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${isAnalyst
                                ? 'bg-white text-blue-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                                }`}
                        >
                            Analyst
                        </Link>
                    </nav>
                </div>
            </div>
        </div>
    );
}
