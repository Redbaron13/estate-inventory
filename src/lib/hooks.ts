import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { EstateData, Member } from '../../supabase/functions/_shared/domain.ts';
import { db, getMeta, loadEstateData, type MyEstate } from './db';
import { recordDiagnostic } from './diagnostics';
import { supabase } from './supabase';
import { getSyncState, subscribeSync } from './sync';

export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        setSession(null);
        void recordDiagnostic('error', 'api', 'SESSION_READ_FAILED', 'The saved sign-in could not be checked. Sign in again.');
      } else {
        setSession(data.session);
      }
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      setSession(null);
      setLoading(false);
      void recordDiagnostic('error', 'api', 'SESSION_READ_FAILED', 'The saved sign-in could not be checked. Sign in again.');
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!alive) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return { session, loading };
}

export function useSyncState() {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

export function useMyEstates(): MyEstate[] | undefined {
  return useLiveQuery(() => db.myEstates.toArray(), []);
}

export function useEstateId(): string {
  return useParams().estateId ?? '';
}

/** The whole local copy of an estate, kept up to date as data changes. */
export function useEstateData(estateId: string): EstateData | undefined {
  return useLiveQuery(() => (estateId ? loadEstateData(estateId) : undefined), [estateId]);
}

export function useMe(): string | null {
  const { session } = useSession();
  return session?.user.id ?? null;
}

export function useMyMembership(data: EstateData | undefined, me: string | null): Member | null {
  return useMemo(() => data?.members.find((m) => m.user_id === me && m.is_active) ?? null, [data, me]);
}

export function usePending(entityId: string | null | undefined) {
  return useLiveQuery(() => (entityId ? db.outbox.where('entity_id').equals(entityId).toArray() : []), [entityId]) ?? [];
}

export function useMeta<T>(key: string, fallback: T): T {
  return useLiveQuery(() => getMeta<T>(key, fallback), [key]) ?? fallback;
}

/** Object URL for a stored photo (thumbnail or full), fetched and cached if needed. */
export function useBlobUrl(sha256: string | null | undefined, fetcher?: () => Promise<Blob | null>): string | null {
  const stored = useLiveQuery(() => (sha256 ? db.blobs.get(sha256) : undefined), [sha256]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!stored) {
      setUrl(null);
      if (sha256 && fetcher && stored === undefined && navigator.onLine) {
        fetcher().catch(() => null);
      }
      return;
    }
    const u = URL.createObjectURL(stored.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, sha256]);
  return url;
}

export function useOnline(): boolean {
  return useSyncState().online;
}
