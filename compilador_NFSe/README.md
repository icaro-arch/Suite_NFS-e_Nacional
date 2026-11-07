# 📊 Compilador de NFS-e Nacional (`XML` $\rightarrow$ `Excel Dinâmico`)

[![Baixar Executável Windows](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_BAIXAR_APLICATIVO_(WINDOWS)-Compilador__NFSe.exe-1B6B53?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/icaro-arch/compilador_NFSe/raw/main/compilador_NFSe/Compilador_NFSe.exe)

Aplicação desktop em Python para leitura, auditoria fiscal e consolidação de lotes de **Notas Fiscais de Serviços Eletrônicas (NFS-e)** emitidas no **Padrão Nacional SPED (`nfse.gov.br`)**, gerando pastas de trabalho **Excel (`.xlsx`)** estruturadas com **somas e contagens 100% dinâmicas sob filtro (`SUBTOTAL`)**, agrupamento funcional de 70 colunas e demonstrativos executivos.

---

## 🚀 Como Utilizar no Windows (Sem Instalar Python)

1. **[📥 Baixe o `Compilador_NFSe.exe`](https://github.com/icaro-arch/compilador_NFSe/raw/main/compilador_NFSe/Compilador_NFSe.exe)** e dê dois cliques para abrir.
2. Clique em **"Procurar Pasta..."** para selecionar uma pasta contendo arquivos `.xml` (como a pasta `xml/` extraída do [Extrator NFS-e](../extrator_NFSe)) ou clique em **"Selecionar CSV / XML..."** para carregar um `.csv` do ADN.
3. Clique em **"▶ COMPILAR NOTAS E GERAR EXCEL"**.

---

## 🛠️ Execução via Código-Fonte Python

```bash
cd compilador_NFSe
pip install -r requirements.txt
python compilar_nfse.py
```

Para executar via CLI:
```bash
python compilar_nfse.py --cli --input "examples" --output "demonstracao_nfse.xlsx"
```
