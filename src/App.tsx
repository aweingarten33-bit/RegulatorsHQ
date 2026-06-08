import React, { Suspense, useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { I18nProvider } from "@/i18n";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/hooks/useAuth";
import AppSidebar from "@/components/AppSidebar";
import { PageTransition } from "@/components/PageTransition";
import { EasterEggs } from "@/components/EasterEggs";
import Auth from "@/pages/Auth";

// Lazy-load all pages for code splitting
const DashboardRouter = React.lazy(() => import("@/components/dashboard/DashboardRouter"));
const Policies = React.lazy(() => import("@/pages/Policies"));
const PolicyDetail = React.lazy(() => import("@/pages/PolicyDetail"));
const AISearch = React.lazy(() => import("@/pages/AISearch"));
const AIGenerate = React.lazy(() => import("@/pages/AIGenerate"));
const DocumentReview = React.lazy(() => import("@/pages/DocumentReview"));
const ComplianceNewsletter = React.lazy(() => import("@/pages/ComplianceNewsletter"));
const RegulatoryIntel = React.lazy(() => import("@/pages/RegulatoryIntel"));
const Tasks = React.lazy(() => import("@/pages/Tasks"));
const Reports = React.lazy(() => import("@/pages/Reports"));
const SettingsPage = React.lazy(() => import("@/pages/SettingsPage"));
const PolicyEditor = React.lazy(() => import("@/pages/PolicyEditor"));
const Manuals = React.lazy(() => import("@/pages/Manuals"));
const CaseIQ = React.lazy(() => import("@/pages/CaseIQ"));
const InterviewCopilot = React.lazy(() => import("@/pages/InterviewCopilot"));
const AnonymousReport = React.lazy(() => import("@/pages/AnonymousReport"));
const RegChangeManager = React.lazy(() => import("@/pages/RegChangeManager"));
const PrivacyHQ = React.lazy(() => import("@/pages/PrivacyHQ"));
const AccreditationReadiness = React.lazy(() => import("@/pages/AccreditationReadiness"));
const SurveyorHQ = React.lazy(() => import("@/pages/SurveyorHQ"));
const ComplianceCalendar = React.lazy(() => import("@/pages/ComplianceCalendar"));
const BulkImport = React.lazy(() => import("@/pages/BulkImport"));
const StaffDirectory = React.lazy(() => import("@/pages/StaffDirectory"));
const DrillDashboard = React.lazy(() => import("@/pages/DrillDashboard"));
const StudioPage = React.lazy(() => import("@/pages/StudioPage"));

const AIGovernance = React.lazy(() => import("@/pages/AIGovernance"));
const CompetitiveAnalysis = React.lazy(() => import("@/pages/CompetitiveAnalysis"));
const IdeaBank = React.lazy(() => import("@/pages/IdeaBank"));
const OverviewDoc = React.lazy(() => import("@/pages/OverviewDoc"));
const NotFound = React.lazy(() => import("@/pages/NotFound"));
const ForgotPassword = React.lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = React.lazy(() => import("@/pages/ResetPassword"));
const FlybyShowcase = React.lazy(() => import("@/pages/FlybyShowcase"));

const LazyFallback = () => <div className="min-h-[200px]" />;


function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function RoleRoutes() {
  const { role, loading } = useRole();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isAdmin = role === "admin";
  const isEditorUp = role === "admin" || role === "editor";
  const isExec = role === "executive";

  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/" element={<DashboardRouter />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/policies/:id" element={<PolicyDetail />} />
        <Route path="/search" element={<AISearch />} />
        <Route path="/newsletter" element={<ComplianceNewsletter />} />
        <Route path="/report" element={<AnonymousReport />} />
        <Route path="/generate" element={<AIGenerate />} />
        <Route path="/review" element={<DocumentReview />} />
        <Route path="/manuals" element={<Manuals />} />
        <Route path="/daily-drill" element={<DrillDashboard />} />
        <Route path="/studio" element={<StudioPage />} />
        

        {isEditorUp && (
          <>
            <Route path="/policies/new" element={<PolicyEditor />} />
            <Route path="/policies/:id/edit" element={<PolicyEditor />} />
            <Route path="/tasks" element={<Tasks />} />
          </>
        )}

        {(isEditorUp || isExec) && (
          <Route path="/reports" element={<Reports />} />
        )}

        {isAdmin && (
          <>
            <Route path="/ai-governance" element={<AIGovernance />} />
            <Route path="/competitive-analysis" element={<CompetitiveAnalysis />} />
            <Route path="/idea-bank" element={<IdeaBank />} />
            <Route path="/overview-doc" element={<OverviewDoc />} />
            <Route path="/case-iq" element={<CaseIQ />} />
            <Route path="/privacy-hq" element={<PrivacyHQ />} />
            <Route path="/interview-copilot" element={<InterviewCopilot />} />
            <Route path="/investigations" element={<Navigate to="/case-iq" replace />} />
            <Route path="/reg-changes" element={<RegChangeManager />} />
            <Route path="/compliance-calendar" element={<ComplianceCalendar />} />
            <Route path="/audit-log" element={<Navigate to="/settings" replace />} />
            <Route path="/user-management" element={<Navigate to="/settings" replace />} />
            <Route path="/regulatory" element={<RegulatoryIntel />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/users" element={<SettingsPage />} />
            <Route path="/billing" element={<SettingsPage />} />
            <Route path="/bulk-import" element={<BulkImport />} />
            <Route path="/staff-directory" element={<StaffDirectory />} />
          </>
        )}

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => {
  const [queryClient] = React.useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            
            <EasterEggs />
            <Routes>
              <Route path="/flyby" element={<Suspense fallback={<LazyFallback />}><FlybyShowcase /></Suspense>} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/forgot-password" element={<Suspense fallback={<LazyFallback />}><ForgotPassword /></Suspense>} />
              <Route path="/reset-password" element={<Suspense fallback={<LazyFallback />}><ResetPassword /></Suspense>} />
              <Route path="*" element={
                <AuthGate>
                  <AppSidebar>
                    <PageTransition>
                      <RoleRoutes />
                    </PageTransition>
                  </AppSidebar>
                </AuthGate>
              } />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
};

export default App;
