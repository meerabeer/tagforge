import React, { Suspense } from 'react';
import AppHeaderTabs from '@/components/AppHeaderTabs';
import PMRView from '@/components/PMRView';
import AuthProvider from '@/components/AuthProvider';

export const dynamic = 'force-dynamic';

export default function PMRPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <AuthProvider>
                <AppHeaderTabs />
                <PMRView />
            </AuthProvider>
        </Suspense>
    );
}
