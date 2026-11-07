# Extrator NFS-e — Extensão Manifest V3 (Painel Municipal)

Extensão para navegadores baseados em Chromium (**Google Chrome**, **Microsoft Edge**, **Brave**) que automatiza a varredura de páginas, a **filtragem por Data de Emissão**, o download em lote de arquivos **XML** e **PDF (DANFSe)** e a geração de uma **Planilha Resumo (`.csv` compatível com Excel)** no **Painel Municipal da NFS-e** (`https://www.nfse.gov.br/PainelMunicipal/NFSe/Consulta`).

---

## Principais Funcionalidades

1. **Redirecionamento e Escopo Exclusivo (`/PainelMunicipal`):**
   - Ao clicar no ícone da extensão na barra do navegador, abre diretamente `https://www.nfse.gov.br/PainelMunicipal/NFSe/Consulta` (ou alterna o painel flutuante caso você já esteja na página).
   - Opera sobre a sessão autenticada do usuário (`{ credentials: 'include' }`).
2. **Filtro de Período por Data de Emissão (`De` / `Até`) com Parada Inteligente (*Early Stop*):**
   - **Campo "De" (Data Inicial):** Inicia por padrão em **`"Desde sempre"`** (sem limite inicial). Ao clicar na caixa, abre o seletor de calendário (`<input type="date">`) com botão rápido (`×`) para retornar a `"Desde sempre"`.
   - **Campo "Até" (Data Final):** Preenchido automaticamente com a **data de hoje** (`YYYY-MM-DD` no fuso local), editável via calendário.
   - **Parada Inteligente:** Quando uma Data Inicial (**"De"**) é informada e uma página inteira da tabela só contém notas anteriores a essa data, a paginação para automaticamente e inicia os downloads na hora.
3. **Nomeação Dinâmica por CPF/CNPJ (`NFSe_CPF-CNPJ_Data`):**
   - Detecta automaticamente o CPF ou CNPJ consultado no filtro da página, URL ou tabela e sugere o nome `NFSe_{CPF_OU_CNPJ}_{DATA_ATUAL}` em um campo totalmente editável antes do download.
4. **Compactação Recomendada em `.ZIP` e Performance Otimizada:**
   - Opção destacada **`📦 Compactar tudo em .ZIP [Recomendado: evita bloqueio pelo navegador]`** marcada por padrão.
   - Padrão de alta velocidade testado: **Intervalo de `100 ms`** e **Fila Simultânea `2x (Paralelo Moderado)`**.
   - Extrai 37 colunas fiscais do XML SPED v1.01 para `resumo_notas.csv` (UTF-8 BOM + `;`).

---

## Estrutura do Diretório

```text
extrator_NFSe/
├── manifest.json               # Configuração Chrome Extension Manifest V3
├── lib/
│   └── jszip.min.js            # JSZip v3.10.1 local para compactação em memória
├── src/
│   ├── content/
│   │   ├── xmlParser.js        # Parser XML SPED v1.01 e gerador de CSV/Excel (UTF-8 BOM)
│   │   ├── scraper.js          # Varredura da tabela DOM, Early Stop e paginação via DOMParser
│   │   ├── downloader.js       # Fila com rate-limit, retry, validação %PDF/XML e JSZip
│   │   └── content.js          # Orquestrador principal e injeção do painel flutuante
│   ├── ui/
│   │   └── panel.css           # Estilização isolada do painel flutuante
│   └── background/
│       └── service-worker.js   # Atalho na barra do navegador e estado inicial
└── README.md
```

---

## Como Instalar / Recarregar no Chrome ou Edge

1. Acesse `chrome://extensions/` (ou `edge://extensions/`).
2. Ative o **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
3. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a pasta:
   `d:\My Files\SEFIN\extrator_NFSe`
