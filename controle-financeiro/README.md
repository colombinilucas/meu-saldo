# Meu Saldo: controle financeiro (PWA)

Aplicativo pessoal para controlar salário, gastos e documentos do mês.
Funciona no celular e no computador, inclusive sem internet.

## Privacidade
- Todos os dados ficam **apenas no aparelho** onde você usa o app (no armazenamento do navegador).
- Nada é enviado para a internet. Não há login nem nuvem.
- Os dados **não passam sozinhos** de um aparelho para outro: use **Backup → Exportar** num aparelho e **Importar** no outro.
- Se você apagar os dados do navegador, os dados do app podem ser apagados. **Faça backups com frequência.**

## Arquivos do projeto
- `README.md`: este arquivo de explicação.
- `index.html`: a página do app (a "casca" da tela).
- `css/style.css`: a aparência (cores, tamanhos, celular e computador).
- `js/util.js`: funções de apoio (reais, datas no padrão brasileiro).
- `js/db.js`: o banco de dados local do navegador (IndexedDB), que guarda tudo neste aparelho.
- `js/app.js`: as telas e as ações (salário, gastos, categorias, contas fixas, limites, resumo e histórico).
- `js/charts.js`: os gráficos (rosca por categoria e barras dos últimos 6 meses).
- `js/docs.js`: documentos anexados (contracheques, extratos e comprovantes em PDF, JPG ou PNG).
- `js/cofre.js`: o cofre com objetivos (guardar e retirar dinheiro de cada objetivo).
- `js/zip.js` e `js/backup.js`: o backup (um arquivo .zip com dados e documentos) e a importação com conferência.
- `js/extrato-pdf.js`: leitura do extrato do Itaú em PDF.
- `vendor/pdfjs/`: biblioteca PDF.js (Mozilla) usada para ler PDFs no aparelho.
- `js/ofx.js`: importação do extrato do banco em formato OFX (Itaú e outros), com revisão antes de lançar.
- `manifest.json`: nome, cores e ícones usados na instalação.
- `service-worker.js`: guarda os arquivos do app para ele abrir sem internet. Não guarda seus dados nem documentos.
- `icons/`: ícones do app.

## Saldo entre meses
O Início mostra o **saldo disponível**: o que sobrou (ou faltou) nos meses anteriores + o que entrou − o que saiu no mês.
Para cada mês começar do zero: **Ajustes → Saldo entre meses** (desligar).

## Limites
**Resumo → Limites do mês → Definir limites**: um valor por categoria. O Início mostra quanto já foi usado.

## Gráficos
Resumo: rosca por categoria, linha de gastos (por dia, semana ou mês) com médias, barras dos últimos 6 meses (com valores) e tabela do ano.

## Compras parceladas
No **+ Gasto**, marque **Compra parcelada**, informe o número de parcelas e se o valor é de cada parcela ou o total.
O app lança uma parcela por mês (ex.: "Celular (1/12)"). No Início aparece o card **Parcelas** com quanto falta.
Para apagar uma compra inteira: abra uma parcela → **Excluir as N parcelas**.

## Importar extrato (PDF do Itaú ou OFX)
Aba **Gastos → Importar extrato do banco**. Aceita o **PDF do extrato de conta corrente do Itaú** e arquivos **OFX**.
O PDF é lido no próprio aparelho com a biblioteca PDF.js (pasta `vendor/pdfjs`, licença Apache 2.0). Nada é enviado.
Para apagar o que veio de um extrato: **Gastos → Extratos importados → Desfazer** (ou em Ajustes).
O app confere os lançamentos com o saldo do extrato e mostra "Conferido" quando bate.
Compras estornadas vêm desmarcadas. A leitura de PDF funciona no app publicado (não abrindo o index.html direto).

### Detalhes do OFX
Aba **Gastos → Importar extrato do banco (OFX)**. No Itaú (internet banking): **Extrato → período → Salvar em outros formatos → OFX**.
O app mostra as movimentações, sugere categorias e lembra suas escolhas. Movimentações já importadas não entram de novo.
Aplicações/resgates e valores iguais a gastos já lançados no mesmo dia vêm desmarcados para você conferir.

## Tabela do ano
Aba **Resumo → Tabela do ano**: toque num mês para ver receitas, gastos por categoria, cada gasto e o cofre.
**Baixar planilha (CSV)** gera um arquivo que abre no Excel.

## Backup e outros aparelhos
Os dados **não passam sozinhos** de um aparelho para outro. Em **Ajustes → Backup**:
1. No aparelho de origem: **Baixar backup** (gera `meu-salario-backup-AAAA-MM-DD.zip`).
2. Leve o arquivo para o outro aparelho (e-mail para você mesmo, cabo USB, Google Drive pessoal…).
3. No outro aparelho: **Importar backup**, escolha o arquivo, confira o resumo e escolha **Juntar** ou **Substituir tudo**.

O backup tem seus documentos financeiros: guarde-o em local privado.

## Sem internet e instalação
Funciona depois que o app for publicado num endereço `https://` e aberto uma vez com internet.
Aberto direto do arquivo (`index.html`), ele serve só para testes e não pode ser instalado.

## Como a sobra do mês é calculada
Sobra = Recebido − Gasto − Guardado no cofre. Retirar do cofre devolve o valor para a sobra do mês da retirada.

## Como abrir no computador
Dê dois cliques em `index.html` (ou clique com o botão direito → Abrir com → Google Chrome / Microsoft Edge).

## Dados de exemplo
Em **Ajustes → Dados de exemplo → Carregar exemplos**. Para tirar: **Remover exemplos**. Seus próprios lançamentos não são afetados.

## Publicação (Netlify)
Endereço: https://meu-salario-lucas.netlify.app (deixe como **Public**; seus dados não ficam lá).
Para atualizar: no painel do projeto no Netlify, use **Drop new files** e arraste a pasta `controle-financeiro` inteira.
Depois, feche e abra o app (com internet) nos aparelhos para pegar a versão nova.
