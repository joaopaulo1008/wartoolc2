# Revisão de custos — Etapa 11

Comparação entre o que `docs/Plano_WartoolC2.docx` (seção 5, "Estimativa de custos") previa e o que foi de fato decidido/implementado nesta etapa. Nenhum valor do plano original precisou de correção — só uma peça mudou (hospedagem do frontend), e o efeito é neutro no custo.

## O que o plano previa

| Item | Opção recomendada no plano | Custo aproximado |
|---|---|---|
| Hospedagem do frontend | Vercel/Netlify (plano gratuito) | R$ 0/mês |
| Backend + banco (tempo real) | Supabase Free (até 200 conexões simultâneas); migrar para Pro quando passar disso | R$ 0/mês no início; ≈ R$ 135-150/mês no Pro |
| Mapa base | OpenStreetMap + Esri (gratuitos); Mapbox opcional | R$ 0/mês na prática |
| Domínio próprio | Registro.br ou similar | ≈ R$ 40-60/ano (≈ R$ 3-5/mês) |
| Certificado HTTPS | Incluso na hospedagem | R$ 0 |

Estimativa do plano: **R$ 0 a R$ 10/mês** na fase de testes; **R$ 140 a R$ 190/mês** com +60 usuários simultâneos (Supabase Pro + domínio) — dentro do teto de R$ 200, sem muita margem.

## O que mudou nesta etapa, e por quê

**Hospedagem do frontend: GitHub Pages no lugar de Vercel/Netlify.** Custo igual — R$ 0/mês nos dois casos, os dois têm HTTPS automático — mas a razão da troca não foi custo, foi a decisão do item 1 do `docs/prompt-etapa-11.md`: como `frontend/config.js` passou a ser **commitado** (a `SUPABASE_ANON_KEY` é uma *publishable key*, pública por design — RLS é quem barra, não a chave), o site não precisa de etapa de build nem de variável de ambiente do host para montar a configuração. Isso elimina justamente a vantagem que faria Vercel/Netlify valerem a complexidade extra (build, *previews* por branch) — sem bundler até a Etapa 9, GitHub Pages entrega o mesmo resultado com menos partes móveis, e o repositório já está no GitHub. Se a Etapa 9 (SPA com bundler) tornar um passo de build necessário por outro motivo, vale reconsiderar Vercel/Netlify então — não agora.

**Backend (Supabase): sem mudança.** Continua no plano Free, como o plano original previa para a fase de testes. Nada na Etapa 11 aumenta uso de banco/Realtime/Storage — só o frontend passou a ser servido de outro lugar.

**Domínio: não comprado nesta etapa.** O plano original já tratava isso como opcional (≈ R$ 3-5/mês). Manteve-se o subdomínio gratuito do GitHub Pages (`https://joaopaulo1008.github.io/wartoolc2/`) para não gastar antes de confirmar, no teste de campo, que o resto funciona. Continua uma troca simples e reversível quando/se decidido: apontar um CNAME e adicionar um arquivo `CNAME` na raiz do repositório — nenhum código depende do domínio.

**Egress do plano Free do Supabase, revisitado por causa de GitHub Pages.** A conta de egress da Etapa 7 (2 MB por calco × 60 alunos × 3 calcos × ~5 recargas ≈ 1,8 GB/exercício, contra 5 GB/mês do Free) não muda: calcos continuam vindo do Storage do Supabase, não do GitHub Pages. O que passou a vir do GitHub Pages é `data/*.geojson` (antes vinha de `raw.githubusercontent.com`, fora da conta de egress do Supabase de qualquer jeito) — sem efeito na conta.

## Estimativa atual de total mensal

Sem mudança em relação ao plano original:

- **Fase de testes (agora):** R$ 0/mês — GitHub Pages grátis, Supabase Free, sem domínio próprio.
- **Fase de uso real com +60 usuários simultâneos:** R$ 135-150/mês (Supabase Pro) + domínio opcional (R$ 3-5/mês) = ainda dentro do teto de R$ 200/mês, com a mesma margem apertada já registrada no plano original. A Etapa 10 (teste de carga) é quem vai dizer se e quando migrar para o Pro é necessário — nada nesta etapa antecipa essa decisão.
