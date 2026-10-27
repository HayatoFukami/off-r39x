import catalog from "./schema-contract.json" with { type: "json" };

// Release-required PG17 catalog, reviewed against 0001_foundation.sql and the
// migration journal DDL. Never derive the expectation from the live database.
export const requiredCatalog = catalog;
export const catalogQuery = `SELECT jsonb_build_object(
  'schemas', (SELECT jsonb_agg(jsonb_build_array(nspname, pg_get_userbyid(nspowner)) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('app','auth_read')),
  'tables', (SELECT jsonb_agg(jsonb_build_array(c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relrowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind IN ('r','p')),
  'columns', (SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='app' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app'),
  'indexes', (SELECT jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive) ORDER BY c.relname,x.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app'),
  'sequences', (SELECT jsonb_agg(jsonb_build_array(c.relname,format_type(s.seqtypid,NULL),pg_get_userbyid(c.relowner)) ORDER BY c.relname) FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app')
) AS catalog`;
