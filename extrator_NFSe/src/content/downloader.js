/**
 * @file downloader.js
 * @description Fila resiliente de downloads em lote com rate-limiting, retry exponencial,
 * validação de assinatura binária (XML / %PDF), extração para CSV e empacotamento .ZIP (padrão recomendado)
 * ou salvamento descompactado, utilizando o nome de lote dinâmico/editável (NFSe_CPF-CNPJ_Data).
 */

(function (global) {
  'use strict';

  const NFSeBulk = (global.NFSeBulk = global.NFSeBulk || {});

  /**
   * Aguarda N milissegundos com pequeno jitter anti-WAF (±12%).
   * @param {number} baseMs
   * @returns {Promise<void>}
   */
  function sleepWithJitter(baseMs) {
    const ms = Math.max(20, Math.round(baseMs * (0.88 + Math.random() * 0.24)));
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Verifica se um ArrayBuffer começa com a assinatura mágica '%PDF-' (0x25 0x50 0x44 0x46 0x2D).
   * @param {ArrayBuffer} buffer
   * @returns {boolean}
   */
  function isValidPdfBuffer(buffer) {
    if (!buffer || buffer.byteLength < 5) return false;
    const bytes = new Uint8Array(buffer, 0, 5);
    return (
      bytes[0] === 0x25 && // %
      bytes[1] === 0x50 && // P
      bytes[2] === 0x44 && // D
      bytes[3] === 0x46 && // F
      bytes[4] === 0x2d    // -
    );
  }

  /**
   * Verifica se o texto retornado é realmente um XML da NFS-e e não uma página HTML de login/captcha.
   * @param {string} text
   * @returns {boolean}
   */
  function isValidXmlContent(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (/^<!doctype\s+html/i.test(trimmed) || /^<html/i.test(trimmed)) {
      return false;
    }
    return (
      trimmed.startsWith('<?xml') ||
      trimmed.includes('<NFSe') ||
      trimmed.includes('<infNFSe') ||
      trimmed.includes('<nfse')
    );
  }

  /**
   * Executa um fetch com credenciais de sessão e lógica de retry (até maxRetries tentativas).
   * @param {string} url
   * @param {'text'|'arrayBuffer'} responseType
   * @param {Object} options
   * @returns {Promise<string|ArrayBuffer>}
   */
  async function fetchWithRetry(url, responseType, options = {}) {
    const {
      maxRetries = 3,
      baseDelayMs = 300,
      checkCancelled = () => false
    } = options;

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (checkCancelled()) {
        throw new Error('Operação cancelada pelo usuário.');
      }

      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store'
        });

        if (response.redirected && /login|acesso|autenticacao/i.test(response.url)) {
          throw new Error('Sessão expirada (redirecionado para tela de login).');
        }

        if (response.status === 429) {
          const waitTime = 2200 * attempt;
          await sleepWithJitter(waitTime);
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} (${response.statusText || 'Erro no servidor'})`);
        }

        if (responseType === 'arrayBuffer') {
          const buffer = await response.arrayBuffer();
          if (!isValidPdfBuffer(buffer)) {
            const preview = new TextDecoder('utf-8').decode(buffer.slice(0, 300));
            if (/captcha|hcaptcha|g-recaptcha/i.test(preview)) {
              throw new Error('Bloqueio de Captcha detectado ao baixar o PDF.');
            }
            if (/<!doctype html|<html/i.test(preview)) {
              throw new Error('O servidor retornou HTML em vez de PDF (verifique a sessão).');
            }
            throw new Error('Arquivo PDF inválido ou corrompido.');
          }
          return buffer;
        } else {
          const text = await response.text();
          if (!isValidXmlContent(text)) {
            if (/captcha|hcaptcha|g-recaptcha/i.test(text)) {
              throw new Error('Bloqueio de Captcha detectado ao baixar o XML.');
            }
            throw new Error('O servidor retornou HTML em vez de XML válido.');
          }
          return text;
        }
      } catch (err) {
        lastError = err;
        if (checkCancelled() || /cancelada pelo usuário|Sessão expirada/i.test(err.message)) {
          throw err;
        }
        if (attempt < maxRetries) {
          const backoff = Math.max(300, baseDelayMs) * Math.pow(1.8, attempt - 1);
          await sleepWithJitter(backoff);
        }
      }
    }

    throw lastError || new Error('Falha desconhecida no download.');
  }

  /**
   * Sanitiza string para compor nome de arquivo ou pasta válido no Windows/macOS/Linux.
   * Remove caracteres proibidos (como /, \, :, *, ?, ", <, >, |) substituindo por '-' ou '_'.
   * @param {string} name
   * @returns {string}
   */
  function sanitizeFileName(name) {
    return String(name || '')
      .trim()
      .replace(/\.zip$/i, '')
      .replace(/[/\\]+/g, '-')
      .replace(/[<>:"|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^[_.-]+|[_.-]+$/g, '')
      .slice(0, 120);
  }

  /**
   * Formata data atual YYYY-MM-DD para fallback de nomeação.
   * @returns {string}
   */
  function getTodayIsoFallback() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * Dispara o download de um Blob na memória do navegador.
   * @param {Blob} blob
   * @param {string} fileName
   */
  function triggerBrowserDownload(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 15000);
  }

  /**
   * Grava um arquivo diretamente dentro de um FileSystemDirectoryHandle.
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} fileName
   * @param {string|ArrayBuffer|Blob} content
   */
  async function writeFileToDirectory(dirHandle, fileName, content) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * Controlador de execução da fila de downloads em lote (.ZIP ou descompactado).
   */
  class BulkDownloadController {
    constructor() {
      this.status = 'idle'; // 'idle' | 'running' | 'paused' | 'cancelled' | 'completed'
      this._pausePromiseResolve = null;
    }

    pause() {
      if (this.status === 'running') {
        this.status = 'paused';
      }
    }

    resume() {
      if (this.status === 'paused') {
        this.status = 'running';
        if (this._pausePromiseResolve) {
          const resolve = this._pausePromiseResolve;
          this._pausePromiseResolve = null;
          resolve();
        }
      }
    }

    cancel() {
      this.status = 'cancelled';
      if (this._pausePromiseResolve) {
        const resolve = this._pausePromiseResolve;
        this._pausePromiseResolve = null;
        resolve();
      }
    }

    async _waitIfPaused() {
      while (this.status === 'paused') {
        await new Promise((resolve) => {
          this._pausePromiseResolve = resolve;
        });
      }
    }

    isCancelled() {
      return this.status === 'cancelled';
    }

    /**
     * Executa o processamento de uma lista de notas coletadas pelo Scraper.
     * @param {Array<Object>} notes Lista de notas extraídas
     * @param {Object} config Configurações escolhidas na UI
     * @param {boolean} config.downloadXml
     * @param {boolean} config.downloadPdf
     * @param {boolean} config.generateCsv
     * @param {boolean} [config.useZip=true] Se verdadeiro, agrupa tudo em um único arquivo .ZIP
     * @param {string} [config.customBatchName=''] Nome do arquivo/lote definido no input da UI
     * @param {FileSystemDirectoryHandle} [config.rootDirectoryHandle=null] Pasta escolhida quando useZip=false
     * @param {number} [config.delayMs=100]
     * @param {number} [config.concurrency=2]
     * @param {Object} callbacks
     * @param {Function} callbacks.onProgress
     * @returns {Promise<Object>} Resumo da operação
     */
    async run(notes, config, callbacks = {}) {
      const {
        downloadXml = true,
        downloadPdf = false,
        generateCsv = true,
        useZip = true,
        customBatchName = '',
        rootDirectoryHandle = null,
        delayMs = 100,
        concurrency = 2
      } = config;

      const {
        onProgress = () => {}
      } = callbacks;

      if (useZip && typeof JSZip === 'undefined') {
        throw new Error('Biblioteca JSZip não carregada.');
      }

      this.status = 'running';
      const batchBaseName =
        sanitizeFileName(customBatchName) || `NFSe_Lote_${getTodayIsoFallback()}`;

      // Configuração de destino: JSZip (memória) OU Pasta Real / Avulso
      const zip = useZip ? new JSZip() : null;
      const xmlZipFolder = useZip && downloadXml ? zip.folder('xml') : null;
      const pdfZipFolder = useZip && downloadPdf ? zip.folder('pdf') : null;

      let batchDirHandle = null;
      let xmlDirHandle = null;
      let pdfDirHandle = null;

      if (!useZip && rootDirectoryHandle) {
        batchDirHandle = await rootDirectoryHandle.getDirectoryHandle(batchBaseName, { create: true });
        if (downloadXml) {
          xmlDirHandle = await batchDirHandle.getDirectoryHandle('xml', { create: true });
        }
        if (downloadPdf) {
          pdfDirHandle = await batchDirHandle.getDirectoryHandle('pdf', { create: true });
        }
      }

      const parsedCsvRecords = [];
      const errorsLog = [];

      let completedCount = 0;
      let xmlSuccess = 0;
      let pdfSuccess = 0;
      let errorCount = 0;
      const totalNotes = notes.length;

      const safeConcurrency = Math.min(2, Math.max(1, parseInt(concurrency, 10) || 2));
      let cursor = 0;

      const reportProgress = (currentLabel = '') => {
        onProgress({
          completed: completedCount,
          total: totalNotes,
          xmlSuccess,
          pdfSuccess,
          errorCount,
          status: this.status,
          currentLabel
        });
      };

      reportProgress('Iniciando fila de downloads...');

      const processSingleNote = async (note, index) => {
        await this._waitIfPaused();
        if (this.isCancelled()) return;

        const shortId = note.numero
          ? `Nº ${note.numero}`
          : note.chave
            ? `...${note.chave.slice(-8)}`
            : `#${index + 1}`;

        let baseIdentifier = sanitizeFileName(
          note.chave || note.numero || `Nota_${String(index + 1).padStart(4, '0')}`
        );

        let noteHadError = false;

        // 1. Download de XML (necessário se downloadXml=true OU generateCsv=true)
        if ((downloadXml || generateCsv) && note.xmlUrl) {
          try {
            const xmlText = await fetchWithRetry(note.xmlUrl, 'text', {
              maxRetries: 3,
              baseDelayMs: Math.max(250, delayMs),
              checkCancelled: () => this.isCancelled()
            });

            let parsedData = null;
            try {
              parsedData = NFSeBulk.XMLParser.parseNFSeXML(xmlText);
              if (parsedData.numeroNFSe && parsedData.chaveAcesso) {
                baseIdentifier = sanitizeFileName(`${parsedData.numeroNFSe}_${parsedData.chaveAcesso}`);
              } else if (parsedData.chaveAcesso) {
                baseIdentifier = sanitizeFileName(parsedData.chaveAcesso);
              }
            } catch (_) {
              // Mantém baseIdentifier padrão caso alguma tag opcional falhe
            }

            const xmlFileName = `NFSe_${baseIdentifier}.xml`;
            if (parsedData) {
              parsedData.arquivoXml = downloadXml ? `xml/${xmlFileName}` : '(Apenas Resumo CSV)';
              if (generateCsv) {
                parsedCsvRecords.push({ index, data: parsedData });
              }
            }

            if (downloadXml) {
              if (useZip && xmlZipFolder) {
                xmlZipFolder.file(xmlFileName, xmlText);
              } else if (xmlDirHandle) {
                await writeFileToDirectory(xmlDirHandle, xmlFileName, xmlText);
              } else {
                const xmlBlob = new Blob([xmlText], { type: 'application/xml;charset=utf-8' });
                triggerBrowserDownload(xmlBlob, xmlFileName);
              }
              xmlSuccess++;
            }
          } catch (err) {
            if (this.isCancelled()) return;
            noteHadError = true;
            errorsLog.push(`[XML] Nota ${shortId} (${note.xmlUrl}): ${err.message}`);
          }

          if (!this.isCancelled() && downloadPdf && note.pdfUrl) {
            await sleepWithJitter(Math.round(delayMs * 0.6));
          }
        }

        await this._waitIfPaused();
        if (this.isCancelled()) return;

        // 2. Download de PDF (DANFSe)
        if (downloadPdf && note.pdfUrl) {
          try {
            const pdfBuffer = await fetchWithRetry(note.pdfUrl, 'arrayBuffer', {
              maxRetries: 3,
              baseDelayMs: Math.max(250, delayMs),
              checkCancelled: () => this.isCancelled()
            });

            const pdfFileName = `DANFSe_${baseIdentifier}.pdf`;
            if (useZip && pdfZipFolder) {
              pdfZipFolder.file(pdfFileName, pdfBuffer);
            } else if (pdfDirHandle) {
              await writeFileToDirectory(pdfDirHandle, pdfFileName, pdfBuffer);
            } else {
              const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
              triggerBrowserDownload(pdfBlob, pdfFileName);
            }
            pdfSuccess++;
          } catch (err) {
            if (this.isCancelled()) return;
            noteHadError = true;
            errorsLog.push(`[PDF] Nota ${shortId} (${note.pdfUrl}): ${err.message}`);
          }
        }

        if (noteHadError) {
          errorCount++;
        }

        completedCount++;
        reportProgress(`Baixando nota ${completedCount} de ${totalNotes} (${shortId})...`);
      };

      const worker = async () => {
        while (cursor < totalNotes) {
          await this._waitIfPaused();
          if (this.isCancelled()) break;

          const currentIndex = cursor++;
          const currentNote = notes[currentIndex];

          await processSingleNote(currentNote, currentIndex);

          if (cursor < totalNotes && !this.isCancelled()) {
            await sleepWithJitter(delayMs);
          }
        }
      };

      const workers = [];
      for (let w = 0; w < safeConcurrency; w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (this.isCancelled()) {
        return {
          cancelled: true,
          completedCount,
          xmlSuccess,
          pdfSuccess,
          errorCount
        };
      }

      if (xmlSuccess === 0 && pdfSuccess === 0 && parsedCsvRecords.length === 0) {
        this.status = 'completed';
        throw new Error('Nenhum arquivo pôde ser baixado. Verifique se sua sessão continua ativa.');
      }

      // 3. Gera a planilha resumo CSV ordenada na mesma sequência das notas
      if (generateCsv && parsedCsvRecords.length > 0) {
        parsedCsvRecords.sort((a, b) => a.index - b.index);
        const orderedData = parsedCsvRecords.map((item) => item.data);
        const csvContent = NFSeBulk.XMLParser.generateSummaryCSV(orderedData);

        if (useZip && zip) {
          zip.file('resumo_notas.csv', csvContent);
        } else if (batchDirHandle) {
          await writeFileToDirectory(batchDirHandle, 'resumo_notas.csv', csvContent);
        } else {
          const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          triggerBrowserDownload(csvBlob, `${batchBaseName}_resumo.csv`);
        }
      }

      // 4. Relatório de erros (se houver)
      if (errorsLog.length > 0) {
        const errorReport = [
          'RELATÓRIO DE OCORRÊNCIAS — EXTRATOR NFS-e',
          `Data/Hora: ${new Date().toLocaleString('pt-BR')}`,
          `Total de Notas na Fila: ${totalNotes}`,
          `XMLs Baixados: ${xmlSuccess} | PDFs Baixados: ${pdfSuccess} | Notas com Falha: ${errorCount}`,
          '------------------------------------------------------------------------',
          ...errorsLog
        ].join('\r\n');

        if (useZip && zip) {
          zip.file('relatorio_erros.txt', errorReport);
        } else if (batchDirHandle) {
          await writeFileToDirectory(batchDirHandle, 'relatorio_erros.txt', errorReport);
        }
      }

      // 5. Se for modo .ZIP, compacta e dispara o download do .ZIP usando o nome configurado
      if (useZip && zip) {
        reportProgress('Compactando arquivos em pacote .ZIP...');

        const zipBlob = await zip.generateAsync(
          {
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          },
          (metadata) => {
            reportProgress(`Compactando .ZIP (${metadata.percent.toFixed(0)}%)...`);
          }
        );

        const zipFileName = `${batchBaseName}.zip`;
        triggerBrowserDownload(zipBlob, zipFileName);

        this.status = 'completed';
        reportProgress(`Concluído! ${zipFileName} baixado.`);

        return {
          cancelled: false,
          zipFileName,
          completedCount,
          xmlSuccess,
          pdfSuccess,
          csvRows: parsedCsvRecords.length,
          errorCount
        };
      }

      this.status = 'completed';
      reportProgress(`Concluído! Pasta "${batchBaseName}" salva com sucesso.`);

      return {
        cancelled: false,
        folderName: batchBaseName,
        completedCount,
        xmlSuccess,
        pdfSuccess,
        csvRows: parsedCsvRecords.length,
        errorCount
      };
    }
  }

  NFSeBulk.Downloader = {
    BulkDownloadController,
    fetchWithRetry,
    sanitizeFileName,
    isValidPdfBuffer,
    isValidXmlContent
  };
})(typeof window !== 'undefined' ? window : globalThis);
