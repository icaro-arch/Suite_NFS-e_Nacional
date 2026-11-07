/**
 * @file content.js
 * @description Orquestrador principal da extensão NFSe Bulk Downloader.
 * Injeta o painel flutuante no Painel Municipal da NFS-e (/PainelMunicipal/NFSe/Consulta),
 * gerencia o filtro por Data de Emissão, sugere dinamicamente o nome do arquivo por CPF/CNPJ
 * e coordena a paginação automática (com Early Stop) + Download em Lote (.ZIP recomendado ou descompactado).
 */

(function (global) {
  'use strict';

  const NFSeBulk = (global.NFSeBulk = global.NFSeBulk || {});

  if (document.getElementById('nfse-bulk-root')) {
    return;
  }

  const STORAGE_KEY = 'nfse_bulk_user_prefs_v3';

  const defaultPrefs = {
    downloadXml: true,
    downloadPdf: false,
    generateCsv: true,
    useZip: true,
    scanAllPages: true,
    dateFrom: '',
    delayMs: 100,
    concurrency: 2,
    minimized: false
  };

  let activeController = null;
  let cancelScanRequested = false;

  /**
   * Carrega preferências salvas pelo usuário.
   * @returns {Promise<Object>}
   */
  async function loadPrefs() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        return new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY], (res) => {
            resolve({ ...defaultPrefs, ...(res && res[STORAGE_KEY] ? res[STORAGE_KEY] : {}) });
          });
        });
      }
    } catch (_) {
      // Fallback para localStorage
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : { ...defaultPrefs };
    } catch (_) {
      return { ...defaultPrefs };
    }
  }

  /**
   * Salva preferências do usuário.
   * @param {Object} prefs
   */
  function savePrefs(prefs) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: prefs });
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (_) {
      // Ignora erros de quota
    }
  }

  /**
   * Torna o painel flutuante arrastável pelo cabeçalho.
   * @param {HTMLElement} panel
   * @param {HTMLElement} handle
   */
  function makeDraggable(panel, handle) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = rect.left;
      initialTop = rect.top;

      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${initialLeft}px`;
      panel.style.top = `${initialTop}px`;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth - 8);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight - 8);
      const nextLeft = Math.min(maxLeft, Math.max(8, initialLeft + dx));
      const nextTop = Math.min(maxTop, Math.max(8, initialTop + dy));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  /**
   * Constrói e injeta a interface do painel flutuante na página.
   */
  async function initPanel() {
    const prefs = await loadPrefs();
    const todayIso = NFSeBulk.Scraper.getTodayLocalIso();
    const initialDateFrom = prefs.dateFrom || '';
    const initialDateTo = todayIso;

    const pageCtx = NFSeBulk.Scraper.detectPageContext();
    const currentNotesOnDom = NFSeBulk.Scraper.extractNotesFromDocument(document, window.location.href);
    const paginationLinks = NFSeBulk.Scraper.extractPaginationLinks(document, window.location.href);
    const initialFiltered = NFSeBulk.Scraper.filterNotesByDateRange(
      currentNotesOnDom,
      initialDateFrom,
      initialDateTo
    );

    const suggestedBatchName = NFSeBulk.Scraper.getSuggestedBatchName(document, window.location.href);

    const root = document.createElement('div');
    root.id = 'nfse-bulk-root';
    if (prefs.minimized) {
      root.classList.add('nfse-bulk-minimized');
    }

    const hasCustomDateFrom = Boolean(initialDateFrom);

    root.innerHTML = `
      <div class="nfse-bulk-header" id="nfse-bulk-drag-handle" title="Arraste para mover o painel">
        <div class="nfse-bulk-title-wrap">
          <span class="nfse-bulk-logo">NFS</span>
          <div>
            <div class="nfse-bulk-title">Extrator NFS-e</div>
            <span class="nfse-bulk-subtitle">Painel Municipal • Download em Lote</span>
          </div>
        </div>
        <div class="nfse-bulk-header-actions">
          <button type="button" class="nfse-bulk-icon-btn" id="nfse-bulk-btn-minimize" title="Minimizar / Expandir">
            ${prefs.minimized ? '+' : '−'}
          </button>
        </div>
      </div>

      <div class="nfse-bulk-body">
        <div class="nfse-bulk-context-bar">
          <span>Ambiente: <strong id="nfse-bulk-ctx-label">${pageCtx.label}</strong></span>
          <span class="nfse-bulk-badge" id="nfse-bulk-dom-count">
            ${initialFiltered.accepted.length}/${currentNotesOnDom.length} nesta pág.${paginationLinks.length > 0 ? ' (+págs)' : ''}
          </span>
        </div>

        <div class="nfse-bulk-section">
          <div class="nfse-bulk-section-title">Período por Data de Emissão</div>
          <div class="nfse-bulk-date-grid">
            <div class="nfse-bulk-field">
              <label for="nfse-input-date-from">De (Data Inicial)</label>
              <div class="nfse-bulk-date-from-wrap">
                <button
                  type="button"
                  id="nfse-btn-since-forever"
                  class="nfse-bulk-since-forever-btn ${hasCustomDateFrom ? 'nfse-bulk-hidden' : ''}"
                  title="Clique para escolher uma data inicial específica"
                >
                  <span>Desde sempre</span>
                  <span aria-hidden="true">📅</span>
                </button>
                <div
                  id="nfse-date-from-picker-wrap"
                  class="nfse-bulk-date-input-group ${hasCustomDateFrom ? '' : 'nfse-bulk-hidden'}"
                >
                  <input
                    type="date"
                    id="nfse-input-date-from"
                    class="nfse-bulk-input"
                    value="${initialDateFrom}"
                    max="${todayIso}"
                  />
                  <button
                    type="button"
                    id="nfse-btn-clear-date-from"
                    class="nfse-bulk-clear-date-btn"
                    title="Limpar e voltar para 'Desde sempre'"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            <div class="nfse-bulk-field">
              <label for="nfse-input-date-to">Até (Data Final)</label>
              <input
                type="date"
                id="nfse-input-date-to"
                class="nfse-bulk-input"
                value="${initialDateTo}"
              />
            </div>
          </div>
        </div>

        <div class="nfse-bulk-section">
          <div class="nfse-bulk-section-title">Opções de Download</div>
          <div class="nfse-bulk-checkbox-list">
            <label class="nfse-bulk-checkbox-item">
              <input type="checkbox" id="nfse-chk-xml" ${prefs.downloadXml ? 'checked' : ''} />
              <span>Baixar XML</span>
            </label>
            <label class="nfse-bulk-checkbox-item">
              <input type="checkbox" id="nfse-chk-pdf" ${prefs.downloadPdf ? 'checked' : ''} />
              <span>Baixar PDF (DANFS-e)</span>
            </label>
            <label class="nfse-bulk-checkbox-item">
              <input type="checkbox" id="nfse-chk-csv" ${prefs.generateCsv ? 'checked' : ''} />
              <span>Gerar Planilha Resumo (CSV)</span>
            </label>
            <label class="nfse-bulk-checkbox-item">
              <input type="checkbox" id="nfse-chk-all-pages" ${prefs.scanAllPages ? 'checked' : ''} />
              <span>Varredura automática de todas as páginas</span>
            </label>
            <label class="nfse-bulk-checkbox-item nfse-bulk-zip-highlight">
              <input type="checkbox" id="nfse-chk-use-zip" ${prefs.useZip !== false ? 'checked' : ''} />
              <div class="nfse-bulk-zip-text-wrap">
                <span class="nfse-bulk-zip-title">📦 Compactar tudo em .ZIP</span>
                <span class="nfse-bulk-zip-hint">[Recomendado: evita bloqueio pelo navegador]</span>
              </div>
            </label>
          </div>

          <div class="nfse-bulk-field nfse-bulk-batchname-wrap">
            <label for="nfse-input-batch-name">Nome do arquivo/lote:</label>
            <input
              type="text"
              id="nfse-input-batch-name"
              class="nfse-bulk-input"
              value="${suggestedBatchName}"
              placeholder="NFSe_CPF-CNPJ_AAAA-MM-DD"
              title="Nome sugerido automaticamente com base no CPF/CNPJ consultado. Você pode editá-lo livremente."
            />
          </div>

          <div class="nfse-bulk-controls-grid">
            <div class="nfse-bulk-field">
              <label for="nfse-input-delay">Intervalo (ms)</label>
              <input
                type="number"
                id="nfse-input-delay"
                class="nfse-bulk-input"
                min="50"
                max="5000"
                step="50"
                value="${prefs.delayMs}"
                title="Tempo de espera entre downloads (Padrão: 100 ms)"
              />
            </div>
            <div class="nfse-bulk-field">
              <label for="nfse-select-concurrency">Fila Simultânea</label>
              <select id="nfse-select-concurrency" class="nfse-bulk-select">
                <option value="1" ${Number(prefs.concurrency) === 1 ? 'selected' : ''}>1x (Sequencial Seguro)</option>
                <option value="2" ${Number(prefs.concurrency) === 2 ? 'selected' : ''}>2x (Paralelo Moderado)</option>
              </select>
            </div>
          </div>
        </div>

        <div class="nfse-bulk-stats-grid">
          <div class="nfse-bulk-stat-card">
            <span class="nfse-bulk-stat-value" id="nfse-stat-found">${initialFiltered.accepted.length}</span>
            <span class="nfse-bulk-stat-label">No Período</span>
          </div>
          <div class="nfse-bulk-stat-card stat-xml">
            <span class="nfse-bulk-stat-value" id="nfse-stat-xml">0</span>
            <span class="nfse-bulk-stat-label">XMLs</span>
          </div>
          <div class="nfse-bulk-stat-card stat-pdf">
            <span class="nfse-bulk-stat-value" id="nfse-stat-pdf">0</span>
            <span class="nfse-bulk-stat-label">PDFs</span>
          </div>
          <div class="nfse-bulk-stat-card stat-err">
            <span class="nfse-bulk-stat-value" id="nfse-stat-err">0</span>
            <span class="nfse-bulk-stat-label">Erros</span>
          </div>
        </div>

        <div class="nfse-bulk-progress-wrap">
          <div class="nfse-bulk-progress-header">
            <span id="nfse-progress-text">Pronto para iniciar</span>
            <span id="nfse-progress-pct">0%</span>
          </div>
          <div class="nfse-bulk-progress-track">
            <div class="nfse-bulk-progress-fill" id="nfse-progress-bar"></div>
          </div>
        </div>

        <div class="nfse-bulk-actions">
          <button
            type="button"
            class="nfse-bulk-btn nfse-bulk-btn-primary"
            id="nfse-btn-start"
          >
            Baixar Lote
          </button>
          <button type="button" class="nfse-bulk-btn nfse-bulk-btn-warning" id="nfse-btn-pause" disabled>
            Pausar
          </button>
          <button type="button" class="nfse-bulk-btn nfse-bulk-btn-danger" id="nfse-btn-cancel" disabled>
            Cancelar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    // Referências aos elementos da UI
    const dragHandle = root.querySelector('#nfse-bulk-drag-handle');
    const btnMinimize = root.querySelector('#nfse-bulk-btn-minimize');
    const domCountBadge = root.querySelector('#nfse-bulk-dom-count');

    const btnSinceForever = root.querySelector('#nfse-btn-since-forever');
    const dateFromPickerWrap = root.querySelector('#nfse-date-from-picker-wrap');
    const inputDateFrom = root.querySelector('#nfse-input-date-from');
    const btnClearDateFrom = root.querySelector('#nfse-btn-clear-date-from');
    const inputDateTo = root.querySelector('#nfse-input-date-to');

    const chkXml = root.querySelector('#nfse-chk-xml');
    const chkPdf = root.querySelector('#nfse-chk-pdf');
    const chkCsv = root.querySelector('#nfse-chk-csv');
    const chkAllPages = root.querySelector('#nfse-chk-all-pages');
    const chkUseZip = root.querySelector('#nfse-chk-use-zip');
    const inputBatchName = root.querySelector('#nfse-input-batch-name');
    const inputDelay = root.querySelector('#nfse-input-delay');
    const selectConcurrency = root.querySelector('#nfse-select-concurrency');

    const statFound = root.querySelector('#nfse-stat-found');
    const statXml = root.querySelector('#nfse-stat-xml');
    const statPdf = root.querySelector('#nfse-stat-pdf');
    const statErr = root.querySelector('#nfse-stat-err');

    const progressText = root.querySelector('#nfse-progress-text');
    const progressPct = root.querySelector('#nfse-progress-pct');
    const progressBar = root.querySelector('#nfse-progress-bar');

    const btnStart = root.querySelector('#nfse-btn-start');
    const btnPause = root.querySelector('#nfse-btn-pause');
    const btnCancel = root.querySelector('#nfse-btn-cancel');

    makeDraggable(root, dragHandle);

    let batchNameEditedByUser = false;

    inputBatchName.addEventListener('input', () => {
      batchNameEditedByUser = true;
    });

    // Se o usuário digitar um CPF/CNPJ nos filtros da própria página do portal e ainda não
    // tiver editado manualmente o nome do lote, atualiza a sugestão automaticamente.
    document.addEventListener('change', (e) => {
      if (e.target && !e.target.closest('#nfse-bulk-root') && !batchNameEditedByUser) {
        const freshSuggestion = NFSeBulk.Scraper.getSuggestedBatchName(document, window.location.href);
        if (freshSuggestion) {
          inputBatchName.value = freshSuggestion;
        }
      }
    });

    function getCurrentConfig() {
      const isSinceForeverVisible = !btnSinceForever.classList.contains('nfse-bulk-hidden');
      const dateFromVal = isSinceForeverVisible ? '' : (inputDateFrom.value || '').trim();
      const dateToVal = (inputDateTo.value || '').trim() || NFSeBulk.Scraper.getTodayLocalIso();
      const rawBatchName = (inputBatchName.value || '').trim();
      const fallbackBatchName = NFSeBulk.Scraper.getSuggestedBatchName(document, window.location.href);

      return {
        downloadXml: chkXml.checked,
        downloadPdf: chkPdf.checked,
        generateCsv: chkCsv.checked,
        scanAllPages: chkAllPages.checked,
        useZip: chkUseZip.checked,
        customBatchName: rawBatchName || fallbackBatchName,
        dateFrom: dateFromVal,
        dateTo: dateToVal,
        delayMs: Math.max(50, parseInt(inputDelay.value, 10) || 100),
        concurrency: parseInt(selectConcurrency.value, 10) || 2,
        minimized: root.classList.contains('nfse-bulk-minimized')
      };
    }

    function persistCurrentConfig() {
      const cfg = getCurrentConfig();
      savePrefs({
        downloadXml: cfg.downloadXml,
        downloadPdf: cfg.downloadPdf,
        generateCsv: cfg.generateCsv,
        useZip: cfg.useZip,
        scanAllPages: cfg.scanAllPages,
        dateFrom: cfg.dateFrom,
        delayMs: cfg.delayMs,
        concurrency: cfg.concurrency,
        minimized: cfg.minimized
      });
    }

    /**
     * Recalcula quantas notas da página atual atendem ao filtro "De / Até" em tempo real.
     */
    function refreshCurrentPageFilteredCount() {
      const cfg = getCurrentConfig();
      const liveNotes = NFSeBulk.Scraper.extractNotesFromDocument(document, window.location.href);
      const { accepted } = NFSeBulk.Scraper.filterNotesByDateRange(liveNotes, cfg.dateFrom, cfg.dateTo);
      statFound.textContent = String(accepted.length);
      domCountBadge.textContent = `${accepted.length}/${liveNotes.length} nesta pág.${
        paginationLinks.length > 0 ? ' (+págs)' : ''
      }`;
    }

    // Interação do campo "De": alternar entre "Desde sempre" e <input type="date">
    btnSinceForever.addEventListener('click', () => {
      btnSinceForever.classList.add('nfse-bulk-hidden');
      dateFromPickerWrap.classList.remove('nfse-bulk-hidden');
      if (!inputDateFrom.value) {
        inputDateFrom.value = inputDateTo.value || NFSeBulk.Scraper.getTodayLocalIso();
      }
      inputDateFrom.focus();
      if (typeof inputDateFrom.showPicker === 'function') {
        try {
          inputDateFrom.showPicker();
        } catch (_) {
          // Alguns navegadores exigem interação direta no input
        }
      }
      persistCurrentConfig();
      refreshCurrentPageFilteredCount();
    });

    // Botão '×' para limpar a data inicial e voltar para "Desde sempre"
    btnClearDateFrom.addEventListener('click', () => {
      inputDateFrom.value = '';
      dateFromPickerWrap.classList.add('nfse-bulk-hidden');
      btnSinceForever.classList.remove('nfse-bulk-hidden');
      persistCurrentConfig();
      refreshCurrentPageFilteredCount();
    });

    inputDateFrom.addEventListener('change', () => {
      if (!inputDateFrom.value) {
        dateFromPickerWrap.classList.add('nfse-bulk-hidden');
        btnSinceForever.classList.remove('nfse-bulk-hidden');
      }
      persistCurrentConfig();
      refreshCurrentPageFilteredCount();
    });

    inputDateTo.addEventListener('change', () => {
      if (!inputDateTo.value) {
        inputDateTo.value = NFSeBulk.Scraper.getTodayLocalIso();
      }
      persistCurrentConfig();
      refreshCurrentPageFilteredCount();
    });

    [chkXml, chkPdf, chkCsv, chkAllPages, chkUseZip, inputDelay, selectConcurrency].forEach((el) => {
      el.addEventListener('change', persistCurrentConfig);
    });

    btnMinimize.addEventListener('click', () => {
      const isMin = root.classList.toggle('nfse-bulk-minimized');
      btnMinimize.textContent = isMin ? '+' : '−';
      persistCurrentConfig();
    });

    function setControlsRunningState(isRunning) {
      btnSinceForever.disabled = isRunning;
      inputDateFrom.disabled = isRunning;
      btnClearDateFrom.disabled = isRunning;
      inputDateTo.disabled = isRunning;
      chkXml.disabled = isRunning;
      chkPdf.disabled = isRunning;
      chkCsv.disabled = isRunning;
      chkAllPages.disabled = isRunning;
      chkUseZip.disabled = isRunning;
      inputBatchName.disabled = isRunning;
      inputDelay.disabled = isRunning;
      selectConcurrency.disabled = isRunning;
      btnStart.disabled = isRunning;
      btnPause.disabled = !isRunning;
      btnCancel.disabled = !isRunning;
      if (!isRunning) {
        btnPause.textContent = 'Pausar';
      }
    }

    function updateProgressUI(completed, total, label) {
      const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      if (label) {
        progressText.textContent = label;
      }
    }

    /**
     * Inicia o processo de coleta e download conforme as opções marcadas.
     */
    async function startBatchDownload() {
      const config = getCurrentConfig();
      if (!config.downloadXml && !config.downloadPdf && !config.generateCsv) {
        updateProgressUI(0, 100, 'Selecione ao menos XML, PDF ou Planilha CSV.');
        return;
      }

      if (config.dateFrom && config.dateTo && config.dateFrom > config.dateTo) {
        updateProgressUI(0, 100, 'Data inicial maior que a data final.');
        return;
      }

      // Quando a opção .ZIP estiver marcada (padrão), não pede pasta via showDirectoryPicker.
      // Só abre seletor de pasta caso o usuário tenha desmarcado a opção .ZIP.
      let rootDirectoryHandle = null;
      const useZip = config.useZip;

      if (!useZip && typeof window.showDirectoryPicker === 'function') {
        try {
          updateProgressUI(0, 100, 'Selecione uma pasta permitida ou marque a opção .ZIP...');
          rootDirectoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
          });
        } catch (pickerErr) {
          if (pickerErr && pickerErr.name === 'AbortError') {
            updateProgressUI(0, 100, 'Seleção de pasta cancelada.');
            return;
          }
          // Se o navegador bloquear a pasta escolhida, avisa ou segue avulso
        }
      }

      setControlsRunningState(true);
      cancelScanRequested = false;
      statXml.textContent = '0';
      statPdf.textContent = '0';
      statErr.textContent = '0';
      updateProgressUI(0, 100, 'Coletando e filtrando notas...');

      try {
        // Fase 1: Coleta, Paginação (com Early Stop) e Filtragem por Data de Emissão
        const notes = await NFSeBulk.Scraper.collectAllNotes({
          scanAllPages: config.scanAllPages,
          dateFrom: config.dateFrom,
          dateTo: config.dateTo,
          pageDelayMs: Math.min(400, Math.max(80, Math.round(config.delayMs))),
          shouldStop: () => cancelScanRequested,
          onPageProgress: ({ currentPage, totalKnownPages, totalNotesFound }) => {
            statFound.textContent = String(totalNotesFound);
            updateProgressUI(
              currentPage,
              Math.max(currentPage, totalKnownPages),
              `Varrendo pág. ${currentPage} de ${totalKnownPages} (${totalNotesFound} no período)...`
            );
          }
        });

        if (cancelScanRequested) {
          updateProgressUI(0, 100, 'Operação cancelada.');
          setControlsRunningState(false);
          return;
        }

        statFound.textContent = String(notes.length);

        if (notes.length === 0) {
          updateProgressUI(0, 100, 'Nenhuma nota encontrada no período.');
          setControlsRunningState(false);
          return;
        }

        // Caso o nome do lote ainda seja o genérico "NFSe_Lote_..." e o usuário não o tenha editado,
        // verifica se nas páginas coletadas há um CPF/CNPJ para atualizar o nome antes de salvar
        let finalBatchName = config.customBatchName;
        if (!batchNameEditedByUser && /^NFSe_Lote_/i.test(finalBatchName)) {
          const detectedFromNotes =
            notes[0] && notes[0].contraparte
              ? NFSeBulk.Scraper.extractCleanCpfCnpj(notes[0].contraparte)
              : '';
          if (detectedFromNotes) {
            finalBatchName = `NFSe_${detectedFromNotes}_${NFSeBulk.Scraper.getTodayLocalIso()}`;
            inputBatchName.value = finalBatchName;
          }
        }

        // Fase 2: Fila de Downloads + Extração XML -> CSV + Empacotamento .ZIP (ou pasta)
        activeController = new NFSeBulk.Downloader.BulkDownloadController();

        await activeController.run(
          notes,
          {
            ...config,
            useZip,
            customBatchName: finalBatchName,
            rootDirectoryHandle
          },
          {
            onProgress: ({ completed, total, xmlSuccess, pdfSuccess, errorCount, currentLabel }) => {
              statXml.textContent = String(xmlSuccess);
              statPdf.textContent = String(pdfSuccess);
              statErr.textContent = String(errorCount);
              updateProgressUI(completed, total, currentLabel);
            }
          }
        );
      } catch (err) {
        updateProgressUI(0, 100, `Erro: ${err.message}`);
      } finally {
        activeController = null;
        setControlsRunningState(false);
      }
    }

    // Botão Unificado: Baixar Lote
    btnStart.addEventListener('click', () => startBatchDownload());

    // Evento: Pausar / Retomar
    btnPause.addEventListener('click', () => {
      if (!activeController) return;
      if (activeController.status === 'running') {
        activeController.pause();
        btnPause.textContent = 'Retomar';
        progressText.textContent = 'Fila pausada pelo usuário';
      } else if (activeController.status === 'paused') {
        activeController.resume();
        btnPause.textContent = 'Pausar';
      }
    });

    // Evento: Cancelar
    btnCancel.addEventListener('click', () => {
      cancelScanRequested = true;
      if (activeController) {
        activeController.cancel();
      }
      progressText.textContent = 'Cancelando...';
    });

    // Escuta comando do ícone da extensão (service-worker) para mostrar/expandir o painel
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message && message.action === 'TOGGLE_NFSE_PANEL') {
          const isMin = root.classList.toggle('nfse-bulk-minimized');
          btnMinimize.textContent = isMin ? '+' : '−';
          persistCurrentConfig();
          sendResponse({ ok: true, minimized: isMin });
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel);
  } else {
    initPanel();
  }
})(typeof window !== 'undefined' ? window : globalThis);
