# Deploy

## GitHub Pages

Este repositorio ja inclui `.github/workflows/pages.yml`. Depois de enviar para o GitHub:

1. Abra `Settings > Pages`.
2. Em `Build and deployment`, selecione `GitHub Actions`.
3. Rode o workflow `Deploy GitHub Pages` ou faca push na branch `main`.

## Render

O arquivo `render.yaml` publica o projeto como Static Site.

Build command:

```bash
pnpm install --frozen-lockfile && pnpm build
```

Publish directory:

```bash
dist
```

## Observacao operacional

A aplicacao e estatica. Dossies, auditoria e configuracoes ficam no `localStorage` do navegador do usuario. Para uso multiusuario, banco de dados, MFA, API propria e logs imutaveis devem entrar em uma fase backend.
