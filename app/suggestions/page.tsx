'use client';

import AppHeaderTabs from '@/components/AppHeaderTabs';
import SuggestionsView from '@/components/SuggestionsView';
import { Suspense } from 'react';

export default function SuggestionsPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <AppHeaderTabs />
      <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading...</div>}>
        <SuggestionsView />
      </Suspense>
    </main>
  );
}
