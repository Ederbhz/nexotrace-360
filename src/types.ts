export type DocumentType = "CNPJ" | "CPF";

export type EvidenceStatus =
  | "Confirmada"
  | "Provavel"
  | "Divergente"
  | "Nao confirmada"
  | "Indisponivel";

export type ConfidenceLevel =
  | "Alta"
  | "Media"
  | "Baixa"
  | "Indeterminada"
  | "Divergente";

export type SourceType =
  | "Oficial"
  | "Publica"
  | "Jornalistica"
  | "Contratada"
  | "Manual"
  | "Sistema";

export type UserProfile =
  | "Administrador"
  | "Analista"
  | "Gestor"
  | "Auditor"
  | "Usuario Restrito";

export interface Partner {
  name: string;
  documentMasked?: string;
  qualification?: string;
  joinedAt?: string;
  ageRange?: string;
  confidence: ConfidenceLevel;
}

export interface Cnae {
  code: string;
  description: string;
}

export interface CompanyProfile {
  cnpj: string;
  legalName: string;
  tradeName?: string;
  registrationStatus: string;
  openedAt?: string;
  statusDate?: string;
  legalNature?: string;
  size?: string;
  headOfficeType?: string;
  capitalSocial?: number;
  primaryCnae?: Cnae;
  secondaryCnaes: Cnae[];
  address: string;
  city?: string;
  state?: string;
  zipCode?: string;
  email?: string;
  phones: string[];
  partners: Partner[];
  sourceName: string;
  sourceUrl: string;
  sourceUpdatedAt?: string;
  raw: unknown;
}

export interface Evidence {
  id: string;
  title: string;
  source: string;
  sourceType: SourceType;
  url?: string;
  collectedAt: string;
  hash?: string;
  status: EvidenceStatus;
  confidence: ConfidenceLevel;
  notes?: string;
}

export type ExternalCheckStatus =
  | "Consultado"
  | "Link de verificacao"
  | "Requer chave"
  | "Bloqueado"
  | "Nao consultado";

export interface ExternalCheck {
  id: string;
  name: string;
  source: string;
  url?: string;
  status: ExternalCheckStatus;
  confidence: ConfidenceLevel;
  notes: string;
}

export interface RiskFactor {
  label: string;
  points: number;
  severity: "baixa" | "moderada" | "alta";
  evidence?: string;
}

export interface RiskAssessment {
  score: number;
  level: "Baixo" | "Moderado" | "Atencao" | "Alto" | "Critico" | "Restrito";
  factors: RiskFactor[];
  limitations: string[];
}

export interface CpfGate {
  valid: boolean;
  masked: string;
  gateStatus: "Liberado para evidencia manual" | "Bloqueado";
  requiredControls: string[];
}

export interface AuditEntry {
  id: string;
  action: string;
  timestamp: string;
  documentType: DocumentType;
  documentMasked: string;
  purpose: string;
  legalBasis: string;
  userProfile: UserProfile;
  status: "Concluida" | "Bloqueada" | "Erro";
  details: string;
}

export interface Dossier {
  id: string;
  documentType: DocumentType;
  document: string;
  documentMasked: string;
  createdAt: string;
  purpose: string;
  legalBasis: string;
  justification?: string;
  userProfile: UserProfile;
  company?: CompanyProfile;
  cpfGate?: CpfGate;
  risk: RiskAssessment;
  evidences: Evidence[];
  externalChecks: ExternalCheck[];
  auditTrail: AuditEntry[];
  analystNotes: string[];
}

export interface ManualEvidenceDraft {
  title: string;
  source: string;
  url: string;
  notes: string;
  confidence: ConfidenceLevel;
  status: EvidenceStatus;
  sourceType: SourceType;
}
