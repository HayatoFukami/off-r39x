import type { Pool } from "pg";

export type PrincipalRecord = {
  profile: {
    id: string;
    publicRef: string;
    authSubject: string;
    displayName: string | null;
  } | null;
  roles: ("STAFF" | "ADMINISTRATOR")[];
  directory: { authSubject: string; email: string | null; emailVerified: boolean } | null;
};
export function createPrincipalRepository(pool: Pool) {
  return {
    async findByAuthSubject(subject: string): Promise<PrincipalRecord> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject))
        throw new Error("Verified UUID subject required");
      // One statement/snapshot, no implicit writes or email cache.
      const r = await pool.query(
        `SELECT p.id::text, p.public_ref, p.auth_subject, p.display_name,
        d.auth_subject AS directory_subject, d.email, d.email_verified,
        ARRAY(SELECT r.role FROM app.role_assignments r WHERE r.profile_id = p.id AND r.state = 'ACTIVE' ORDER BY r.role) AS roles
        FROM (SELECT $1::uuid AS subject) s LEFT JOIN app.business_profiles p ON p.auth_subject=s.subject
        LEFT JOIN auth_read.identity_directory d ON d.auth_subject=s.subject`,
        [subject],
      );
      if (r.rows.length !== 1) throw new Error("Identity directory cardinality violation");
      const row = r.rows[0];
      return {
        profile: row.id
          ? {
              id: row.id,
              publicRef: row.public_ref,
              authSubject: row.auth_subject,
              displayName: row.display_name,
            }
          : null,
        roles: row.roles,
        directory: row.directory_subject
          ? {
              authSubject: row.directory_subject,
              email: row.email,
              emailVerified: row.email_verified,
            }
          : null,
      };
    },
  };
}
