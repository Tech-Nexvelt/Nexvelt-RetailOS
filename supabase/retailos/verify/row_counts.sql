-- READ-ONLY. Exact row counts for every base table in the application schemas, to compare a backup against the
-- live database. Run it at the moment of the backup (counts change) and keep the output next to the dump.
-- Output: one row per table: tbl, rows.   Expected today: 39 tables; RetailOS tables 0 rows.
select format('%I.%I', t.table_schema, t.table_name) as tbl,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', t.table_schema, t.table_name), false, true, '')))[1]::text::bigint as rows
from information_schema.tables t
where t.table_schema in ('public', 'cms', 'auth_custom', 'retailos') and t.table_type = 'BASE TABLE'
order by 1;
