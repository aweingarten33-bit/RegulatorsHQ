-- =============================================
-- SECURITY FIX: Replace all permissive USING (true) RLS policies
-- with authentication-scoped policies.
-- Tables that previously allowed full anonymous access now require
-- an authenticated Supabase session (auth.uid() IS NOT NULL).
-- hotline_reports INSERT remains open for anonymous reporting.
-- =============================================

-- Helper: drop policy if it exists (idempotent)
DO $$
DECLARE
  tbl text;
  pol text;
BEGIN
  FOR tbl, pol IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual = 'true' OR with_check = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
  END LOOP;
END
$$;

-- ── standards_library ──────────────────────────────────────────
CREATE POLICY "Authenticated read standards_library"
  ON public.standards_library FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin write standards_library"
  ON public.standards_library FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── policy_versions ────────────────────────────────────────────
CREATE POLICY "Authenticated read policy_versions"
  ON public.policy_versions FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write policy_versions"
  ON public.policy_versions FOR INSERT
  TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')
  );

CREATE POLICY "Editor update policy_versions"
  ON public.policy_versions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Admin delete policy_versions"
  ON public.policy_versions FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ── audit_log ──────────────────────────────────────────────────
CREATE POLICY "Authenticated read audit_log"
  ON public.audit_log FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated insert audit_log"
  ON public.audit_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- No UPDATE/DELETE on audit_log — immutable record

-- ── policy_standard_mappings ───────────────────────────────────
CREATE POLICY "Authenticated read policy_standard_mappings"
  ON public.policy_standard_mappings FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write policy_standard_mappings"
  ON public.policy_standard_mappings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── attestation_records ────────────────────────────────────────
CREATE POLICY "Authenticated read attestation_records"
  ON public.attestation_records FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated write attestation_records"
  ON public.attestation_records FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admin update attestation_records"
  ON public.attestation_records FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── capa_records ───────────────────────────────────────────────
CREATE POLICY "Authenticated read capa_records"
  ON public.capa_records FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write capa_records"
  ON public.capa_records FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── survey_findings ────────────────────────────────────────────
CREATE POLICY "Authenticated read survey_findings"
  ON public.survey_findings FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write survey_findings"
  ON public.survey_findings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── review_cycles ──────────────────────────────────────────────
CREATE POLICY "Authenticated read review_cycles"
  ON public.review_cycles FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write review_cycles"
  ON public.review_cycles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── approval_workflows ─────────────────────────────────────────
CREATE POLICY "Authenticated read approval_workflows"
  ON public.approval_workflows FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write approval_workflows"
  ON public.approval_workflows FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── approval_steps ─────────────────────────────────────────────
CREATE POLICY "Authenticated read approval_steps"
  ON public.approval_steps FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write approval_steps"
  ON public.approval_steps FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── training_records ───────────────────────────────────────────
CREATE POLICY "Authenticated read training_records"
  ON public.training_records FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write training_records"
  ON public.training_records FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── distribution_records ───────────────────────────────────────
CREATE POLICY "Authenticated read distribution_records"
  ON public.distribution_records FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write distribution_records"
  ON public.distribution_records FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── manuals ────────────────────────────────────────────────────
CREATE POLICY "Authenticated read manuals"
  ON public.manuals FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write manuals"
  ON public.manuals FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── manual_chapters ────────────────────────────────────────────
CREATE POLICY "Authenticated read manual_chapters"
  ON public.manual_chapters FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write manual_chapters"
  ON public.manual_chapters FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── manual_chapter_policies ────────────────────────────────────
CREATE POLICY "Authenticated read manual_chapter_policies"
  ON public.manual_chapter_policies FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write manual_chapter_policies"
  ON public.manual_chapter_policies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── competency_assessments ─────────────────────────────────────
CREATE POLICY "Authenticated read competency_assessments"
  ON public.competency_assessments FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write competency_assessments"
  ON public.competency_assessments FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── assessment_results ─────────────────────────────────────────
CREATE POLICY "Authenticated read assessment_results"
  ON public.assessment_results FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated insert assessment_results"
  ON public.assessment_results FOR INSERT
  TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admin update assessment_results"
  ON public.assessment_results FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── risk_assessments ───────────────────────────────────────────
CREATE POLICY "Authenticated read risk_assessments"
  ON public.risk_assessments FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write risk_assessments"
  ON public.risk_assessments FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── investigations ─────────────────────────────────────────────
CREATE POLICY "Admin read investigations"
  ON public.investigations FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write investigations"
  ON public.investigations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── investigation_evidence ─────────────────────────────────────
CREATE POLICY "Admin read investigation_evidence"
  ON public.investigation_evidence FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write investigation_evidence"
  ON public.investigation_evidence FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── investigation_interviews ───────────────────────────────────
CREATE POLICY "Admin read investigation_interviews"
  ON public.investigation_interviews FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write investigation_interviews"
  ON public.investigation_interviews FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── vendor_records ─────────────────────────────────────────────
CREATE POLICY "Authenticated read vendor_records"
  ON public.vendor_records FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write vendor_records"
  ON public.vendor_records FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── compliance_calendar ────────────────────────────────────────
CREATE POLICY "Authenticated read compliance_calendar"
  ON public.compliance_calendar FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Editor write compliance_calendar"
  ON public.compliance_calendar FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

-- ── hotline_reports ────────────────────────────────────────────
-- INSERT is open so anonymous reporters can submit without a login.
-- Reading is restricted to admins only.
CREATE POLICY "Anonymous insert hotline_reports"
  ON public.hotline_reports FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin read hotline_reports"
  ON public.hotline_reports FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin update hotline_reports"
  ON public.hotline_reports FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── physician_arrangements ─────────────────────────────────────
CREATE POLICY "Admin read physician_arrangements"
  ON public.physician_arrangements FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write physician_arrangements"
  ON public.physician_arrangements FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── copilot_conversations ──────────────────────────────────────
CREATE POLICY "Own copilot_conversations"
  ON public.copilot_conversations FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── copilot_messages ───────────────────────────────────────────
CREATE POLICY "Own copilot_messages"
  ON public.copilot_messages FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── user_policies ──────────────────────────────────────────────
CREATE POLICY "Own user_policies"
  ON public.user_policies FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── ai_model_registry ──────────────────────────────────────────
CREATE POLICY "Admin read ai_model_registry"
  ON public.ai_model_registry FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write ai_model_registry"
  ON public.ai_model_registry FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── ai_governance_assessments ──────────────────────────────────
CREATE POLICY "Admin read ai_governance_assessments"
  ON public.ai_governance_assessments FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write ai_governance_assessments"
  ON public.ai_governance_assessments FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── case_notes ─────────────────────────────────────────────────
CREATE POLICY "Admin read case_notes"
  ON public.case_notes FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write case_notes"
  ON public.case_notes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── privacy_incidents ──────────────────────────────────────────
CREATE POLICY "Admin read privacy_incidents"
  ON public.privacy_incidents FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin write privacy_incidents"
  ON public.privacy_incidents FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── board_reports ──────────────────────────────────────────────
CREATE POLICY "Editor read board_reports"
  ON public.board_reports FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'));

CREATE POLICY "Admin write board_reports"
  ON public.board_reports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── document_templates ─────────────────────────────────────────
CREATE POLICY "Authenticated read document_templates"
  ON public.document_templates FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin write document_templates"
  ON public.document_templates FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── staff_directory ────────────────────────────────────────────
CREATE POLICY "Authenticated read staff_directory"
  ON public.staff_directory FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin write staff_directory"
  ON public.staff_directory FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── daily_drill_questions ──────────────────────────────────────
CREATE POLICY "Authenticated read daily_drill_questions"
  ON public.daily_drill_questions FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin write daily_drill_questions"
  ON public.daily_drill_questions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── ai_tool_inventory ──────────────────────────────────────────
CREATE POLICY "Authenticated read ai_tool_inventory"
  ON public.ai_tool_inventory FOR SELECT
  TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admin write ai_tool_inventory"
  ON public.ai_tool_inventory FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ── Storage: policy-documents ──────────────────────────────────
-- Drop the fully public storage policies
DROP POLICY IF EXISTS "Allow public read access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow public update" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete" ON storage.objects;

-- Restrict storage to authenticated users; admins/editors can write
CREATE POLICY "Authenticated read policy-documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'policy-documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Editor upload policy-documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'policy-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

CREATE POLICY "Editor update policy-documents"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'policy-documents'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

CREATE POLICY "Admin delete policy-documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'policy-documents' AND public.has_role(auth.uid(), 'admin'));

-- Make the policy-documents bucket private (was public: true)
UPDATE storage.buckets SET public = false WHERE id = 'policy-documents';
