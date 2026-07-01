import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 4173);
const DIST_DIR = join(process.cwd(), "dist");
const PORTAL_ENDPOINT = "https://api.portaldatransparencia.gov.br/api-de-dados/contratos/cpf-cnpj";
const COMPRAS_FORNECEDOR_ENDPOINT =
  "https://dadosabertos.compras.gov.br/modulo-fornecedor/1_consultarFornecedor";
const MAX_PAGES = 8;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

async function fetchPortalContracts(cnpj, maxPages) {
  const apiKey = process.env.PORTAL_TRANSPARENCIA_API_KEY;
  if (!apiKey) {
    const error = new Error("PORTAL_TRANSPARENCIA_API_KEY nao configurada no Render.");
    error.statusCode = 503;
    throw error;
  }

  const contracts = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(PORTAL_ENDPOINT);
    url.searchParams.set("cpfCnpj", cnpj);
    url.searchParams.set("pagina", String(page));

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "chave-api-dados": apiKey,
      },
    });

    if (!response.ok) {
      const error = new Error(`Portal da Transparencia respondeu HTTP ${response.status}.`);
      error.statusCode = response.status;
      throw error;
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) break;
    contracts.push(...data);
  }

  return contracts;
}

async function fetchComprasSupplier(cnpj) {
  const url = new URL(COMPRAS_FORNECEDOR_ENDPOINT);
  url.searchParams.set("cnpj", cnpj);
  url.searchParams.set("ativo", "true");
  url.searchParams.set("pagina", "1");
  url.searchParams.set("tamanhoPagina", "10");

  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    const error = new Error(`Compras.gov.br respondeu HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return response.json();
}

async function handleApi(request, response, url) {
  const portalMatch = url.pathname.match(/^\/api\/portal-transparencia\/contracts\/(\d{14})$/);
  const comprasMatch = url.pathname.match(/^\/api\/compras-gov\/fornecedor\/(\d{14})$/);
  if (!portalMatch && !comprasMatch) {
    sendJson(response, 404, { error: "Endpoint nao encontrado." });
    return true;
  }

  try {
    if (comprasMatch) {
      const cnpj = digitsOnly(comprasMatch[1]);
      const supplier = await fetchComprasSupplier(cnpj);
      sendJson(response, 200, supplier);
      return true;
    }

    const cnpj = digitsOnly(portalMatch[1]);
    const maxPages = Math.min(Number(url.searchParams.get("maxPages") || MAX_PAGES), MAX_PAGES);
    const contracts = await fetchPortalContracts(cnpj, maxPages);
    sendJson(response, 200, { cnpj, pagesLimit: maxPages, contracts });
  } catch (caught) {
    sendJson(response, caught.statusCode || 500, {
      error: caught instanceof Error ? caught.message : "Falha ao consultar contratos.",
    });
  }

  return true;
}

async function serveStatic(request, response, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const filePath = join(DIST_DIR, safePath);

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": requested === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    response.end(content);
  } catch {
    const fallback = await readFile(join(DIST_DIR, "index.html"));
    response.writeHead(200, {
      "content-type": contentTypes[".html"],
      "cache-control": "no-cache",
    });
    response.end(fallback);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  await serveStatic(request, response, url);
});

server.listen(PORT, () => {
  console.log(`NexoTrace 360 listening on ${PORT}`);
});
