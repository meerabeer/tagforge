'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';

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

export default function Home() {
  const [siteIdInput, setSiteIdInput] = useState('');
  const [results, setResults] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Category tab state
  const [activeTab, setActiveTab] = useState<string>('All');

  // Helper catalog cascade maps (loaded once)
  const [cascadeMaps, setCascadeMaps] = useState<CascadeMaps>({
    categories: [],
    categoryToEquipmentTypes: new Map(),
    categoryEquipmentToProductNames: new Map(),
    categoryEquipmentProductToNumbers: new Map()
  });
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // Track edits per row (Map<rowId, InventoryRow>)
  const [rowEdits, setRowEdits] = useState<Map<string, InventoryRow>>(new Map());
  const [updateSuccess, setUpdateSuccess] = useState<Map<string, boolean>>(new Map());
  const [updateErrors, setUpdateErrors] = useState<Map<string, string>>(new Map());

  // Add Row state
  const [addRowSheetSource, setAddRowSheetSource] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedEquipmentType, setSelectedEquipmentType] = useState('');
  const [selectedProductName, setSelectedProductName] = useState('');
  const [selectedProductNumber, setSelectedProductNumber] = useState('');
  const [newSerialNumber, setNewSerialNumber] = useState('');
  const [newTagId, setNewTagId] = useState('');
  const [newTagCategory, setNewTagCategory] = useState('');
  const [addRowSerialPicUrl, setAddRowSerialPicUrl] = useState('');
  const [addRowTagPicUrl, setAddRowTagPicUrl] = useState('');

  // Add Row cascaded options
  const [catalogEquipmentTypes, setCatalogEquipmentTypes] = useState<string[]>([]);
  const [catalogProductNames, setCatalogProductNames] = useState<string[]>([]);
  const [catalogProductNumbers, setCatalogProductNumbers] = useState<string[]>([]);

  // Compute unique categories from results for tabs
  const categoryTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach((row) => {
      const cat = row.category || 'Uncategorized';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [results]);

  // Filter results based on active tab
  const filteredResults = useMemo(() => {
    if (activeTab === 'All') return results;
    return results.filter((row) => (row.category || 'Uncategorized') === activeTab);
  }, [results, activeTab]);

  // Reset active tab when results change
  useEffect(() => { setActiveTab('All'); }, [results]);

  // Lock category when tab is not "All"
  const lockedCategory = activeTab !== 'All' ? activeTab : null;
  const addRowCategory = lockedCategory || selectedCategory;

  // Load helper_catalog once on mount
  useEffect(() => {
    const loadCatalog = async () => {
      try {
        const { data, error } = await supabase
          .from('helper_catalog')
          .select('category, equipment_type, product_name, product_number');

        if (error) throw error;
        if (!data) return;

        // Build cascade maps
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
        setCatalogLoaded(true);
      } catch (err) {
        console.error('Failed to load catalog:', err);
      }
    };
    loadCatalog();
  }, []);

  // Sync selectedCategory when tab changes (locked category)
  useEffect(() => {
    if (lockedCategory) setSelectedCategory(lockedCategory);
  }, [lockedCategory]);

  // Fetch equipment types for Add Row when addRowCategory changes
  useEffect(() => {
    if (!addRowCategory) {
      setCatalogEquipmentTypes([]);
      setSelectedEquipmentType('');
      setCatalogProductNames([]);
      setSelectedProductName('');
      setCatalogProductNumbers([]);
      setSelectedProductNumber('');
      return;
    }
    const equipmentTypes = cascadeMaps.categoryToEquipmentTypes.get(addRowCategory) || [];
    setCatalogEquipmentTypes(equipmentTypes);
    setSelectedEquipmentType('');
    setCatalogProductNames([]);
    setSelectedProductName('');
    setCatalogProductNumbers([]);
    setSelectedProductNumber('');
  }, [addRowCategory, cascadeMaps]);

  // Fetch product names for Add Row when equipment type changes
  useEffect(() => {
    if (!addRowCategory || !selectedEquipmentType) {
      setCatalogProductNames([]);
      setSelectedProductName('');
      setCatalogProductNumbers([]);
      setSelectedProductNumber('');
      return;
    }
    const key = `${addRowCategory}|${selectedEquipmentType}`;
    const productNames = cascadeMaps.categoryEquipmentToProductNames.get(key) || [];
    setCatalogProductNames(productNames);
    setSelectedProductName('');
    setCatalogProductNumbers([]);
    setSelectedProductNumber('');
  }, [addRowCategory, selectedEquipmentType, cascadeMaps]);

  // Fetch product numbers for Add Row when product name changes
  useEffect(() => {
    if (!addRowCategory || !selectedEquipmentType || !selectedProductName) {
      setCatalogProductNumbers([]);
      setSelectedProductNumber('');
      return;
    }
    const key = `${addRowCategory}|${selectedEquipmentType}|${selectedProductName}`;
    const productNumbers = cascadeMaps.categoryEquipmentProductToNumbers.get(key) || [];
    setCatalogProductNumbers(productNumbers);
    setSelectedProductNumber('');
  }, [addRowCategory, selectedEquipmentType, selectedProductName, cascadeMaps]);

  // Helper functions for inline editing
  const getRowData = (row: InventoryRow): InventoryRow => {
    return rowEdits.get(row.id) || row;
  };

  const updateRowField = (rowId: string, originalRow: InventoryRow, field: keyof InventoryRow, value: string | null) => {
    const currentData = rowEdits.get(rowId) || originalRow;
    const updated = { ...currentData, [field]: value };

    // Handle cascading when category changes
    if (field === 'category') {
      updated.equipment_type = null;
      updated.product_name = null;
      updated.product_number = null;
    }

    // Handle cascading when equipment_type changes
    if (field === 'equipment_type') {
      updated.product_name = null;
      updated.product_number = null;
    }

    // Handle cascading when product_name changes
    if (field === 'product_name') {
      updated.product_number = null;
    }

    setRowEdits(prev => new Map(prev).set(rowId, updated));
  };

  const resetRow = (rowId: string) => {
    setRowEdits(prev => {
      const newMap = new Map(prev);
      newMap.delete(rowId);
      return newMap;
    });
    setUpdateSuccess(prev => {
      const newMap = new Map(prev);
      newMap.delete(rowId);
      return newMap;
    });
    setUpdateErrors(prev => {
      const newMap = new Map(prev);
      newMap.delete(rowId);
      return newMap;
    });
  };

  const handleUpdateRow = async (rowId: string, originalRow: InventoryRow) => {
    const editedRow = rowEdits.get(rowId);
    if (!editedRow) return;

    try {
      const { error: updateError } = await supabase
        .from('main_inventory')
        .update({
          sheet_source: editedRow.sheet_source,
          category: editedRow.category,
          equipment_type: editedRow.equipment_type,
          product_name: editedRow.product_name,
          product_number: editedRow.product_number,
          serial_number: editedRow.serial_number,
          tag_id: editedRow.tag_id,
          tag_category: editedRow.tag_category,
          serial_pic_url: editedRow.serial_pic_url,
          tag_pic_url: editedRow.tag_pic_url
        })
        .eq('id', rowId);

      if (updateError) throw updateError;

      // Update local results
      setResults(prev => prev.map(r => r.id === rowId ? editedRow : r));
      
      // Clear edit for this row
      setRowEdits(prev => {
        const newMap = new Map(prev);
        newMap.delete(rowId);
        return newMap;
      });

      // Show success
      setUpdateSuccess(prev => new Map(prev).set(rowId, true));
      setUpdateErrors(prev => {
        const newMap = new Map(prev);
        newMap.delete(rowId);
        return newMap;
      });

      // Clear success message after 2 seconds
      setTimeout(() => {
        setUpdateSuccess(prev => {
          const newMap = new Map(prev);
          newMap.delete(rowId);
          return newMap;
        });
      }, 2000);
    } catch (err) {
      setUpdateErrors(prev => new Map(prev).set(rowId, err instanceof Error ? err.message : 'Update failed'));
      setUpdateSuccess(prev => {
        const newMap = new Map(prev);
        newMap.delete(rowId);
        return newMap;
      });
    }
  };

  // Check for duplicates
  const checkDuplicate = (rowId: string, serialNum: string | null, tagIdVal: string | null): { serial: boolean; tag: boolean } => {
    const serial = !!(serialNum && serialNum.trim() && results.find(r => r.id !== rowId && r.serial_number === serialNum.trim()));
    const tag = !!(tagIdVal && tagIdVal.trim() && results.find(r => r.id !== rowId && r.tag_id === tagIdVal.trim()));
    return { serial, tag };
  };

  // Get cascaded options for a row
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

      // Build unique search values
      const searchValues = [...new Set([normalized, rawDigits, original])];

      const { data, error: queryError } = await supabase
        .from('main_inventory')
        .select('id, site_id, sheet_source, category, equipment_type, product_name, product_number, serial_number, tag_id, tag_category, serial_pic_url, tag_pic_url, updated_at')
        .in('site_id', searchValues)
        .order('updated_at', { ascending: false });

      if (queryError) {
        throw new Error(queryError.message);
      }

      setResults(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while searching');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">
          Site Inventory Search
        </h1>

        {/* Search Section */}
        <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={siteIdInput}
              onChange={(e) => setSiteIdInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter Site ID (e.g., 2264 or W2264)"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
              disabled={loading}
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
            <p className="mt-4 text-gray-600">Loading inventory data...</p>
          </div>
        )}

        {/* Results Section */}
        {!loading && searched && (
          <>
            {results.length === 0 ? (
              /* No Results State */
              <div className="bg-white rounded-lg shadow p-8 text-center">
                <p className="text-gray-600 mb-4">No data found for this site</p>
                <button
                  className="px-6 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors cursor-not-allowed"
                  disabled
                >
                  Add first row
                </button>
              </div>
            ) : (
              <>
                {/* Category Tabs */}
                <div className="bg-white rounded-lg shadow mb-4 overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="flex border-b border-gray-200 min-w-max">
                      <button
                        onClick={() => setActiveTab('All')}
                        className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                          activeTab === 'All'
                            ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                      >
                        All ({results.length})
                      </button>
                      {categoryTabs.map(([category, count]) => (
                        <button
                          key={category}
                          onClick={() => setActiveTab(category)}
                          className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                            activeTab === category
                              ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                          }`}
                        >
                          {category} ({count})
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Results Cards */}
                <div className="mb-6">
                  <div className="bg-white rounded-lg shadow px-4 py-3 mb-4">
                    <p className="text-sm text-gray-600">
                      Showing <span className="font-semibold">{filteredResults.length}</span> row{filteredResults.length !== 1 ? 's' : ''}
                      {activeTab !== 'All' && ` in ${activeTab}`}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {filteredResults.map((row) => {
                      const rowData = getRowData(row);
                      const isDirty = rowEdits.has(row.id);
                      const duplicates = checkDuplicate(row.id, rowData.serial_number, rowData.tag_id);

                      return (
                        <div
                          key={row.id}
                          className={`bg-white rounded-lg shadow-md p-4 ${isDirty ? 'border-2 border-yellow-400' : 'border border-gray-200'}`}
                        >
                          {/* Sheet Source */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Sheet Source</label>
                            <input
                              type="text"
                              value={rowData.sheet_source || ''}
                              onChange={(e) => updateRowField(row.id, row, 'sheet_source', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                            />
                          </div>

                          {/* Category */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                            <select
                              value={rowData.category || ''}
                              onChange={(e) => updateRowField(row.id, row, 'category', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
                            >
                              <option value="">Select</option>
                              {cascadeMaps.categories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </div>

                          {/* Equipment Type */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Equipment Type</label>
                            <select
                              value={rowData.equipment_type || ''}
                              onChange={(e) => updateRowField(row.id, row, 'equipment_type', e.target.value)}
                              disabled={!rowData.category}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white disabled:bg-gray-100"
                            >
                              <option value="">Select</option>
                              {getEquipmentTypes(rowData.category).map(et => (
                                <option key={et} value={et}>{et}</option>
                              ))}
                            </select>
                          </div>

                          {/* Product Name */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Product Name</label>
                            <select
                              value={rowData.product_name || ''}
                              onChange={(e) => updateRowField(row.id, row, 'product_name', e.target.value)}
                              disabled={!rowData.equipment_type}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white disabled:bg-gray-100"
                            >
                              <option value="">Select</option>
                              {getProductNames(rowData.category, rowData.equipment_type).map(pn => (
                                <option key={pn} value={pn}>{pn}</option>
                              ))}
                            </select>
                          </div>

                          {/* Product Number */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Product Number</label>
                            <select
                              value={rowData.product_number || ''}
                              onChange={(e) => updateRowField(row.id, row, 'product_number', e.target.value)}
                              disabled={!rowData.product_name}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white disabled:bg-gray-100"
                            >
                              <option value="">Select</option>
                              {getProductNumbers(rowData.category, rowData.equipment_type, rowData.product_name).map(pnum => (
                                <option key={pnum} value={pnum}>{pnum}</option>
                              ))}
                            </select>
                          </div>

                          {/* Serial Number */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Serial Number</label>
                            <input
                              type="text"
                              value={rowData.serial_number || ''}
                              onChange={(e) => updateRowField(row.id, row, 'serial_number', e.target.value)}
                              className={`w-full px-3 py-2 border rounded text-sm ${duplicates.serial ? 'border-yellow-500' : 'border-gray-300'}`}
                            />
                            {duplicates.serial && rowData.serial_number && (
                              <span className="text-xs text-yellow-600 mt-1 block">Already exists in this site</span>
                            )}
                          </div>

                          {/* Tag ID */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Tag ID</label>
                            <input
                              type="text"
                              value={rowData.tag_id || ''}
                              onChange={(e) => updateRowField(row.id, row, 'tag_id', e.target.value)}
                              className={`w-full px-3 py-2 border rounded text-sm ${duplicates.tag ? 'border-yellow-500' : 'border-gray-300'}`}
                            />
                            {duplicates.tag && rowData.tag_id && (
                              <span className="text-xs text-yellow-600 mt-1 block">Already exists in this site</span>
                            )}
                          </div>

                          {/* Tag Category */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Tag Category</label>
                            <input
                              type="text"
                              value={rowData.tag_category || ''}
                              onChange={(e) => updateRowField(row.id, row, 'tag_category', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                            />
                          </div>

                          {/* Photo URLs */}
                          <div className="mb-3">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Serial Photo URL</label>
                            <input
                              type="text"
                              value={rowData.serial_pic_url || ''}
                              onChange={(e) => updateRowField(row.id, row, 'serial_pic_url', e.target.value)}
                              placeholder="Serial pic URL"
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm mb-2"
                            />
                            <label className="block text-xs font-medium text-gray-500 mb-1">Tag Photo URL</label>
                            <input
                              type="text"
                              value={rowData.tag_pic_url || ''}
                              onChange={(e) => updateRowField(row.id, row, 'tag_pic_url', e.target.value)}
                              placeholder="Tag pic URL"
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                            />
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2 mt-4 pt-3 border-t border-gray-200">
                            <button
                              onClick={() => handleUpdateRow(row.id, row)}
                              disabled={!isDirty}
                              className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Update
                            </button>
                            {isDirty && (
                              <button
                                onClick={() => resetRow(row.id)}
                                className="px-4 py-2 bg-gray-400 text-white text-sm font-medium rounded hover:bg-gray-500"
                              >
                                Reset
                              </button>
                            )}
                          </div>
                          {updateSuccess.get(row.id) && (
                            <div className="mt-2 text-sm text-green-600 font-medium">✓ Updated successfully!</div>
                          )}
                          {updateErrors.get(row.id) && (
                            <div className="mt-2 text-sm text-red-600">{updateErrors.get(row.id)}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Add Row Section with Cascaded Filters */}
                <div className="bg-white rounded-lg shadow p-4 sm:p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Add Row (Cascaded Filters)
                    {lockedCategory && <span className="ml-2 text-sm font-normal text-blue-600">- Category locked to: {lockedCategory}</span>}
                  </h2>
                  
                  {/* Sheet Source */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sheet Source
                    </label>
                    <input
                      type="text"
                      value={addRowSheetSource}
                      onChange={(e) => setAddRowSheetSource(e.target.value)}
                      placeholder="Enter sheet source"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    {/* Category Dropdown - locked if tab is not "All" */}
                    {!lockedCategory && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Category
                        </label>
                        <select
                          value={selectedCategory}
                          onChange={(e) => setSelectedCategory(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white"
                        >
                          <option value="">Select Category</option>
                          {cascadeMaps.categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Equipment Type Dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Equipment Type
                      </label>
                      <select
                        value={selectedEquipmentType}
                        onChange={(e) => setSelectedEquipmentType(e.target.value)}
                        disabled={!addRowCategory}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Equipment Type</option>
                        {catalogEquipmentTypes.map((et) => (
                          <option key={et} value={et}>
                            {et}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Product Name Dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product Name
                      </label>
                      <select
                        value={selectedProductName}
                        onChange={(e) => setSelectedProductName(e.target.value)}
                        disabled={!selectedEquipmentType}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Product Name</option>
                        {catalogProductNames.map((pn) => (
                          <option key={pn} value={pn}>
                            {pn}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Product Number Dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product Number
                      </label>
                      <select
                        value={selectedProductNumber}
                        onChange={(e) => setSelectedProductNumber(e.target.value)}
                        disabled={!selectedProductName}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
                      >
                        <option value="">Select Product Number</option>
                        {catalogProductNumbers.map((pnum) => (
                          <option key={pnum} value={pnum}>
                            {pnum}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    {/* Serial Number Input */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Serial Number
                      </label>
                      <input
                        type="text"
                        value={newSerialNumber}
                        onChange={(e) => setNewSerialNumber(e.target.value)}
                        placeholder="Enter serial number"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Tag ID Input */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tag ID
                      </label>
                      <input
                        type="text"
                        value={newTagId}
                        onChange={(e) => setNewTagId(e.target.value)}
                        placeholder="Enter tag ID"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Tag Category Input */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tag Category
                      </label>
                      <input
                        type="text"
                        value={newTagCategory}
                        onChange={(e) => setNewTagCategory(e.target.value)}
                        placeholder="Enter tag category"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    {/* Serial Pic URL */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Serial Picture URL
                      </label>
                      <input
                        type="text"
                        value={addRowSerialPicUrl}
                        onChange={(e) => setAddRowSerialPicUrl(e.target.value)}
                        placeholder="Enter serial picture URL"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>

                    {/* Tag Pic URL */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tag Picture URL
                      </label>
                      <input
                        type="text"
                        value={addRowTagPicUrl}
                        onChange={(e) => setAddRowTagPicUrl(e.target.value)}
                        placeholder="Enter tag picture URL"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      disabled
                      className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Save Row
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
