import type { CompanyProfile, RiskAssessment, RiskFactor } from "../types";

function ageInDays(date?: string): number | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
}

function levelFromScore(score: number): RiskAssessment["level"] {
  if (score <= 20) return "Baixo";
  if (score <= 40) return "Moderado";
  if (score <= 60) return "Atencao";
  if (score <= 80) return "Alto";
  return "Critico";
}

export function calculateCompanyRisk(company: CompanyProfile): RiskAssessment {
  const factors: RiskFactor[] = [];
  const limitations = [
    "Score calculado somente com dados cadastrais efetivamente coletados.",
    "Contratos, sancoes, processos e noticias exigem confirmacao nas fontes oficiais indicadas.",
    "O resultado e apoio analitico e nao substitui parecer juridico, contabil ou pericial.",
  ];

  if (!company.registrationStatus.toUpperCase().includes("ATIVA")) {
    factors.push({
      label: "Situacao cadastral diferente de ativa",
      points: 35,
      severity: "alta",
      evidence: company.registrationStatus,
    });
  }

  const days = ageInDays(company.openedAt);
  if (days !== null && days < 365) {
    factors.push({
      label: "Empresa com menos de 1 ano",
      points: 15,
      severity: "moderada",
      evidence: company.openedAt,
    });
  } else if (days !== null && days < 1095) {
    factors.push({
      label: "Empresa com menos de 3 anos",
      points: 8,
      severity: "baixa",
      evidence: company.openedAt,
    });
  }

  if (typeof company.capitalSocial === "number" && company.capitalSocial > 0 && company.capitalSocial < 5_000) {
    factors.push({
      label: "Capital social baixo",
      points: 8,
      severity: "baixa",
      evidence: company.capitalSocial.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    });
  }

  if (!company.email && company.phones.length === 0) {
    factors.push({
      label: "Contato publico ausente na fonte cadastral",
      points: 5,
      severity: "baixa",
    });
  }

  if (company.partners.length === 0) {
    factors.push({
      label: "Quadro societario nao retornado pela fonte",
      points: 5,
      severity: "baixa",
    });
  }

  const score = Math.min(
    100,
    factors.reduce((total, factor) => total + factor.points, 0),
  );

  return {
    score,
    level: levelFromScore(score),
    factors,
    limitations,
  };
}

export function restrictedCpfRisk(): RiskAssessment {
  return {
    score: 0,
    level: "Restrito",
    factors: [],
    limitations: [
      "Consulta CPF externa bloqueada nesta versao por principio de necessidade e finalidade.",
      "Inclua apenas evidencias autorizadas, oficiais ou fornecidas pelo titular.",
      "Exportacao sensivel deve seguir politica interna, base legal e auditoria.",
    ],
  };
}
