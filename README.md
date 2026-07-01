# NexoTrace 360

Plataforma web estática para inteligência cadastral, investigação OSINT e due diligence com evidência rastreável.

## O que está pronto

- Consulta CNPJ real por API pública.
- Validação de CPF sem consulta externa indiscriminada.
- Dossiê com dados cadastrais, quadro societário, CNAE, capital social e endereço.
- Evidências com fonte, horário, status, confiança e hash SHA-256.
- Score de risco explicável baseado apenas no que foi efetivamente coletado.
- Auditoria local das consultas e exportações.
- Links de verificação para fontes oficiais e complementares.
- Exportação JSON e relatório para PDF via impressão do navegador.

## Limites legais implementados

O módulo CPF é restrito por desenho. Ele valida o documento, exige finalidade, base legal, justificativa e perfil autorizado, mas não busca endereço, telefone, bens, crédito, familiares, dados vazados ou dados sensíveis. Informações adicionais devem ser anexadas manualmente apenas quando houver fonte, autorização ou base legal documentada.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

O build estático fica em `dist/` e pode ser publicado em GitHub Pages, Render Static Site, Netlify ou qualquer hospedagem de arquivos estáticos.

## Fonte CNPJ padrão

A primeira versão usa a BrasilAPI para consulta CNPJ pública:

`https://brasilapi.com.br/api/cnpj/v1/{cnpj}`

Fontes que exigem chave, captcha, contrato ou autenticação são tratadas como links de verificação ou conectores pendentes, sem simular resultados.
