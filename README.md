# 📊 Suíte NFS-e Nacional: Extrator em Lote (Extensão) & Compilador Fiscal (`XML` $\rightarrow$ `Excel Dinâmico`)

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Extens%C3%A3o_Navegador-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![OpenPyXL](https://img.shields.io/badge/Excel-OpenPyXL-217346?style=for-the-badge&logo=microsoft-excel&logoColor=white)
![SPED NFS-e](https://img.shields.io/badge/Padr%C3%A3o_SPED-NFS--e_v1.01-1F4E79?style=for-the-badge)
![License](https://img.shields.io/badge/Licen%C3%A7a-MIT-green?style=for-the-badge)

[![Baixar Executável Windows](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_BAIXAR_COMPILADOR_(WINDOWS)-Compilador__NFSe.exe-1B6B53?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/icaro-arch/compilador_NFSe/raw/main/Compilador_NFSe.exe)
[![Ver Extensão Extrator NFS-e](https://img.shields.io/badge/%F0%9F%A7%A9_EXTENS%C3%83O_DE_NAVEGADOR-extrator__NFSe-0F3566?style=for-the-badge&logo=googlechrome&logoColor=white)](./extrator_NFSe)

Solução ponta a ponta para **coleta automatizada em lote** e **auditoria fiscal/contábil** de **Notas Fiscais de Serviços Eletrônicas (NFS-e)** no **Padrão Nacional SPED (`nfse.gov.br`)**, composta por dois módulos integrados:

1. **🧩 [`extrator_NFSe/`](./extrator_NFSe) (Extensão de Navegador — Manifest V3):** Automatiza a paginação, a filtragem por **Data de Emissão** e o download em lote de arquivos **XML**, **PDF (DANFSe)** e **Planilha Resumo (`.csv`)** em um único pacote `.zip` diretamente no **Painel Municipal da NFS-e** (`nfse.gov.br/PainelMunicipal/NFSe/Consulta`).
2. **📊 [`Compilador_NFSe.exe`](https://github.com/icaro-arch/compilador_NFSe/raw/main/Compilador_NFSe.exe) / [`compilar_nfse.py`](compilar_nfse.py) (Aplicação Desktop Python):** Lê lotes de arquivos `.xml` (inclusive os baixados pelo Extrator) ou exportações `.csv` do ADN e gera pastas de trabalho **Excel (`.xlsx`)** executivas com **4 abas**, **70 colunas organizadas em 7 blocos** e **somas 100% dinâmicas sob filtro (`SUBTOTAL`)**.

---

## 🏗️ Fluxo Integrado (Ponta a Ponta)

```mermaid
flowchart LR
    subgraph Portal["1. Coleta no Portal (extrator_NFSe)"]
        P1["Painel Municipal\n(Sessão Autenticada)"] --> P2["Filtro por Data de Emissão\n+ Paginação Automática"]
        P2 --> P3["Pacote NFSe_CNPJ_Data.zip\n(/xml, /pdf e resumo_notas.csv)"]
    end

    subgraph Compilador["2. Auditoria Avançada (Compilador_NFSe)"]
        P3 --> A["Auto-Scan & Parser XML\n(UTF-8 / CP1252)"]
        A --> C["Motor Fiscal & Contábil\n(ISSQN, Federais, IBS/CBS, Duplicatas)"]
        C --> D["Planilha Executiva (.xlsx)\n(4 Abas + SUBTOTAL Dinâmico)"]
    end
```

---

## 🧩 Módulo 1: Extrator NFS-e (`extrator_NFSe/`) — Extensão de Navegador

O Portal da NFS-e não possui função nativa para baixar todas as notas de um período de uma só vez. A extensão **Extrator NFS-e** injeta um painel flutuante em `https://www.nfse.gov.br/PainelMunicipal/NFSe/Consulta` para realizar a coleta em lote sem precisar clicar nota por nota.

### Principais Recursos do Extrator:
- **Autenticação Transparente (`Session Inheritance`):** Reaproveita sua sessão já logada (Certificado Digital A1/A3 ou Gov.br) sem nunca solicitar senhas ou chaves privadas.
- **Filtro por Data de Emissão com Parada Inteligente (*Early Stop*):**
  - Campo **"De" (Data Inicial):** Inicia em `"Desde sempre"` e permite escolher uma data específica no calendário (com botão `×` para limpar).
  - Campo **"Até" (Data Final):** Preenchido automaticamente com a data de hoje.
  - **Early Stop:** Como o portal não tem filtro nativo de data na listagem, a extensão lê a coluna de Data de Emissão linha a linha e **interrompe a paginação automaticamente** assim que alcança páginas anteriores à data inicial escolhida.
- **Nomeação Automática por CPF/CNPJ:** Detecta o CPF/CNPJ consultado na página e sugere automaticamente `NFSe_{CPF_OU_CNPJ}_{DATA}` em um campo editável.
- **Alta Velocidade & Compactação `.ZIP` em Memória:** Fila paralela otimizada (`2x` simultâneos com intervalo de `100 ms` e *retry* automático) que empacota `/xml`, `/pdf` e `resumo_notas.csv` em um único download `.zip`.

### Como Instalar a Extensão no Chrome / Edge / Brave:
1. Baixe ou clone este repositório no seu computador.
2. No navegador, acesse `chrome://extensions/` (ou `edge://extensions/`).
3. Ative a chave **Modo do desenvolvedor** (*Developer mode*) no canto superior direito.
4. Clique em **Carregar sem compactação** (*Load unpacked*) e selecione a pasta [`extrator_NFSe`](./extrator_NFSe).
5. Clique no ícone da extensão na barra do navegador para abrir diretamente `https://www.nfse.gov.br/PainelMunicipal/NFSe/Consulta`.

---

## 🚀 Módulo 2: Compilador de NFS-e (`Compilador_NFSe.exe`) — Pronto para Uso

Para gerar a auditoria fiscal completa em Excel (`.xlsx`) a partir dos XMLs baixados no Windows, **não é necessário instalar Python nem nenhuma biblioteca**:

### Passo a Passo Rápido:
1. **Baixe o programa:** Clique no link direto abaixo para baixar o executável:
   - 👉 **[📥 Clique aqui para baixar o `Compilador_NFSe.exe`](https://github.com/icaro-arch/compilador_NFSe/raw/main/Compilador_NFSe.exe)**
2. **Abra o aplicativo:** Dê dois cliques no arquivo `Compilador_NFSe.exe` baixado *(caso o Windows exiba o aviso padrão do SmartScreen, clique em "Mais informações" → "Executar assim mesmo")*.
3. **Escolha a pasta de XMLs ou o arquivo `.CSV` (ADN):** Clique em **"Procurar Pasta..."** (para selecionar a pasta `xml/` extraída do `.zip` ou qualquer pasta com notas em `.xml`) ou em **"Selecionar CSV / XML..."** (para selecionar um arquivo `.csv` exportado do Ambiente de Dados Nacional — ADN com XMLs embutidos).
   - O programa fará a leitura instantânea das notas e **sugerirá automaticamente o nome do arquivo Excel** com base na empresa e competência identificadas.
4. **Gere a planilha:** Clique no botão verde **"▶ COMPILAR NOTAS E GERAR EXCEL"** e, em seguida, em **"📊 Abrir Planilha no Excel"**.

---

## 🎯 Principais Diferenciais do Compilador Excel

- **Interface Gráfica (`Tkinter`) com Pré-Leitura Inteligente (Auto-Scan):**
  - Ao selecionar uma pasta com arquivos `.xml`, o sistema inspeciona automaticamente o lote em milissegundos, exibindo em cards de diagnóstico:
    - Quantidade de notas fiscais válidas;
    - Empresa principal identificada (Tomador ou Prestador predominante);
    - Número de fornecedores distintos e período de competência;
    - Valor bruto total dos serviços.
  - **Sugestão Automática de Nome:** Preenche automaticamente o nome ideal para a planilha `.xlsx` com base na empresa ou no diretório analisado.
- **Somas e Contagens Dinâmicas Reativas a Filtros (`SUBTOTAL`):**
  - Diferente de planilhas estáticas que usam `=SUM(...)`, todas as **15 colunas financeiras e tributárias** utilizam `=SUBTOTAL(109, ...)` e `=SUBTOTAL(103, ...)`.
  - Ao filtrar qualquer critério no Excel (ex.: *Tipo Retenção ISS = `2 - Retido na Fonte`*, *Retenção INSS*, *Fornecedor*, *Município*, *Competência* ou *Obra*), **todas as somas de ISSQN, INSS, IRRF, CSLL, PIS, COFINS, IBS, CBS, Valor Bruto e Valor Líquido recalculam instantaneamente** considerando apenas as notas filtradas.
- **Reorganização Funcional de 70 Colunas + Grupos Retráteis (`+` / `-`):**
  - As colunas críticas para conferência fiscal e financeira ficam visíveis logo na abertura, enquanto dados cadastrais extensos (endereços, CEPs, telefones, e-mails e chaves de acesso) ficam agrupados com recurso nativo de *Outline Grouping* do Excel.
- **Blindagem de Codificação e Higienização (`UTF-8` / `CP1252`):**
  - Tratamento automático contra *mojibake* e caracteres de controle inválidos, garantindo acentuação impecável em todos os campos.

---

## 📑 Estrutura da Planilha Gerada (4 Abas)

| Aba | Conteúdo e Funcionalidades |
| :--- | :--- |
| **1. `Resumo Financeiro Consolidado`** | Dashboard executivo com KPIs do lote, Demonstrativo Financeiro vinculado por fórmulas dinâmicas (`SUM`, `SUMIF`, `COUNTIF`), apuração da Reforma Tributária (**IBS / CBS**) e ranking **Top 10 Maiores Fornecedores**. |
| **2. `Notas Fiscais`** | Base analítica com **70 colunas** divididas em **7 blocos funcionais coloridos**, painel congelado (`D2`), destaque visual condicional para retenções na fonte e linha de **Total Filtrado** com `=SUBTOTAL(109, ...)`. |
| **3. `Resumo por Fornecedor`** | Consolidação por prestador de serviço com quebra explícita entre **ISSQN Retido na Fonte** vs. **ISSQN Não Retido**, retenções federais (`INSS`, `IRRF`, `CSLL`, `PIS`, `COFINS`), total retido e líquido a pagar. |
| **4. `Resumo por Município`** | Consolidação geográfica por município de execução do serviço, separando ISSQN retido, não retido e retenções federais com subtotais dinâmicos. |

### Organização dos 7 Blocos da Aba `Notas Fiscais`
1. **Identificação Essencial (`#1F4E79`):** `Número NFS-e`, `Competência`, `Razão Social Prestador`, `CNPJ Prestador`, `Data Emissão DPS`, `Status Duplicidade`, `Status (cStat)`.
2. **Enquadramento e Local (`#2F5597`):** `Regime Tributário (Simples Nacional)`, `Regime Especial`, `Município Prestação`, `Município Incidência`, `Cód. Obra`.
3. **Valores e ISS / ISSQN (`#1B6B53`):** `Tipo Retenção ISS`, `Valor Serviços (R$)`, `Deduções/Reduções (R$)`, `Desconto Incond. (R$)`, `Base Cálculo ISS (R$)`, `Alíquota ISS (%)`, `Valor ISSQN (R$)`.
4. **Retenções Federais e Valor Líquido (`#833C0C`):** `Retenções Federais Aplicadas` (filtro rápido), `Retenção INSS`, `Retenção IRRF`, `Retenção CSLL`, `Valor PIS`, `Valor COFINS`, `Total Retenções (R$)`, `Valor Líquido (R$)` *(+ detalhes de CST, Base e Alíquotas recolhíveis)*.
5. **Reforma Tributária — Novo SPED (`#4A3B7C`):** `IBS Alíquota UF (%)`, `IBS Alíquota Mun (%)`, `CBS Alíquota (%)`, `IBS Total (R$)`, `CBS Total (R$)`.
6. **Detalhamento do Serviço e Obra (`#2B5868`):** `Discriminação dos Serviços`, códigos e descrições de tributação nacional/municipal/NBS, informações complementares e endereço da obra.
7. **Cadastros Auxiliares e Chaves (`#4A5568` — Recolhível `+`/`-`):** Dados cadastrais completos do prestador e do tomador, códigos IBGE, números DFSe/DPS, chave de 50 dígitos e nome do arquivo XML.

---

## 🛠️ Para Desenvolvedores (Execução via Código-Fonte Python)

Caso deseje modificar o código-fonte ([`compilar_nfse.py`](compilar_nfse.py)) ou executar diretamente pelo Python:

### 1. Instalar dependências
```bash
pip install -r requirements.txt
```

### 2. Executar a Interface Gráfica via Python
```bash
python compilar_nfse.py
```

### 3. Executar via Linha de Comando (CLI / Automação)
```bash
python compilar_nfse.py --cli --input "examples" --output "demonstracao_nfse.xlsx"
```

### 4. Recompilar o Executável (`.exe`) após alterações no código
```bash
pip install pyinstaller
python -m PyInstaller --noconfirm --onefile --windowed --name "Compilador_NFSe" --distpath "." compilar_nfse.py
```

---

## 🔒 Privacidade e Sigilo Fiscal (`.gitignore`)

Este repositório está configurado por padrão para **ignorar qualquer arquivo `.xml` real, pastas de lotes fiscais e planilhas `.xlsx`/`.csv` geradas**, garantindo que nenhum dado sensível de contribuintes seja versionado acidentalmente. Apenas o arquivo fictício em [`examples/exemplo_nfse_nacional.xml`](examples/exemplo_nfse_nacional.xml) é incluído para fins de demonstração.

---

## 👤 Autor

Desenvolvido por **Icaro** ([`@icaro-arch`](https://github.com/icaro-arch)).
