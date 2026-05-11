import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface RealtimeSyncOptions {
  table: string;
  queryKey: string[];
  idColumn: string;
  selectQuery?: string;
}

export function useRealtimeSync({ table, queryKey, idColumn, selectQuery = '*' }: RealtimeSyncOptions) {
  const queryClient = useQueryClient();

  const queryKeyStr = JSON.stringify(queryKey);

  useEffect(() => {
    const channel = supabase
      .channel(`public:${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: table },
        async (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            // Fetch the single row with joined data to ensure we have all relations
            const { data, error } = await supabase
              .from(table)
              .select(selectQuery)
              .eq(idColumn, payload.new[idColumn])
              .single();

            if (!error && data) {
              queryClient.setQueriesData({ queryKey }, (old: any) => {
                if (!Array.isArray(old)) return old;
                const exists = old.some(item => item[idColumn] === data[idColumn]);
                if (payload.eventType === 'INSERT' && !exists) {
                  return [...old, data];
                } else if (payload.eventType === 'UPDATE' || exists) {
                  return old.map(item => item[idColumn] === data[idColumn] ? data : item);
                }
                return old;
              });
            }
          } else if (payload.eventType === 'DELETE') {
            queryClient.setQueriesData({ queryKey }, (old: any) => {
              if (!Array.isArray(old)) return old;
              return old.filter(item => item[idColumn] !== payload.old[idColumn]);
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, table, queryKeyStr, idColumn, selectQuery]);
}
