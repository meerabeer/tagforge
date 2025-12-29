'use client';

import { useState, useEffect } from 'react';
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

interface CascadeMaps {
  categories: string[];
  categoryToEquipmentTypes: Map<string, string[]>;
  categoryEquipmentToProductNames: Map<string, string[]>;
  categoryEquipmentProductToNumbers: Map<string, string[]>;
}

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  row: InventoryRow | null;
  cascadeMaps: CascadeMaps;
  onUpdate: (updatedRow: InventoryRow) => void;
}

export default function EditItemModal({ isOpen, onClose, row, cascadeMaps, onUpdate }: EditItemModalProps) {
  const [editedRow, setEditedRow] = useState<InventoryRow | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when row changes
  useEffect(() => {
    if (row) {
      setEditedRow({ ...row });
      setError(null);
      setSuccess(false);
    }
  }, [row]);

  if (!isOpen || !row || !editedRow) return null;

  const updateField = (field: keyof InventoryRow, value: string | null) => {
    const updated = { ...editedRow, [field]: value };

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

    setEditedRow(updated);
  };

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

  const handleSave = async () => {
    setUpdating(true);
    setError(null);

    try {
      await updateMainInventoryRow(editedRow.id, {
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
      });

      setSuccess(true);
      onUpdate(editedRow);

      // Close modal after brief success message
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-t-2xl flex items-center justify-between">
              <h2 className="text-2xl font-bold">✏️ Edit Inventory Item</h2>
              <button
                onClick={onClose}
                className="text-white hover:text-gray-200 text-2xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Site ID (readonly) */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Site ID
                </label>
                <input
                  type="text"
                  value={editedRow.site_id || ''}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600"
                />
              </div>

              {/* Sheet Source */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Sheet Source
                </label>
                <input
                  type="text"
                  value={editedRow.sheet_source || ''}
                  onChange={(e) => updateField('sheet_source', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={editedRow.category || ''}
                  onChange={(e) => updateField('category', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">Select Category</option>
                  {cascadeMaps.categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Equipment Type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Equipment Type
                </label>
                <select
                  value={editedRow.equipment_type || ''}
                  onChange={(e) => updateField('equipment_type', e.target.value)}
                  disabled={!editedRow.category}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-100"
                >
                  <option value="">Select Equipment Type</option>
                  {getEquipmentTypes(editedRow.category).map(et => (
                    <option key={et} value={et}>{et}</option>
                  ))}
                </select>
              </div>

              {/* Product Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Product Name
                </label>
                <select
                  value={editedRow.product_name || ''}
                  onChange={(e) => updateField('product_name', e.target.value)}
                  disabled={!editedRow.equipment_type}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-100"
                >
                  <option value="">Select Product Name</option>
                  {getProductNames(editedRow.category, editedRow.equipment_type).map(pn => (
                    <option key={pn} value={pn}>{pn}</option>
                  ))}
                </select>
              </div>

              {/* Product Number */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Product Number
                </label>
                <select
                  value={editedRow.product_number || ''}
                  onChange={(e) => updateField('product_number', e.target.value)}
                  disabled={!editedRow.product_name}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white disabled:bg-gray-100"
                >
                  <option value="">Select Product Number</option>
                  {getProductNumbers(editedRow.category, editedRow.equipment_type, editedRow.product_name).map(pnum => (
                    <option key={pnum} value={pnum}>{pnum}</option>
                  ))}
                </select>
              </div>

              {/* Serial Number */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Serial Number
                </label>
                <input
                  type="text"
                  value={editedRow.serial_number || ''}
                  onChange={(e) => updateField('serial_number', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Tag ID */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Tag ID
                </label>
                <input
                  type="text"
                  value={editedRow.tag_id || ''}
                  onChange={(e) => updateField('tag_id', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Tag Category */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Tag Category
                </label>
                <input
                  type="text"
                  value={editedRow.tag_category || ''}
                  onChange={(e) => updateField('tag_category', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Photo URLs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Serial Photo URL
                  </label>
                  <input
                    type="text"
                    value={editedRow.serial_pic_url || ''}
                    onChange={(e) => updateField('serial_pic_url', e.target.value)}
                    placeholder="https://..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Tag Photo URL
                  </label>
                  <input
                    type="text"
                    value={editedRow.tag_pic_url || ''}
                    onChange={(e) => updateField('tag_pic_url', e.target.value)}
                    placeholder="https://..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Success/Error Messages */}
              {success && (
                <div className="bg-green-50 border-l-4 border-green-500 text-green-700 px-4 py-3 rounded">
                  ✓ Successfully updated!
                </div>
              )}
              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded">
                  ⚠️ {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-50 px-6 py-4 rounded-b-2xl flex items-center justify-end gap-3 border-t border-gray-200">
              <button
                onClick={onClose}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition-colors"
                disabled={updating}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={updating}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
              >
                {updating ? '💾 Saving...' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
