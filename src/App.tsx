import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Spinner } from './components/ui';
import { useMyEstates, useSession } from './lib/hooks';
import { requestPersistentStorage, getMeta } from './lib/db';
import { refreshMyEstates, startSync } from './lib/sync';
import { preloadDetector } from './lib/barcode';
import Home from './pages/Home';
import Inventory from './pages/Inventory';
import ItemDetail from './pages/ItemDetail';
import Capture from './pages/Capture';
import SignIn from './pages/SignIn';
import Estates from './pages/Estates';

// Less-used screens load on demand (they are still stored for offline use).
const QuickScan = lazy(() => import('./pages/QuickScan'));
const Decisions = lazy(() => import('./pages/Decisions'));
const Reports = lazy(() => import('./pages/Reports'));
const Backup = lazy(() => import('./pages/Backup'));
const Family = lazy(() => import('./pages/Family'));
const Uploads = lazy(() => import('./pages/Uploads'));
const More = lazy(() => import('./pages/More'));
const Join = lazy(() => import('./pages/Join'));
const PlaceList = lazy(() => import('./pages/Places').then((m) => ({ default: m.PlaceList })));
const PlaceDetail = lazy(() => import('./pages/Places').then((m) => ({ default: m.PlaceDetail })));

function Loading() {
  return <div className="p-8"><Spinner label="Opening" /></div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  if (loading) return <Loading />;
  // Offline with an expired token still has a stored session; the app keeps working locally.
  if (!session) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const local = useMyEstates();
  const [fresh, setFresh] = useState<{ id: string }[] | null>(null);
  useEffect(() => {
    // Right after signing in the local list is empty: ask the server first.
    if (!navigator.onLine) return setFresh([]);
    refreshMyEstates().then(setFresh).catch(() => setFresh([]));
  }, []);
  const estates = fresh && fresh.length ? fresh : local;
  if (estates === undefined || fresh === null) return <Loading />;
  if (estates.length === 1) return <Navigate to={`/e/${estates[0].id}`} replace />;
  return <Navigate to="/estates" replace />;
}

function EstateLayout() {
  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

export default function App() {
  useEffect(() => {
    startSync();
    void requestPersistentStorage();
    preloadDetector();
    void getMeta<{ large_text?: boolean } | null>('my_profile', null).then((p) => document.documentElement.classList.toggle('large-text', !!p?.large_text));
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/" element={<RequireAuth><RootRedirect /></RequireAuth>} />
          <Route path="/estates" element={<RequireAuth><Estates /></RequireAuth>} />
          <Route path="/join" element={<RequireAuth><Join /></RequireAuth>} />
          <Route path="/e/:estateId" element={<RequireAuth><EstateLayout /></RequireAuth>}>
            <Route index element={<Home />} />
            <Route path="add" element={<Capture />} />
            <Route path="scan" element={<QuickScan />} />
            <Route path="items" element={<Inventory />} />
            <Route path="items/:itemId" element={<ItemDetail />} />
            <Route path="decisions" element={<Decisions />} />
            <Route path="places" element={<PlaceList />} />
            <Route path="places/:locationId" element={<PlaceDetail />} />
            <Route path="reports" element={<Reports />} />
            <Route path="backup" element={<Backup />} />
            <Route path="family" element={<Family />} />
            <Route path="uploads" element={<Uploads />} />
            <Route path="more" element={<More />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
