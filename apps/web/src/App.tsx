import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { InventoryPage } from './pages/InventoryPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PurchaseDetailPage } from './pages/PurchaseDetailPage';
import { PurchaseFormPage } from './pages/PurchaseFormPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { PosPage } from './pages/PosPage';
import { SaleDetailPage } from './pages/SaleDetailPage';
import { SalesPage } from './pages/SalesPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReorderPage } from './pages/ReorderPage';
import { AssistantPage } from './pages/AssistantPage';
import { PublicOnly, RequireAuth, RequireOnboarding, RequireRole } from './routes/guards';

export function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<RequireOnboarding />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/pos" element={<PosPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/sales/:id" element={<SaleDetailPage />} />
            <Route element={<RequireRole minRole="MANAGER" />}>
              <Route path="/products/new" element={<ProductFormPage />} />
              <Route path="/products/:id/edit" element={<ProductFormPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/purchases" element={<PurchasesPage />} />
              <Route path="/purchases/new" element={<PurchaseFormPage />} />
              <Route path="/purchases/:id" element={<PurchaseDetailPage />} />
              <Route path="/purchases/:id/edit" element={<PurchaseFormPage />} />
              <Route path="/returns" element={<ReturnsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reorder" element={<ReorderPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
            </Route>
            <Route element={<RequireRole minRole="OWNER" />}>
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
