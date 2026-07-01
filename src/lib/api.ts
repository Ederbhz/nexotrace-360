import type { Cnae, CompanyProfile, ExternalCheck, Partner } from "../types";
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

export async function fetchCompanyByCnpj(cnpj: string): Promise<CompanyProfile> {
  const digits = onlyDigits(cnpj);
  const response = await fetch(`${CNPJ_ENDPOINT}/${digits}`);

  if (!response.ok) {
    const details = response.status === 404 ? "CNPJ nao localizado na fonte publica." : "Fonte CNPJ indisponivel.";
    throw new Error(details);
  }

  const data = (await response.json()) as BrasilApiCnpjResponse;
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
    raw: data,
  };
}

export function buildExternalChecks(company: CompanyProfile): ExternalCheck[] {
  const cnpj = onlyDigits(company.cnpj);
  const name = encodeURIComponent(`"${company.legalName}" OR "${cnpj}"`);

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
      id: "pncp",
      name: "Contratos e licitacoes",
      source: "PNCP",
      url: `https://pncp.gov.br/app/editais?q=${cnpj}`,
      status: "Link de verificacao",
      confidence: "Alta",
      notes: "Consulta oficial por CNPJ/razao social deve ser confirmada no portal.",
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
