import TrendingView from '@/components/TrendingView';
import AppHeaderTabs from '@/components/AppHeaderTabs';
import { Suspense } from 'react';

export default function TrendingPage() {
    return (
        <>
            <AppHeaderTabs />
            <Suspense fallback={
                <div className="flex justify-center items-center min-h-screen">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                </div>
            }>
                <TrendingView />
            </Suspense>
        </>
    );
}
