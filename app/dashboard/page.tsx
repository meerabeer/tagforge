'use client';

import React, { Suspense } from 'react';
import AppHeaderTabs from '@/components/AppHeaderTabs';
import DashboardView from '@/components/DashboardView';

export default function DashboardPage() {
    return (
        <>
            <Suspense fallback={<div className="h-14 bg-white border-b border-slate-200" />}>
                <AppHeaderTabs />
            </Suspense>
            <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading dashboard...</div>}>
                <DashboardView />
            </Suspense>
        </>
    );
}
