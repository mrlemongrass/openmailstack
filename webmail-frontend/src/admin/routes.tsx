import { Routes, Route } from 'react-router';

function AdminDashboard() {
  return (
    <div className="glass-panel" style={{ margin: 20, padding: 24 }}>
      <h2 style={{ margin: '0 0 16px' }}>Admin Dashboard</h2>
      <p style={{ color: 'var(--text-secondary)' }}>Admin panels are being extracted from legacy code.</p>
    </div>
  );
}

export function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminDashboard />} />
      <Route path=":panel" element={<AdminDashboard />} />
    </Routes>
  );
}
