import { Routes, Route } from 'react-router';

function SettingsContentWrapper() {
  return <div style={{ color: 'var(--text-secondary)', padding: 24 }}>Settings — select a tab</div>;
}

export function SettingsRoutes() {
  return (
    <Routes>
      <Route path=":tab?" element={
        <div style={{ flex: 1, display: 'flex' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <SettingsContentWrapper />
          </div>
        </div>
      } />
    </Routes>
  );
}
