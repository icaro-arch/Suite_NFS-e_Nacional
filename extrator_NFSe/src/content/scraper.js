/**
 * @file scraper.js
 * @description Varredura do DOM, detecção automática de CPF/CNPJ consultado, filtragem por Data de Emissão
 * (com Early Stop inteligente) e paginação automática via fetch({ credentials: 'include' }) + DOMParser('text/html')
 * para /PainelMunicipal/NFSe/Consulta.
 */

(function (global) {
  'use strict';

  const NFSeBulk = (global.NFSeBulk = global.NFSeBulk || {});

  const CHAVE_50_REGEX = /(?:NFS)?(\d{50})/i;
  const BR_DATE_REGEX = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
  const CNPJ_FORMATTED_REGEX = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
  const CPF_FORMATTED_REGEX = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;

  /**
   * Retorna a data atual (hoje) no fuso horário local no formato ISO 'YYYY-MM-DD'.
   * @returns {string}
   */
  function getTodayLocalIso() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Extrai um CPF (11 dígitos) ou CNPJ (14 dígitos) válido de uma string, retornando apenas os dígitos.
   * Ignora números de 50 dígitos (chaves de acesso).
   * @param {string} raw
   * @returns {string} Dígitos do CPF/CNPJ ou '' se não encontrado
   */
  function extractCleanCpfCnpj(raw) {
    if (!raw) return '';
    const text = String(raw).trim();

    // 1. Verifica formato mascarado explícito primeiro (XX.XXX.XXX/XXXX-XX ou XXX.XXX.XXX-XX)
    const cnpjMatch = text.match(CNPJ_FORMATTED_REGEX);
    if (cnpjMatch) {
      return cnpjMatch[0].replace(/\D/g, '');
    }
    const cpfMatch = text.match(CPF_FORMATTED_REGEX);
    if (cpfMatch) {
      return cpfMatch[0].replace(/\D/g, '');
    }

    // 2. Verifica sequência de apenas dígitos (11 ou 14 dígitos)
    const digitsOnly = text.replace(/\D/g, '');
    if (digitsOnly.length === 14 || digitsOnly.length === 11) {
      return digitsOnly;
    }

    return '';
  }

  /**
   * Lê os campos de filtro de pesquisa da página (/PainelMunicipal/NFSe/Consulta), parâmetros de URL
   * ou dados da tabela para identificar qual CPF ou CNPJ foi consultado.
   * @param {Document} [doc=document]
   * @param {string} [url=window.location.href]
   * @returns {string} Apenas dígitos do CPF/CNPJ (11 ou 14 dígitos) ou ''
   */
  function detectQueriedDocument(doc = document, url = window.location.href) {
    // 1. Inspeciona inputs de filtro do próprio portal (priorizando campos com id/name/label de CNPJ, CPF, Prestador, Tomador)
    const inputs = Array.from(
      doc.querySelectorAll('input[type="text"], input[type="search"], input[type="tel"], input:not([type])')
    ).filter((el) => !el.closest('#nfse-bulk-root'));

    // Ordena priorizando inputs cujos atributos indiquem documento/contribuinte
    const scoredInputs = inputs.map((input) => {
      const attrs = [
        input.name || '',
        input.id || '',
        input.placeholder || '',
        input.getAttribute('aria-label') || '',
        input.className || ''
      ]
        .join(' ')
        .toLowerCase();

      let score = 0;
      if (/cnpj|cpf|inscricao|documento|ni\b/.test(attrs)) score += 10;
      if (/prestador|tomador|emitente|contribuinte/.test(attrs)) score += 6;
      return { input, score };
    });

    scoredInputs.sort((a, b) => b.score - a.score);

    for (const { input } of scoredInputs) {
      const val = (input.value || input.getAttribute('value') || '').trim();
      const docDigits = extractCleanCpfCnpj(val);
      if (docDigits) {
        return docDigits;
      }
    }

    // 2. Verifica parâmetros na Query String da URL atual
    try {
      const parsedUrl = new URL(url);
      for (const [key, val] of parsedUrl.searchParams.entries()) {
        if (/chave|pagina|page/i.test(key)) continue;
        const docDigits = extractCleanCpfCnpj(val);
        if (docDigits) {
          return docDigits;
        }
      }
    } catch (_) {
      // Ignora erro de URL
    }

    // 3. Verifica textos de resumo/cabeçalho de filtro ativo ou coluna recorrente na tabela
    const tableCells = Array.from(doc.querySelectorAll('table tbody tr td'));
    const freqMap = new Map();
    for (const td of tableCells) {
      const text = (td.textContent || '').trim();
      const cnpjMatch = text.match(CNPJ_FORMATTED_REGEX);
      const cpfMatch = !cnpjMatch ? text.match(CPF_FORMATTED_REGEX) : null;
      const found = cnpjMatch ? cnpjMatch[0].replace(/\D/g, '') : cpfMatch ? cpfMatch[0].replace(/\D/g, '') : '';
      if (found) {
        freqMap.set(found, (freqMap.get(found) || 0) + 1);
      }
    }

    // Se encontrou algum CPF/CNPJ que se repete como contraparte principal da consulta, retorna o mais frequente
    let bestDoc = '';
    let bestCount = 0;
    for (const [docNum, count] of freqMap.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestDoc = docNum;
      }
    }

    return bestDoc;
  }

  /**
   * Gera a sugestão padrão de nome de arquivo/lote no formato:
   * NFSe_{CPF_OU_CNPJ}_{DATA_ATUAL} ou NFSe_Lote_{DATA_ATUAL}.
   * @param {Document} [doc=document]
   * @param {string} [url=window.location.href]
   * @returns {string}
   */
  function getSuggestedBatchName(doc = document, url = window.location.href) {
    const todayIso = getTodayLocalIso();
    const cpfCnpj = detectQueriedDocument(doc, url);
    if (cpfCnpj) {
      return `NFSe_${cpfCnpj}_${todayIso}`;
    }
    return `NFSe_Lote_${todayIso}`;
  }

  /**
   * Extrai a primeira data no formato DD/MM/AAAA de um texto (ignorando o horário se houver)
   * e retorna tanto a string 'DD/MM/AAAA' quanto o formato comparável ISO 'YYYY-MM-DD'.
   * @param {string} text
   * @returns {{ br: string, iso: string } | null}
   */
  function parseBrDateFromText(text) {
    if (!text) return null;
    const match = String(text).match(BR_DATE_REGEX);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const day = parseInt(dd, 10);
    const month = parseInt(mm, 10);
    const year = parseInt(yyyy, 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) {
      return null;
    }
    return {
      br: `${dd}/${mm}/${yyyy}`,
      iso: `${yyyy}-${mm}-${dd}`
    };
  }

  /**
   * Formata uma data ISO 'YYYY-MM-DD' para 'DD/MM/AAAA'.
   * @param {string} isoDate
   * @returns {string}
   */
  function formatIsoToBr(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
    const [yyyy, mm, dd] = isoDate.split('-');
    return `${dd}/${mm}/${yyyy}`;
  }

  /**
   * Verifica se uma nota está dentro do intervalo de Data de Emissão configurado.
   * - Se dateFrom for vazio ("Desde sempre"): inclui notas com Data de Emissão <= dateTo.
   * - Se dateFrom estiver definido: inclui apenas notas com Data de Emissão >= dateFrom E <= dateTo.
   *
   * @param {Object} note Objeto da nota contendo dataEmissaoIso ('YYYY-MM-DD')
   * @param {string} [dateFrom=''] Data inicial 'YYYY-MM-DD' ou '' para "Desde sempre"
   * @param {string} [dateTo=''] Data final 'YYYY-MM-DD'
   * @returns {boolean}
   */
  function isNoteWithinDateRange(note, dateFrom = '', dateTo = '') {
    if (!dateFrom && !dateTo) return true;

    const noteIso = note && note.dataEmissaoIso ? note.dataEmissaoIso : '';
    if (!noteIso) {
      return false;
    }

    if (dateFrom && noteIso < dateFrom) {
      return false;
    }
    if (dateTo && noteIso > dateTo) {
      return false;
    }
    return true;
  }

  /**
   * Filtra um array de notas pelo intervalo de Data de Emissão.
   * @param {Array<Object>} notes
   * @param {string} [dateFrom='']
   * @param {string} [dateTo='']
   * @returns {{ accepted: Array<Object>, rejectedCount: number }}
   */
  function filterNotesByDateRange(notes, dateFrom = '', dateTo = '') {
    const accepted = [];
    let rejectedCount = 0;

    for (const note of notes) {
      if (isNoteWithinDateRange(note, dateFrom, dateTo)) {
        accepted.push(note);
      } else {
        rejectedCount++;
      }
    }

    return { accepted, rejectedCount };
  }

  /**
   * Verifica se todas as notas datadas de uma página já são anteriores à Data Inicial (dateFrom),
   * permitindo interromper a paginação antecipadamente (Early Stop) em listas decrescentes.
   * @param {Array<Object>} pageNotes
   * @param {string} dateFrom
   * @returns {boolean}
   */
  function areAllPageNotesOlderThanDateFrom(pageNotes, dateFrom) {
    if (!dateFrom || !Array.isArray(pageNotes) || pageNotes.length === 0) {
      return false;
    }
    const datedNotes = pageNotes.filter((n) => Boolean(n && n.dataEmissaoIso));
    if (datedNotes.length === 0) {
      return false;
    }
    return datedNotes.every((n) => n.dataEmissaoIso < dateFrom);
  }

  /**
   * Identifica o contexto da página atual no Painel Municipal.
   * @param {string} [url=window.location.href]
   * @returns {{ tipo: string, label: string, isSupportedListing: boolean }}
   */
  function detectPageContext(url = window.location.href) {
    const lower = url.toLowerCase();
    if (lower.includes('/painelmunicipal/nfse/consulta')) {
      return {
        tipo: 'consulta_municipal',
        label: 'Painel Municipal • Consulta',
        isSupportedListing: true
      };
    }
    if (lower.includes('/painelmunicipal')) {
      return {
        tipo: 'painel_municipal',
        label: 'Painel Municipal NFS-e',
        isSupportedListing: true
      };
    }
    return {
      tipo: 'geral',
      label: 'Portal NFS-e',
      isSupportedListing: false
    };
  }

  /**
   * Resolve um href relativo em uma URL absoluta baseada na origem do portal.
   * @param {string} href
   * @param {string} baseUrl
   * @returns {string}
   */
  function resolveUrl(href, baseUrl) {
    if (!href) return '';
    const trimmed = href.trim();
    if (!trimmed || trimmed === '#' || trimmed.toLowerCase().startsWith('javascript:')) {
      return '';
    }
    try {
      return new URL(trimmed, baseUrl).href;
    } catch (_) {
      return '';
    }
  }

  /**
   * Extrai a chave de acesso de 50 dígitos de uma URL ou string arbitrária.
   * @param {string} str
   * @returns {string}
   */
  function extractChaveFromText(str) {
    if (!str) return '';
    const match = String(str).match(CHAVE_50_REGEX);
    return match ? match[1] : '';
  }

  /**
   * Localiza o índice da coluna de "Data de Emissão" inspecionando os cabeçalhos <th> da tabela.
   * @param {HTMLTableElement|Element} table
   * @returns {number} Índice 0-based da coluna ou -1 se não identificado
   */
  function findEmissionDateColumnIndex(table) {
    if (!table || !table.querySelectorAll) return -1;
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return -1;

    const headers = Array.from(headerRow.querySelectorAll('th, td'));
    for (let i = 0; i < headers.length; i++) {
      const text = (headers[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.includes('emiss')) {
        return i;
      }
    }
    for (let i = 0; i < headers.length; i++) {
      const text = (headers[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if ((text.includes('data') || text.includes('dt.')) && !text.includes('compet')) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Analisa uma linha <tr> da tabela de notas e extrai links de XML, PDF (DANFSe) e a Data de Emissão.
   * @param {HTMLTableRowElement} tr
   * @param {string} baseUrl
   * @param {number} fallbackIndex
   * @param {number} [emissionColIndex=-1]
   * @returns {Object|null}
   */
  function extractNoteFromRow(tr, baseUrl, fallbackIndex, emissionColIndex = -1) {
    if (!tr || !tr.querySelectorAll) return null;
    if (tr.querySelector('th') && !tr.querySelector('td')) return null;

    const links = Array.from(tr.querySelectorAll('a[href], button[data-url], [data-href]'));
    let xmlUrl = '';
    let pdfUrl = '';
    let chave = '';

    for (const el of links) {
      const rawHref = el.getAttribute('href') || el.getAttribute('data-url') || el.getAttribute('data-href') || '';
      const absUrl = resolveUrl(rawHref, baseUrl);
      if (!absUrl) continue;

      const lowerUrl = absUrl.toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();
      const title = ((el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
      const iconHtml = el.innerHTML.toLowerCase();

      const foundChave = extractChaveFromText(absUrl) || extractChaveFromText(el.outerHTML);
      if (foundChave && !chave) {
        chave = foundChave;
      }

      const isXmlLink =
        lowerUrl.includes('/download/xml') ||
        lowerUrl.includes('/download/nfse') ||
        lowerUrl.includes('/downloadxml') ||
        lowerUrl.endsWith('.xml') ||
        text.includes('xml') ||
        title.includes('xml') ||
        iconHtml.includes('fa-file-code');

      const isPdfLink =
        lowerUrl.includes('/nfse/danfse') ||
        lowerUrl.includes('/nfse/danfe') ||
        lowerUrl.includes('/download/danfse') ||
        lowerUrl.includes('/visualizardanfse') ||
        lowerUrl.includes('danfse') ||
        lowerUrl.endsWith('.pdf') ||
        text.includes('danfse') ||
        text.includes('pdf') ||
        title.includes('danfse') ||
        title.includes('pdf') ||
        iconHtml.includes('fa-file-pdf');

      if (isXmlLink && !xmlUrl) {
        xmlUrl = absUrl;
      } else if (isPdfLink && !pdfUrl) {
        pdfUrl = absUrl;
      }
    }

    if (!chave) {
      chave = extractChaveFromText(tr.innerHTML);
    }

    if (chave) {
      const originObj = new URL(baseUrl);
      const isPainelMunicipal = originObj.pathname.toLowerCase().includes('/painelmunicipal');
      if (isPainelMunicipal) {
        if (!xmlUrl) {
          xmlUrl = `${originObj.origin}/PainelMunicipal/NFSe/Download/XML/${chave}`;
        }
        if (!pdfUrl) {
          pdfUrl = `${originObj.origin}/PainelMunicipal/NFSe/Danfse/${chave}`;
        }
      } else {
        const pathPrefix = originObj.pathname.toLowerCase().includes('/emissornacional')
          ? '/EmissorNacional'
          : '';
        if (!xmlUrl) {
          xmlUrl = `${originObj.origin}${pathPrefix}/Notas/Download/NFSe/${chave}`;
        }
        if (!pdfUrl) {
          pdfUrl = `${originObj.origin}${pathPrefix}/Notas/Download/DANFSe/${chave}`;
        }
      }
    }

    if (!xmlUrl && !pdfUrl) {
      return null;
    }

    const tdElements = Array.from(tr.querySelectorAll('td'));
    const cells = tdElements.map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());

    let dataEmissao = '';
    let dataEmissaoIso = '';

    if (emissionColIndex >= 0 && emissionColIndex < cells.length) {
      const parsedFromCol = parseBrDateFromText(cells[emissionColIndex]);
      if (parsedFromCol) {
        dataEmissao = parsedFromCol.br;
        dataEmissaoIso = parsedFromCol.iso;
      }
    }

    if (!dataEmissaoIso) {
      for (const cellText of cells) {
        if (/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(cellText)) {
          const parsed = parseBrDateFromText(cellText);
          if (parsed) {
            dataEmissao = parsed.br;
            dataEmissaoIso = parsed.iso;
            break;
          }
        }
      }
    }
    if (!dataEmissaoIso) {
      for (const cellText of cells) {
        const parsed = parseBrDateFromText(cellText);
        if (parsed) {
          dataEmissao = parsed.br;
          dataEmissaoIso = parsed.iso;
          break;
        }
      }
    }

    let valor = '';
    let numeroNota = '';
    let contraparte = '';
    let situacao = 'Autorizada';

    const rowFullText = cells.join(' | ');
    const valorMatch = rowFullText.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (valorMatch) valor = valorMatch[1];

    if (/cancelad/i.test(rowFullText) || tr.querySelector('.text-danger, .badge-danger, .label-danger')) {
      situacao = 'Cancelada';
    } else if (/substitu/i.test(rowFullText)) {
      situacao = 'Substituída';
    }

    for (const cellText of cells) {
      if (!contraparte && (/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(cellText) || /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(cellText))) {
        contraparte = cellText;
      }
      if (!numeroNota && /^\d{1,12}$/.test(cellText)) {
        numeroNota = cellText;
      }
    }

    const uniqueId = chave || xmlUrl || pdfUrl || `row_${fallbackIndex}`;

    return {
      id: uniqueId,
      chave: chave || '',
      numero: numeroNota || '',
      dataEmissao,
      dataEmissaoIso,
      contraparte,
      valor,
      situacao,
      xmlUrl,
      pdfUrl
    };
  }

  /**
   * Extrai todas as notas fiscais presentes em um Document (DOM vivo ou DOMParser).
   * @param {Document} doc
   * @param {string} baseUrl
   * @returns {Array<Object>}
   */
  function extractNotesFromDocument(doc, baseUrl) {
    const notesMap = new Map();
    const tables = Array.from(doc.querySelectorAll('table'));

    if (tables.length > 0) {
      let globalRowIdx = 0;
      for (const table of tables) {
        const emissionColIndex = findEmissionDateColumnIndex(table);
        const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
        for (const tr of rows) {
          const note = extractNoteFromRow(tr, baseUrl, globalRowIdx++, emissionColIndex);
          if (note && !notesMap.has(note.id)) {
            notesMap.set(note.id, note);
          }
        }
      }
    }

    if (notesMap.size === 0) {
      const standaloneLinks = Array.from(
        doc.querySelectorAll(
          'a[href*="/Download/XML/"], a[href*="/NFSe/Danfse/"], a[href*="/NFSe/Visualizar/"], a[href*="/Download/NFSe/"]'
        )
      );
      standaloneLinks.forEach((a, idx) => {
        const container = a.closest('tr, li, .card, .row, div') || a.parentElement;
        if (container) {
          const note = extractNoteFromRow(container, baseUrl, idx, -1);
          if (note && !notesMap.has(note.id)) {
            notesMap.set(note.id, note);
          }
        }
      });
    }

    return Array.from(notesMap.values());
  }

  /**
   * Extrai todas as URLs de paginação presentes no Document (suporta X.PagedList / Bootstrap pagination).
   * @param {Document} doc
   * @param {string} baseUrl
   * @returns {Array<{ pageNumber: number, url: string }>}
   */
  function extractPaginationLinks(doc, baseUrl) {
    const selectors = [
      'ul.pagination a[href]',
      '.pagination-container a[href]',
      '.pagination a[href]',
      'a.page-link[href]',
      'a[href*="pagina="]',
      'a[href*="pg="]',
      'a[href*="page="]',
      'a[rel="next"]'
    ];

    const links = Array.from(doc.querySelectorAll(selectors.join(', ')));
    const discovered = new Map();

    for (const a of links) {
      const li = a.closest('li');
      if (li && (li.classList.contains('disabled') || li.classList.contains('active'))) {
        continue;
      }

      const absUrl = resolveUrl(a.getAttribute('href'), baseUrl);
      if (!absUrl) continue;

      try {
        const parsed = new URL(absUrl);
        const pageParam =
          parsed.searchParams.get('pagina') ||
          parsed.searchParams.get('pg') ||
          parsed.searchParams.get('page');

        let pageNum = pageParam ? parseInt(pageParam, 10) : NaN;
        if (Number.isNaN(pageNum)) {
          const textNum = parseInt((a.textContent || '').trim(), 10);
          if (!Number.isNaN(textNum)) {
            pageNum = textNum;
          }
        }

        if (!Number.isNaN(pageNum) && pageNum > 0) {
          if (!discovered.has(absUrl)) {
            discovered.set(absUrl, { pageNumber: pageNum, url: absUrl });
          }
        } else if (!discovered.has(absUrl)) {
          discovered.set(absUrl, { pageNumber: 9999, url: absUrl });
        }
      } catch (_) {
        // Ignora URLs malformadas
      }
    }

    return Array.from(discovered.values()).sort((a, b) => a.pageNumber - b.pageNumber);
  }

  /**
   * Normaliza URL de página para controle de páginas já visitadas.
   * @param {string} urlStr
   * @returns {string}
   */
  function normalizePageKey(urlStr) {
    try {
      const u = new URL(urlStr);
      const page = u.searchParams.get('pagina') || u.searchParams.get('pg') || u.searchParams.get('page') || '1';
      return `${u.origin}${u.pathname}?page=${page}`;
    } catch (_) {
      return urlStr;
    }
  }

  /**
   * Aguarda N milissegundos.
   * @param {number} ms
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Coleta todas as notas da página atual e (se configurado) das páginas subsequentes,
   * aplicando o filtro de intervalo de Data de Emissão (De / Até) e Parada Inteligente (Early Stop)
   * quando todas as notas de uma página já são anteriores à Data Inicial ("De").
   *
   * @param {Object} options
   * @param {boolean} [options.scanAllPages=true] Se verdadeiro, busca todas as páginas da listagem
   * @param {string} [options.dateFrom=''] Data Inicial ('YYYY-MM-DD') ou '' para "Desde sempre"
   * @param {string} [options.dateTo=''] Data Final ('YYYY-MM-DD')
   * @param {number} [options.pageDelayMs=100] Delay entre requisições de paginação
   * @param {number} [options.maxPages=200] Limite de segurança de páginas
   * @param {Function} [options.shouldStop] Callback que retorna true se o usuário cancelou
   * @param {Function} [options.onPageProgress] Callback({ currentPage, totalKnownPages, totalNotesFound, filteredOutCount, pageUrl })
   * @returns {Promise<Array<Object>>} Lista consolidada, desduplicada e filtrada por Data de Emissão
   */
  async function collectAllNotes(options = {}) {
    const {
      scanAllPages = true,
      dateFrom = '',
      dateTo = getTodayLocalIso(),
      pageDelayMs = 100,
      maxPages = 200,
      shouldStop = () => false,
      onPageProgress = () => {}
    } = options;

    const currentUrl = window.location.href;
    const acceptedNotesMap = new Map();
    const seenIds = new Set();
    const visitedPages = new Set();
    let totalFilteredOut = 0;

    // 1. Coleta e filtra a página atualmente aberta no DOM
    const currentKey = normalizePageKey(currentUrl);
    visitedPages.add(currentKey);

    const initialNotes = extractNotesFromDocument(document, currentUrl);
    for (const note of initialNotes) {
      if (seenIds.has(note.id)) continue;
      seenIds.add(note.id);
      if (isNoteWithinDateRange(note, dateFrom, dateTo)) {
        acceptedNotesMap.set(note.id, note);
      } else {
        totalFilteredOut++;
      }
    }

    if (dateFrom && areAllPageNotesOlderThanDateFrom(initialNotes, dateFrom)) {
      onPageProgress({
        currentPage: 1,
        totalKnownPages: 1,
        totalNotesFound: acceptedNotesMap.size,
        filteredOutCount: totalFilteredOut,
        pageUrl: currentUrl
      });
      return Array.from(acceptedNotesMap.values());
    }

    const initialPagination = extractPaginationLinks(document, currentUrl);
    const queue = [];
    const queuedKeys = new Set([currentKey]);

    for (const item of initialPagination) {
      const key = normalizePageKey(item.url);
      if (!queuedKeys.has(key)) {
        queuedKeys.add(key);
        queue.push(item);
      }
    }

    let pagesScanned = 1;
    onPageProgress({
      currentPage: pagesScanned,
      totalKnownPages: scanAllPages ? Math.max(1, pagesScanned + queue.length) : 1,
      totalNotesFound: acceptedNotesMap.size,
      filteredOutCount: totalFilteredOut,
      pageUrl: currentUrl
    });

    if (!scanAllPages || queue.length === 0) {
      return Array.from(acceptedNotesMap.values());
    }

    // 2. Percorre a fila de páginas seguintes com suporte a Early Stop
    while (queue.length > 0 && pagesScanned < maxPages) {
      if (shouldStop()) {
        break;
      }

      queue.sort((a, b) => a.pageNumber - b.pageNumber);
      const nextItem = queue.shift();
      const pageKey = normalizePageKey(nextItem.url);

      if (visitedPages.has(pageKey)) {
        continue;
      }
      visitedPages.add(pageKey);

      await sleep(pageDelayMs);
      if (shouldStop()) break;

      try {
        const response = await fetch(nextItem.url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'X-Requested-With': 'XMLHttpRequest'
          }
        });

        if (!response.ok) {
          continue;
        }

        if (response.redirected && /login|acesso|autenticacao/i.test(response.url)) {
          break;
        }

        const html = await response.text();
        const parser = new DOMParser();
        const pageDoc = parser.parseFromString(html, 'text/html');

        const pageNotes = extractNotesFromDocument(pageDoc, nextItem.url);

        for (const note of pageNotes) {
          if (seenIds.has(note.id)) continue;
          seenIds.add(note.id);

          if (isNoteWithinDateRange(note, dateFrom, dateTo)) {
            acceptedNotesMap.set(note.id, note);
          } else {
            totalFilteredOut++;
          }
        }

        pagesScanned++;

        if (dateFrom && areAllPageNotesOlderThanDateFrom(pageNotes, dateFrom)) {
          onPageProgress({
            currentPage: pagesScanned,
            totalKnownPages: pagesScanned,
            totalNotesFound: acceptedNotesMap.size,
            filteredOutCount: totalFilteredOut,
            pageUrl: nextItem.url
          });
          break;
        }

        const morePagination = extractPaginationLinks(pageDoc, nextItem.url);
        for (const candidate of morePagination) {
          const candKey = normalizePageKey(candidate.url);
          if (!visitedPages.has(candKey) && !queuedKeys.has(candKey)) {
            queuedKeys.add(candKey);
            queue.push(candidate);
          }
        }

        onPageProgress({
          currentPage: pagesScanned,
          totalKnownPages: pagesScanned + queue.length,
          totalNotesFound: acceptedNotesMap.size,
          filteredOutCount: totalFilteredOut,
          pageUrl: nextItem.url
        });
      } catch (_) {
        // Continua na próxima página em caso de falha transitória
      }
    }

    return Array.from(acceptedNotesMap.values());
  }

  NFSeBulk.Scraper = {
    getTodayLocalIso,
    extractCleanCpfCnpj,
    detectQueriedDocument,
    getSuggestedBatchName,
    parseBrDateFromText,
    formatIsoToBr,
    isNoteWithinDateRange,
    filterNotesByDateRange,
    areAllPageNotesOlderThanDateFrom,
    detectPageContext,
    extractNotesFromDocument,
    extractPaginationLinks,
    collectAllNotes
  };
})(typeof window !== 'undefined' ? window : globalThis);
