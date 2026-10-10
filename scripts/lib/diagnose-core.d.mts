export interface ExpectedObject {
  mig: string;
  file: string;
  kind: string;
  sch: string;
  name: string;
  tbl: string;
}
export interface CheckedRow {
  mig: string;
  kind: string;
  sch: string;
  name: string;
  tbl: string;
  present: boolean;
}
export interface Verdict {
  mig: string;
  total: number;
  present: number;
  missing: string[];
  status: string;
}
export function expectedObjects(migrationsDir: string): ExpectedObject[];
export function diagnosticSql(objs: ExpectedObject[]): string;
export function summarySql(objs: ExpectedObject[]): string;
export function functionCompareSql(expectedLines: string[]): string;
export function verdicts(rows: CheckedRow[], allMigrations: string[]): Verdict[];
export function lastDefiningMigration(objs: ExpectedObject[]): Map<string, string>;
export const functionHashSql: string;
