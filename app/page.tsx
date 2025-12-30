
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { updateMainInventoryRow } from '@/lib/mainInventory';

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

function normalizeSiteId(input: string): { normalized: string; rawDigits: string; original: string } {
  const trimmed = input.trim();
  const original = trimmed;

  if (/^\d+$/.test(trimmed)) {
    return { normalized: 'W' + trimmed, rawDigits: trimmed, original };
  }

  const wMatch = trimmed.match(/^[Ww](\d+)$/);
  if (wMatch) {
    return { normalized: 'W' + wMatch[1], rawDigits: wMatch[1], original };
  }

  return { normalized: trimmed, rawDigits: trimmed.replace(/\D/g, ''), original };
}

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

export default function Home() {
  const [siteIdInput, setSiteIdInput] = useState('');
  const [allSiteRows, setAllSiteRows] = useState<InventoryRow[]>([]);
  const [requirementsMap, setRequirementsMap] = useState<Map<string, CategoryRequirement>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const [activeTab, setActiveTab] = useState<CategoryTab>('All');

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [draftRow, setDraftRow] = useState<InventoryRow | null>(null);
  const [originalRow, setOriginalRow] = useState<InventoryRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedDetailsRowId, setExpandedDetailsRowId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [duplicateFields, setDuplicateFields] = useState<{ serial: boolean; tagId: boolean }>({ serial: false, tagId: false });

  const [cascadeMaps, setCascadeMaps] = useState<CascadeMaps>({
    categories: [],
    categoryToEquipmentTypes: new Map(),
    categoryEquipmentToProductNames: new Map(),
    categoryEquipmentProductToNumbers: new Map()
  });

  const [tagCategoryOptions, setTagCategoryOptions] = useState<string[]>([]);
  const [tagCategoryLoading, setTagCategoryLoading] = useState(true);
  const [tagCategoryError, setTagCategoryError] = useState(false);

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

  const { visibleRows, hiddenDuplicateCount } = useMemo(() => {
    const normActiveTab = normalizeCategoryName(activeTab);

    const filteredByTab =
      activeTab === 'All'
        ? allSiteRows
        : allSiteRows.filter((row) => normalizeCategoryName(row.category) === normActiveTab);

    let hiddenNfoCount = 0;

    const afterNfoFilter = filteredByTab.filter((row) => {
      const catNorm = normalizeCategoryName(row.category);
      const srcNorm = normalizeSheetSource(row.sheet_source);
      const isMwOrRanActive = catNorm === 'mw-active' || catNorm === 'ran-active';
      const isNfo = srcNorm === 'nfo_sheet';

      if (isMwOrRanActive && isNfo) {
        hiddenNfoCount += 1;
        return false;
      }
      return true;
    });

    const seen = new Set<string>();
    const deduped = afterNfoFilter.filter((row) => {
      const site = (row.site_id || '').trim();
      const serial = (row.serial_number || '').trim();

      if (!serial) return true;

      const key = `${site}__${serial}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const hiddenDupCount = afterNfoFilter.length - deduped.length;

    return { visibleRows: deduped, hiddenDuplicateCount: hiddenDupCount };
  }, [activeTab, allSiteRows]);

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

  const handleSearch = async () => {
    if (!siteIdInput.trim()) {
      setError('Please enter a Site ID');
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const { normalized, rawDigits, original } = normalizeSiteId(siteIdInput);
      const searchValues = [...new Set([normalized, rawDigits, original])];
      const siteIdNorm = normalized.replace(/^[Ww]/, '');

      const { data, error: queryError } = await supabase
        .from('main_inventory')
        .select(
          'id, site_id, sheet_source, category, equipment_type, product_name, product_number, serial_number, tag_id, tag_category, serial_pic_url, tag_pic_url, updated_at'
        )
        .in('site_id', searchValues)
        .order('updated_at', { ascending: false });

      if (queryError) throw new Error(queryError.message);

      setAllSiteRows(data || []);

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
      setError(err instanceof Error ? err.message : 'An error occurred while searching');
      setAllSiteRows([]);
      setRequirementsMap(new Map());
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const beginInlineEdit = (row: InventoryRow) => {
    if (saving) return;

    if (editingRowId && editingRowId !== row.id) {
      setEditingRowId(null);
      setDraftRow(null);
      setOriginalRow(null);
      setEditError(null);
    }

    setEditingRowId(row.id);
    setDraftRow({ ...row });
    setOriginalRow({ ...row });
    setEditError(null);
    setIsAddingNew(false);
    setDuplicateFields({ serial: false, tagId: false });
  };

  const beginAddNew = () => {
    if (saving || !siteIdInput.trim()) return;

    // Cancel any existing edit
    if (editingRowId) {
      setEditingRowId(null);
      setDraftRow(null);
      setOriginalRow(null);
      setEditError(null);
    }

    // Create new draft row
    const newRow: InventoryRow = {
      id: 'NEW_TEMP_ID',
      site_id: normalizeSiteId(siteIdInput).normalized,
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

    const siteId = (draft.site_id || '').trim().toLowerCase();
    const serial = (draft.serial_number || '').trim();
    const tagId = (draft.tag_id || '').trim();

    // Check against ALL results for this site_id (unfiltered by category tab)
    // This ensures we check against the complete dataset for the searched site
    const siteRows = allSiteRows.filter(r => {
      const rowSiteId = (r.site_id || '').trim().toLowerCase();
      const isSameSite = rowSiteId === siteId;
      const isSelfRow = !isNew && r.id === draft.id;
      return isSameSite && !isSelfRow;
    });

    let hasDuplicateSerial = false;
    let hasDuplicateTag = false;
    const errors: string[] = [];

    // Check duplicate serial (only if non-empty)
    if (serial) {
      const serialLower = serial.toLowerCase();
      hasDuplicateSerial = siteRows.some(r => {
        const existingSerial = (r.serial_number || '').trim().toLowerCase();
        return existingSerial && existingSerial === serialLower;
      });
      if (hasDuplicateSerial) {
        errors.push('Duplicate Serial Number already exists in this Site ID.');
      }
    }

    // Check duplicate tag_id (only if non-empty)
    if (tagId) {
      const tagIdLower = tagId.toLowerCase();
      hasDuplicateTag = siteRows.some(r => {
        const existingTagId = (r.tag_id || '').trim().toLowerCase();
        return existingTagId && existingTagId === tagIdLower;
      });
      if (hasDuplicateTag) {
        errors.push('Duplicate Tag ID already exists in this Site ID.');
      }
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

    // Check for duplicates against ALL site rows
    const duplicateCheck = checkDuplicates(draftRow, isAddingNew);
    if (duplicateCheck.error) {
      setEditError(duplicateCheck.error);
      setDuplicateFields({
        serial: duplicateCheck.duplicateSerial,
        tagId: duplicateCheck.duplicateTag
      });
      return;
    }

    setSaving(true);
    setEditError(null);
    setDuplicateFields({ serial: false, tagId: false });

    try {
      if (isAddingNew) {
        // INSERT new row
        const { data, error: insertError } = await supabase
          .from('main_inventory')
          .insert({
            site_id: draftRow.site_id,
            sheet_source: draftRow.sheet_source,
            category: draftRow.category,
            equipment_type: draftRow.equipment_type,
            product_name: draftRow.product_name,
            product_number: draftRow.product_number,
            serial_number: draftRow.serial_number,
            tag_id: draftRow.tag_id,
            tag_category: draftRow.tag_category,
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
        const nextSheetSource = existingSourceNorm === 'manual_added' ? 'Manual_added' : 'Manual_edited';

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

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4">
        {/* Top section */}
        <div className="mb-4">
          <h1 className="text-2xl font-semibold text-slate-900">TagForge</h1>
          <p className="text-sm text-slate-600">Site inventory management</p>
        </div>

        {/* Search bar */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={siteIdInput}
              onChange={(e) => setSiteIdInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter Site ID"
              className="flex-1 px-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-5 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Searching…' : 'Search'}
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
                  className={
                    'px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ' +
                    (activeTab === tab
                      ? 'border-blue-600 text-blue-700 bg-blue-50'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50')
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
                Showing <span className="font-semibold">{visibleRows.length}</span> row
                {visibleRows.length !== 1 ? 's' : ''}
                {hiddenDuplicateCount > 0 && (
                  <span className="text-slate-500"> ({hiddenDuplicateCount} duplicate{hiddenDuplicateCount !== 1 ? 's' : ''} hidden)</span>
                )}
              </div>
              <button
                onClick={beginAddNew}
                disabled={saving || !searched || allSiteRows.length === 0 || isAddingNew}
                className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + Add Row
              </button>
            </div>

            {allSiteRows.length === 0 && !isAddingNew ? (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-600">
                <div className="text-sm">No data found for this site.</div>
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
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '130px' }}>Category</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '140px' }}>Equipment Type</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '160px' }}>Product Name</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '120px' }}>Product #</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '110px' }}>Serial #</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '90px' }}>Tag ID</th>
                        <th className="px-2 py-1.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '120px' }}>Tag Category</th>
                        <th className="px-2 py-1.5 text-center text-xs font-semibold text-slate-700 uppercase tracking-wide" style={{ width: '130px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {/* New row being added */}
                      {isAddingNew && draftRow && (
                        <tr className="bg-blue-50 border-2 border-blue-300">
                          <td className="px-2 py-1.5 text-xs text-slate-800">
                            <span className="inline-block px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold">NEW</span>
                          </td>

                          {/* Category */}
                          <td className="px-2 py-1.5 text-xs text-slate-800">
                            <select
                              value={draftRow.category || ''}
                              onChange={(e) => updateDraftField('category', e.target.value || null)}
                              className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              disabled={saving || (activeTab !== 'All')}
                            >
                              <option value="">Select</option>
                              {(activeTab === 'All' ? cascadeMaps.categories : [activeTab]).map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          </td>

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
                              className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 ${duplicateFields.serial ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-blue-500'}`}
                              disabled={saving}
                              placeholder="Optional"
                            />
                          </td>

                          {/* Tag ID */}
                          <td className="px-2 py-1.5 text-xs text-slate-800">
                            <input
                              type="text"
                              value={draftRow.tag_id || ''}
                              onChange={(e) => updateDraftField('tag_id', e.target.value)}
                              className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 ${duplicateFields.tagId ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-blue-500'}`}
                              disabled={saving}
                              placeholder="Optional"
                            />
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
                                className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                                disabled={saving || tagCategoryLoading}
                              >
                                <option value="">{tagCategoryLoading ? 'Loading…' : 'Select'}</option>
                                {tagCategoryOptions.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {cat}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={saveInlineUpdate}
                                disabled={saving || !canUpdateDraft}
                                className="px-2 py-0.5 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {saving ? 'Saving…' : 'Add'}
                              </button>
                              <button
                                onClick={cancelInlineEdit}
                                disabled={saving}
                                className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Existing rows */}
                      {visibleRows.map((row) => {
                        const isEditing = editingRowId === row.id;
                        const isDetailsExpanded = expandedDetailsRowId === row.id;
                        const rowKey = row.id || `${row.site_id}__${(row.serial_number || '').trim() || 'EMPTY'}__${row.product_number || row.product_name || ''}`;
                        
                        return (
                          <React.Fragment key={rowKey}>
                            <tr className="hover:bg-slate-50">
                              <td className="px-2 py-1.5 text-xs text-slate-800" title={row.sheet_source || ''}>
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="truncate" title={row.sheet_source || ''}>
                                    {row.sheet_source || '—'}
                                  </span>
                                  {(() => {
                                    const srcNorm = normalizeSheetSource(row.sheet_source);
                                    let badgeText = '';
                                    let badgeClass = '';

                                    if (srcNorm === 'manual_added') {
                                      badgeText = 'Added';
                                      badgeClass = 'bg-emerald-100 text-emerald-700';
                                    } else if (srcNorm === 'manual_edited') {
                                      badgeText = 'Edited';
                                      badgeClass = 'bg-blue-100 text-blue-700';
                                    } else if (srcNorm === 'nfo_sheet') {
                                      badgeText = 'NFO Import';
                                      badgeClass = 'bg-orange-100 text-orange-700';
                                    } else if (srcNorm === 'sys_sheet' || srcNorm === 'matched') {
                                      badgeText = 'System';
                                      badgeClass = 'bg-slate-100 text-slate-700';
                                    }

                                    return badgeText ? (
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${badgeClass}`}>
                                        {badgeText}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                              </td>

                              {/* Category */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
                                  <select
                                    value={draftRow.category || ''}
                                    onChange={(e) => updateDraftField('category', e.target.value || null)}
                                    className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    disabled={saving || (activeTab !== 'All')}
                                  >
                                    <option value="">Select</option>
                                    {(activeTab === 'All' ? cascadeMaps.categories : [activeTab]).map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="truncate block" title={row.category || ''}>
                                    {row.category || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Equipment Type */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
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
                                ) : (
                                  <span className="truncate block" title={row.equipment_type || ''}>
                                    {row.equipment_type || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Product Name */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
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
                                ) : (
                                  <span className="truncate block" title={row.product_name || ''}>
                                    {row.product_name || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Product Number */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
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
                                ) : (
                                  <span className="font-mono truncate block" title={row.product_number || ''}>
                                    {row.product_number || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Serial Number */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
                                  <input
                                    type="text"
                                    value={draftRow.serial_number || ''}
                                    onChange={(e) => updateDraftField('serial_number', e.target.value)}
                                    className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 ${duplicateFields.serial ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-blue-500'}`}
                                    disabled={saving}
                                  />
                                ) : (
                                  <span className="font-mono truncate block" title={row.serial_number || ''}>
                                    {row.serial_number || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Tag ID */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
                                  <input
                                    type="text"
                                    value={draftRow.tag_id || ''}
                                    onChange={(e) => updateDraftField('tag_id', e.target.value)}
                                    className={`w-full h-7 px-1.5 py-0.5 border rounded text-xs font-mono focus:outline-none focus:ring-1 ${duplicateFields.tagId ? 'border-red-500 bg-red-50 focus:ring-red-500' : 'border-slate-300 focus:ring-blue-500'}`}
                                    disabled={saving}
                                  />
                                ) : (
                                  <span className="font-mono truncate block" title={row.tag_id || ''}>
                                    {row.tag_id || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Tag Category */}
                              <td className="px-2 py-1.5 text-xs text-slate-800">
                                {isEditing && draftRow ? (
                                  tagCategoryError ? (
                                    <input
                                      type="text"
                                      value={draftRow.tag_category || ''}
                                      onChange={(e) => updateDraftField('tag_category', e.target.value)}
                                      className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                      disabled={saving}
                                      placeholder="Load failed"
                                    />
                                  ) : (
                                    <select
                                      value={draftRow.tag_category || ''}
                                      onChange={(e) => updateDraftField('tag_category', e.target.value || null)}
                                      className="w-full h-7 px-1.5 py-0.5 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
                                      disabled={saving || tagCategoryLoading}
                                    >
                                      <option value="">{tagCategoryLoading ? 'Loading…' : 'Select'}</option>
                                      {draftRow.tag_category && !tagCategoryOptions.includes(draftRow.tag_category) && (
                                        <option value={draftRow.tag_category}>(Current) {draftRow.tag_category}</option>
                                      )}
                                      {tagCategoryOptions.map((cat) => (
                                        <option key={cat} value={cat}>
                                          {cat}
                                        </option>
                                      ))}
                                    </select>
                                  )
                                ) : (
                                  <span className="truncate block" title={row.tag_category || ''}>
                                    {row.tag_category || '—'}
                                  </span>
                                )}
                              </td>

                              {/* Actions */}
                              <td className="px-2 py-1.5 text-center">
                                {isEditing ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={saveInlineUpdate}
                                      disabled={saving || !canUpdateDraft}
                                      className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {saving ? 'Saving…' : 'Update'}
                                    </button>
                                    <button
                                      onClick={() => {
                                        cancelInlineEdit();
                                      }}
                                      disabled={saving}
                                      className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      onClick={() => beginInlineEdit(row)}
                                      disabled={saving || (editingRowId !== null && editingRowId !== row.id)}
                                      className="px-2 py-0.5 rounded bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Edit
                                    </button>
                                    {(row.serial_pic_url || row.tag_pic_url) && (
                                      <button
                                        onClick={() => setExpandedDetailsRowId(isDetailsExpanded ? null : row.id)}
                                        className="px-1 py-0.5 rounded border border-slate-300 text-slate-700 text-xs hover:bg-slate-50"
                                        title={isDetailsExpanded ? 'Hide photos' : 'Show photos'}
                                      >
                                        {isDetailsExpanded ? '▲' : '▼'}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>

                            {/* Details expansion row - only for photo URLs */}
                            {isDetailsExpanded && (row.serial_pic_url || row.tag_pic_url) && (
                              <tr className="bg-slate-50">
                                <td colSpan={9} className="px-2 py-2">
                                  <div className="flex gap-4 text-xs">
                                    {row.serial_pic_url && (
                                      <div className="flex-1">
                                        <span className="text-slate-600 font-semibold">Serial Photo: </span>
                                        <a href={row.serial_pic_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">
                                          {row.serial_pic_url}
                                        </a>
                                      </div>
                                    )}
                                    {row.tag_pic_url && (
                                      <div className="flex-1">
                                        <span className="text-slate-600 font-semibold">Tag Photo: </span>
                                        <a href={row.tag_pic_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">
                                          {row.tag_pic_url}
                                        </a>
                                      </div>
                                    )}
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

                {editingRowId && editError && (
                  <div className="px-4 py-3 border-t border-slate-200 bg-red-50 text-red-700 text-sm">
                    {editError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-600">
            Loading…
          </div>
        )}
      </div>
    </main>
  );
}
