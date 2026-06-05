import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "admin" | "editor" | "viewer" | "executive";

/**
 * Role hierarchy (highest → lowest) — MCN-style:
 *   admin      – System Administrator: full system access, user mgmt, all modules
 *   editor     – Department Manager: create/edit/route policies, reports, training
 *   viewer     – All Staff: view policies, attestations, assessments, AI assistant
 *
 * Note: "executive" enum value maps to "viewer" (All Staff) for simplicity.
 */

export function useRole() {
  const { user, loading: authLoading } = useAuth();
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);

      if (error || !data || data.length === 0) {
        setRole("viewer"); // default
      } else {
        // Pick highest role if multiple
        const roles = data.map((r) => r.role as AppRole);
        const priority: AppRole[] = ["admin", "editor", "executive", "viewer"];
        const highest = priority.find((p) => roles.includes(p)) || "viewer";
        setRole(highest);
      }
      setLoading(false);
    })();
  }, [user, authLoading]);

  const isAtLeast = (minRole: AppRole): boolean => {
    if (!role) return false;
    const hierarchy: AppRole[] = ["admin", "editor", "executive", "viewer"];
    return hierarchy.indexOf(role) <= hierarchy.indexOf(minRole);
  };

  return { role, loading: loading || authLoading, isAtLeast };
}
