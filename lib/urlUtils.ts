import { ReadonlyURLSearchParams } from 'next/navigation';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

/**
 * Helper to get a parameter from search params with a default value.
 */
export function getParam(searchParams: ReadonlyURLSearchParams, key: string, defaultValue: string = ''): string {
    return searchParams.get(key) || defaultValue;
}

/**
 * Helper to update URL parameters without full page reload.
 * Merges updates into current params, removing keys with null/empty values.
 * Uses router.replace with scroll: false.
 */
export function setParams(
    router: AppRouterInstance,
    pathname: string,
    currentParams: ReadonlyURLSearchParams,
    updates: Record<string, string | null | undefined>
) {
    const params = new URLSearchParams(currentParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
            params.delete(key);
        } else {
            params.set(key, value);
        }
    });

    const queryString = params.toString();
    const url = queryString ? `${pathname}?${queryString}` : pathname;

    router.replace(url, { scroll: false });
}
