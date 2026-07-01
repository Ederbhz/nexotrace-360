import type { Cnae, CompanyProfile, ContractIntelligence, ExternalCheck, Partner } from "../types";
import { onlyDigits } from "./validators";

interface BrasilApiPartner {
  nome_socio?: string;
  cnpj_cpf_do_socio?: string;
  qualificacao_socio?: string;
  data_entrada_sociedade?: string;
  faixa_etaria?: string;
}

interface BrasilApiCnpjResponse {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  data_situacao_cadastral?: string;
  natureza_juridica?: string;
  porte?: string;
  descricao_identificador_matriz_filial?: string;
  capital_social?: number;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  cnaes_secundarios?: Array<{ codigo?: number; descricao?: string }>;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  email?: string | null;
  ddd_telefone_1?: string;
  ddd_telefone_2?: string;
  ddd_fax?: string;
  qsa?: BrasilApiPartner[];
}

const CNPJ_ENDPOINT = "https://brasilapi.com.br/api/cnpj/v1";
const CNPJ_WS_ENDPOINT = "https://publica.cnpj.ws/cnpj";

interface CnpjWsResponse {
  razao_social?: string;
  capital_social?: string;
  atualizado_em?: string;
  porte?: { descricao?: string };
  natureza_juridica?: { descricao?: string };
  socios?: Array<{
    cpf_cnpj_socio?: string;
    nome?: string;
    data_entrada?: string;
    faixa_etaria?: string;
    qualificacao_socio?: { descricao?: string };
  }>;
  estabelecimento?: {
    cnpj?: string;
    nome_fantasia?: string;
    situacao_cadastral?: string;
    data_situacao_cadastral?: string;
    data_inicio_atividade?: string;
    tipo?: string;
    tipo_logradouro?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string | null;
    bairro?: string;
    cep?: string;
    ddd1?: string;
    telefone1?: string;
    ddd2?: string | null;
    telefone2?: string | null;
    email?: string | null;
    atualizado_em?: string;
    atividade_principal?: { id?: string; descricao?: string };
    atividades_secundarias?: Array<{ id?: string; descricao?: string }>;
    estado?: { sigla?: string };
    cidade?: { nome?: string };
  };
}

function asCnae(code?: number, description?: string): Cnae | undefined {
  if (!code && !description) return undefined;
  return {
    code: code ? String(code) : "Nao informado",
    description: description || "Nao informado",
  };
}

function compact(parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizePhone(phone?: string): string | undefined {
  const digits = onlyDigits(phone || "");
  if (!digits) return undefined;
  if (digits.length <= 8) return digits;
  const ddd = digits.slice(0, 2);
  const body = digits.slice(2);
  return `(${ddd}) ${body}`;
}

function mapPartners(qsa?: BrasilApiPartner[]): Partner[] {
  return (qsa || []).map((partner) => ({
    name: partner.nome_socio || "Nome nao informado",
    documentMasked: partner.cnpj_cpf_do_socio,
    qualification: partner.qualificacao_socio,
    joinedAt: partner.data_entrada_sociedade,
    ageRange: partner.faixa_etaria,
    confidence: "Media",
  }));
}

function mapCnpjWsPartners(socios?: CnpjWsResponse["socios"]): Partner[] {
  return (socios || []).map((partner) => ({
    name: partner.nome || "Nome nao informado",
    documentMasked: partner.cpf_cnpj_socio,
    qualification: partner.qualificacao_socio?.descricao?.trim(),
    joinedAt: partner.data_entrada,
    ageRange: partner.faixa_etaria,
    confidence: "Media",
  }));
}

async function fetchJsonWithTimeout<T>(url: string, label: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = response.status === 404 ? "CNPJ nao localizado na fonte publica." : `${label} indisponivel.`;
      throw new Error(details);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function mapBrasilApiCompany(data: BrasilApiCnpjResponse, digits: string): CompanyProfile {
  const primaryCnae = asCnae(data.cnae_fiscal, data.cnae_fiscal_descricao);
  const secondaryCnaes = (data.cnaes_secundarios || [])
    .map((item) => asCnae(item.codigo, item.descricao))
    .filter(Boolean) as Cnae[];

  return {
    cnpj: data.cnpj || digits,
    legalName: data.razao_social || "Razao social nao informada",
    tradeName: data.nome_fantasia || undefined,
    registrationStatus: data.descricao_situacao_cadastral || "Nao informado",
    openedAt: data.data_inicio_atividade,
    statusDate: data.data_situacao_cadastral,
    legalNature: data.natureza_juridica,
    size: data.porte,
    headOfficeType: data.descricao_identificador_matriz_filial,
    capitalSocial: data.capital_social,
    primaryCnae,
    secondaryCnaes,
    address: compact([
      data.logradouro,
      data.numero,
      data.complemento,
      data.bairro,
      data.municipio,
      data.uf,
      data.cep,
    ]),
    city: data.municipio,
    state: data.uf,
    zipCode: data.cep,
    email: data.email || undefined,
    phones: [normalizePhone(data.ddd_telefone_1), normalizePhone(data.ddd_telefone_2), normalizePhone(data.ddd_fax)].filter(
      Boolean,
    ) as string[],
    partners: mapPartners(data.qsa),
    sourceName: "BrasilAPI CNPJ",
    sourceUrl: cnpjApiUrl(digits),
    raw: data,
  };
}

function mapCnpjWsCompany(data: CnpjWsResponse, digits: string): CompanyProfile {
  const establishment = data.estabelecimento || {};
  const primaryCnae = asCnae(
    establishment.atividade_principal?.id ? Number(establishment.atividade_principal.id) : undefined,
    establishment.atividade_principal?.descricao,
  );
  const secondaryCnaes = (establishment.atividades_secundarias || [])
    .map((item) => asCnae(item.id ? Number(item.id) : undefined, item.descricao))
    .filter(Boolean) as Cnae[];
  const phone1 = normalizePhone(`${establishment.ddd1 || ""}${establishment.telefone1 || ""}`);
  const phone2 = normalizePhone(`${establishment.ddd2 || ""}${establishment.telefone2 || ""}`);

  return {
    cnpj: establishment.cnpj || digits,
    legalName: data.razao_social || "Razao social nao informada",
    tradeName: establishment.nome_fantasia || undefined,
    registrationStatus: establishment.situacao_cadastral || "Nao informado",
    openedAt: establishment.data_inicio_atividade,
    statusDate: establishment.data_situacao_cadastral,
    legalNature: data.natureza_juridica?.descricao,
    size: data.porte?.descricao,
    headOfficeType: establishment.tipo,
    capitalSocial: data.capital_social ? Number(data.capital_social) : undefined,
    primaryCnae,
    secondaryCnaes,
    address: compact([
      establishment.tipo_logradouro,
      establishment.logradouro,
      establishment.numero,
      establishment.complemento,
      establishment.bairro,
      establishment.cidade?.nome,
      establishment.estado?.sigla,
      establishment.cep,
    ]),
    city: establishment.cidade?.nome,
    state: establishment.estado?.sigla,
    zipCode: establishment.cep,
    email: establishment.email || undefined,
    phones: [phone1, phone2].filter(Boolean) as string[],
    partners: mapCnpjWsPartners(data.socios),
    sourceName: "CNPJ.ws Publica",
    sourceUrl: cnpjWsApiUrl(digits),
    sourceUpdatedAt: establishment.atualizado_em || data.atualizado_em,
    raw: data,
  };
}

export async function fetchCompanyByCnpj(cnpj: string): Promise<CompanyProfile> {
  const digits = onlyDigits(cnpj);
  const errors: string[] = [];

  try {
    const data = await fetchJsonWithTimeout<BrasilApiCnpjResponse>(cnpjApiUrl(digits), "BrasilAPI");
    return mapBrasilApiCompany(data, digits);
  } catch (caught) {
    errors.push(caught instanceof Error ? caught.message : "BrasilAPI indisponivel.");
  }

  try {
    const data = await fetchJsonWithTimeout<CnpjWsResponse>(cnpjWsApiUrl(digits), "CNPJ.ws");
    return mapCnpjWsCompany(data, digits);
  } catch (caught) {
    errors.push(caught instanceof Error ? caught.message : "CNPJ.ws indisponivel.");
  }

  throw new Error(
    `Nao consegui acessar as fontes publicas de CNPJ agora. Verifique sua conexao ou tente novamente em alguns instantes. Detalhes: ${errors.join(" | ")}`,
  );
}

export function buildExternalChecks(company: CompanyProfile, contracts?: ContractIntelligence): ExternalCheck[] {
  const cnpj = onlyDigits(company.cnpj);
  const name = encodeURIComponent(`"${company.legalName}" OR "${cnpj}"`);
  const contractStatus =
    contracts?.status === "Consultado"
      ? "Consultado"
      : contracts?.status === "Requer chave"
        ? "Requer chave"
        : contracts?.status === "Indisponivel"
          ? "Nao consultado"
          : "Link de verificacao";
  const contractNotes =
    contracts?.status === "Consultado"
      ? `${contracts.totalContracts} contrato(s) coletado(s), valor final somado ${contracts.totalFinalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`
      : contracts?.status === "Requer chave"
        ? "Para coletar contratos federais por fornecedor, configure chave da API de Dados da CGU ou proxy Render."
        : contracts?.status === "Indisponivel"
          ? contracts.notes[contracts.notes.length - 1] || "Fonte de contratos indisponivel na tentativa de coleta."
        : "Consulta oficial por CNPJ/razao social deve ser confirmada no portal.";
  const supplierStatus = contracts?.supplierRegistry?.status === "Consultado" ? "Consultado" : "Link de verificacao";

  return [
    {
      id: "receita",
      name: "Comprovante Receita Federal",
      source: "Receita Federal",
      url: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp",
      status: "Link de verificacao",
      confidence: "Alta",
      notes: "Fonte oficial aberta em ambiente externo. Use o CNPJ consultado para confirmar o comprovante.",
    },
    {
      id: "compras-fornecedor",
      name: "Fornecedor Compras.gov.br",
      source: "Compras.gov.br Dados Abertos",
      url: contracts?.supplierRegistry?.sourceUrl || `https://dadosabertos.compras.gov.br/swagger-ui/index.html`,
      status: supplierStatus,
      confidence: contracts?.supplierRegistry?.status === "Consultado" ? "Alta" : "Indeterminada",
      notes:
        contracts?.supplierRegistry?.status === "Consultado"
          ? `Fornecedor localizado. Habilitado para licitar: ${contracts.supplierRegistry.enabledToBid === false ? "nao" : "sim"}.`
          : "Base oficial aberta de fornecedores. Pode ser consultada automaticamente quando disponivel.",
    },
    {
      id: "pncp",
      name: "Contratos e licitacoes",
      source: "PNCP",
      url: contracts?.pncpSearchUrl || `https://pncp.gov.br/app/contratos?pagina=1&q=${cnpj}&status=todos`,
      status: "Link de verificacao",
      confidence: "Alta",
      notes: "Link oficial filtrado no PNCP para conferencia de contratos, editais e documentos relacionados.",
    },
    {
      id: "portal-contratos",
      name: "Contratos por fornecedor",
      source: "Portal da Transparencia",
      url: contracts?.portalTransparencyUrl || "https://portaldatransparencia.gov.br/contratos/consulta",
      status: contractStatus,
      confidence: contracts?.status === "Consultado" ? "Alta" : "Indeterminada",
      notes: contractNotes,
    },
    {
      id: "sancoes",
      name: "CEIS, CNEP e CEPIM",
      source: "Portal da Transparencia",
      url: "https://portaldatransparencia.gov.br/sancoes/consulta",
      status: "Link de verificacao",
      confidence: "Alta",
      notes: "A fonte oficial pode exigir filtros, sessao ou tratamento anti-abuso.",
    },
    {
      id: "datajud",
      name: "Processos judiciais",
      source: "CNJ DataJud",
      url: "https://www.cnj.jus.br/sistemas/datajud/",
      status: "Requer chave",
      confidence: "Indeterminada",
      notes: "Integracao oficial depende de credenciais e politica de uso.",
    },
    {
      id: "news",
      name: "Noticias e reputacao",
      source: "Google News",
      url: `https://news.google.com/search?q=${name}&hl=pt-BR&gl=BR&ceid=BR%3Apt-419`,
      status: "Link de verificacao",
      confidence: "Media",
      notes: "Resultado jornalistico nao implica culpa; exige revisao humana e controle de homonimos.",
    },
  ];
}

export const cnpjApiUrl = (cnpj: string): string => `${CNPJ_ENDPOINT}/${onlyDigits(cnpj)}`;
export const cnpjWsApiUrl = (cnpj: string): string => `${CNPJ_WS_ENDPOINT}/${onlyDigits(cnpj)}`;
