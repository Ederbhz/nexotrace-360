import type { ContractIntelligence, PublicContract, SupplierRegistry } from "../types";
import { onlyDigits } from "./validators";

const COMPRAS_FORNECEDOR_ENDPOINT =
  "https://dadosabertos.compras.gov.br/modulo-fornecedor/1_consultarFornecedor";
const PORTAL_CONTRATOS_ENDPOINT =
  "https://api.portaldatransparencia.gov.br/api-de-dados/contratos/cpf-cnpj";
const MAX_PORTAL_PAGES = 6;

interface ComprasFornecedorResponse {
  resultado?: Array<{
    ativo?: boolean;
    cnpj?: string;
    habilitadoLicitar?: boolean;
    codigoCnae?: number;
    nomeCnae?: string;
    nomeMunicipio?: string;
    naturezaJuridicaNome?: string;
    porteEmpresaNome?: string;
    nomeRazaoSocialFornecedor?: string;
    ufSigla?: string;
  }>;
  totalRegistros?: number;
  totalPaginas?: number;
}

interface PortalContratoResponse {
  id?: number;
  numero?: string;
  objeto?: string;
  numeroProcesso?: string;
  fundamentoLegal?: string;
  situacaoContrato?: string;
  modalidadeCompra?: string;
  unidadeGestora?: {
    codigo?: string;
    nome?: string;
    descricaoPoder?: string;
    orgaoVinculado?: {
      codigoSIAFI?: string;
      cnpj?: string;
      nome?: string;
    };
  };
  unidadeGestoraCompras?: {
    codigo?: string;
    nome?: string;
  };
  dataAssinatura?: string;
  dataPublicacaoDOU?: string;
  dataInicioVigencia?: string;
  dataFimVigencia?: string;
  fornecedor?: {
    cpfFormatado?: string;
    cnpjFormatado?: string;
    nome?: string;
  };
  valorInicialCompra?: number;
  valorFinalCompra?: number;
}

interface PublicContractsOptions {
  portalApiKey?: string;
  proxyBaseUrl?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function endpointWithParams(baseUrl: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchJsonWithTimeout<T>(
  url: string,
  label: string,
  init: RequestInit = {},
  timeoutMs = 18_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${label} respondeu HTTP ${response.status}.`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatPortalDate(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/");
    return `${year}-${month}-${day}`;
  }
  return value;
}

function isActiveContract(contract: PublicContract): boolean {
  const status = (contract.status || "").toLowerCase();
  if (status.includes("encerr") || status.includes("rescind") || status.includes("cancel")) return false;
  if (!contract.endDate) return true;
  const end = new Date(`${contract.endDate}T23:59:59`);
  return Number.isNaN(end.getTime()) || end.getTime() >= Date.now();
}

function mapPortalContract(item: PortalContratoResponse): PublicContract {
  const finalValue = typeof item.valorFinalCompra === "number" ? item.valorFinalCompra : item.valorInicialCompra;
  return {
    id: item.id ? `portal-${item.id}` : `portal-${item.numero || crypto.randomUUID()}`,
    source: "Portal da Transparencia",
    sourceUrl: item.id
      ? `https://portaldatransparencia.gov.br/contratos/${item.id}`
      : "https://portaldatransparencia.gov.br/contratos/consulta",
    number: item.numero,
    process: item.numeroProcesso,
    object: item.objeto || "Objeto nao informado",
    agency: item.unidadeGestora?.orgaoVinculado?.nome || item.unidadeGestora?.nome,
    unit: item.unidadeGestoraCompras?.nome || item.unidadeGestora?.nome,
    supplierName: item.fornecedor?.nome,
    status: item.situacaoContrato,
    modality: item.modalidadeCompra,
    signedAt: formatPortalDate(item.dataAssinatura),
    startDate: formatPortalDate(item.dataInicioVigencia),
    endDate: formatPortalDate(item.dataFimVigencia),
    initialValue: item.valorInicialCompra,
    finalValue,
    raw: item,
  };
}

async function fetchSupplierRegistry(cnpj: string, proxyBaseUrl?: string): Promise<SupplierRegistry | undefined> {
  const digits = onlyDigits(cnpj);
  const url = endpointWithParams(COMPRAS_FORNECEDOR_ENDPOINT, {
    cnpj: digits,
    ativo: true,
    pagina: 1,
    tamanhoPagina: 10,
  });
  const proxyUrl = proxyBaseUrl ? `${proxyBaseUrl.replace(/\/$/, "")}/api/compras-gov/fornecedor/${digits}` : undefined;
  let sourceUrl = proxyUrl || url;

  try {
    let data: ComprasFornecedorResponse;
    try {
      data = await fetchJsonWithTimeout<ComprasFornecedorResponse>(sourceUrl, "Compras.gov.br Dados Abertos");
    } catch (caught) {
      if (!proxyUrl) throw caught;
      sourceUrl = url;
      data = await fetchJsonWithTimeout<ComprasFornecedorResponse>(url, "Compras.gov.br Dados Abertos");
    }
    const supplier = data.resultado?.[0];

    if (!supplier) {
      return {
        source: "Compras.gov.br Dados Abertos",
        status: "Nao localizado",
        sourceUrl,
        collectedAt: nowIso(),
        notes: "Fornecedor nao retornado no cadastro ativo de fornecedores do Compras.gov.br.",
        raw: data,
      };
    }

    return {
      source: "Compras.gov.br Dados Abertos",
      status: "Consultado",
      sourceUrl,
      collectedAt: nowIso(),
      enabledToBid: supplier.habilitadoLicitar,
      legalName: supplier.nomeRazaoSocialFornecedor,
      cnae: supplier.nomeCnae || (supplier.codigoCnae ? String(supplier.codigoCnae) : undefined),
      legalNature: supplier.naturezaJuridicaNome,
      size: supplier.porteEmpresaNome,
      city: supplier.nomeMunicipio,
      state: supplier.ufSigla,
      raw: data,
    };
  } catch (caught) {
    return {
      source: "Compras.gov.br Dados Abertos",
      status: "Indisponivel",
      sourceUrl,
      collectedAt: nowIso(),
      notes: caught instanceof Error ? caught.message : "Falha ao consultar Compras.gov.br Dados Abertos.",
    };
  }
}

async function fetchPortalContractsFromProxy(cnpj: string, proxyBaseUrl: string): Promise<PublicContract[]> {
  const baseUrl = proxyBaseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/api/portal-transparencia/contracts/${onlyDigits(cnpj)}?maxPages=${MAX_PORTAL_PAGES}`;
  const data = await fetchJsonWithTimeout<{ contracts?: PortalContratoResponse[] }>(url, "Proxy Portal da Transparencia");
  return (data.contracts || []).map(mapPortalContract);
}

async function fetchPortalContractsDirect(cnpj: string, apiKey: string): Promise<PublicContract[]> {
  const contracts: PublicContract[] = [];

  for (let page = 1; page <= MAX_PORTAL_PAGES; page += 1) {
    const url = endpointWithParams(PORTAL_CONTRATOS_ENDPOINT, {
      cpfCnpj: onlyDigits(cnpj),
      pagina: page,
    });
    const data = await fetchJsonWithTimeout<PortalContratoResponse[]>(url, "Portal da Transparencia", {
      headers: { "chave-api-dados": apiKey },
    });

    if (!data.length) break;
    contracts.push(...data.map(mapPortalContract));
  }

  return contracts;
}

function uniqueContracts(contracts: PublicContract[]): PublicContract[] {
  const seen = new Set<string>();
  return contracts.filter((contract) => {
    const key = [contract.source, contract.number, contract.process, contract.agency, contract.object].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarize(
  cnpj: string,
  contracts: PublicContract[],
  supplierRegistry: SupplierRegistry | undefined,
  status: ContractIntelligence["status"],
  source: ContractIntelligence["source"],
  notes: string[],
): ContractIntelligence {
  const unique = uniqueContracts(contracts);
  return {
    cnpj: onlyDigits(cnpj),
    collectedAt: nowIso(),
    source,
    status: unique.length ? "Consultado" : status,
    totalContracts: unique.length,
    activeContracts: unique.filter(isActiveContract).length,
    totalInitialValue: unique.reduce((total, contract) => total + (contract.initialValue || 0), 0),
    totalFinalValue: unique.reduce((total, contract) => total + (contract.finalValue || contract.initialValue || 0), 0),
    contracts: unique,
    supplierRegistry,
    portalTransparencyUrl: `https://portaldatransparencia.gov.br/contratos/consulta?termo=${onlyDigits(cnpj)}`,
    pncpSearchUrl: `https://pncp.gov.br/app/contratos?pagina=1&q=${onlyDigits(cnpj)}&status=todos`,
    notes,
  };
}

export async function fetchContractIntelligence(
  cnpj: string,
  options: PublicContractsOptions = {},
): Promise<ContractIntelligence> {
  const supplierRegistry = await fetchSupplierRegistry(cnpj, options.proxyBaseUrl);
  const notes: string[] = [
    "Contratos federais por fornecedor dependem do endpoint CPF/CNPJ do Portal da Transparencia.",
    "PNCP e Compras.gov podem divergir por data de publicacao, orgao integrador e obrigatoriedade legal.",
  ];

  if (options.proxyBaseUrl) {
    try {
      const contracts = await fetchPortalContractsFromProxy(cnpj, options.proxyBaseUrl);
      return summarize(cnpj, contracts, supplierRegistry, contracts.length ? "Consultado" : "Sem resultado", "NexoTrace Proxy", notes);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Proxy de contratos indisponivel.";
      notes.push(message);
      const status = message.includes("PORTAL_TRANSPARENCIA_API_KEY") || message.includes("HTTP 503")
        ? "Requer chave"
        : "Indisponivel";
      return summarize(cnpj, [], supplierRegistry, status, "NexoTrace Proxy", notes);
    }
  }

  if (options.portalApiKey) {
    try {
      const contracts = await fetchPortalContractsDirect(cnpj, options.portalApiKey);
      return summarize(
        cnpj,
        contracts,
        supplierRegistry,
        contracts.length ? "Consultado" : "Sem resultado",
        "Portal da Transparencia",
        notes,
      );
    } catch (caught) {
      notes.push(
        caught instanceof Error
          ? caught.message
          : "Falha na consulta direta ao Portal da Transparencia. Verifique chave, CORS ou limite de uso.",
      );
      return summarize(cnpj, [], supplierRegistry, "Indisponivel", "Portal da Transparencia", notes);
    }
  }

  notes.push("Configure uma chave da API de Dados da CGU ou um proxy Render para coletar contratos automaticamente.");
  return summarize(cnpj, [], supplierRegistry, "Requer chave", "Portal da Transparencia", notes);
}
