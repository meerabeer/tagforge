import { supabase } from '@/lib/supabaseClient';

export type MainInventoryUpdatePatch = {
  sheet_source?: string | null;
  category?: string | null;
  equipment_type?: string | null;
  product_name?: string | null;
  product_number?: string | null;
  serial_number?: string | null;
  tag_id?: string | null;
  tag_category?: string | null;
  serial_pic_url?: string | null;
  tag_pic_url?: string | null;
};

export async function updateMainInventoryRow(id: string, patch: MainInventoryUpdatePatch): Promise<void> {
  const { error } = await supabase.from('main_inventory').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
