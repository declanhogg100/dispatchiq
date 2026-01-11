'use server';

import { getServerSupabase } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

export async function deleteCall(callId: string) {
  const supabase = getServerSupabase();
  
  try {
    const { error } = await supabase
      .from('calls')
      .delete()
      .eq('id', callId);

    if (error) {
      console.error('Error deleting call:', error);
      return { success: false, error: error.message };
    }

    revalidatePath('/history');
    return { success: true };
  } catch (error) {
    console.error('Unexpected error deleting call:', error);
    return { success: false, error: 'Unexpected error' };
  }
}

