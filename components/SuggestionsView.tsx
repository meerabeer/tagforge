'use client';

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/AuthProvider';
import { compressImage } from '@/lib/imageCompress';
import ImagePreviewModal from '@/components/ImagePreviewModal';

interface Suggestion {
  id: string;
  category: string;
  image_url: string | null;
  remarks: string | null;
  status: 'pending' | 'done' | 'rejected';
  created_by: string | null;
  created_by_name: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const CATEGORY_OPTIONS = [
  'Enclosure-Active',
  'Enclosure-Passive',
  'MW-Active',
  'MW-Passive',
  'RAN-Active',
  'RAN-Passive',
];

const STATUS_OPTIONS = ['all', 'pending', 'done', 'rejected'] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

export default function SuggestionsView() {
  const { user, profile } = useAuth();

  // Data state
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formCategory, setFormCategory] = useState<string>('');
  const [formRemarks, setFormRemarks] = useState('');
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Review modal state
  const [reviewingSuggestion, setReviewingSuggestion] = useState<Suggestion | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  // Image preview state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  // Load suggestions
  const loadSuggestions = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('suggestions')
        .select('*')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      setSuggestions(data || []);
    } catch (err) {
      console.error('Failed to load suggestions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  }, [statusFilter]);

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Clear form
  const clearForm = () => {
    setFormCategory('');
    setFormRemarks('');
    setFormImage(null);
    setFormImagePreview(null);
    setSubmitError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Submit suggestion
  const handleSubmit = async () => {
    if (!formCategory) {
      setSubmitError('Please select a category');
      return;
    }
    if (!formImage) {
      setSubmitError('Please upload a picture');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Create the suggestion row first (to get ID for image path)
      const { data: newSuggestion, error: insertError } = await supabase
        .from('suggestions')
        .insert({
          category: formCategory,
          remarks: formRemarks || null,
          status: 'pending',
          created_by: user?.id || null,
          created_by_name: profile?.full_name || 'Unknown',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 2. Compress and upload image
      let imageUrl: string | null = null;
      try {
        const { compressedFile } = await compressImage(formImage);

        const uploadFormData = new FormData();
        uploadFormData.append('file', compressedFile);
        uploadFormData.append('suggestionId', newSuggestion.id);

        const uploadRes = await fetch('/api/r2/upload-suggestion', {
          method: 'POST',
          body: uploadFormData,
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json();
          throw new Error(errData.error || 'Upload failed');
        }

        const uploadData = await uploadRes.json();
        imageUrl = uploadData.publicUrl;
      } catch (uploadErr) {
        console.error('Image upload failed:', uploadErr);
        // Continue without image - we can still save the suggestion
      }

      // 3. Update suggestion with image URL
      if (imageUrl) {
        await supabase
          .from('suggestions')
          .update({ image_url: imageUrl })
          .eq('id', newSuggestion.id);
      }

      // 4. Refresh list and close form
      await loadSuggestions();
      clearForm();
      setShowAddForm(false);
    } catch (err) {
      console.error('Submit error:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit suggestion');
    } finally {
      setSubmitting(false);
    }
  };

  // Review actions
  const handleReview = async (status: 'done' | 'rejected') => {
    if (!reviewingSuggestion) return;

    setReviewSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from('suggestions')
        .update({
          status,
          reviewed_by: user?.id || null,
          reviewed_by_name: profile?.full_name || 'Unknown',
          review_notes: reviewNotes || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', reviewingSuggestion.id);

      if (updateError) throw updateError;

      await loadSuggestions();
      setReviewingSuggestion(null);
      setReviewNotes('');
    } catch (err) {
      console.error('Review error:', err);
      alert(err instanceof Error ? err.message : 'Failed to update suggestion');
    } finally {
      setReviewSubmitting(false);
    }
  };

  // Delete suggestion
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this suggestion?')) return;

    try {
      const { error: deleteError } = await supabase
        .from('suggestions')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      await loadSuggestions();
    } catch (err) {
      console.error('Delete error:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete suggestion');
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Status badge
  const StatusBadge = ({ status }: { status: string }) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      done: 'bg-green-100 text-green-800 border-green-300',
      rejected: 'bg-red-100 text-red-800 border-red-300',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[status as keyof typeof colors] || 'bg-gray-100'}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Suggestions</h2>
          <p className="text-sm text-slate-500">Submit hardware suggestions that are missing from the catalog</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="h-9 px-3 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="done">Done</option>
            <option value="rejected">Rejected</option>
          </select>

          {/* Add Button */}
          <button
            onClick={() => setShowAddForm(true)}
            className="h-9 px-4 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
          >
            + Add Suggestion
          </button>
        </div>
      </div>

      {/* Add Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Add Suggestion</h3>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full h-10 px-3 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Category</option>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Product Picture <span className="text-red-500">*</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {formImagePreview && (
                  <div className="mt-2">
                    <img
                      src={formImagePreview}
                      alt="Preview"
                      className="h-32 w-auto rounded border border-slate-200 object-cover"
                    />
                  </div>
                )}
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Remarks
                </label>
                <textarea
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  placeholder="Describe the hardware, why it should be added..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {submitError && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                  {submitError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  clearForm();
                  setShowAddForm(false);
                }}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewingSuggestion && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Review Suggestion</h3>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Suggestion Details */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-600">Category:</span>
                  <span className="text-sm text-slate-800">{reviewingSuggestion.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-600">Submitted by:</span>
                  <span className="text-sm text-slate-800">{reviewingSuggestion.created_by_name}</span>
                </div>
                {reviewingSuggestion.remarks && (
                  <div>
                    <span className="text-sm font-medium text-slate-600">Remarks:</span>
                    <p className="text-sm text-slate-800 mt-1">{reviewingSuggestion.remarks}</p>
                  </div>
                )}
                {reviewingSuggestion.image_url && (
                  <div>
                    <span className="text-sm font-medium text-slate-600">Image:</span>
                    <img
                      src={reviewingSuggestion.image_url}
                      alt="Suggestion"
                      className="mt-2 max-h-48 rounded border border-slate-200 cursor-pointer hover:opacity-90"
                      onClick={() => {
                        setPreviewUrl(reviewingSuggestion.image_url);
                        setPreviewTitle('Suggestion Image');
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Review Notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Review Notes (optional)
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Add notes about this review..."
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
              <button
                onClick={() => {
                  setReviewingSuggestion(null);
                  setReviewNotes('');
                }}
                disabled={reviewSubmitting}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReview('rejected')}
                  disabled={reviewSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleReview('done')}
                  disabled={reviewSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50"
                >
                  Mark Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12 text-slate-500">Loading suggestions...</div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-12 text-red-600">{error}</div>
      )}

      {/* Empty State */}
      {!loading && !error && suggestions.length === 0 && (
        <div className="text-center py-12">
          <div className="text-slate-400 text-4xl mb-2">📋</div>
          <p className="text-slate-500">No suggestions found</p>
          <p className="text-sm text-slate-400 mt-1">
            {statusFilter !== 'all' ? `No ${statusFilter} suggestions` : 'Be the first to add one!'}
          </p>
        </div>
      )}

      {/* Suggestions Grid */}
      {!loading && !error && suggestions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Image */}
              {suggestion.image_url ? (
                <div
                  className="h-48 bg-slate-100 cursor-pointer"
                  onClick={() => {
                    setPreviewUrl(suggestion.image_url);
                    setPreviewTitle(`${suggestion.category} - ${suggestion.created_by_name}`);
                  }}
                >
                  <img
                    src={suggestion.image_url}
                    alt={suggestion.category}
                    className="w-full h-full object-cover hover:opacity-90 transition-opacity"
                  />
                </div>
              ) : (
                <div className="h-48 bg-slate-100 flex items-center justify-center">
                  <span className="text-slate-400 text-4xl">📷</span>
                </div>
              )}

              {/* Content */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-800">{suggestion.category}</span>
                  <StatusBadge status={suggestion.status} />
                </div>

                <div className="text-xs text-slate-500 mb-2">
                  <span className="font-medium">By:</span> {suggestion.created_by_name || 'Unknown'}
                </div>

                {suggestion.remarks && (
                  <p className="text-sm text-slate-600 mb-3 line-clamp-2">{suggestion.remarks}</p>
                )}

                <div className="text-xs text-slate-400 mb-3">
                  {formatDate(suggestion.created_at)}
                </div>

                {/* Review info if reviewed */}
                {suggestion.status !== 'pending' && suggestion.reviewed_by_name && (
                  <div className="text-xs text-slate-500 bg-slate-50 rounded p-2 mb-3">
                    <span className="font-medium">Reviewed by:</span> {suggestion.reviewed_by_name}
                    {suggestion.review_notes && (
                      <p className="mt-1 text-slate-600">{suggestion.review_notes}</p>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  {suggestion.status === 'pending' && (
                    <>
                      <button
                        onClick={() => setReviewingSuggestion(suggestion)}
                        className="flex-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                      >
                        Review
                      </button>
                      {suggestion.created_by === user?.id && (
                        <button
                          onClick={() => handleDelete(suggestion.id)}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image Preview Modal */}
      <ImagePreviewModal
        isOpen={!!previewUrl}
        imageUrl={previewUrl || ''}
        title={previewTitle}
        onClose={() => {
          setPreviewUrl(null);
          setPreviewTitle('');
        }}
      />
    </div>
  );
}
