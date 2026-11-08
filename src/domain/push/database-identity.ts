// Identidade do banco a partir da URL, sem credenciais. Não abre conexão.

export type DatabaseIdentity = {
  host: string;
  database: string;
};

export function readDatabaseIdentity(connectionString: string): DatabaseIdentity | null {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return null;
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, "").split("/")[0] ?? "");
  if (!url.hostname || !database) return null;
  return { host: url.hostname, database };
}

export function sameDatabaseIdentity(actual: DatabaseIdentity, expected: DatabaseIdentity): boolean {
  return actual.host === expected.host && actual.database === expected.database;
}
