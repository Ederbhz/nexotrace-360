import {
  Activity,
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink as ExternalLinkIcon,
  FileJson,
  FileText,
  Fingerprint,
  Gauge,
  Gavel,
  History,
  KeyRound,
  Link2,
  Lock,
  Network,
  Newspaper,
  Plus,
  Printer,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { buildExternalChecks, cnpjApiUrl, fetchCompanyByCnpj } from "./lib/api";
import { sha256 } from "./lib/hash";
import { fetchContractIntelligence } from "./lib/publicContracts";
import { calculateCompanyRisk, restrictedCpfRisk } from "./lib/risk";
import {
  clearWorkspace,
  loadAudit,
  loadConnectorSettings,
  loadDossiers,
  saveAudit,
  saveConnectorSettings,
  saveDossier,
} from "./lib/storage";
import {
  formatCnpj,
  formatCpf,
  identifyDocumentType,
  maskDocument,
  onlyDigits,
  uid,
  validateCnpj,
  validateCpf,
} from "./lib/validators";
import type {
  AuditEntry,
  ConfidenceLevel,
  Dossier,
  DocumentType,
  Evidence,
  EvidenceStatus,
  ExternalCheck,
  ManualEvidenceDraft,
  SourceType,
  UserProfile,
} from "./types";

type TabId = "overview" | "cadastro" | "socios" | "contratos" | "fontes" | "evidencias" | "auditoria";

const logoUrl = `${import.meta.env.BASE_URL}assets/nexotrace-logo.png`;
const boardUrl = `${import.meta.env.BASE_URL}assets/nexotrace-board.png`;

const PURPOSES = [
  "Due diligence de fornecedor",
  "Homologacao cadastral",
  "Compliance e auditoria",
  "Analise antifraude",
  "Investigacao OSINT autorizada",
  "Apoio pericial/documental",
];

const LEGAL_BASES = [
  "Interesse legitimo documentado",
  "Execucao de contrato",
  "Obrigacao legal ou regulatoria",
  "Exercicio regular de direitos",
  "Consentimento do titular",
  "Ordem judicial ou demanda institucional",
];

const PROFILES: UserProfile[] = ["Administrador", "Analista", "Gestor", "Auditor", "Usuario Restrito"];
const CONFIDENCES: ConfidenceLevel[] = ["Alta", "Media", "Baixa", "Indeterminada", "Divergente"];
const STATUSES: EvidenceStatus[] = ["Confirmada", "Provavel", "Divergente", "Nao confirmada", "Indisponivel"];
const SOURCE_TYPES: SourceType[] = ["Oficial", "Publica", "Jornalistica", "Contratada", "Manual", "Sistema"];

const emptyManualEvidence: ManualEvidenceDraft = {
  title: "",
  source: "",
  url: "",
  notes: "",
  confidence: "Media",
  status: "Provavel",
  sourceType: "Manual",
};

function nowIso(): string {
  return new Date().toISOString();
}

function formatDate(value?: string): string {
  if (!value) return "Nao informado";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(parsed);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(parsed);
}

function formatCurrency(value?: number): string {
  if (typeof value !== "number") return "Nao informado";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCompactCurrency(value?: number): string {
  if (typeof value !== "number") return "R$ 0";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function compactDisplay(parts: Array<string | undefined>): string {
  const value = parts.map((part) => part?.trim()).filter(Boolean).join(" / ");
  return value || "Nao informado";
}

function getProxyBaseUrl(): string | undefined {
  const configured = import.meta.env.VITE_NEXOTRACE_API_BASE_URL as string | undefined;
  if (configured) return configured;
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") return window.location.origin;
  if (window.location.hostname.endsWith(".onrender.com")) return window.location.origin;
  return undefined;
}

function downloadText(filename: string, content: string, type = "application/json"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function makeAudit(
  action: string,
  type: DocumentType,
  documentValue: string,
  purpose: string,
  legalBasis: string,
  userProfile: UserProfile,
  status: AuditEntry["status"],
  details: string,
): AuditEntry {
  return {
    id: uid("audit"),
    action,
    timestamp: nowIso(),
    documentType: type,
    documentMasked: maskDocument(documentValue, type),
    purpose,
    legalBasis,
    userProfile,
    status,
    details,
  };
}

function appendAuditToDossier(dossier: Dossier, entry: AuditEntry): Dossier {
  return {
    ...dossier,
    auditTrail: [entry, ...dossier.auditTrail],
  };
}

function checkStatusClass(status: string): string {
  if (status === "Consultado" || status === "Confirmada") return "is-ok";
  if (status === "Requer chave" || status === "Link de verificacao" || status === "Provavel") return "is-watch";
  if (status === "Bloqueado" || status === "Divergente") return "is-danger";
  return "is-muted";
}

function riskClass(level: string): string {
  if (level === "Baixo") return "risk-low";
  if (level === "Moderado" || level === "Atencao") return "risk-mid";
  if (level === "Alto" || level === "Critico") return "risk-high";
  return "risk-restricted";
}

function safeFilename(dossier: Dossier, ext: string): string {
  return `nexotrace-${dossier.documentType.toLowerCase()}-${onlyDigits(dossier.document).slice(0, 14)}.${ext}`;
}

function sourceIcon(source: string) {
  if (source.toLowerCase().includes("pncp")) return <Briefcase size={18} />;
  if (source.toLowerCase().includes("compras")) return <Briefcase size={18} />;
  if (source.toLowerCase().includes("transparencia")) return <Scale size={18} />;
  if (source.toLowerCase().includes("cnj")) return <Gavel size={18} />;
  if (source.toLowerCase().includes("news")) return <Newspaper size={18} />;
  if (source.toLowerCase().includes("receita")) return <Building2 size={18} />;
  return <Database size={18} />;
}

export default function App() {
  const initialDossiers = useMemo(() => loadDossiers(), []);
  const [dossiers, setDossiers] = useState<Dossier[]>(initialDossiers);
  const [activeDossier, setActiveDossier] = useState<Dossier | null>(initialDossiers[0] || null);
  const [audit, setAudit] = useState<AuditEntry[]>(() => loadAudit());
  const [connectorSettings, setConnectorSettings] = useState(() => loadConnectorSettings());
  const [documentInput, setDocumentInput] = useState("");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [legalBasis, setLegalBasis] = useState(LEGAL_BASES[0]);
  const [userProfile, setUserProfile] = useState<UserProfile>("Analista");
  const [justification, setJustification] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [manualEvidence, setManualEvidence] = useState<ManualEvidenceDraft>(emptyManualEvidence);
  const [tab, setTab] = useState<TabId>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const detectedType = identifyDocumentType(documentInput);
  const canExport =
    activeDossier?.documentType === "CNPJ" ||
    (activeDossier?.documentType === "CPF" &&
      ["Administrador", "Gestor", "Auditor"].includes(activeDossier.userProfile));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const type = identifyDocumentType(documentInput);
    const digits = onlyDigits(documentInput);
    if (!type) {
      setError("Informe um CPF ou CNPJ valido para iniciar a consulta.");
      return;
    }

    if (!purpose || !legalBasis) {
      setError("Finalidade e base legal sao obrigatorias para gerar trilha de auditoria.");
      return;
    }

    if (type === "CNPJ" && !validateCnpj(digits)) {
      setError("CNPJ invalido. Revise o numero informado.");
      return;
    }

    if (type === "CPF" && !validateCpf(digits)) {
      setError("CPF invalido. Revise o numero informado.");
      return;
    }

    setLoading(true);

    try {
      if (type === "CNPJ") {
        const company = await fetchCompanyByCnpj(digits);
        const contracts = await fetchContractIntelligence(digits, {
          portalApiKey: connectorSettings.portalTransparencyApiKey,
          proxyBaseUrl: getProxyBaseUrl(),
        });
        const collectedAt = nowIso();
        const evidenceHash = await sha256(JSON.stringify(company.raw));
        const evidence: Evidence = {
          id: uid("evidence"),
          title: "Dados cadastrais CNPJ",
          source: `${company.sourceName} com dados publicos derivados da Receita Federal`,
          sourceType: "Publica",
          url: company.sourceUrl || cnpjApiUrl(digits),
          collectedAt,
          hash: evidenceHash,
          status: "Confirmada",
          confidence: "Media",
          notes: "Fonte publica agregada. Confirme em fonte oficial quando a decisao exigir prova primaria.",
        };
        const collectedEvidence: Evidence[] = [evidence];

        if (contracts.supplierRegistry?.status === "Consultado") {
          collectedEvidence.push({
            id: uid("evidence"),
            title: "Cadastro de fornecedor Compras.gov.br",
            source: "Compras.gov.br Dados Abertos",
            sourceType: "Oficial",
            url: contracts.supplierRegistry.sourceUrl,
            collectedAt: contracts.supplierRegistry.collectedAt,
            hash: await sha256(JSON.stringify(contracts.supplierRegistry.raw || contracts.supplierRegistry)),
            status: "Confirmada",
            confidence: "Alta",
            notes: contracts.supplierRegistry.enabledToBid === false ? "Fornecedor retornou sem habilitacao para licitar." : "Fornecedor localizado em base oficial de compras publicas.",
          });
        }

        if (contracts.status === "Consultado") {
          collectedEvidence.push({
            id: uid("evidence"),
            title: "Contratos publicos por fornecedor",
            source: contracts.source,
            sourceType: "Oficial",
            url: contracts.portalTransparencyUrl,
            collectedAt: contracts.collectedAt,
            hash: await sha256(JSON.stringify(contracts.contracts.map((contract) => contract.raw || contract))),
            status: contracts.totalContracts > 0 ? "Confirmada" : "Nao confirmada",
            confidence: "Alta",
            notes: `${contracts.totalContracts} contrato(s) coletado(s), valor final somado ${formatCurrency(contracts.totalFinalValue)}.`,
          });
        }

        const externalChecks = buildExternalChecks(company, contracts);
        const auditEntry = makeAudit(
          "CONSULTA_CNPJ",
          "CNPJ",
          digits,
          purpose,
          legalBasis,
          userProfile,
          "Concluida",
          `Consulta cadastral concluida. Contratos: ${contracts.status}.`,
        );
        const dossier: Dossier = {
          id: uid("case"),
          documentType: "CNPJ",
          document: digits,
          documentMasked: formatCnpj(digits),
          createdAt: collectedAt,
          purpose,
          legalBasis,
          justification,
          userProfile,
          company,
          contracts,
          risk: calculateCompanyRisk(company),
          evidences: collectedEvidence,
          externalChecks,
          auditTrail: [auditEntry],
          analystNotes: [],
        };

        setActiveDossier(dossier);
        setDossiers(saveDossier(dossier));
        setAudit(saveAudit(auditEntry));
        setTab("overview");
      } else {
        if (userProfile === "Usuario Restrito") {
          const blocked = makeAudit(
            "CONSULTA_CPF_BLOQUEADA",
            "CPF",
            digits,
            purpose,
            legalBasis,
            userProfile,
            "Bloqueada",
            "Perfil sem permissao para CPF.",
          );
          setAudit(saveAudit(blocked));
          setError("CPF bloqueado para Usuario Restrito. Selecione um perfil autorizado e registre justificativa.");
          return;
        }

        if (justification.trim().length < 20) {
          setError("Para CPF, registre uma justificativa objetiva com pelo menos 20 caracteres.");
          return;
        }

        if (legalBasis === "Consentimento do titular" && !consentChecked) {
          setError("Marque o consentimento para prosseguir com CPF nessa base legal.");
          return;
        }

        const collectedAt = nowIso();
        const validationHash = await sha256(JSON.stringify({ document: maskDocument(digits, "CPF"), collectedAt, purpose }));
        const evidence: Evidence = {
          id: uid("evidence"),
          title: "Validacao matematica de CPF",
          source: "NexoTrace 360",
          sourceType: "Sistema",
          collectedAt,
          hash: validationHash,
          status: "Confirmada",
          confidence: "Alta",
          notes: "Validacao local do digito verificador. Nenhuma fonte externa de dados pessoais foi consultada.",
        };
        const externalChecks: ExternalCheck[] = [
          {
            id: "cpf-open-search",
            name: "Busca externa indiscriminada de CPF",
            source: "Sistema",
            status: "Bloqueado",
            confidence: "Alta",
            notes: "Bloqueio preventivo para evitar exposicao, vigilancia pessoal ou uso de bases sem origem legal.",
          },
          {
            id: "cpf-manual-evidence",
            name: "Evidencia autorizada",
            source: "Usuario responsavel",
            status: "Nao consultado",
            confidence: "Indeterminada",
            notes: "Inclua manualmente apenas documentos ou fontes com autorizacao, contrato, ordem legal ou consentimento.",
          },
        ];
        const auditEntry = makeAudit(
          "VALIDACAO_CPF_RESTRITA",
          "CPF",
          digits,
          purpose,
          legalBasis,
          userProfile,
          "Concluida",
          "CPF validado sem consulta externa e com modo restrito habilitado.",
        );
        const dossier: Dossier = {
          id: uid("case"),
          documentType: "CPF",
          document: digits,
          documentMasked: formatCpf(digits),
          createdAt: collectedAt,
          purpose,
          legalBasis,
          justification,
          userProfile,
          cpfGate: {
            valid: true,
            masked: maskDocument(digits, "CPF"),
            gateStatus: "Liberado para evidencia manual",
            requiredControls: [
              "Finalidade documentada",
              "Base legal registrada",
              "Justificativa registrada",
              "Auditoria ativa",
              "Mascaramento aplicado",
            ],
          },
          risk: restrictedCpfRisk(),
          evidences: [evidence],
          externalChecks,
          auditTrail: [auditEntry],
          analystNotes: [],
        };

        setActiveDossier(dossier);
        setDossiers(saveDossier(dossier));
        setAudit(saveAudit(auditEntry));
        setTab("overview");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Erro inesperado na consulta.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeDossier) return;
    if (!manualEvidence.title.trim() || !manualEvidence.source.trim()) {
      setError("Titulo e fonte da evidencia manual sao obrigatorios.");
      return;
    }

    const collectedAt = nowIso();
    const evidence: Evidence = {
      id: uid("evidence"),
      title: manualEvidence.title.trim(),
      source: manualEvidence.source.trim(),
      sourceType: manualEvidence.sourceType,
      url: manualEvidence.url.trim() || undefined,
      collectedAt,
      hash: await sha256(JSON.stringify({ ...manualEvidence, collectedAt })),
      status: manualEvidence.status,
      confidence: manualEvidence.confidence,
      notes: manualEvidence.notes.trim() || undefined,
    };
    const auditEntry = makeAudit(
      "EVIDENCIA_MANUAL",
      activeDossier.documentType,
      activeDossier.document,
      activeDossier.purpose,
      activeDossier.legalBasis,
      activeDossier.userProfile,
      "Concluida",
      `Evidencia adicionada: ${evidence.title}`,
    );
    const updated = appendAuditToDossier(
      {
        ...activeDossier,
        evidences: [evidence, ...activeDossier.evidences],
      },
      auditEntry,
    );

    setActiveDossier(updated);
    setDossiers(saveDossier(updated));
    setAudit(saveAudit(auditEntry));
    setManualEvidence(emptyManualEvidence);
    setError("");
  }

  function logExport(kind: "JSON" | "PDF") {
    if (!activeDossier) return null;
    const auditEntry = makeAudit(
      `EXPORTACAO_${kind}`,
      activeDossier.documentType,
      activeDossier.document,
      activeDossier.purpose,
      activeDossier.legalBasis,
      activeDossier.userProfile,
      "Concluida",
      `Exportacao ${kind} solicitada.`,
    );
    const updated = appendAuditToDossier(activeDossier, auditEntry);
    setActiveDossier(updated);
    setDossiers(saveDossier(updated));
    setAudit(saveAudit(auditEntry));
    return updated;
  }

  function handleExportJson() {
    if (!activeDossier || !canExport) return;
    const updated = logExport("JSON") || activeDossier;
    downloadText(safeFilename(updated, "json"), JSON.stringify(updated, null, 2));
  }

  function handlePrint() {
    if (!activeDossier || !canExport) return;
    logExport("PDF");
    window.setTimeout(() => window.print(), 80);
  }

  function handleConfigureConnectors() {
    const current = connectorSettings.portalTransparencyApiKey || "";
    const next = window.prompt("Chave API de Dados CGU para contratos por fornecedor:", current);
    if (next === null) return;
    const saved = saveConnectorSettings({
      ...connectorSettings,
      portalTransparencyApiKey: next.trim() || undefined,
    });
    setConnectorSettings(saved);
  }

  function handleClearWorkspace() {
    if (!window.confirm("Apagar dossies e auditoria local deste navegador?")) return;
    clearWorkspace();
    setDossiers([]);
    setAudit([]);
    setConnectorSettings({});
    setActiveDossier(null);
    setTab("overview");
  }

  return (
    <div className="app-shell">
      <aside className="side-rail no-print">
        <div className="brand-card">
          <img src={logoUrl} alt="NexoTrace 360" className="brand-art" />
          <div className="brand-lockup">
            <span>NexoTrace 360</span>
            <strong>Inteligencia investigativa com evidencia rastreavel.</strong>
          </div>
        </div>

        <div className="rail-panel">
          <div className="panel-title">
            <ShieldCheck size={18} />
            <span>Controles ativos</span>
          </div>
          <ul className="control-list">
            <li>
              <CheckCircle2 size={16} />
              Auditoria local por consulta
            </li>
            <li>
              <CheckCircle2 size={16} />
              CPF sem busca invasiva
            </li>
            <li>
              <CheckCircle2 size={16} />
              Evidencia com hash SHA-256
            </li>
          </ul>
        </div>

        <div className="rail-panel recent-panel">
          <div className="panel-title">
            <History size={18} />
            <span>Historico recente</span>
          </div>
          {dossiers.length === 0 ? (
            <p className="muted">Nenhuma consulta neste navegador.</p>
          ) : (
            <div className="recent-list">
              {dossiers.slice(0, 6).map((item) => (
                <button
                  className={item.id === activeDossier?.id ? "recent-item is-active" : "recent-item"}
                  key={item.id}
                  onClick={() => setActiveDossier(item)}
                  type="button"
                >
                  <span>{item.documentType}</span>
                  <strong>{item.company?.legalName || item.documentMasked}</strong>
                  <small>{formatDateTime(item.createdAt)}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="ghost-button danger-button" type="button" onClick={handleClearWorkspace}>
          <Trash2 size={16} />
          Limpar dados locais
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar no-print">
          <div>
            <span className="eyebrow">Bancada de investigacao</span>
            <h1>NexoTrace 360</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" title="Exportar JSON" disabled={!activeDossier || !canExport} onClick={handleExportJson}>
              <FileJson size={18} />
            </button>
            <button className="icon-button" title="Gerar PDF" disabled={!activeDossier || !canExport} onClick={handlePrint}>
              <Printer size={18} />
            </button>
            <button className="icon-button" title="Configurar conectores" onClick={handleConfigureConnectors}>
              <Settings size={18} />
            </button>
            <span className="status-pill">
              <Lock size={14} />
              Uso auditavel
            </span>
          </div>
        </header>

        <section className="input-console no-print">
          <form onSubmit={handleSubmit} className="query-form">
            <label className="field document-field">
              <span>CPF ou CNPJ</span>
              <div className="input-with-icon">
                <Search size={18} />
                <input
                  value={documentInput}
                  onChange={(event) => setDocumentInput(event.target.value)}
                  placeholder="Digite o documento"
                  inputMode="numeric"
                />
                <strong>{detectedType || "AUTO"}</strong>
              </div>
            </label>

            <label className="field">
              <span>Finalidade</span>
              <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
                {PURPOSES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Base legal</span>
              <select value={legalBasis} onChange={(event) => setLegalBasis(event.target.value)}>
                {LEGAL_BASES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Perfil</span>
              <select value={userProfile} onChange={(event) => setUserProfile(event.target.value as UserProfile)}>
                {PROFILES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="field justification-field">
              <span>Justificativa</span>
              <textarea
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="Contexto da consulta, especialmente obrigatorio para CPF"
              />
            </label>

            <label className="consent-check">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(event) => setConsentChecked(event.target.checked)}
              />
              <span>Consentimento registrado quando aplicavel</span>
            </label>

            <button className="primary-button" disabled={loading} type="submit">
              {loading ? <Clock3 size={18} /> : <Search size={18} />}
              {loading ? "Consultando" : "Consultar"}
            </button>
          </form>

          {error ? (
            <div className="alert-line">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          ) : null}
        </section>

        <DossierView
          activeDossier={activeDossier}
          audit={audit}
          tab={tab}
          setTab={setTab}
          manualEvidence={manualEvidence}
          setManualEvidence={setManualEvidence}
          onAddEvidence={handleAddEvidence}
        />
      </main>

      <PrintReport dossier={activeDossier} />
    </div>
  );
}

interface DossierViewProps {
  activeDossier: Dossier | null;
  audit: AuditEntry[];
  tab: TabId;
  setTab: (tab: TabId) => void;
  manualEvidence: ManualEvidenceDraft;
  setManualEvidence: (draft: ManualEvidenceDraft) => void;
  onAddEvidence: (event: FormEvent<HTMLFormElement>) => void;
}

function DossierView({
  activeDossier,
  audit,
  tab,
  setTab,
  manualEvidence,
  setManualEvidence,
  onAddEvidence,
}: DossierViewProps) {
  if (!activeDossier) {
    return (
      <section className="empty-state">
        <div className="empty-copy">
          <span className="eyebrow">Pronto para consulta real</span>
          <h2>Aguardando CPF ou CNPJ</h2>
          <p>
            A plataforma inicia sem dados ficticios. Ao consultar um CNPJ, o dossie e montado com dados coletados da
            fonte publica configurada e com trilha de evidencias. CPF permanece em modo restrito e auditavel.
          </p>
          <div className="empty-badges">
            <span>
              <Database size={16} />
              CNPJ publico
            </span>
            <span>
              <Fingerprint size={16} />
              CPF restrito
            </span>
            <span>
              <ShieldCheck size={16} />
              Evidencia rastreavel
            </span>
          </div>
        </div>
        <div className="empty-visual" aria-hidden="true">
          <img src={boardUrl} alt="" />
        </div>
      </section>
    );
  }

  const metricItems = [
    { label: "Evidencias", value: activeDossier.evidences.length, icon: <FileText size={18} /> },
    { label: "Fontes", value: activeDossier.externalChecks.length, icon: <Database size={18} /> },
    { label: "Socios", value: activeDossier.company?.partners.length || 0, icon: <Users size={18} /> },
    { label: "Contratos", value: activeDossier.contracts?.totalContracts || 0, icon: <Briefcase size={18} /> },
    { label: "Valor contratos", value: formatCompactCurrency(activeDossier.contracts?.totalFinalValue), icon: <Scale size={18} /> },
  ];

  return (
    <>
      <section className="dossier-header">
        <div className="entity-title">
          <span className="document-chip">{activeDossier.documentType}</span>
          <h2>{activeDossier.company?.legalName || activeDossier.cpfGate?.masked || activeDossier.documentMasked}</h2>
          <p>
            {activeDossier.company?.tradeName || activeDossier.purpose} · {activeDossier.documentMasked}
          </p>
        </div>

        <div className={`risk-module ${riskClass(activeDossier.risk.level)}`}>
          <div
            className="risk-dial"
            style={{ "--score": `${activeDossier.risk.score}%` } as CSSProperties}
            aria-label={`Score ${activeDossier.risk.score}`}
          >
            <strong>{activeDossier.risk.level === "Restrito" ? "RST" : activeDossier.risk.score}</strong>
          </div>
          <div>
            <span>Risco</span>
            <strong>{activeDossier.risk.level}</strong>
          </div>
        </div>
      </section>

      <section className="metric-grid no-print">
        {metricItems.map((item) => (
          <div className="metric-card" key={item.label}>
            {item.icon}
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <nav className="tabs no-print" aria-label="Abas do dossie">
        <TabButton id="overview" active={tab} setTab={setTab} icon={<Activity size={16} />} label="Visao geral" />
        <TabButton id="cadastro" active={tab} setTab={setTab} icon={<Building2 size={16} />} label="Cadastro" />
        <TabButton id="socios" active={tab} setTab={setTab} icon={<Network size={16} />} label="Vinculos" />
        <TabButton id="contratos" active={tab} setTab={setTab} icon={<Briefcase size={16} />} label="Contratos" />
        <TabButton id="fontes" active={tab} setTab={setTab} icon={<Link2 size={16} />} label="Fontes" />
        <TabButton id="evidencias" active={tab} setTab={setTab} icon={<FileText size={16} />} label="Evidencias" />
        <TabButton id="auditoria" active={tab} setTab={setTab} icon={<History size={16} />} label="Auditoria" />
      </nav>

      <section className="content-panel">
        {tab === "overview" ? <Overview dossier={activeDossier} /> : null}
        {tab === "cadastro" ? <Cadastro dossier={activeDossier} /> : null}
        {tab === "socios" ? <Socios dossier={activeDossier} /> : null}
        {tab === "contratos" ? <Contratos dossier={activeDossier} /> : null}
        {tab === "fontes" ? <Fontes checks={activeDossier.externalChecks} /> : null}
        {tab === "evidencias" ? (
          <Evidencias
            dossier={activeDossier}
            manualEvidence={manualEvidence}
            setManualEvidence={setManualEvidence}
            onAddEvidence={onAddEvidence}
          />
        ) : null}
        {tab === "auditoria" ? <Auditoria entries={[...activeDossier.auditTrail, ...audit]} /> : null}
      </section>
    </>
  );
}

function TabButton({
  id,
  active,
  setTab,
  icon,
  label,
}: {
  id: TabId;
  active: TabId;
  setTab: (tab: TabId) => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button type="button" className={active === id ? "tab-button is-active" : "tab-button"} onClick={() => setTab(id)}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Overview({ dossier }: { dossier: Dossier }) {
  const company = dossier.company;
  return (
    <div className="overview-grid">
      <section className="panel-block">
        <div className="section-heading">
          <Gauge size={19} />
          <h3>Score explicavel</h3>
        </div>
        {dossier.risk.factors.length === 0 ? (
          <p className="positive-line">
            <CheckCircle2 size={17} />
            Nenhum fator cadastral objetivo elevou o risco nesta coleta.
          </p>
        ) : (
          <div className="factor-list">
            {dossier.risk.factors.map((factor) => (
              <div className={`factor-item ${factor.severity}`} key={factor.label}>
                <strong>+{factor.points}</strong>
                <span>{factor.label}</span>
                <small>{factor.evidence}</small>
              </div>
            ))}
          </div>
        )}
        <ul className="limitation-list">
          {dossier.risk.limitations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="panel-block">
        <div className="section-heading">
          <Building2 size={19} />
          <h3>Resumo operacional</h3>
        </div>
        <div className="data-grid">
          <DataPoint label="Situacao" value={company?.registrationStatus || dossier.cpfGate?.gateStatus || "Nao informado"} />
          <DataPoint label="Abertura" value={formatDate(company?.openedAt)} />
          <DataPoint label="Natureza" value={company?.legalNature || "Nao informado"} />
          <DataPoint label="Capital" value={formatCurrency(company?.capitalSocial)} />
          <DataPoint label="Contratos publicos" value={String(dossier.contracts?.totalContracts || 0)} />
          <DataPoint label="Valor contratos" value={formatCurrency(dossier.contracts?.totalFinalValue)} />
          <DataPoint label="Finalidade" value={dossier.purpose} />
          <DataPoint label="Base legal" value={dossier.legalBasis} />
        </div>
      </section>

      <section className="panel-block span-2">
        <div className="section-heading">
          <ShieldCheck size={19} />
          <h3>Fontes e verificacoes</h3>
        </div>
        <div className="source-strip">
          {dossier.externalChecks.map((check) => (
            <a
              className={`source-tile ${checkStatusClass(check.status)}`}
              key={check.id}
              href={check.url}
              target="_blank"
              rel="noreferrer"
            >
              {sourceIcon(check.source)}
              <span>{check.name}</span>
              <strong>{check.status}</strong>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function Cadastro({ dossier }: { dossier: Dossier }) {
  const company = dossier.company;
  if (!company) {
    return (
      <div className="panel-block">
        <div className="section-heading">
          <Fingerprint size={19} />
          <h3>CPF restrito</h3>
        </div>
        <div className="data-grid">
          <DataPoint label="Documento" value={dossier.cpfGate?.masked || dossier.documentMasked} />
          <DataPoint label="Status" value={dossier.cpfGate?.gateStatus || "Restrito"} />
          <DataPoint label="Perfil" value={dossier.userProfile} />
          <DataPoint label="Finalidade" value={dossier.purpose} />
        </div>
        <div className="compliance-box">
          <Lock size={18} />
          <span>Dados pessoais nao sao enriquecidos automaticamente. Use apenas evidencias autorizadas.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-block">
      <div className="section-heading">
        <Building2 size={19} />
        <h3>Dados cadastrais</h3>
      </div>
      <div className="data-grid dense">
        <DataPoint label="CNPJ" value={formatCnpj(company.cnpj)} />
        <DataPoint label="Razao social" value={company.legalName} />
        <DataPoint label="Nome fantasia" value={company.tradeName || "Nao informado"} />
        <DataPoint label="Situacao" value={company.registrationStatus} />
        <DataPoint label="Matriz/filial" value={company.headOfficeType || "Nao informado"} />
        <DataPoint label="Porte" value={company.size || "Nao informado"} />
        <DataPoint label="Natureza juridica" value={company.legalNature || "Nao informado"} />
        <DataPoint label="Capital social" value={formatCurrency(company.capitalSocial)} />
        <DataPoint label="CNAE principal" value={company.primaryCnae?.description || "Nao informado"} />
        <DataPoint label="Codigo CNAE" value={company.primaryCnae?.code || "Nao informado"} />
        <DataPoint label="Endereco" value={company.address || "Nao informado"} wide />
        <DataPoint label="E-mail publico" value={company.email || "Nao informado"} />
        <DataPoint label="Telefones publicos" value={company.phones.join(" / ") || "Nao informado"} />
      </div>

      {company.secondaryCnaes.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CNAEs secundarios</th>
                <th>Codigo</th>
              </tr>
            </thead>
            <tbody>
              {company.secondaryCnaes.map((item) => (
                <tr key={`${item.code}-${item.description}`}>
                  <td>{item.description}</td>
                  <td>{item.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Socios({ dossier }: { dossier: Dossier }) {
  const partners = dossier.company?.partners || [];
  if (!dossier.company) {
    return (
      <div className="panel-block">
        <div className="section-heading">
          <Lock size={19} />
          <h3>Vinculos CPF</h3>
        </div>
        <p className="muted">Vinculos pessoais devem ser anexados manualmente com fonte e base legal.</p>
      </div>
    );
  }

  return (
    <div className="panel-block">
      <div className="section-heading">
        <Users size={19} />
        <h3>Socios e administradores</h3>
      </div>
      {partners.length === 0 ? (
        <p className="muted">A fonte consultada nao retornou quadro societario.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Documento</th>
                <th>Qualificacao</th>
                <th>Entrada</th>
                <th>Confianca</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((partner, index) => (
                <tr key={`${partner.name}-${index}`}>
                  <td>{partner.name}</td>
                  <td>{partner.documentMasked || "Nao informado"}</td>
                  <td>{partner.qualification || "Nao informado"}</td>
                  <td>{formatDate(partner.joinedAt)}</td>
                  <td>{partner.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Contratos({ dossier }: { dossier: Dossier }) {
  const contracts = dossier.contracts;

  if (!contracts) {
    return (
      <div className="panel-block">
        <div className="section-heading">
          <Briefcase size={19} />
          <h3>Contratos publicos</h3>
        </div>
        <p className="muted">Nenhuma coleta operacional foi executada para este dossie.</p>
      </div>
    );
  }

  return (
    <div className="contract-layout">
      <section className="panel-block">
        <div className="section-heading">
          <Briefcase size={19} />
          <h3>Contratos publicos</h3>
        </div>

        <div className="data-grid contract-summary">
          <DataPoint label="Status da coleta" value={contracts.status} />
          <DataPoint label="Fonte de contratos" value={contracts.source} />
          <DataPoint label="Contratos localizados" value={String(contracts.totalContracts)} />
          <DataPoint label="Contratos vigentes" value={String(contracts.activeContracts)} />
          <DataPoint label="Valor inicial somado" value={formatCurrency(contracts.totalInitialValue)} />
          <DataPoint label="Valor final somado" value={formatCurrency(contracts.totalFinalValue)} />
        </div>

        {contracts.status === "Requer chave" || contracts.status === "Indisponivel" ? (
          <div className="compliance-box warning-box">
            <KeyRound size={18} />
            <span>
              Contratos federais por CNPJ do fornecedor exigem chave da API de Dados da CGU ou proxy Render configurado.
            </span>
          </div>
        ) : null}

        {contracts.notes.length ? (
          <ul className="limitation-list">
            {contracts.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <div className="contract-actions no-print">
          <a href={contracts.portalTransparencyUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon size={16} />
            Portal da Transparencia
          </a>
          <a href={contracts.pncpSearchUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon size={16} />
            PNCP filtrado
          </a>
        </div>
      </section>

      <section className="panel-block">
        <div className="section-heading">
          <Database size={19} />
          <h3>Fornecedor em compras publicas</h3>
        </div>
        {contracts.supplierRegistry ? (
          <div className="data-grid dense">
            <DataPoint label="Status" value={contracts.supplierRegistry.status} />
            <DataPoint
              label="Habilitado licitar"
              value={contracts.supplierRegistry.enabledToBid === undefined ? "Nao informado" : contracts.supplierRegistry.enabledToBid ? "Sim" : "Nao"}
            />
            <DataPoint label="Razao social" value={contracts.supplierRegistry.legalName || "Nao informado"} />
            <DataPoint label="CNAE" value={contracts.supplierRegistry.cnae || "Nao informado"} wide />
            <DataPoint label="Natureza" value={contracts.supplierRegistry.legalNature || "Nao informado"} />
            <DataPoint label="Porte" value={contracts.supplierRegistry.size || "Nao informado"} />
            <DataPoint label="Municipio/UF" value={compactDisplay([contracts.supplierRegistry.city, contracts.supplierRegistry.state])} />
          </div>
        ) : (
          <p className="muted">Cadastro de fornecedor nao consultado.</p>
        )}
      </section>

      <section className="panel-block span-2">
        <div className="section-heading">
          <FileText size={19} />
          <h3>Lista de contratos</h3>
        </div>
        {contracts.contracts.length === 0 ? (
          <p className="muted">Nenhum contrato foi coletado automaticamente nesta consulta.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Orgao / unidade</th>
                  <th>Objeto</th>
                  <th>Vigencia</th>
                  <th>Valor</th>
                  <th>Fonte</th>
                </tr>
              </thead>
              <tbody>
                {contracts.contracts.map((contract) => (
                  <tr key={contract.id}>
                    <td>
                      <strong>{contract.number || "Nao informado"}</strong>
                      <small>{contract.process || contract.status || ""}</small>
                    </td>
                    <td>
                      {contract.agency || "Nao informado"}
                      <small>{contract.unit || ""}</small>
                    </td>
                    <td>{contract.object}</td>
                    <td>
                      {formatDate(contract.startDate)} ate {formatDate(contract.endDate)}
                    </td>
                    <td>{formatCurrency(contract.finalValue || contract.initialValue)}</td>
                    <td>
                      {contract.sourceUrl ? (
                        <a href={contract.sourceUrl} target="_blank" rel="noreferrer" title="Abrir fonte">
                          <ExternalLinkIcon size={16} />
                        </a>
                      ) : (
                        contract.source
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Fontes({ checks }: { checks: ExternalCheck[] }) {
  return (
    <div className="panel-block">
      <div className="section-heading">
        <Link2 size={19} />
        <h3>Fontes de verificacao</h3>
      </div>
      <div className="check-list">
        {checks.map((check) => (
          <article className="check-row" key={check.id}>
            <div className={`check-icon ${checkStatusClass(check.status)}`}>{sourceIcon(check.source)}</div>
            <div>
              <strong>{check.name}</strong>
              <span>{check.source}</span>
              <p>{check.notes}</p>
            </div>
            <div className="check-actions">
              <span className={`mini-status ${checkStatusClass(check.status)}`}>{check.status}</span>
              {check.url ? (
                <a href={check.url} target="_blank" rel="noreferrer" title="Abrir fonte">
                  <ExternalLinkIcon size={17} />
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Evidencias({
  dossier,
  manualEvidence,
  setManualEvidence,
  onAddEvidence,
}: {
  dossier: Dossier;
  manualEvidence: ManualEvidenceDraft;
  setManualEvidence: (draft: ManualEvidenceDraft) => void;
  onAddEvidence: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="evidence-layout">
      <section className="panel-block">
        <div className="section-heading">
          <FileText size={19} />
          <h3>Evidencias coletadas</h3>
        </div>
        <div className="evidence-list">
          {dossier.evidences.map((evidence) => (
            <article className="evidence-item" key={evidence.id}>
              <div className="evidence-topline">
                <strong>{evidence.title}</strong>
                <span className={`mini-status ${checkStatusClass(evidence.status)}`}>{evidence.status}</span>
              </div>
              <p>{evidence.source}</p>
              <div className="evidence-meta">
                <span>{evidence.sourceType}</span>
                <span>{evidence.confidence}</span>
                <span>{formatDateTime(evidence.collectedAt)}</span>
              </div>
              {evidence.hash ? <code>{evidence.hash}</code> : null}
              {evidence.url ? (
                <a href={evidence.url} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon size={15} />
                  Abrir fonte
                </a>
              ) : null}
              {evidence.notes ? <small>{evidence.notes}</small> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel-block">
        <div className="section-heading">
          <Plus size={19} />
          <h3>Anexar evidencia</h3>
        </div>
        <form className="manual-form" onSubmit={onAddEvidence}>
          <label className="field">
            <span>Titulo</span>
            <input
              value={manualEvidence.title}
              onChange={(event) => setManualEvidence({ ...manualEvidence, title: event.target.value })}
              placeholder="Documento, noticia, certidao..."
            />
          </label>
          <label className="field">
            <span>Fonte</span>
            <input
              value={manualEvidence.source}
              onChange={(event) => setManualEvidence({ ...manualEvidence, source: event.target.value })}
              placeholder="Orgao, portal, contrato, titular..."
            />
          </label>
          <label className="field">
            <span>URL ou identificador</span>
            <input
              value={manualEvidence.url}
              onChange={(event) => setManualEvidence({ ...manualEvidence, url: event.target.value })}
              placeholder="https://..."
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Tipo</span>
              <select
                value={manualEvidence.sourceType}
                onChange={(event) => setManualEvidence({ ...manualEvidence, sourceType: event.target.value as SourceType })}
              >
                {SOURCE_TYPES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={manualEvidence.status}
                onChange={(event) => setManualEvidence({ ...manualEvidence, status: event.target.value as EvidenceStatus })}
              >
                {STATUSES.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Confianca</span>
            <select
              value={manualEvidence.confidence}
              onChange={(event) => setManualEvidence({ ...manualEvidence, confidence: event.target.value as ConfidenceLevel })}
            >
              {CONFIDENCES.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Observacao</span>
            <textarea
              value={manualEvidence.notes}
              onChange={(event) => setManualEvidence({ ...manualEvidence, notes: event.target.value })}
              placeholder="Contexto, limitacoes, cadeia de custodia..."
            />
          </label>
          <button className="secondary-button" type="submit">
            <Plus size={17} />
            Registrar evidencia
          </button>
        </form>
      </section>
    </div>
  );
}

function Auditoria({ entries }: { entries: AuditEntry[] }) {
  const uniqueEntries = entries.filter((entry, index, list) => list.findIndex((item) => item.id === entry.id) === index);
  return (
    <div className="panel-block">
      <div className="section-heading">
        <History size={19} />
        <h3>Trilha de auditoria</h3>
      </div>
      <div className="audit-list">
        {uniqueEntries.map((entry) => (
          <article className="audit-row" key={entry.id}>
            <div>
              <strong>{entry.action}</strong>
              <span>{entry.details}</span>
            </div>
            <div>
              <small>{entry.documentMasked}</small>
              <small>{formatDateTime(entry.timestamp)}</small>
            </div>
            <span className={`mini-status ${checkStatusClass(entry.status)}`}>{entry.status}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function DataPoint({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <div className={wide ? "data-point wide" : "data-point"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PrintReport({ dossier }: { dossier: Dossier | null }) {
  if (!dossier) return null;
  const company = dossier.company;
  return (
    <section className="print-report">
      <header>
        <h1>NexoTrace 360</h1>
        <p>Relatorio tecnico de inteligencia cadastral e evidencias</p>
      </header>

      <h2>Identificacao</h2>
      <table>
        <tbody>
          <tr>
            <th>Documento</th>
            <td>{dossier.documentMasked}</td>
          </tr>
          <tr>
            <th>Tipo</th>
            <td>{dossier.documentType}</td>
          </tr>
          <tr>
            <th>Finalidade</th>
            <td>{dossier.purpose}</td>
          </tr>
          <tr>
            <th>Base legal</th>
            <td>{dossier.legalBasis}</td>
          </tr>
          <tr>
            <th>Emissao</th>
            <td>{formatDateTime(nowIso())}</td>
          </tr>
        </tbody>
      </table>

      <h2>Resumo executivo</h2>
      <p>
        {company
          ? `${company.legalName} consta com situacao ${company.registrationStatus}. O score cadastral calculado foi ${dossier.risk.score} (${dossier.risk.level}). Contratos coletados: ${dossier.contracts?.totalContracts || 0}, valor final somado: ${formatCurrency(dossier.contracts?.totalFinalValue)}.`
          : `CPF validado em modo restrito. Nenhuma busca externa de dados pessoais foi executada.`}
      </p>

      {company ? (
        <>
          <h2>Dados cadastrais</h2>
          <table>
            <tbody>
              <tr>
                <th>Razao social</th>
                <td>{company.legalName}</td>
              </tr>
              <tr>
                <th>Nome fantasia</th>
                <td>{company.tradeName || "Nao informado"}</td>
              </tr>
              <tr>
                <th>CNAE principal</th>
                <td>{company.primaryCnae?.description || "Nao informado"}</td>
              </tr>
              <tr>
                <th>Endereco</th>
                <td>{company.address || "Nao informado"}</td>
              </tr>
              <tr>
                <th>Capital social</th>
                <td>{formatCurrency(company.capitalSocial)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      {dossier.contracts ? (
        <>
          <h2>Contratos publicos</h2>
          <table>
            <tbody>
              <tr>
                <th>Status da coleta</th>
                <td>{dossier.contracts.status}</td>
              </tr>
              <tr>
                <th>Fonte</th>
                <td>{dossier.contracts.source}</td>
              </tr>
              <tr>
                <th>Total de contratos</th>
                <td>{dossier.contracts.totalContracts}</td>
              </tr>
              <tr>
                <th>Valor final somado</th>
                <td>{formatCurrency(dossier.contracts.totalFinalValue)}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}

      <h2>Evidencias</h2>
      <table>
        <thead>
          <tr>
            <th>Titulo</th>
            <th>Fonte</th>
            <th>Status</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {dossier.evidences.map((evidence) => (
            <tr key={evidence.id}>
              <td>{evidence.title}</td>
              <td>{evidence.source}</td>
              <td>{evidence.status}</td>
              <td>{evidence.hash || "Nao informado"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Limitacoes</h2>
      <p>
        Este relatorio foi elaborado com base em informacoes publicas, oficiais, autorizadas ou contratadas disponiveis
        no momento da consulta. A existencia de processo, noticia, mencao negativa ou vinculo identificado nao representa,
        por si so, conclusao de culpa, fraude ou irregularidade. A analise deve ser interpretada por profissional
        habilitado e, quando necessario, complementada por parecer juridico, contabil ou investigativo.
      </p>
    </section>
  );
}
