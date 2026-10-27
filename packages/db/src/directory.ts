import type { Client } from "pg";

export type DirectorySourceMapping = {
  deploymentConfirmed: true;
  providerSchemaVersion: string;
  schema: string;
  table: string;
  subjectColumn: string;
  emailColumn: string;
  verifiedColumn: string;
};
const quote = (name: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Invalid SQL identifier");
  return `"${name}"`;
};
/** Deployment identity must have only the grants needed to install this projection. */
export async function installIdentityDirectory(
  client: Client,
  mapping: DirectorySourceMapping,
): Promise<void> {
  if (mapping.deploymentConfirmed !== true || !mapping.providerSchemaVersion.trim())
    throw new Error("Deployment-confirmed provider mapping required");
  const source = `${quote(mapping.schema)}.${quote(mapping.table)}`;
  const columns = [mapping.subjectColumn, mapping.emailColumn, mapping.verifiedColumn];
  if (new Set(columns).size !== 3) throw new Error("Distinct provider columns required");
  const types = (
    await client.query(
      `SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`,
      [source],
    )
  ).rows;
  for (const [index, type] of ["uuid", "text", "boolean"].entries()) {
    if (!types.some((row) => row.attname === columns[index] && row.type === type))
      throw new Error("Provider directory source type mismatch");
  }
  const subject = quote(mapping.subjectColumn),
    email = quote(mapping.emailColumn),
    verified = quote(mapping.verifiedColumn);
  const bad = await client.query(
    `SELECT EXISTS(SELECT 1 FROM ${source} WHERE ${subject} IS NULL OR ${verified} IS NULL) OR EXISTS(SELECT 1 FROM ${source} GROUP BY ${subject} HAVING count(*)>1) AS invalid`,
  );
  if (bad.rows[0].invalid) throw new Error("Provider directory cardinality/null violation");
  const unique = await client.query(
    `SELECT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] WHERE i.indrelid=$1::regclass AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND a.attname=$2) AS valid`,
    [source, mapping.subjectColumn],
  );
  if (!unique.rows[0].valid)
    throw new Error("Provider subject requires single-column unique index");
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE SCHEMA IF NOT EXISTS auth_read AUTHORIZATION app_migrator; REVOKE ALL ON SCHEMA auth_read FROM PUBLIC",
    );
    await client.query(`GRANT USAGE ON SCHEMA ${quote(mapping.schema)} TO auth_directory_owner`);
    await client.query(
      `GRANT SELECT (${subject},${email},${verified}) ON ${source} TO auth_directory_owner`,
    );
    await client.query(
      `CREATE OR REPLACE VIEW auth_read.identity_directory WITH (security_barrier=true) AS SELECT ${subject} AS auth_subject, ${email} AS email, ${verified} AS email_verified FROM ${source}`,
    );
    // PostgreSQL requires the prospective view owner to have CREATE temporarily.
    await client.query(
      "GRANT USAGE, CREATE ON SCHEMA auth_read TO auth_directory_owner; ALTER VIEW auth_read.identity_directory OWNER TO auth_directory_owner; REVOKE CREATE ON SCHEMA auth_read FROM auth_directory_owner",
    );
    await client.query(
      "REVOKE ALL ON auth_read.identity_directory FROM PUBLIC, app_runtime, app_api_runtime, app_email_runtime, app_reconciliation_runtime; REVOKE ALL ON SCHEMA auth_read FROM app_runtime, app_reconciliation_runtime; GRANT USAGE ON SCHEMA auth_read TO app_api_runtime, app_email_runtime; GRANT SELECT ON auth_read.identity_directory TO app_api_runtime, app_email_runtime",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
