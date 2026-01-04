
'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { updateMainInventoryRow } from '@/lib/mainInventory';
import { compressImage } from '@/lib/imageCompress';
import { getParam, setParams } from '@/lib/urlUtils';
import ImagePreviewModal from '@/components/ImagePreviewModal';

interface InventoryRow {
  id: string;
  site_id: string;
  sheet_source: string | null;
  category: string | null;
  equipment_type: string | null;
  product_name: string | null;
  product_number: string | null;
  serial_number: string | null;
  tag_id: string | null;
  tag_category: string | null;
  serial_pic_url: string | null;
  tag_pic_url: string | null;
  photo_category: string | null;
  updated_at: string | null;
}

interface CatalogItem {
  category: string;
  equipment_type: string;
  product_name: string;
  product_number: string;
}

interface CascadeMaps {
  categories: string[];
  categoryToEquipmentTypes: Map<string, string[]>;
  categoryEquipmentToProductNames: Map<string, string[]>;
  categoryEquipmentProductToNumbers: Map<string, string[]>;
}

interface CategoryRequirement {
  required_flag: number;
  rule_text: string | null;
  parse_note: string | null;
}

// --- NEW HELPERS ---

const normalizeInputToDigits = (input: string): string => {
  return input.trim().replace(/\D/g, '');
};

const getCanonicalFromDigits = (digits: string): string => {
  return digits ? `W${digits}` : '';
};

const DEBOUNCE_DELAY = 300;

const CATEGORY_TABS = [
  'All',
  'Enclosure-Active',
  'Enclosure-Passive',
  'MW-Active',
  'MW-Passive',
  'RAN-Active',
  'RAN-Passive'
] as const;

type CategoryTab = (typeof CATEGORY_TABS)[number];

export default function NFOView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // --- URL State Initialization ---
  const initialSite = getParam(searchParams, 'site', '');
  const initialTab = getParam(searchParams, 'tab', 'All') as CategoryTab;

  // Search State
  const [siteIdInput, setSiteIdInput] = useState(initialSite);
  const [activeSiteCanonical, setActiveSiteCanonical] = useState<string | null>(initialSite || null);
  const [siteSuggestions, setSiteSuggestions] = useState<{ site_id_canonical: string; row_count: number; site_digits: string }[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Inventory Data State
  const [allSiteRows, setAllSiteRows] = useState<InventoryRow[]>([]);
  const [requirementsMap, setRequirementsMap] = useState<Map<string, CategoryRequirement>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(!!initialSite);

  // Tabs & Editing State
  // Use URL param for activeTab, but keep local state for immediate UI feedback if needed? 
  // Actually simpler to treat URL as source of truth if we update it immediately, 
  // but for tabs usually local state + effect is standard in Next.js CSR.
  const [activeTab, setActiveTabInternal] = useState<CategoryTab>(initialTab);

  const setActiveTab = (tab: CategoryTab) => {
    setActiveTabInternal(tab);
    setParams(router, pathname, searchParams, { tab });
  };



  // Tabs & Editing State
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [draftRow, setDraftRow] = useState<InventoryRow | null>(null);
  const [originalRow, setOriginalRow] = useState<InventoryRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editWarning, setEditWarning] = useState<string | null>(null);
  const [expandedDetailsRowId, setExpandedDetailsRowId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [duplicateFields, setDuplicateFields] = useState<{ serial: boolean; tagId: boolean }>({ serial: false, tagId: false });
  const [showHiddenDuplicates, setShowHiddenDuplicates] = useState(false);

  // Add New Site Modal State
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);
  const [addSiteQuery, setAddSiteQuery] = useState('');
  const [addSiteSuggestions, setAddSiteSuggestions] = useState<{ site_id_with_w: string; site_id_without_w: string }[]>([]);
  const [addSiteLoading, setAddSiteLoading] = useState(false);
  const [addSiteSelected, setAddSiteSelected] = useState<{ canonical: string; digits: string } | null>(null);
  const [addSiteInventoryCount, setAddSiteInventoryCount] = useState<number | null>(null);
  const [checkingInventory, setCheckingInventory] = useState(false);

  // Helper Data
  const [cascadeMaps, setCascadeMaps] = useState<CascadeMaps>({
    categories: [],
    categoryToEquipmentTypes: new Map(),
    categoryEquipmentToProductNames: new Map(),
    categoryEquipmentProductToNumbers: new Map()
  });
  const [tagCategoryOptions, setTagCategoryOptions] = useState<string[]>([]);
  const [tagCategoryLoading, setTagCategoryLoading] = useState(true);
  const [tagCategoryError, setTagCategoryError] = useState(false);
  const [photoCategoryOptions, setPhotoCategoryOptions] = useState<string[]>([]);

  // Upload State
  const [uploadingField, setUploadingField] = useState<{ rowId: string; field: 'serial' | 'tag' } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Image Preview State
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  const openPreview = (url: string | null, title: string) => {
    if (!url) return;
    setPreviewUrl(url);
    setPreviewTitle(title);
  };

  const closePreview = () => {
    setPreviewUrl(null);
    setPreviewTitle('');
  };

  // Debounce helper for main search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchInventorySuggestions(siteIdInput);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [siteIdInput]);

  // Debounce helper for Add Site modal
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFrontOfficeSuggestions(addSiteQuery);
    }, DEBOUNCE_DELAY);
    return () => clearTimeout(timer);
  }, [addSiteQuery]);

  // LOAD HELPERS (catalog, tags)
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const { data, error: catalogError } = await supabase
          .from('helper_catalog')
          .select('category, equipment_type, product_name, product_number');

        if (catalogError) throw catalogError;
        if (!data) return;

        const categories = new Set<string>();
        const categoryToEquipmentTypes = new Map<string, Set<string>>();
        const categoryEquipmentToProductNames = new Map<string, Set<string>>();
        const categoryEquipmentProductToNumbers = new Map<string, Set<string>>();

        data.forEach((item: CatalogItem) => {
          if (item.category) categories.add(item.category);

          if (item.category && item.equipment_type) {
            const key1 = item.category;
            if (!categoryToEquipmentTypes.has(key1)) categoryToEquipmentTypes.set(key1, new Set());
            categoryToEquipmentTypes.get(key1)!.add(item.equipment_type);
          }

          if (item.category && item.equipment_type && item.product_name) {
            const key2 = `${item.category}|${item.equipment_type}`;
            if (!categoryEquipmentToProductNames.has(key2)) categoryEquipmentToProductNames.set(key2, new Set());
            categoryEquipmentToProductNames.get(key2)!.add(item.product_name);
          }

          if (item.category && item.equipment_type && item.product_name && item.product_number) {
            const key3 = `${item.category}|${item.equipment_type}|${item.product_name}`;
            if (!categoryEquipmentProductToNumbers.has(key3)) categoryEquipmentProductToNumbers.set(key3, new Set());
            categoryEquipmentProductToNumbers.get(key3)!.add(item.product_number);
          }
        });

        setCascadeMaps({
          categories: Array.from(categories).sort(),
          categoryToEquipmentTypes: new Map(
            Array.from(categoryToEquipmentTypes.entries()).map(([k, v]) => [k, Array.from(v).sort()])
          ),
          categoryEquipmentToProductNames: new Map(
            Array.from(categoryEquipmentToProductNames.entries()).map(([k, v]) => [k, Array.from(v).sort()])
          ),
          categoryEquipmentProductToNumbers: new Map(
            Array.from(categoryEquipmentProductToNumbers.entries()).map(([k, v]) => [k, Array.from(v).sort()])
          )
        });
      } catch (err) {
        console.error('Failed to load catalog:', err);
      }
    };

    loadCatalog();
  }, []);

  useEffect(() => {
    const loadTagCategories = async () => {
      setTagCategoryLoading(true);
      setTagCategoryError(false);
      try {
        const { data, error: fetchError } = await supabase
          .from('tag_category_helper')
          .select('value, sort_order')
          .order('sort_order', { ascending: true });

        if (fetchError) throw fetchError;

        const values = (data || []).map((item: { value: string; sort_order: number }) => item.value);
        setTagCategoryOptions(values);
      } catch (err) {
        console.error('Failed to load tag categories:', err);
        setTagCategoryError(true);
      } finally {
        setTagCategoryLoading(false);
      }
    };

    loadTagCategories();
  }, []);

  useEffect(() => {
    const loadPhotoCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('photo_category_helper')
          .select('value, sort_order')
          .order('sort_order', { ascending: true });

        if (error) throw error;
        setPhotoCategoryOptions((data || []).map((i: any) => i.value));
      } catch (err) {
        console.error('Failed to load photo categories:', err);
      }
    };
    loadPhotoCategories();
  }, []);

  // --- CORE SEARCH LOGIC ---

  const fetchInventorySuggestions = async (input: string) => {
    setIsSearchLoading(true);
    try {
      const digits = normalizeInputToDigits(input);
      let query = supabase.from('inventory_sites').select('site_id_canonical, site_digits, row_count');

      // If user clears input, clear suggestions
      if (!input.trim()) {
        setSiteSuggestions([]);
        setIsSearchLoading(false);
        return;
      }

      if (digits.length > 0) {
        query = query
          .ilike('site_digits', `${digits}%`)
          .order('site_digits', { ascending: true })
          .limit(20);
      } else {
        // Fallback or show top
        query = query
          .order('row_count', { ascending: false })
          .limit(20);
      }

      const { data, error } = await query;
      if (error) throw error;

      console.log('Inventory Suggestions:', data?.length);
      setSiteSuggestions(data || []);
      // Only show suggestions if we have input? Or focus logic handles it.
    } catch (err) {
      console.error('Error fetching inventory suggestions:', err);
      setSiteSuggestions([]);
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleSelectSite = (canonical: string) => {
    setSiteIdInput(canonical);
    setActiveSiteCanonical(canonical);
    setShowSuggestions(false);

    // Update URL logic
    setParams(router, pathname, searchParams, { site: canonical });

    // We can rely on the Effect to trigger loadSiteInventory, OR call it here.
    // Calling it here is faster UI response, but might cause double fetch if Effect runs?
    // The Effect checks `if (siteParam && siteParam !== activeSiteCanonical)`.
    // If we update state here, the effect might NOT trigger if the param matches state?
    // Actually, `activeSiteCanonical` is a dependency? No, refs are dependent.
    // Let's set state AND update URL.
    // The previous implementation relied on `loadSiteInventory` here.
    // The Effect handles "Back button" or "External link".
    // If we rely purely on Effect, we should just update URL?
    // But we need immediate UI feedback.

    loadSiteInventory(canonical);
  };

  const loadSiteInventory = async (canonical: string) => {
    setLoading(true);
    setError(null);
    setSearched(true);
    // Reset editing state
    setEditingRowId(null);
    setIsAddingNew(false);

    try {
      console.log('Loading inventory for:', canonical);

      // Fetch main inventory rows using canonical ID
      const { data, error: queryError } = await supabase
        .from('main_inventory')
        .select(
          'id, site_id, site_id_canonical, sheet_source, category, equipment_type, product_name, product_number, serial_number, tag_id, tag_category, photo_category, serial_pic_url, tag_pic_url, updated_at'
        )
        .eq('site_id_canonical', canonical)
        .order('updated_at', { ascending: false });

      if (queryError) throw new Error(queryError.message);

      console.log('Rows loaded:', data?.length);
      setAllSiteRows(data || []);

      // Load requirements
      const siteIdNorm = canonical.replace(/^W/, '');
      const { data: requirementsData, error: requirementsError } = await supabase
        .from('site_category_requirements')
        .select('category, required_flag, rule_text, parse_note')
        .eq('site_id_norm', siteIdNorm);

      if (requirementsError) {
        console.error('Failed to load site category requirements:', requirementsError);
        setRequirementsMap(new Map());
      } else {
        const nextMap = new Map<string, CategoryRequirement>();
        (requirementsData || []).forEach((row: CategoryRequirement & { category: string }) => {
          const key = normalizeCategoryName(row.category);
          if (!key) return;
          nextMap.set(key, {
            required_flag: row.required_flag,
            rule_text: row.rule_text,
            parse_note: row.parse_note
          });
        });
        setRequirementsMap(nextMap);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while loading inventory');
      setAllSiteRows([]);
      setRequirementsMap(new Map());
    } finally {
      setLoading(false);
    }
  };

  // --- ADD NEW SITE MODAL LOGIC ---

  const fetchFrontOfficeSuggestions = async (input: string) => {
    if (!input.trim()) {
      setAddSiteSuggestions([]);
      return;
    }

    setAddSiteLoading(true);
    try {
      const digits = normalizeInputToDigits(input);
      if (!digits) {
        setAddSiteSuggestions([]);
        return;
      }

      // Search by digits (without W) OR W + digits
      const { data, error } = await supabase
        .from('front_office_active_sites')
        .select('site_id_with_w, site_id_without_w')
        .or(`site_id_without_w.ilike.${digits}%,site_id_with_w.ilike.W${digits}%`)
        .limit(20);

      if (error) throw error;
      setAddSiteSuggestions(data || []);
    } catch (err) {
      console.error('Error fetching front office sites:', err);
    } finally {
      setAddSiteLoading(false);
    }
  };

  const handleSelectAddSite = async (site: { site_id_with_w: string; site_id_without_w: string }) => {
    const digits = site.site_id_without_w || normalizeInputToDigits(site.site_id_with_w);
    const canonical = getCanonicalFromDigits(digits);

    setAddSiteSelected({ canonical, digits });
    setCheckingInventory(true);
    setAddSiteInventoryCount(null);

    try {
      const { count, error } = await supabase
        .from('main_inventory')
        .select('*', { count: 'exact', head: true })
        .eq('site_id_canonical', canonical);

      if (error) throw error;
      setAddSiteInventoryCount(count || 0);
    } catch (err) {
      console.error('Error checking inventory:', err);
      // Fallback to allowing add if check fails, but better to prevent duplicate adds?
      // For safety, assume 0 if error, but user can see rows if they exist
      setAddSiteInventoryCount(0);
    } finally {
      setCheckingInventory(false);
    }
  };

  const executeAddFirstRow = () => {
    if (!addSiteSelected) return;

    // Close modal
    setShowAddSiteModal(false);

    // Set active site content
    setSiteIdInput(addSiteSelected.canonical);
    setActiveSiteCanonical(addSiteSelected.canonical);
    setAllSiteRows([]); // Clear previous
    setSearched(true);
    setRequirementsMap(new Map());

    // Trigger "Add New" flow immediately
    // Need to wait for state, but since we modify state directly below, it might be fine.

    const newRow: InventoryRow = {
      id: 'NEW_TEMP_ID',
      site_id: addSiteSelected.canonical, // Force canonical
      sheet_source: 'Manual_added',
      category: activeTab !== 'All' ? activeTab : null,
      equipment_type: null,
      product_name: null,
      product_number: null,
      serial_number: null,
      tag_id: null,
      tag_category: null,
      serial_pic_url: null,
      tag_pic_url: null,
      photo_category: null,
      updated_at: null
    };

    setIsAddingNew(true);
    setEditingRowId('NEW_TEMP_ID');
    setDraftRow(newRow);
    setOriginalRow(newRow);
    setEditError(null);
    setDuplicateFields({ serial: false, tagId: false });
  };

  const executeOpenExistingSite = () => {
    if (!addSiteSelected) return;
    setShowAddSiteModal(false);
    handleSelectSite(addSiteSelected.canonical);
  };

  // --- EXISTING HELPERS & LOGIC ---

  const normalizeCategoryName = (category: string | null | CategoryTab) =>
    (category ?? '')
      .toString()
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase();

  const normalizeSheetSource = (src: string | null) => (src ?? '').toString().trim().toLowerCase();

  const activeRequirement = useMemo(() => {
    if (activeTab === 'All') return null;
    const key = normalizeCategoryName(activeTab);
    return requirementsMap.get(key) || null;
  }, [activeTab, requirementsMap]);

  const activeRequirementText = useMemo(() => {
    if (!activeRequirement) return '';
    return [activeRequirement.rule_text, activeRequirement.parse_note]
      .map((text) => (text ?? '').trim())
      .filter((text) => text.length > 0)
      .join(' ');
  }, [activeRequirement]);

  // Global Deduplication & Hidden Rows Calculation
  // Global Duplicate Detection (Frequency counting)
  const { visibleRowsInTab, serialCounts, tagCounts } = useMemo(() => {
    const sCounts = new Map<string, number>();
    const tCounts = new Map<string, number>();

    // 1. Check frequencies across ALL rows for this site
    allSiteRows.forEach(row => {
      const site = (row.site_id || '').trim();
      const serial = (row.serial_number || '').trim().toLowerCase();
      const tag = (row.tag_id || '').trim().toLowerCase();

      if (serial) {
        const key = `${site}|${serial}`;
        sCounts.set(key, (sCounts.get(key) || 0) + 1);
      }
      if (tag) {
        const key = `${site}|${tag}`;
        tCounts.set(key, (tCounts.get(key) || 0) + 1);
      }
    });

    // 2. Filter for current tab (Show ALL rows, including duplicates)
    const normActiveTab = normalizeCategoryName(activeTab);
    const visible = allSiteRows.filter(row => {
      // Category Filter
      if (activeTab !== 'All' && normalizeCategoryName(row.category) !== normActiveTab) return false;
      return true;
    });

    return {
      visibleRowsInTab: visible,
      serialCounts: sCounts,
      tagCounts: tCounts
    };
  }, [activeTab, allSiteRows]);

  /*
  const { visibleRows, hiddenDuplicateCount } = useMemo(() => {
    // ... OLD LOGIC REMOVED ...
  }, [activeTab, allSiteRows]);
  */

  const getEquipmentTypes = (category: string | null): string[] => {
    if (!category) return [];
    return cascadeMaps.categoryToEquipmentTypes.get(category) || [];
  };

  const getProductNames = (category: string | null, equipmentType: string | null): string[] => {
    if (!category || !equipmentType) return [];
    const key = `${category}|${equipmentType}`;
    return cascadeMaps.categoryEquipmentToProductNames.get(key) || [];
  };

  const getProductNumbers = (category: string | null, equipmentType: string | null, productName: string | null): string[] => {
    if (!category || !equipmentType || !productName) return [];
    const key = `${category}|${equipmentType}|${productName}`;
    return cascadeMaps.categoryEquipmentProductToNumbers.get(key) || [];
  };

  // Sync URL changes to State (Handle Back/Forward navigation)
  const initialLoadRef = useRef(false);

  useEffect(() => {
    const siteParam = searchParams.get('site');
    const tabParam = searchParams.get('tab') as CategoryTab || 'All';

    // Sync Tab
    if (tabParam !== activeTab) {
      setActiveTabInternal(tabParam);
    }

    // Sync Site
    if (siteParam) {
      if (siteParam !== activeSiteCanonical) {
        // URL changed (or back button) -> Update state & fetch
        setSiteIdInput(siteParam);
        setActiveSiteCanonical(siteParam);
        loadSiteInventory(siteParam);
        setSearched(true);
      } else if (!initialLoadRef.current) {
        // Initial load: State matches URL (from init), but data not fetched yet
        initialLoadRef.current = true;
        loadSiteInventory(siteParam);
      }
    } else if (!siteParam && activeSiteCanonical) {
      // cleared via URL
      setSiteIdInput('');
      setActiveSiteCanonical(null);
      setSearched(false);
      setAllSiteRows([]);
      initialLoadRef.current = true; // Mark as handled
    }
  }, [searchParams]);

  const beginInlineEdit = (row: InventoryRow) => {
    if (saving) return;

    if (editingRowId && editingRowId !== row.id) {
      setEditingRowId(null);
      setDraftRow(null);
      setOriginalRow(null);
      setEditError(null);
      setEditWarning(null);
    }

    // ... capture draft ...
    const draft: InventoryRow = { ...row };

    // A) Log original and draft as requested
    console.log('[beginInlineEdit] START', {
      rowId: row.id,
      draftId: draft.id,
      rowSerial: row.serial_number,
      draftSerial: draft.serial_number,
      rowTagId: row.tag_id,
      draftTagId: draft.tag_id,
      rowTagCat: row.tag_category,
      draftTagCat: draft.tag_category,
      // Casting to any to check for potential hidden ID fields at runtime
      rowTagCatId: (row as any).tag_category_id,
      draftTagCatId: (draft as any).tag_category_id,
      rowPhotoCat: row.photo_category,
      draftPhotoCat: draft.photo_category,
      rowPhotoCatId: (row as any).photo_category_id,
      draftPhotoCatId: (draft as any).photo_category_id,
    });

    setEditingRowId(row.id);
    setDraftRow(draft);
    setOriginalRow({ ...row });
    setEditError(null);
    setEditWarning(null);
    setIsAddingNew(false);
    setDuplicateFields({ serial: false, tagId: false });
  };

  const beginAddNew = () => {
    if (saving || !activeSiteCanonical) return; // REQUIRE active canonical

    // Cancel any existing edit
    if (editingRowId) {
      setEditingRowId(null);
      setDraftRow(null);
      setOriginalRow(null);
      setEditError(null);
      setEditWarning(null);
    }

    // Create new draft row
    const newRow: InventoryRow = {
      id: 'NEW_TEMP_ID',
      site_id: activeSiteCanonical, // Use canonical
      sheet_source: 'Manual_added',
      category: activeTab !== 'All' ? activeTab : null,
      equipment_type: null,
      product_name: null,
      product_number: null,
      serial_number: null,
      tag_id: null,
      tag_category: null,
      serial_pic_url: null,
      tag_pic_url: null,
      photo_category: null,
      updated_at: null
    };

    setIsAddingNew(true);
    setEditingRowId('NEW_TEMP_ID');
    setDraftRow(newRow);
    setOriginalRow(newRow);
    setEditError(null);
    setDuplicateFields({ serial: false, tagId: false });
  };

  const cancelInlineEdit = () => {
    if (saving) return;
    setEditingRowId(null);
    setDraftRow(null);
    setOriginalRow(null);
    setEditError(null);
    setEditWarning(null);
    setIsAddingNew(false);
    setDuplicateFields({ serial: false, tagId: false });
  };

  const updateDraftField = (field: keyof InventoryRow, value: string | null) => {
    if (!draftRow) return;
    const updated: InventoryRow = { ...draftRow, [field]: value };

    if (field === 'category') {
      updated.equipment_type = null;
      updated.product_name = null;
      updated.product_number = null;
    }

    if (field === 'equipment_type') {
      updated.product_name = null;
      updated.product_number = null;
    }

    if (field === 'product_name') {
      updated.product_number = null;
    }

    setDraftRow(updated);
  };

  const canUpdateDraft = useMemo(() => {
    if (!draftRow) return false;
    return Boolean((draftRow.category || '').trim() && (draftRow.equipment_type || '').trim() && (draftRow.product_number || '').trim());
  }, [draftRow]);

  const checkDuplicates = (draft: InventoryRow, isNew: boolean): { error: string | null; duplicateSerial: boolean; duplicateTag: boolean } => {
    if (!draft) return { error: null, duplicateSerial: false, duplicateTag: false };

    const serial = (draft.serial_number || '').trim();
    const tagId = (draft.tag_id || '').trim();

    // 1) Optimization: If editing an existing row and critical fields are unchanged, skip check
    if (!isNew && originalRow) {
      const origSerial = (originalRow.serial_number || '').trim();
      const origTag = (originalRow.tag_id || '').trim();

      if (serial === origSerial && tagId === origTag) {
        console.log('[checkDuplicates] Skipped: Serial and Tag unchanged vs Original.');
        return { error: null, duplicateSerial: false, duplicateTag: false };
      }
    }

    // 3) Print/log variables at runtime (keep existing logs)
    console.log('Duplicate Check Debug:', {
      mode: isNew ? 'insert' : 'update',
      currentRowId: draft.id,
      site_id: draft.site_id,
      serial_number: serial,
      tag_id: tagId,
    });

    if (!serial && !tagId) {
      return { error: null, duplicateSerial: false, duplicateTag: false };
    }

    // 2) Build Winner Maps (Global Dedup across all rows for this site)
    // allSiteRows is already sorted by updated_at DESC (so first seen is winner)
    const winnerSerialMap = new Map<string, InventoryRow>();
    const winnerTagMap = new Map<string, InventoryRow>();

    allSiteRows.forEach(row => {
      const rowSite = (row.site_id || '').trim();

      const rowSerial = (row.serial_number || '').trim().toLowerCase();
      if (rowSerial) {
        const key = `${rowSite}|${rowSerial}`;
        if (!winnerSerialMap.has(key)) {
          winnerSerialMap.set(key, row);
        }
      }

      const rowTag = (row.tag_id || '').trim().toLowerCase();
      if (rowTag) {
        const key = `${rowSite}|${rowTag}`;
        if (!winnerTagMap.has(key)) {
          winnerTagMap.set(key, row);
        }
      }
    });

    let hasDuplicateSerial = false;
    let hasDuplicateTag = false;
    const errors: string[] = [];
    const draftSite = (draft.site_id || '').trim();

    // Check duplicate serial
    if (serial) {
      const serialKey = `${draftSite}|${serial.toLowerCase()}`;
      const match = winnerSerialMap.get(serialKey);

      // If match exists AND it is NOT the current row (draft.id)
      if (match && match.id !== draft.id) {
        hasDuplicateSerial = true;

        let msg = `⚠ Serial "${serial}" already exists on this site (conflict row: ${match.id.substring(0, 8)}..., source: ${match.sheet_source})`;
        errors.push(msg);
      }
    }

    // Check duplicate tag_id
    if (tagId) {
      const tagKey = `${draftSite}|${tagId.toLowerCase()}`;
      const match = winnerTagMap.get(tagKey);

      if (match && match.id !== draft.id) {
        hasDuplicateTag = true;
        let msg = `⚠ Tag ID "${tagId}" already exists on this site (conflict row: ${match.id.substring(0, 8)}..., source: ${match.sheet_source})`;
        errors.push(msg);
      }
    }

    if (errors.length > 0) {
      // Add actionable footer
      errors.push(`Click '(N) duplicate hidden' to review.`);
    }

    return {
      error: errors.length > 0 ? errors.join(' ') : null,
      duplicateSerial: hasDuplicateSerial,
      duplicateTag: hasDuplicateTag
    };
  };

  const saveInlineUpdate = async () => {
    if (!draftRow || !editingRowId) return;

    if (!canUpdateDraft) {
      setEditError('Category, Equipment Type, and Product Number are required.');
      setDuplicateFields({ serial: false, tagId: false });
      return;
    }

    if (isAddingNew) {
      const ruleKey = normalizeCategoryName(draftRow.category);
      const rule = requirementsMap.get(ruleKey);
      if (rule && rule.required_flag === 0) {
        const categoryLabel = (draftRow.category || 'This category').trim();
        const details = [rule.parse_note, rule.rule_text]
          .map((text) => (text ?? '').trim().replace(/[.]+$/, ''))
          .filter((text) => text.length > 0)
          .map((text) => `${text}.`)
          .join(' ');
        setEditError(
          `Not allowed: ${categoryLabel} is not required for this Site.${details ? ' ' + details : ''}`
        );
        setDuplicateFields({ serial: false, tagId: false });
        return;
      }
    }

    // Check for duplicates (Non-blocking Warning)
    const duplicateCheck = checkDuplicates(draftRow, isAddingNew);
    if (duplicateCheck.error) {
      setEditWarning(duplicateCheck.error);
      setDuplicateFields({
        serial: duplicateCheck.duplicateSerial,
        tagId: duplicateCheck.duplicateTag
      });
      // DO NOT RETURN. Proceed to save.
    } else {
      setEditWarning(null);
      setDuplicateFields({ serial: false, tagId: false });
    }

    setSaving(true);
    setEditError(null); // Clear errors
    // Keep duplicateFields/warning for display during save if any


    try {
      if (isAddingNew) {
        // INSERT new row
        const { data, error: insertError } = await supabase
          .from('main_inventory')
          .insert({
            site_id: draftRow.site_id, // Already canonical from beginAddNew
            sheet_source: draftRow.sheet_source,
            category: draftRow.category,
            equipment_type: draftRow.equipment_type,
            product_name: draftRow.product_name,
            product_number: draftRow.product_number,
            serial_number: draftRow.serial_number,
            tag_id: draftRow.tag_id,
            tag_category: draftRow.tag_category,
            photo_category: draftRow.photo_category,
            serial_pic_url: draftRow.serial_pic_url,
            tag_pic_url: draftRow.tag_pic_url
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // Add to local state
        setAllSiteRows((prev) => [data, ...prev]);
      } else {
        const existingSourceNorm = normalizeSheetSource(draftRow.sheet_source);
        // If photo_category is set, force to Manual_verified
        let nextSheetSource = existingSourceNorm === 'manual_added' ? 'Manual_added' : 'Manual_edited';

        if (draftRow.photo_category) {
          nextSheetSource = 'Manual_verified';
        }

        // UPDATE existing row
        await updateMainInventoryRow(draftRow.id, {
          sheet_source: nextSheetSource,
          category: draftRow.category,
          equipment_type: draftRow.equipment_type,
          product_name: draftRow.product_name,
          product_number: draftRow.product_number,
          serial_number: draftRow.serial_number,
          tag_id: draftRow.tag_id,
          tag_category: draftRow.tag_category,
          photo_category: draftRow.photo_category,
          serial_pic_url: draftRow.serial_pic_url,
          tag_pic_url: draftRow.tag_pic_url
        });

        setAllSiteRows((prev) =>
          prev.map((r) => (r.id === draftRow.id ? { ...r, ...draftRow, sheet_source: nextSheetSource } : r))
        );
      }

      cancelInlineEdit();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (file: File, rowId: string, kind: 'serial' | 'tag') => {
    if (!activeSiteCanonical) return;

    // === DIAGNOSTIC: Log file info ===
    console.log('[UPLOAD-START]', {
      fileName: file.name,
      fileType: file.type,
      fileSizeKB: (file.size / 1024).toFixed(2),
      rowId,
      kind,
      siteId: activeSiteCanonical,
      userAgent: navigator.userAgent,
    });

    setUploadingField({ rowId, field: kind });
    setUploadProgress('Compressing...');
    setUploadError(null);

    try {
      // 1. Try to compress image on client (with fallback to original if compression fails)
      let fileToUpload: Blob = file;
      let originalSizeKB = Number((file.size / 1024).toFixed(2));
      let compressedSizeKB = originalSizeKB;

      console.log('[UPLOAD] Starting compression...');
      try {
        const compressionResult = await compressImage(file);
        fileToUpload = compressionResult.compressedFile;
        originalSizeKB = compressionResult.originalSizeKB;
        compressedSizeKB = compressionResult.compressedSizeKB;

        console.log('[UPLOAD-COMPRESS] Success:', {
          originalSizeKB,
          compressedSizeKB,
          compressedType: fileToUpload.type,
          compressedSize: fileToUpload.size,
        });
      } catch (compressionError) {
        // Compression failed - use original file instead
        console.warn('[UPLOAD-COMPRESS] Compression failed, using original file:', compressionError);
        fileToUpload = file;
        // Continue with upload - don't throw
      }

      // Check if we have a valid file to upload
      if (!fileToUpload || fileToUpload.size === 0) {
        throw new Error('No valid file to upload');
      }

      setUploadProgress(`Uploading (${originalSizeKB}KB -> ${compressedSizeKB}KB)...`);


      // 2. Build FormData for server upload
      const formData = new FormData();
      formData.append('file', fileToUpload, 'image.jpg');
      formData.append('siteId', activeSiteCanonical);
      formData.append('rowId', rowId);
      formData.append('kind', kind);

      console.log('[UPLOAD] Sending to server...');

      // 3. POST to server-side upload route
      const uploadRes = await fetch('/api/r2/upload', {
        method: 'POST',
        body: formData,
      });

      console.log('[UPLOAD-RESPONSE]', {
        status: uploadRes.status,
        ok: uploadRes.ok,
        statusText: uploadRes.statusText,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error('[UPLOAD-ERROR] Server returned error:', errText);
        let errMsg = 'Upload failed';
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error || errMsg;
        } catch { /* ignore parse error */ }
        throw new Error(errMsg);
      }

      const responseData = await uploadRes.json();
      console.log('[UPLOAD-SUCCESS]', responseData);

      const { publicUrl, dbUpdated, key } = responseData;

      if (!publicUrl) {
        throw new Error('Server did not return publicUrl');
      }

      // 4. Update local UI state
      const urlField = kind === 'serial' ? 'serial_pic_url' : 'tag_pic_url';

      if (draftRow && draftRow.id === rowId) {
        // Update draft state for new/editing rows
        setDraftRow(prev => prev ? ({ ...prev, [urlField]: publicUrl }) : null);
        console.log('[UPLOAD] Updated draft row with URL');
      }

      // Update allSiteRows state so "View" link appears immediately
      if (rowId !== 'NEW_TEMP_ID') {
        setAllSiteRows(prev => prev.map(r => r.id === rowId ? ({
          ...r,
          [urlField]: publicUrl
        }) : r));
        console.log('[UPLOAD] Updated allSiteRows with URL');
      }

      // If server didn't update DB (for NEW_TEMP_ID), we'll handle it on row save
      if (!dbUpdated && rowId === 'NEW_TEMP_ID') {
        console.log('[UPLOAD] URL stored in draft, will persist on save');
      }

      console.log('[UPLOAD-COMPLETE] Success! Key:', key, 'URL:', publicUrl);

      setUploadProgress(null);
      setUploadingField(null);

    } catch (err) {
      console.error('[UPLOAD-FAILED]', err);
      const errorMsg = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(errorMsg);
      setUploadProgress(null);

      // Show alert for mobile debugging (remove after debugging)
      alert(`Upload failed: ${errorMsg}\n\nCheck browser console for details.`);

      setTimeout(() => setUploadingField(null), 3000);
    }
  };



  const handleDeleteRow = async (rowId: string) => {
    if (!confirm('Are you sure you want to delete this row permanently?')) return;

    try {
      const { error } = await supabase
        .from('main_inventory')
        .delete()
        .eq('id', rowId);

      if (error) throw error;

      setAllSiteRows(prev => prev.filter(r => r.id !== rowId));
      if (editingRowId === rowId) cancelInlineEdit();

    } catch (err: any) {
      alert('Failed to delete row: ' + err.message);
    }
  };

  const handleDeleteImage = async (rowId: string, kind: 'serial' | 'tag') => {
    if (!confirm('Delete this picture?')) return;

    try {
      const res = await fetch('/api/r2/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, kind })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete picture');
      }

      const field = kind === 'serial' ? 'serial_pic_url' : 'tag_pic_url';

      // Update local state
      setAllSiteRows(prev => prev.map(r => {
        if (r.id === rowId) {
          return { ...r, [field]: null, updated_at: new Date().toISOString() };
        }
        return r;
      }));

      // If currently editing this row, update draft too
      if (editingRowId === rowId && draftRow) {
        setDraftRow(prev => prev ? { ...prev, [field]: null } : null);
      }

      alert('Picture deleted');

    } catch (err: any) {
      console.error('Delete error:', err);
      alert('Failed to delete picture: ' + err.message);
    }
  };

  const handleVerifyRow = async (rowId: string) => {
    try {
      // Optimistic update
      setAllSiteRows(prev => prev.map(r => r.id === rowId ? { ...r, sheet_source: 'Manual_verified' } : r));
      await updateMainInventoryRow(rowId, { sheet_source: 'Manual_verified' });
    } catch (err) {
      console.error('Verify failed:', err);
      // Revert if needed, but low risk
    }
  };

  // Global Key Listener for Delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If pressing Del and we have an editing row that is NOT "NEW_TEMP_ID" (or maybe we allow deleting new?)
      // The user likely means selecting a row? Or just when hovering? 
      // "when i am pressing Del its not giving me popup to del"
      // Usually implies selecting a row first. But we don't have row selection state.
      // Maybe they mean while editing?
      // Or maybe there WAS a selection state I missed?
      // I don't see row selection state (checkboxes). 
      // Maybe they mean when they click "Delete Row" button?
      // "pressing Del" -> implies keyboard. 
      // If there's no selection, 'Del' is ambiguous. 
      // I will assume they mean *While Editing* (since editingRowId exists).

      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement?.tagName || '').toUpperCase());

      // Allow Ctrl+Delete regardless of focus, OR Delete key if NOT in an input
      if ((e.key === 'Delete' && e.ctrlKey) || (e.key === 'Delete' && !isInput)) {
        if (editingRowId && editingRowId !== 'NEW_TEMP_ID') {
          handleDeleteRow(editingRowId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingRowId]);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4">
        {/* Header removed, now in AppHeaderTabs */}

        {/* New Search & Add Site Area */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search Typeahead */}
            <div className="flex-1 relative z-10">
              <input
                type="text"
                value={siteIdInput}
                onChange={(e) => {
                  setSiteIdInput(e.target.value);
                  setShowSuggestions(true);
                  // Don't clear immediately if empty, debounce handles it, but maybe clear UX?
                  if (!e.target.value.trim()) setSiteSuggestions([]);
                }}
                placeholder="Search inventory (e.g. W5074)..."
                className="w-full px-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                onFocus={() => {
                  if (siteSuggestions.length > 0) setShowSuggestions(true);
                  if (siteIdInput && siteSuggestions.length === 0) fetchInventorySuggestions(siteIdInput);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} // Delay to allow click
              />
              {isSearchLoading && (
                <div className="absolute right-3 top-3">
                  <span className="block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
                </div>
              )}

              {/* Typeahead Dropdown */}
              {showSuggestions && siteSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-y-auto z-50">
                  {siteSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.site_id_canonical}
                      className="w-full text-left px-4 py-2 hover:bg-blue-50 flex justify-between items-center text-sm"
                      onClick={() => handleSelectSite(suggestion.site_id_canonical)}
                    >
                      <span className="font-medium text-slate-800">{suggestion.site_id_canonical}</span>
                      <span className="text-slate-500 text-xs">({suggestion.row_count} items)</span>
                    </button>
                  ))}
                </div>
              )}
              {showSuggestions && !isSearchLoading && siteIdInput.trim().length > 0 && siteSuggestions.length === 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg px-4 py-3 text-sm text-slate-500 z-50">
                  No inventory found. Try adding a new site.
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setShowAddSiteModal(true);
                setAddSiteQuery('');
                setAddSiteSuggestions([]);
                setAddSiteSelected(null);
                setAddSiteInventoryCount(null);
              }}
              className="px-5 py-2 rounded-md bg-white border border-blue-600 text-blue-600 font-medium hover:bg-blue-50 flex items-center gap-2 whitespace-nowrap"
            >
              <span>+ Add New Site</span>
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-3">
          <div className="overflow-x-auto">
            <div className="flex min-w-max border-b border-slate-200">
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  disabled={!searched}
                  className={
                    'px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ' +
                    (activeTab === tab
                      ? 'border-blue-600 text-blue-700 bg-blue-50'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed')
                  }
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          {activeRequirement && (
            <div className="px-4 py-2 text-xs text-slate-600 flex flex-wrap items-center gap-2">
              <span
                className={
                  'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ' +
                  (activeRequirement.required_flag === 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')
                }
              >
                {activeRequirement.required_flag === 1 ? 'Required' : 'Not required'}
              </span>
              {activeRequirementText && <span>{activeRequirementText}</span>}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        {/* Results */}
        {!loading && searched && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-700">
                <span className="font-semibold">{activeSiteCanonical}</span>
                <span className="mx-2 text-slate-400">|</span>
                Showing <span className="font-semibold">{visibleRowsInTab.length}</span> row
                {visibleRowsInTab.length !== 1 ? 's' : ''}
              </div>
              <button
                onClick={beginAddNew}
                disabled={saving || !searched || isAddingNew}
                className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + Add Row
              </button>
            </div>



            {allSiteRows.length === 0 && !isAddingNew ? (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-600">
                <div className="text-sm">No inventory rows found for {activeSiteCanonical}.</div>
                <button
                  onClick={beginAddNew}
                  disabled={saving || isAddingNew}
                  className="mt-4 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  + Add First Row
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto lg:overflow-x-visible">
                  <table className="w-full" style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '90px' }}>Sheet</th>
                        {/* Category column removed */}
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '140px' }}>Equipment Type</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '160px' }}>Product Name</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '120px' }}>Product #</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '110px' }}>Serial #</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '90px' }}>Tag ID</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '120px' }}>Tag Category</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '140px' }}>Photo Category</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '120px' }}>Updated</th>
                        <th className="px-2 py-1.5 text-center text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '130px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {/* New row being added */}
                      {isAddingNew && draftRow && (
                        <>
                          <tr className="bg-blue-50 border-2 border-blue-300">
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <span className="inline-block px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold">NEW</span>
                            </td>

                            {/* Category hidden/removed */}

                            {/* Equipment Type */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <select
                                value={draftRow.equipment_type || ''}
                                onChange={(e) => updateDraftField('equipment_type', e.target.value || null)}
                                disabled={saving || !draftRow.category}
                                className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                              >
                                <option value="">Select</option>
                                {getEquipmentTypes(draftRow.category).map((et) => (
                                  <option key={et} value={et}>
                                    {et}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Product Name */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <select
                                value={draftRow.product_name || ''}
                                onChange={(e) => updateDraftField('product_name', e.target.value || null)}
                                disabled={saving || !draftRow.category || !draftRow.equipment_type}
                                className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                              >
                                <option value="">Select</option>
                                {getProductNames(draftRow.category, draftRow.equipment_type).map((pn) => (
                                  <option key={pn} value={pn}>
                                    {pn}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Product Number */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <select
                                value={draftRow.product_number || ''}
                                onChange={(e) => updateDraftField('product_number', e.target.value || null)}
                                disabled={saving || !draftRow.category || !draftRow.equipment_type || !draftRow.product_name}
                                className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                              >
                                <option value="">Select</option>
                                {getProductNumbers(draftRow.category, draftRow.equipment_type, draftRow.product_name).map((pnum) => (
                                  <option key={pnum} value={pnum}>
                                    {pnum}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Serial Number */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <input
                                type="text"
                                value={draftRow.serial_number || ''}
                                onChange={(e) => updateDraftField('serial_number', e.target.value)}
                                className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 
                                  ${duplicateFields.serial ? 'border-amber-500 bg-amber-50 focus:ring-amber-500' : 'border-slate-300 focus:ring-blue-500'}`}
                                disabled={saving}
                                placeholder="Optional"
                              />
                              <div className="mt-1 flex items-center gap-1">
                                {draftRow?.serial_pic_url && (
                                  <div className="flex gap-2 items-center">
                                    <a
                                      href="#"
                                      onClick={(e) => { e.preventDefault(); openPreview(draftRow.serial_pic_url, 'Serial Photo'); }}
                                      className="text-[10px] text-blue-600 underline"
                                    >
                                      View
                                    </a>
                                    <button
                                      onClick={() => handleDeleteImage(draftRow.id, 'serial')}
                                      className="text-[10px] text-red-500 hover:text-red-700 font-medium"
                                      title="Delete Photo"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                                <label className="cursor-pointer inline-flex items-center px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] text-slate-700">
                                  {uploadingField?.rowId === draftRow?.id && uploadingField?.field === 'serial' ? (
                                    <span>{uploadProgress || '...'}</span>
                                  ) : (
                                    <>
                                      <span>Upload</span>
                                      <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f && draftRow) handleFileUpload(f, draftRow.id, 'serial');
                                        }}
                                      />
                                    </>
                                  )}
                                </label>
                              </div>
                            </td>

                            {/* Tag ID */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <input
                                type="text"
                                value={draftRow.tag_id || ''}
                                onChange={(e) => updateDraftField('tag_id', e.target.value)}
                                className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 
                                  ${duplicateFields.tagId ? 'border-amber-500 bg-amber-50 focus:ring-amber-500' : 'border-slate-300 focus:ring-blue-500'}`}
                                disabled={saving}
                                placeholder="Optional"
                              />
                              <div className="mt-1 flex items-center gap-1">
                                {draftRow?.tag_pic_url && (
                                  <div className="flex gap-2 items-center">
                                    <a
                                      href="#"
                                      onClick={(e) => { e.preventDefault(); openPreview(draftRow.tag_pic_url, 'Tag Photo'); }}
                                      className="text-[10px] text-blue-600 underline"
                                    >
                                      View
                                    </a>
                                    <button
                                      onClick={() => handleDeleteImage(draftRow.id, 'tag')}
                                      className="text-[10px] text-red-500 hover:text-red-700 font-medium"
                                      title="Delete Photo"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                                <label className="cursor-pointer inline-flex items-center px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] text-slate-700">
                                  {uploadingField?.rowId === draftRow?.id && uploadingField?.field === 'tag' ? (
                                    <span>{uploadProgress || '...'}</span>
                                  ) : (
                                    <>
                                      <span>Upload</span>
                                      <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f && draftRow) handleFileUpload(f, draftRow.id, 'tag');
                                        }}
                                      />
                                    </>
                                  )}
                                </label>
                              </div>
                            </td>

                            {/* Tag Category */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              {tagCategoryError ? (
                                <input
                                  type="text"
                                  value={draftRow.tag_category || ''}
                                  onChange={(e) => updateDraftField('tag_category', e.target.value)}
                                  className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  disabled={saving}
                                />
                              ) : (
                                <select
                                  value={draftRow.tag_category || ''}
                                  onChange={(e) => updateDraftField('tag_category', e.target.value || null)}
                                  className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  disabled={saving}
                                >
                                  <option value="">Select</option>
                                  {tagCategoryOptions.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            {/* Photo Category (previously Actions comment was here but shifting) */}
                            <td className="px-2 py-1.5 text-xs text-slate-800">
                              <select
                                value={draftRow.photo_category || ''}
                                onChange={(e) => updateDraftField('photo_category', e.target.value || null)}
                                className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                disabled={saving}
                              >
                                <option value="">Select</option>
                                {photoCategoryOptions.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </td>
                            {/* Updated (Placeholder) */}
                            <td className="px-2 py-1.5 text-xs text-slate-400 text-center">-</td>

                            <td className="px-2 py-1.5 text-center text-xs space-x-2">
                              <button
                                onClick={saveInlineUpdate}
                                disabled={saving}
                                className="text-blue-600 hover:text-blue-800 font-medium"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelInlineEdit}
                                disabled={saving}
                                className="text-slate-500 hover:text-slate-700"
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                          {editError && (
                            <tr className="bg-red-50 border-l-2 border-r-2 border-b-2 border-blue-400">
                              <td colSpan={9} className="px-4 py-2">
                                <div className="flex items-center text-red-700 text-xs">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span className="font-semibold mr-1">Error:</span> {editError}
                                </div>
                              </td>
                            </tr>
                          )}
                          {editWarning && (
                            <tr className="bg-amber-50 border-l-2 border-r-2 border-b-2 border-blue-400">
                              <td colSpan={9} className="px-4 py-2">
                                <div className="flex items-center text-amber-700 text-xs">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <span className="font-semibold mr-1">Warning:</span> {editWarning}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )}

                      {/* Existing rows */}
                      {visibleRowsInTab.map((row) => {
                        const isEditing = editingRowId === row.id;
                        const isManual = normalizeSheetSource(row.sheet_source).startsWith('manual');

                        // Check duplicates
                        const normSerial = (row.serial_number || '').trim().toLowerCase();
                        const normTag = (row.tag_id || '').trim().toLowerCase();
                        const isDupSerial = normSerial ? (serialCounts.get(normSerial) || 0) > 1 : false;
                        const isDupTag = normTag ? (tagCounts.get(normTag) || 0) > 1 : false;
                        const isDuplicateRow = isDupSerial || isDupTag;

                        let rowClass = 'bg-white border-b border-slate-100 transition-colors';
                        if (isEditing) {
                          rowClass = 'bg-blue-50 border-2 border-blue-400';
                        } else if (isDuplicateRow) {
                          rowClass = 'bg-amber-50 border-l-4 border-l-amber-500';
                        } else if (isManual) {
                          rowClass = 'bg-green-50 hover:bg-green-100';
                        } else {
                          rowClass = 'hover:bg-slate-50';
                        }

                        return (
                          <React.Fragment key={row.id}>
                            <tr className={rowClass}>
                              {isEditing ? (
                                // Edit mode fields
                                <>
                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    {(draftRow?.sheet_source || row.sheet_source)?.substring(0, 12)}
                                  </td>



                                  {/* Category hidden */}

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    <select
                                      value={draftRow?.equipment_type || ''}
                                      onChange={(e) => updateDraftField('equipment_type', e.target.value || null)}
                                      disabled={saving || !draftRow?.category}
                                      className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                                    >
                                      <option value="">Select</option>
                                      {getEquipmentTypes(draftRow?.category || null).map((et) => (
                                        <option key={et} value={et}>
                                          {et}
                                        </option>
                                      ))}
                                    </select>
                                  </td>

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    <select
                                      value={draftRow?.product_name || ''}
                                      onChange={(e) => updateDraftField('product_name', e.target.value || null)}
                                      disabled={saving || !draftRow?.category || !draftRow?.equipment_type}
                                      className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                                    >
                                      <option value="">Select</option>
                                      {getProductNames(draftRow?.category || null, draftRow?.equipment_type || null).map((pn) => (
                                        <option key={pn} value={pn}>
                                          {pn}
                                        </option>
                                      ))}
                                    </select>
                                  </td>

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    <select
                                      value={draftRow?.product_number || ''}
                                      onChange={(e) => updateDraftField('product_number', e.target.value || null)}
                                      disabled={saving || !draftRow?.category || !draftRow?.equipment_type || !draftRow?.product_name}
                                      className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs font-mono bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                                    >
                                      <option value="">Select</option>
                                      {getProductNumbers(draftRow?.category || null, draftRow?.equipment_type || null, draftRow?.product_name || null).map((pnum) => (
                                        <option key={pnum} value={pnum}>
                                          {pnum}
                                        </option>
                                      ))}
                                    </select>
                                  </td>

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    <input
                                      type="text"
                                      value={draftRow?.serial_number || ''}
                                      onChange={(e) => updateDraftField('serial_number', e.target.value)}
                                      className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 
                                        ${duplicateFields.serial ? 'border-amber-500 bg-amber-50 focus:ring-amber-500' : 'border-slate-300 focus:ring-blue-500'}`}
                                      disabled={saving}
                                    />
                                    <div className="mt-1 flex items-center gap-1">
                                      {draftRow?.serial_pic_url && (
                                        <a
                                          href="#"
                                          onClick={(e) => { e.preventDefault(); openPreview(draftRow.serial_pic_url, 'Serial Photo'); }}
                                          className="text-[10px] text-blue-600 underline"
                                        >
                                          View
                                        </a>
                                      )}
                                      <label className="cursor-pointer inline-flex items-center px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] text-slate-700">
                                        {uploadingField?.rowId === draftRow?.id && uploadingField?.field === 'serial' ? (
                                          <span>{uploadProgress || '...'}</span>
                                        ) : (
                                          <>
                                            <span>Upload</span>
                                            <input
                                              type="file"
                                              className="hidden"
                                              accept="image/*"
                                              onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f && draftRow) handleFileUpload(f, draftRow.id, 'serial');
                                              }}
                                            />
                                          </>
                                        )}
                                      </label>
                                    </div>
                                  </td>

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    <input
                                      type="text"
                                      value={draftRow?.tag_id || ''}
                                      onChange={(e) => updateDraftField('tag_id', e.target.value)}
                                      className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 
                                        ${duplicateFields.tagId ? 'border-amber-500 bg-amber-50 focus:ring-amber-500' : 'border-slate-300 focus:ring-blue-500'}`}
                                      disabled={saving}
                                    />
                                    <div className="mt-1 flex items-center gap-1">
                                      {draftRow?.tag_pic_url && (
                                        <a
                                          href="#"
                                          onClick={(e) => { e.preventDefault(); openPreview(draftRow.tag_pic_url, 'Tag Photo'); }}
                                          className="text-[10px] text-blue-600 underline"
                                        >
                                          View
                                        </a>
                                      )}
                                      <label className="cursor-pointer inline-flex items-center px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 rounded text-[10px] text-slate-700">
                                        {uploadingField?.rowId === draftRow?.id && uploadingField?.field === 'tag' ? (
                                          <span>{uploadProgress || '...'}</span>
                                        ) : (
                                          <>
                                            <span>Upload</span>
                                            <input
                                              type="file"
                                              className="hidden"
                                              accept="image/*"
                                              onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f && draftRow) handleFileUpload(f, draftRow.id, 'tag');
                                              }}
                                            />
                                          </>
                                        )}
                                      </label>
                                    </div>
                                  </td>

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    {tagCategoryError ? (
                                      <input
                                        type="text"
                                        value={draftRow?.tag_category || ''}
                                        onChange={(e) => updateDraftField('tag_category', e.target.value)}
                                        className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        disabled={saving}
                                      />
                                    ) : (
                                      <select
                                        value={draftRow?.tag_category || ''}
                                        onChange={(e) => updateDraftField('tag_category', e.target.value || null)}
                                        className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        disabled={saving}
                                      >
                                        <option value="">Select</option>
                                        {tagCategoryOptions.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </td>

                                  <td className="px-2 py-1.5 text-xs text-slate-800">
                                    <select
                                      value={draftRow?.photo_category || ''}
                                      onChange={(e) => updateDraftField('photo_category', e.target.value || null)}
                                      className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      disabled={saving}
                                    >
                                      <option value="">Select</option>
                                      {photoCategoryOptions.map((opt) => (
                                        <option key={opt} value={opt}>{opt}</option>
                                      ))}
                                    </select>
                                  </td>

                                  {/* Updated (Read Only) */}
                                  <td className="px-2 py-1.5 text-xs text-slate-500 text-[10px]">
                                    {row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}
                                  </td>

                                  <td className="px-2 py-1.5 text-center text-xs space-x-2">
                                    <button
                                      onClick={saveInlineUpdate}
                                      disabled={saving}
                                      className="text-blue-600 hover:text-blue-800 font-medium"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={cancelInlineEdit}
                                      disabled={saving}
                                      className="text-slate-500 hover:text-slate-700"
                                    >
                                      Cancel
                                    </button>
                                    {!isAddingNew && (
                                      <button
                                        onClick={() => handleDeleteRow(row.id)}
                                        className="block w-full mt-1 text-red-500 hover:text-red-700 font-medium text-[10px]"
                                      >
                                        Delete Row
                                      </button>
                                    )}
                                  </td>
                                </>
                              ) : (
                                // View Mode
                                <>
                                  <td className="px-2 py-1.5 text-xs text-slate-500">
                                    <span className={isManual ? 'font-medium text-amber-700' : ''}>
                                      {row.sheet_source}
                                    </span>
                                  </td>
                                  {/* Category hidden */}
                                  <td className="px-2 py-1.5 text-xs text-slate-800">{row.equipment_type}</td>
                                  <td className="px-2 py-1.5 text-xs text-slate-800">{row.product_name}</td>
                                  <td className="px-2 py-1.5 text-xs font-mono text-slate-600">{row.product_number}</td>
                                  <td className="px-2 py-1.5 text-xs font-mono text-blue-700 font-medium">
                                    {row.serial_number}
                                    {row.serial_pic_url && (
                                      <div className="ml-2 inline-flex gap-1 items-center">
                                        <button
                                          onClick={() => openPreview(row.serial_pic_url, 'Serial Photo')}
                                          className="text-[10px] text-blue-500 underline hover:text-blue-700"
                                        >
                                          View
                                        </button>
                                        <button
                                          onClick={() => handleDeleteImage(row.id, 'serial')}
                                          className="text-[10px] text-red-400 hover:text-red-600 font-bold px-1"
                                          title="Delete Photo"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                    {isDupSerial && (
                                      <div className="mt-1 text-[10px] text-amber-700 font-bold flex items-center">
                                        ⚠ Duplicated ({serialCounts.get(normSerial)})
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs font-mono text-slate-600">
                                    {row.tag_id}
                                    {row.tag_pic_url && (
                                      <div className="ml-2 inline-flex gap-1 items-center">
                                        <button
                                          onClick={() => openPreview(row.tag_pic_url, 'Tag Photo')}
                                          className="text-[10px] text-blue-500 underline hover:text-blue-700"
                                        >
                                          View
                                        </button>
                                        <button
                                          onClick={() => handleDeleteImage(row.id, 'tag')}
                                          className="text-[10px] text-red-400 hover:text-red-600 font-bold px-1"
                                          title="Delete Photo"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                    {isDupTag && (
                                      <div className="mt-1 text-[10px] text-amber-700 font-bold flex items-center">
                                        ⚠ Duplicated ({tagCounts.get(normTag)})
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-slate-800">{row.tag_category}</td>
                                  <td className="px-2 py-1.5 text-xs text-slate-800">{row.photo_category}</td>
                                  <td className="px-2 py-1.5 text-xs text-slate-500 text-[10px]">
                                    {row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-xs">
                                    <button
                                      onClick={() => beginInlineEdit(row)}
                                      disabled={isAddingNew || (editingRowId !== null && editingRowId !== row.id)}
                                      className="text-blue-600 hover:text-blue-800 font-medium disabled:opacity-30"
                                    >
                                      Edit
                                    </button>
                                    {isManual && (
                                      <button
                                        onClick={() => handleDeleteRow(row.id)}
                                        className="ml-2 text-red-500 hover:text-red-700 font-medium disabled:opacity-30"
                                        disabled={isAddingNew || (editingRowId !== null && editingRowId !== row.id)}
                                        title="Delete Row"
                                      >
                                        ✕
                                      </button>
                                    )}
                                    {/* Link for Verify - Only show if not already verified */}

                                  </td>
                                </>
                              )}
                            </tr>
                            {isEditing && editError && (
                              <tr className="bg-red-50 border-l-2 border-r-2 border-b-2 border-blue-400">
                                <td colSpan={9} className="px-4 py-2">
                                  <div className="flex items-center text-red-700 text-xs">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <span className="font-semibold mr-1">Error:</span> {editError}
                                  </div>
                                </td>
                              </tr>
                            )}
                            {isEditing && editWarning && (
                              <tr className="bg-amber-50 border-l-2 border-r-2 border-b-2 border-blue-400">
                                <td colSpan={9} className="px-4 py-2">
                                  <div className="flex items-center text-amber-700 text-xs">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    <span className="font-semibold mr-1">Warning:</span> {editWarning}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ImagePreviewModal
        isOpen={!!previewUrl}
        imageUrl={previewUrl}
        title={previewTitle}
        onClose={closePreview}
      />

      {/* Add New Site Modal */}
      {
        showAddSiteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-slate-800">Add New Site</h3>
                <button
                  onClick={() => setShowAddSiteModal(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              </div>

              <div className="p-6">
                {!addSiteSelected ? (
                  <>
                    <p className="text-sm text-slate-600 mb-3">
                      Search for an active site from the Front Office list.
                    </p>
                    <input
                      type="text"
                      value={addSiteQuery}
                      onChange={(e) => setAddSiteQuery(e.target.value)}
                      placeholder="Search site (e.g. 5074)..."
                      className="w-full px-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                      autoFocus
                    />

                    {addSiteLoading ? (
                      <div className="text-center py-4 text-slate-500">Searching...</div>
                    ) : (
                      <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-md">
                        {addSiteSuggestions.map((site) => (
                          <button
                            key={site.site_id_with_w}
                            onClick={() => handleSelectAddSite(site)}
                            className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-slate-50 last:border-0"
                          >
                            <div className="font-medium text-slate-800">{site.site_id_with_w}</div>
                            {site.site_id_without_w !== site.site_id_with_w && (
                              <div className="text-xs text-slate-400">Alt: {site.site_id_without_w}</div>
                            )}
                          </button>
                        ))}
                        {addSiteQuery && addSiteSuggestions.length === 0 && (
                          <div className="text-center py-4 text-slate-500">No active sites found.</div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center">
                    <div className="mb-4">
                      <div className="text-sm text-slate-500 mb-1">Selected Site</div>
                      <div className="text-2xl font-bold text-slate-800">{addSiteSelected.canonical}</div>
                    </div>

                    {checkingInventory ? (
                      <div className="py-4 text-slate-500">Checking inventory...</div>
                    ) : (
                      <div className="space-y-4">
                        {addSiteInventoryCount !== null && addSiteInventoryCount > 0 ? (
                          <div className="bg-amber-50 text-amber-800 p-4 rounded-md text-sm">
                            This site already has {addSiteInventoryCount} inventory items.
                            <button
                              onClick={executeOpenExistingSite}
                              className="block w-full mt-3 px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700"
                            >
                              Open Site
                            </button>
                          </div>
                        ) : (
                          <div className="bg-green-50 text-green-800 p-4 rounded-md text-sm">
                            No inventory found. You can add the first row.
                            <button
                              onClick={executeAddFirstRow}
                              className="block w-full mt-3 px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700"
                            >
                              Add First Row
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => {
                            setAddSiteSelected(null);
                            setAddSiteInventoryCount(null);
                          }}
                          className="text-sm text-slate-500 hover:text-slate-800 underline"
                        >
                          Back to Search
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }
    </main >
  );
}
