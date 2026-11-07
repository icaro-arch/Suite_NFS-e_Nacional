/**
 * @file xmlParser.js
 * @description Extrator client-side de XMLs da NFS-e Padrão Nacional (SPED / SEFIN / ADN v1.01)
 * via DOMParser('text/xml') e gerador de planilha resumo CSV compatível com Microsoft Excel (UTF-8 BOM + ';').
 */

(function (global) {
  'use strict';

  const NFSeBulk = (global.NFSeBulk = global.NFSeBulk || {});

  /**
   * Busca um elemento descendente pelo caminho de localNames (imune a namespaces xmlns).
   * Exemplo: getByPath(root, ['infNFSe', 'DPS', 'infDPS', 'toma', 'xNome'])
   * @param {Element|Document} parent
   * @param {string[]} path
   * @returns {Element|null}
   */
  function getElementByPath(parent, path) {
    let current = parent;
    for (let i = 0; i < path.length; i++) {
      if (!current) return null;
      const targetName = path[i].toLowerCase();
      let found = null;
      const children = current.children || current.childNodes;
      for (let j = 0; j < children.length; j++) {
        const child = children[j];
        if (child.nodeType === 1) {
          const local = (child.localName || child.nodeName.replace(/^.*:/, '')).toLowerCase();
          if (local === targetName) {
            found = child;
            break;
          }
        }
      }
      current = found;
    }
    return current;
  }

  /**
   * Retorna o texto limpo de um caminho de tags ou fallback em múltiplos caminhos.
   * @param {Element|Document} root
   * @param {Array<string[]>} paths
   * @returns {string}
   */
  function getTextByPaths(root, paths) {
    for (const path of paths) {
      const el = getElementByPath(root, path);
      if (el && el.textContent !== null && el.textContent !== undefined) {
        const txt = el.textContent.trim();
        if (txt !== '') return txt;
      }
    }
    return '';
  }

  /**
   * Formata CNPJ (14 dígitos) ou CPF (11 dígitos) para leitura amigável.
   * @param {string} raw
   * @returns {string}
   */
  function formatDocument(raw) {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 14) {
      return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (digits.length === 11) {
      return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return raw.trim();
  }

  /**
   * Formata datas ISO (ex: 2026-09-15T14:25:00-03:00 ou 2026-09-01) para DD/MM/YYYY HH:mm:ss ou DD/MM/YYYY.
   * @param {string} isoStr
   * @param {boolean} dateOnly
   * @returns {string}
   */
  function formatIsoDate(isoStr, dateOnly = false) {
    if (!isoStr) return '';
    const match = isoStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}:\d{2}:\d{2}))?/);
    if (!match) return isoStr.trim();
    const [, yyyy, mm, dd, time] = match;
    if (dateOnly || !time) {
      return `${dd}/${mm}/${yyyy}`;
    }
    return `${dd}/${mm}/${yyyy} ${time}`;
  }

  /**
   * Converte string numérica de XML (ex: '10000.00') para float seguro.
   * @param {string} val
   * @returns {number}
   */
  function toFloat(val) {
    if (!val) return 0;
    const normalized = String(val).trim().replace(',', '.');
    const parsed = parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Formata número float no padrão monetário/decimal brasileiro (vírgula decimal) para Excel PT-BR.
   * @param {number|string} val
   * @returns {string}
   */
  function formatDecimalBR(val) {
    const num = typeof val === 'number' ? val : toFloat(val);
    return num.toFixed(2).replace('.', ',');
  }

  /**
   * Traduz códigos de domínio do schema SPED NFS-e Nacional.
   */
  function translateSimplesNacional(code) {
    const map = {
      '1': '1 - Não Optante',
      '2': '2 - Optante ME/EPP (Simples Nacional)',
      '3': '3 - Optante MEI (SIMEI)'
    };
    return map[code] || code || '';
  }

  function translateRetencaoISS(code) {
    const map = {
      '1': 'Não Retido',
      '2': 'Retido pelo Tomador',
      '3': 'Retido pelo Intermediário'
    };
    return map[code] || code || 'Não Retido';
  }

  function translateStatusCStat(cStat) {
    const map = {
      '100': '100 - Autorizada',
      '101': '101 - Cancelada',
      '102': '102 - Substituída'
    };
    return map[cStat] || cStat || '';
  }

  /**
   * Faz o parse de uma string XML da NFS-e Nacional e extrai os campos estruturados.
   * @param {string} xmlString Conteúdo bruto do arquivo XML
   * @param {string} [sourceFileName=''] Nome do arquivo salvo no ZIP
   * @returns {Object} Objeto contendo todos os campos fiscais extraídos
   */
  function parseNFSeXML(xmlString, sourceFileName = '') {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('Conteúdo XML vazio ou inválido.');
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString.trim(), 'text/xml');

    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Falha ao interpretar XML: ' + parserError.textContent.slice(0, 120));
    }

    // Localiza a raiz <NFSe> ou <infNFSe>
    let infNFSe = getElementByPath(xmlDoc, ['NFSe', 'infNFSe']);
    if (!infNFSe) {
      const candidates = xmlDoc.getElementsByTagName('infNFSe');
      if (candidates && candidates.length > 0) {
        infNFSe = candidates[0];
      }
    }

    if (!infNFSe) {
      throw new Error('Tag <infNFSe> não encontrada no documento XML.');
    }

    // Chave de acesso no atributo Id="NFS..." (50 dígitos)
    const rawId = infNFSe.getAttribute('Id') || infNFSe.getAttribute('id') || '';
    const chaveAcesso = rawId.replace(/^NFS/i, '').trim();

    // Sub-árvore DPS/infDPS
    const infDPS = getElementByPath(infNFSe, ['DPS', 'infDPS']) || infNFSe;

    // 1. Identificação da Nota
    const numeroNFSe = getTextByPaths(infNFSe, [['nNFSe']]);
    const numeroDFSe = getTextByPaths(infNFSe, [['nDFSe']]);
    const cStat = getTextByPaths(infNFSe, [['cStat']]);
    const dhProc = getTextByPaths(infNFSe, [['dhProc']]);
    const dhEmi = getTextByPaths(infDPS, [['dhEmi']]) || dhProc;
    const dCompet = getTextByPaths(infDPS, [['dCompet']]);
    const serieDPS = getTextByPaths(infDPS, [['serie']]);
    const numeroDPS = getTextByPaths(infDPS, [['nDPS']]);

    // 2. Prestador (Emitente)
    const cnpjPrest = getTextByPaths(infNFSe, [['emit', 'CNPJ']]) || getTextByPaths(infDPS, [['prest', 'CNPJ']]);
    const cpfPrest = getTextByPaths(infNFSe, [['emit', 'CPF']]) || getTextByPaths(infDPS, [['prest', 'CPF']]);
    const docPrestador = formatDocument(cnpjPrest || cpfPrest);
    const razaoPrestador = getTextByPaths(infNFSe, [['emit', 'xNome']]) || getTextByPaths(infDPS, [['prest', 'xNome']]);
    const nomeFantasiaPrestador = getTextByPaths(infNFSe, [['emit', 'xFant']]);
    const imPrestador = getTextByPaths(infNFSe, [['emit', 'IM']]) || getTextByPaths(infDPS, [['prest', 'IM']]);
    const ufPrestador = getTextByPaths(infNFSe, [['emit', 'enderNac', 'UF']]);
    const opSimpNac = getTextByPaths(infDPS, [['prest', 'regTrib', 'opSimpNac']]);

    // 3. Tomador
    const cnpjToma = getTextByPaths(infDPS, [['toma', 'CNPJ']]);
    const cpfToma = getTextByPaths(infDPS, [['toma', 'CPF']]);
    const nifToma = getTextByPaths(infDPS, [['toma', 'NIF']]);
    const docTomador = formatDocument(cnpjToma || cpfToma || nifToma);
    const razaoTomador = getTextByPaths(infDPS, [['toma', 'xNome']]);
    const emailTomador = getTextByPaths(infDPS, [['toma', 'email']]);

    // 4. Localidades e Serviço
    const municipioEmissao = getTextByPaths(infNFSe, [['xLocEmi']]);
    const municipioPrestacao = getTextByPaths(infNFSe, [['xLocPrestacao']]);
    const municipioIncidencia = getTextByPaths(infNFSe, [['xLocIncid']]);
    const codTribNac = getTextByPaths(infDPS, [['serv', 'cServ', 'cTribNac']]);
    const descTribNac = getTextByPaths(infNFSe, [['xTribNac']]);
    const codTribMun = getTextByPaths(infDPS, [['serv', 'cServ', 'cTribMun']]);
    const descTribMun = getTextByPaths(infNFSe, [['xTribMun']]);
    const codNBS = getTextByPaths(infDPS, [['serv', 'cServ', 'cNBS']]);
    const discriminacao = getTextByPaths(infDPS, [['serv', 'cServ', 'xDescServ']])
      .replace(/[\r\n]+/g, ' | ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const codObra = getTextByPaths(infDPS, [['serv', 'obra', 'cObra']]);

    // 5. Valores e Tributos Municipais (ISSQN)
    const vServRaw = getTextByPaths(infDPS, [['valores', 'vServPrest', 'vServ']]);
    const vBCRaw = getTextByPaths(infNFSe, [['valores', 'vBC']]);
    const valorServico = toFloat(vServRaw || vBCRaw);
    const valorDeducoes = toFloat(getTextByPaths(infDPS, [['valores', 'vDedRed', 'vDR']]));
    const descontoIncond = toFloat(getTextByPaths(infDPS, [['valores', 'vDescCondIncond', 'vDescIncond']]));
    const baseCalculoISS = toFloat(vBCRaw || vServRaw);
    const aliqISS = toFloat(
      getTextByPaths(infNFSe, [['valores', 'pAliqAplic']]) ||
      getTextByPaths(infDPS, [['valores', 'trib', 'tribMun', 'pAliq']])
    );
    const valorISSQN = toFloat(getTextByPaths(infNFSe, [['valores', 'vISSQN']]));
    const tpRetISSQN = getTextByPaths(infDPS, [['valores', 'trib', 'tribMun', 'tpRetISSQN']]);

    // 6. Retenções Federais e Líquido
    const vPis = toFloat(getTextByPaths(infDPS, [['valores', 'trib', 'tribFed', 'piscofins', 'vPis']]));
    const vCofins = toFloat(getTextByPaths(infDPS, [['valores', 'trib', 'tribFed', 'piscofins', 'vCofins']]));
    const vRetCP = toFloat(getTextByPaths(infDPS, [['valores', 'trib', 'tribFed', 'vRetCP']]));
    const vRetIRRF = toFloat(getTextByPaths(infDPS, [['valores', 'trib', 'tribFed', 'vRetIRRF']]));
    const vRetCSLL = toFloat(getTextByPaths(infDPS, [['valores', 'trib', 'tribFed', 'vRetCSLL']]));

    const vTotalRetXml = getTextByPaths(infNFSe, [['valores', 'vTotalRet']]);
    const totalRetencoes = vTotalRetXml !== ''
      ? toFloat(vTotalRetXml)
      : (vPis + vCofins + vRetCP + vRetIRRF + vRetCSLL + (tpRetISSQN === '2' || tpRetISSQN === '3' ? valorISSQN : 0));

    const vLiqXml = getTextByPaths(infNFSe, [['valores', 'vLiq']]);
    const valorLiquido = vLiqXml !== '' ? toFloat(vLiqXml) : Math.max(0, valorServico - totalRetencoes);

    // 7. Reforma Tributária (IBS / CBS)
    const vIBSTot = toFloat(getTextByPaths(infNFSe, [['IBSCBS', 'totCIBS', 'gIBS', 'vIBSTot']]));
    const vCBSTot = toFloat(getTextByPaths(infNFSe, [['IBSCBS', 'totCIBS', 'gCBS', 'vCBS']]));

    return {
      numeroNFSe: numeroNFSe || '',
      serieDPS: serieDPS || '',
      numeroDPS: numeroDPS || '',
      numeroDFSe: numeroDFSe || '',
      dataEmissao: formatIsoDate(dhEmi, false),
      competencia: formatIsoDate(dCompet, true),
      status: translateStatusCStat(cStat),
      chaveAcesso: chaveAcesso || '',
      docPrestador,
      razaoPrestador,
      nomeFantasiaPrestador,
      imPrestador,
      ufPrestador,
      regimeSimples: translateSimplesNacional(opSimpNac),
      docTomador,
      razaoTomador,
      emailTomador,
      municipioEmissao,
      municipioPrestacao,
      municipioIncidencia,
      codTribNac,
      descTribNac,
      codTribMun,
      descTribMun,
      codNBS,
      codObra,
      valorServico,
      valorDeducoes,
      descontoIncond,
      baseCalculoISS,
      aliqISS,
      valorISSQN,
      issRetido: translateRetencaoISS(tpRetISSQN),
      retencaoINSS: vRetCP,
      retencaoIRRF: vRetIRRF,
      retencaoCSLL: vRetCSLL,
      valorPIS: vPis,
      valorCOFINS: vCofins,
      totalRetencoes,
      valorLiquido,
      ibsTotal: vIBSTot,
      cbsTotal: vCBSTot,
      discriminacao,
      arquivoXml: sourceFileName || (chaveAcesso ? `NFSe_${chaveAcesso}.xml` : '')
    };
  }

  /**
   * Escapa uma célula para CSV separado por ponto e vírgula (;).
   * Protege contra CSV Formula Injection e quebras de linha.
   * @param {any} value
   * @returns {string}
   */
  function escapeCsvCell(value) {
    if (value === null || value === undefined) return '';
    let str = String(value).replace(/[\r\n]+/g, ' ').trim();
    if (/^[=+\-@]/.test(str)) {
      str = "'" + str;
    }
    if (str.includes(';') || str.includes('"')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Converte uma lista de objetos extraídos pelo parseNFSeXML em conteúdo CSV pronto para Excel PT-BR.
   * Inclui BOM UTF-8 (\uFEFF) para acentuação perfeita no Excel.
   * @param {Array<Object>} records
   * @returns {string}
   */
  function generateSummaryCSV(records) {
    const columns = [
      { header: 'Número NFS-e', get: (r) => r.numeroNFSe },
      { header: 'Série DPS', get: (r) => r.serieDPS },
      { header: 'Número DPS', get: (r) => r.numeroDPS },
      { header: 'Data de Emissão', get: (r) => r.dataEmissao },
      { header: 'Competência', get: (r) => r.competencia },
      { header: 'Status', get: (r) => r.status },
      { header: 'Chave de Acesso (50 dígitos)', get: (r) => r.chaveAcesso ? `'${r.chaveAcesso}` : '' },
      { header: 'CNPJ/CPF Prestador', get: (r) => r.docPrestador },
      { header: 'Razão Social Prestador', get: (r) => r.razaoPrestador },
      { header: 'Inscrição Municipal Prestador', get: (r) => r.imPrestador },
      { header: 'UF Prestador', get: (r) => r.ufPrestador },
      { header: 'Optante Simples Nacional', get: (r) => r.regimeSimples },
      { header: 'CNPJ/CPF Tomador', get: (r) => r.docTomador },
      { header: 'Razão Social Tomador', get: (r) => r.razaoTomador },
      { header: 'Município Emissão', get: (r) => r.municipioEmissao },
      { header: 'Município Prestação', get: (r) => r.municipioPrestacao },
      { header: 'Cód. Trib. Nacional', get: (r) => r.codTribNac },
      { header: 'Descrição Trib. Nacional', get: (r) => r.descTribNac },
      { header: 'Cód. Obra', get: (r) => r.codObra },
      { header: 'Valor do Serviço (R$)', get: (r) => formatDecimalBR(r.valorServico) },
      { header: 'Deduções (R$)', get: (r) => formatDecimalBR(r.valorDeducoes) },
      { header: 'Desconto Incond. (R$)', get: (r) => formatDecimalBR(r.descontoIncond) },
      { header: 'Base de Cálculo ISS (R$)', get: (r) => formatDecimalBR(r.baseCalculoISS) },
      { header: 'Alíquota ISS (%)', get: (r) => formatDecimalBR(r.aliqISS) },
      { header: 'Valor ISSQN (R$)', get: (r) => formatDecimalBR(r.valorISSQN) },
      { header: 'ISS Retido', get: (r) => r.issRetido },
      { header: 'Retenção INSS (R$)', get: (r) => formatDecimalBR(r.retencaoINSS) },
      { header: 'Retenção IRRF (R$)', get: (r) => formatDecimalBR(r.retencaoIRRF) },
      { header: 'Retenção CSLL (R$)', get: (r) => formatDecimalBR(r.retencaoCSLL) },
      { header: 'Valor PIS (R$)', get: (r) => formatDecimalBR(r.valorPIS) },
      { header: 'Valor COFINS (R$)', get: (r) => formatDecimalBR(r.valorCOFINS) },
      { header: 'Total Retenções (R$)', get: (r) => formatDecimalBR(r.totalRetencoes) },
      { header: 'Valor Líquido (R$)', get: (r) => formatDecimalBR(r.valorLiquido) },
      { header: 'IBS Total (R$)', get: (r) => formatDecimalBR(r.ibsTotal) },
      { header: 'CBS Total (R$)', get: (r) => formatDecimalBR(r.cbsTotal) },
      { header: 'Discriminação do Serviço', get: (r) => r.discriminacao },
      { header: 'Arquivo XML', get: (r) => r.arquivoXml }
    ];

    const headerRow = columns.map((c) => escapeCsvCell(c.header)).join(';');
    const dataRows = records.map((rec) =>
      columns.map((c) => escapeCsvCell(c.get(rec))).join(';')
    );

    // UTF-8 BOM (\uFEFF) garante abertura direta no Excel em Português com acentuação e colunas separadas
    return '\uFEFF' + [headerRow, ...dataRows].join('\r\n') + '\r\n';
  }

  NFSeBulk.XMLParser = {
    parseNFSeXML,
    generateSummaryCSV,
    formatDecimalBR,
    formatDocument
  };
})( typeof window !== 'undefined' ? window : globalThis );
