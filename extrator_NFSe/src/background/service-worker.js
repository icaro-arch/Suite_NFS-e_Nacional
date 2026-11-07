/**
 * @file service-worker.js
 * @description Service Worker (Manifest V3) para gerenciamento do atalho de barra de ferramentas
 * e redirecionamento para o Painel Municipal da NFS-e (/PainelMunicipal/NFSe/Consulta).
 */

'use strict';

const PAINEL_MUNICIPAL_CONSULTA_URL = 'https://www.nfse.gov.br/PainelMunicipal/NFSe/Consulta';

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      nfse_bulk_user_prefs_v3: {
        downloadXml: true,
        downloadPdf: false,
        generateCsv: true,
        useZip: true,
        scanAllPages: true,
        dateFrom: '',
        delayMs: 100,
        concurrency: 2,
        minimized: false
      }
    });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const currentUrl = tab.url || '';
  if (currentUrl.includes('nfse.gov.br/PainelMunicipal')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_NFSE_PANEL' });
    } catch (_) {
      chrome.tabs.reload(tab.id);
    }
  } else {
    chrome.tabs.create({ url: PAINEL_MUNICIPAL_CONSULTA_URL });
  }
});
