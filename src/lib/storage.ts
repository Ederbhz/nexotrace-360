import type { AuditEntry, Dossier } from "../types";

const DOSSIER_KEY = "nexotrace:dossiers";
const AUDIT_KEY = "nexotrace:audit";
const CONNECTOR_SETTINGS_KEY = "nexotrace:connector-settings";

export interface ConnectorSettings {
  portalTransparencyApiKey?: string;
}

function readList<T>(key: string): T[] {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadDossiers(): Dossier[] {
  return readList<Dossier>(DOSSIER_KEY);
}

export function saveDossier(dossier: Dossier): Dossier[] {
  const current = loadDossiers();
  const next = [dossier, ...current.filter((item) => item.id !== dossier.id)].slice(0, 30);
  writeList(DOSSIER_KEY, next);
  return next;
}

export function loadAudit(): AuditEntry[] {
  return readList<AuditEntry>(AUDIT_KEY);
}

export function saveAudit(entry: AuditEntry): AuditEntry[] {
  const next = [entry, ...loadAudit()].slice(0, 200);
  writeList(AUDIT_KEY, next);
  return next;
}

export function loadConnectorSettings(): ConnectorSettings {
  try {
    const value = localStorage.getItem(CONNECTOR_SETTINGS_KEY);
    return value ? (JSON.parse(value) as ConnectorSettings) : {};
  } catch {
    return {};
  }
}

export function saveConnectorSettings(settings: ConnectorSettings): ConnectorSettings {
  localStorage.setItem(CONNECTOR_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function clearWorkspace(): void {
  localStorage.removeItem(DOSSIER_KEY);
  localStorage.removeItem(AUDIT_KEY);
  localStorage.removeItem(CONNECTOR_SETTINGS_KEY);
}
