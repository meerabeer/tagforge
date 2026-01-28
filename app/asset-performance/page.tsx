'use client';

import React, { Suspense } from 'react';
import AppHeaderTabs from '@/components/AppHeaderTabs';
import AssetPerformanceView from '@/components/AssetPerformanceView';

export default function AssetPerformancePage() {
    return (
        <>
            <Suspense fallback={<div className="h-14 bg-white border-b border-slate-200" />}>
                <AppHeaderTabs />
            </Suspense>
            <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading asset performance...</div>}>
                <AssetPerformanceView />
            </Suspense>
        </>
    );
}
