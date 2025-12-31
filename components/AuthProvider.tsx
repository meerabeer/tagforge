'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { User } from '@supabase/supabase-js';

// --- Types ---
export interface UserProfile {
    user_id: string;
    full_name: string;
    region: string | null;
    created_at?: string;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    refreshProfile: () => Promise<void>;
}

// --- Context ---
const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    loading: true,
    refreshProfile: async () => { },
});

export const useAuth = () => useContext(AuthContext);

// --- Component ---
export default function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);

    // Profile Modal State
    const [profileMissing, setProfileMissing] = useState(false);
    const [inputName, setInputName] = useState('');
    // Region removed
    const [savingProfile, setSavingProfile] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // 1. Initialize Auth
    useEffect(() => {
        const initAuth = async () => {
            try {
                // Check current session
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();

                let currentUser = session?.user || null;

                if (!currentUser) {
                    console.log('No session, signing in anonymously...');
                    const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously();
                    if (signInError) throw signInError;
                    currentUser = signInData.user;
                }

                if (!currentUser) throw new Error('Failed to get user');

                setUser(currentUser);
                await fetchProfile(currentUser.id);

            } catch (err: any) {
                console.error('Auth Init Error:', err);
                setAuthError(err.message || 'Authentication failed');
            } finally {
                setLoading(false);
            }
        };

        initAuth();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user || null);
        });

        return () => subscription.unsubscribe();
    }, []);

    // 2. Fetch Profile
    const fetchProfile = async (userId: string) => {
        try {
            const { data, error } = await supabase
                .from('nfo_profiles')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = JSON object not found (row missing)
                console.error('Check Profile Error:', error);
            }

            if (data) {
                setProfile(data);
                setProfileMissing(false);
            } else {
                setProfile(null);
                setProfileMissing(true); // Trigger Modal
            }
        } catch (err) {
            console.error('Fetch profile failed:', err);
        }
    };

    const refreshProfile = async () => {
        if (user) await fetchProfile(user.id);
    };

    // 3. Save Profile Handler
    const handleSaveProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        if (!inputName.trim()) {
            setSaveError('Full Name is required.');
            return;
        }

        setSavingProfile(true);
        setSaveError(null);

        try {
            const { error } = await supabase
                .from('nfo_profiles')
                .insert({
                    user_id: user.id,
                    full_name: inputName.trim(),
                    // region removed
                });

            if (error) throw error;

            // Reload profile
            await fetchProfile(user.id);

        } catch (err: any) {
            console.error('Save Profile Error:', err);
            setSaveError(err.message || 'Failed to save profile');
        } finally {
            setSavingProfile(false);
        }
    };

    // --- Render ---

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-slate-600 font-medium text-sm">Initializing application...</p>
                </div>
            </div>
        );
    }

    if (authError) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
                <div className="bg-white p-6 rounded-lg shadow-md max-w-md border border-red-200">
                    <h2 className="text-lg font-bold text-red-700 mb-2">Authentication Error</h2>
                    <p className="text-slate-700">{authError}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>
            {children}

            {/* Profile Setup Modal */}
            {profileMissing && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="bg-blue-600 px-6 py-4">
                            <h2 className="text-xl font-bold text-white">Welcome</h2>
                            <p className="text-blue-100 text-sm">Please complete your profile to continue.</p>
                        </div>

                        <form onSubmit={handleSaveProfile} className="p-6 space-y-4">
                            {saveError && (
                                <div className="bg-red-50 border border-red-100 text-red-600 px-3 py-2 rounded text-sm">
                                    {saveError}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={inputName}
                                    onChange={(e) => setInputName(e.target.value)}
                                    placeholder="e.g. Jane Doe"
                                    className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    autoFocus
                                />
                            </div>

                            {/* Region removed */}

                            <div className="pt-2">
                                <button
                                    type="submit"
                                    disabled={savingProfile}
                                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded shadow-sm disabled:opacity-50 transition-colors"
                                >
                                    {savingProfile ? 'Saving...' : 'Get Started'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </AuthContext.Provider>
    );
}
