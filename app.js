/* ========= CONFIG ========= */
const GOOGLE_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbwy_aKGV9xAd9sBJRGG66LohrR3s0l_DbDCnOveCEHaE_RGjNqgTHbkiBX8ngks3-nO/exec';
const APP_VERSION = 'v13.1 - Correção Decimais Estoque';
const ENVIO_DELAY_MS = 500;

// Configuração para busca de estoque (Do Script do Site)
const STOCK_CONFIG = {
  SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6FsKfgWJxQBzkKSP3ekD-Tbb7bfvGs_Df9aUT9bkv8gPL8dySYVkMmFdlajdrgxLZUs3pufrc0ZX8/pub?gid=1353948690&single=true&output=csv',
  PROXIES: [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
  ]
};

/* ========= VARS ========= */
const ITENS_KEY = 'inv_granel_itens_v5_final';
const NOME_USUARIO_KEY = 'inventarioGranelUsuario';
let nomeUsuario = '', enviando = false, letraPoteSel = 'Nenhuma', itens = [], MAPA = {};
let MAPA_ESTOQUE_SISTEMA = {}; // Novo mapa para estoque
let editandoItemId = null;

/* refs DOM */
const $ = id => document.getElementById(id);
const codigoInp=$('codigoProduto'), nomeDiv=$('nomeProdutoDisplay'),
      taraInp=$('pesoTaraKg'),
      pesoComPoteInp=$('pesoComPoteKg'),
      pesoExtraInp=$('pesoExtraKg'),
      btnReg=$('registrarItemBtn'), textoBotaoRegistrar=$('textoBotaoRegistrar'),
      tbody=$('listaItensBody'),
      letras=$('botoesTaraContainer'),
      statusDiv=$('statusEnvio'), statusMensagem=$('statusMensagem'),
      progressBarContainer=$('progressBarContainer'), progressBar=$('progressBar'),
      nomeDisp=$('nomeUsuarioDisplay'), modal=$('modalNomeUsuario'),
      overlay=$('overlayNomeUsuario'), inpNome=$('inputNomeUsuario'),
      spanLetra=$('letraPoteSelecionado'), enviarTodosBtn=$('enviarTodosBtn'),
      textoBotaoEnviar=$('textoBotaoEnviar'),
      totalizadorPendentes=$('totalizadorPendentes'),
      btnLimpar=$('limparSessaoLocalBtn'),
      btnAlterarNome=$('alterarNomeBtn'), salvaNmBtn=$('salvarNomeUsuarioBtn'),
      closeModalNomeBtn=$('closeModalNomeBtn'),
      calculoPesoLiquidoDisplay=$('calculoPesoLiquidoDisplay');

// Novos elementos para estoque
const estoqueSistemaContainer = $('estoqueSistemaContainer');
const estoqueSistemaDisplay = $('estoqueSistemaDisplay');

const codigoProdutoError = $('codigoProdutoError');
const pesoTaraKgError = $('pesoTaraKgError');
const pesoComPoteKgError = $('pesoComPoteKgError');
const pesoExtraKgError = $('pesoExtraKgError');
const inputNomeUsuarioError = $('inputNomeUsuarioError');


/* ---------- INIT ---------- */
document.addEventListener('DOMContentLoaded', async ()=>{
  console.log('App carregado:', APP_VERSION);
  setupEventListeners();
  carregaLocais();
  await carregaPotes(); // Carrega produtos locais (potes.json)
  carregarEstoqueDoSistema(); // Carrega estoque online (CSV) em background
  renderizaLista();
  verificaNomeUsuario();
  updateBotaoRegistrar();
  selecionaBotaoNenhuma();
  limpaMensagensErro();
});

/* ---------- Setup Eventos ---------- */
function setupEventListeners() {
  salvaNmBtn.addEventListener('click', salvaNome);
  inpNome.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Done') salvaNome(); });
  nomeDisp.addEventListener('click', abrirModalNome);
  btnAlterarNome.addEventListener('click', abrirModalNome);
  closeModalNomeBtn.addEventListener('click', fecharModalNome);
  overlay.addEventListener('click', fecharModalNome);

  const goKeys = ['Enter','Go','Next','Done','Send'];
  codigoInp.addEventListener('keydown', e => { if (goKeys.includes(e.key)) { e.preventDefault(); taraInp.focus(); taraInp.select();} });
  taraInp.addEventListener('keydown', e => { if (goKeys.includes(e.key)) { e.preventDefault(); pesoComPoteInp.focus(); pesoComPoteInp.select();} });
  pesoComPoteInp.addEventListener('keydown', e => { if (goKeys.includes(e.key)) { e.preventDefault(); pesoExtraInp.focus(); pesoExtraInp.select();}});
  pesoExtraInp.addEventListener('keydown', e => { if (goKeys.includes(e.key)) { e.preventDefault(); btnReg.click(); }});

  [codigoInp, taraInp, pesoComPoteInp, pesoExtraInp].forEach(inp => {
    inp.addEventListener('input', () => {
      limpaErroCampo(inp.id + 'Error');
      if (inp === pesoComPoteInp || inp === taraInp || inp === pesoExtraInp) {
        atualizaDisplayCalculoPeso();
      }
      updateBotaoRegistrar();
    });
    if (inp.inputMode === 'decimal') {
        inp.addEventListener('input', formataEntradaNumerica);
    }
  });

  codigoInp.addEventListener('blur', buscaTaraAutomatica);
  // Adiciona evento de input para atualizar estoque enquanto digita (opcional, mas bom)
  codigoInp.addEventListener('input', () => {
      const codigo = codigoInp.value.trim();
      atualizaDisplayEstoque(codigo);
  });
  
  letras.addEventListener('click', handleTaraRapidaClick);
  const btnNenhumaFixo = document.querySelector('.tara-button[data-letra="Nenhuma"]');
  if (btnNenhumaFixo) {
      btnNenhumaFixo.addEventListener('click', handleTaraRapidaClick);
  }
  taraInp.addEventListener('input', handleTaraManualInput);
  btnReg.addEventListener('click', handleRegistrarOuSalvarItem);
  enviarTodosBtn.addEventListener('click', enviarTodos);
  btnLimpar.addEventListener('click', limparItensLocaisComOpcao);
}

/* ---------- Lógica de Estoque do Sistema (CSV) ---------- */
async function carregarEstoqueDoSistema() {
    console.log("Iniciando carga de estoque do sistema...");
    // Mostra indicador discreto se desejar, ou apenas loga
    try {
        let response;
        const urlComTimestamp = STOCK_CONFIG.SHEET_CSV_URL + '&t=' + Date.now(); // Cache busting na URL
        
        try {
            // Tenta fetch direto primeiro (pode falhar por CORS)
            response = await fetch(urlComTimestamp, { cache: 'no-store' });
            if (!response.ok) throw new Error('Falha direta');
        } catch (e) {
            console.log("Tentando via proxy...");
            response = await fetchWithProxy(STOCK_CONFIG.SHEET_CSV_URL);
        }

        const csvText = await response.text();
        const linhas = parseCSVSimples(csvText);
        
        // Processa CSV para MAPA_ESTOQUE_SISTEMA
        // SKU -> Quantidade Formatada
        MAPA_ESTOQUE_SISTEMA = {};
        
        linhas.forEach(item => {
            if(!item.SKU) return;
            const sku = String(item.SKU).trim();
            const isGranel = (item.CATEGORIA || '').toUpperCase() === 'GRANEL';
            
            // CORREÇÃO: Trata a vírgula como separador decimal
            // Ex: "2,34" vira "2.34" para o JavaScript entender
            let estoqueString = String(item.ESTOQUE || '0').replace(',', '.');
            let estoqueVal = parseFloat(estoqueString);
            
            // Fallback caso dê NaN
            if (isNaN(estoqueVal)) estoqueVal = 0;
            
            MAPA_ESTOQUE_SISTEMA[sku] = {
                estoque: estoqueVal,
                isGranel: isGranel
            };
        });
        
        console.log(`Estoque Sistema Carregado: ${Object.keys(MAPA_ESTOQUE_SISTEMA).length} itens.`);
        
        // Se já tiver código digitado, atualiza
        if(codigoInp.value) atualizaDisplayEstoque(codigoInp.value);

    } catch (error) {
        console.error("Erro ao carregar estoque do sistema:", error);
    }
}

async function fetchWithProxy(url) {
  const errors = [];
  for (const proxy of STOCK_CONFIG.PROXIES) {
    try {
      const response = await fetch(proxy + encodeURIComponent(url), { cache: 'no-store' });
      if (response.ok) return response;
    } catch (error) {
      continue;
    }
  }
  throw new Error('Falha nos proxies');
}

function parseCSVSimples(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  return lines.slice(1).map(line => {
    // Regex simples para CSV que lida com aspas
    const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/); 
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (values[index] || '').trim().replace(/^"|"$/g, '');
    });
    return obj;
  });
}

function atualizaDisplayEstoque(codigo) {
    codigo = String(codigo).trim();
    if (!codigo) {
        estoqueSistemaContainer.classList.add('hidden');
        return;
    }

    const itemSistema = MAPA_ESTOQUE_SISTEMA[codigo];
    
    if (itemSistema) {
        estoqueSistemaContainer.classList.remove('hidden');
        // Formatação
        let valorTexto = "";
        if (itemSistema.isGranel) {
            // Se for granel, mostra com 3 casas decimais kg
            valorTexto = itemSistema.estoque.toFixed(3) + " kg";
        } else {
            // Se unitário, inteiro, mas se tiver quebrado mostra até 2 casas
            // Math.floor removido para garantir que 0.5 un não vire 0
            if (Number.isInteger(itemSistema.estoque)) {
                valorTexto = itemSistema.estoque + " un";
            } else {
                valorTexto = itemSistema.estoque.toFixed(2).replace('.',',') + " un";
            }
        }
        estoqueSistemaDisplay.textContent = valorTexto;
        
        // Feedback visual se negativo
        if (itemSistema.estoque < 0) {
            estoqueSistemaDisplay.classList.add('text-red-600');
            estoqueSistemaDisplay.classList.remove('text-blue-700');
        } else {
            estoqueSistemaDisplay.classList.remove('text-red-600');
            estoqueSistemaDisplay.classList.add('text-blue-700');
        }
        
    } else {
        // Código não encontrado na planilha do sistema
        // Oculta ou mostra "ND" (Não Disponível)? Ocultar é mais "clean".
        estoqueSistemaContainer.classList.add('hidden');
    }
}


/* ---------- Nome Usuário ---------- */
function verificaNomeUsuario() {
  nomeUsuario = localStorage.getItem(NOME_USUARIO_KEY) || '';
  mostrarNome();
  if (!nomeUsuario) { abrirModalNome(); }
  updateBotaoRegistrar();
}
function abrirModalNome() {
  inpNome.value = nomeUsuario; limpaErroCampo(inputNomeUsuarioError);
  overlay.classList.add('active'); modal.classList.add('active');
  inpNome.focus(); if(nomeUsuario) inpNome.select();
}
function fecharModalNome() {
    overlay.classList.remove('active'); modal.classList.remove('active');
    limpaErroCampo(inputNomeUsuarioError);
}
function salvaNome() {
  const n = inpNome.value.trim(); if (!n) { mostraMensagemErroCampo(inputNomeUsuarioError, 'Por favor, digite seu nome.'); inpNome.focus(); return; }
  limpaErroCampo(inputNomeUsuarioError);
  nomeUsuario = n; localStorage.setItem(NOME_USUARIO_KEY, n); mostrarNome(); fecharModalNome(); updateBotaoRegistrar();
}
function mostrarNome() {
  nomeDisp.textContent = nomeUsuario ? `Usuário: ${nomeUsuario}` : 'Usuário: (Não definido - Clique para definir)';
}

/* ---------- Carregar Potes (Produtos) ---------- */
async function carregaPotes() {
  try { const response = await fetch('potes.json'); if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`); const data = await response.json(); MAPA = data.reduce((map, pote) => { map[String(pote.codigo).trim()] = pote; return map; }, {}); console.log('Potes carregados:', Object.keys(MAPA).length); geraBotoesTara(); } catch (error) { console.error("Erro ao carregar potes.json:", error); letras.innerHTML = '<span class="text-red-500">Erro ao carregar potes.</span>'; }
}

/* ---------- Gerar Botões de Tara Rápida ---------- */
function geraBotoesTara() {
    letras.innerHTML = ''; const potesUnicos = {};
    Object.values(MAPA).forEach(p => { if (p.letra && p.tara !== undefined && p.letra !== 'Nenhuma' && !potesUnicos[p.letra]) { potesUnicos[p.letra] = p.tara; } });
    Object.keys(potesUnicos).sort().forEach(letra => { const tara = potesUnicos[letra]; const btn = document.createElement('button'); btn.className = 'tara-button'; btn.dataset.taraKg = tara; btn.dataset.letra = letra; btn.innerHTML = `${letra} <i class="fas fa-check ml-1 hidden"></i>`; letras.appendChild(btn); });
}

/* ---------- Funções de Tara ---------- */
function handleTaraRapidaClick(event) {
    const btn = event.target.closest('.tara-button'); if (!btn) return;
    desmarcaBotoesTara(); btn.classList.add('selected'); btn.querySelector('i')?.classList.remove('hidden');
    taraInp.value = parseFloat(btn.dataset.taraKg).toFixed(3); limpaErroCampo(pesoTaraKgError);
    letraPoteSel = btn.dataset.letra; spanLetra.textContent = `(${letraPoteSel})`;
    if (letraPoteSel === 'Nenhuma') {
        pesoComPoteInp.value = '0.000'; pesoComPoteInp.classList.add('input-auto-filled');
        limpaErroCampo(pesoComPoteKgError); pesoExtraInp.focus(); pesoExtraInp.select();
    } else {
        pesoComPoteInp.classList.remove('input-auto-filled'); pesoComPoteInp.focus(); pesoComPoteInp.select();
    }
    atualizaDisplayCalculoPeso(); updateBotaoRegistrar();
}
function handleTaraManualInput() {
    desmarcaBotoesTara(); letraPoteSel = 'Manual'; spanLetra.textContent = '(Manual)';
    pesoComPoteInp.classList.remove('input-auto-filled');
    if (!taraInp.value.trim()) { selecionaBotaoNenhuma(); } else { limpaErroCampo(pesoTaraKgError); }
    atualizaDisplayCalculoPeso();
}
function desmarcaBotoesTara() {
    document.querySelectorAll('.tara-button.selected').forEach(b => { b.classList.remove('selected'); b.querySelector('i')?.classList.add('hidden'); });
}
function selecionaBotaoNenhuma() {
    desmarcaBotoesTara(); const btnNenhumaFixo = document.querySelector('.tara-button[data-letra="Nenhuma"]');
    if(btnNenhumaFixo) { btnNenhumaFixo.classList.add('selected'); btnNenhumaFixo.querySelector('i')?.classList.remove('hidden'); taraInp.value = parseFloat(btnNenhumaFixo.dataset.taraKg).toFixed(3); letraPoteSel = 'Nenhuma'; spanLetra.textContent = '(Nenhuma)'; }
    atualizaDisplayCalculoPeso();
}

/* ---------- Busca Tara Automática ---------- */
function buscaTaraAutomatica() {
  const codigo = codigoInp.value.trim(); limpaErroCampo(codigoProdutoError);
  
  // Atualiza display de estoque
  atualizaDisplayEstoque(codigo);

  const produto = MAPA[codigo];
  pesoComPoteInp.classList.remove('input-auto-filled');
  if (produto) {
    nomeDiv.textContent = produto.Nome || 'Produto sem nome';
    if (!taraInp.value.trim() || letraPoteSel === 'Nenhuma' || pesoComPoteInp.classList.contains('input-auto-filled')) {
        if (produto.tara !== undefined && produto.tara !== null && produto.letra && produto.letra !== "Nenhuma") {
            taraInp.value = parseFloat(produto.tara).toFixed(3); desmarcaBotoesTara();
            const btnLetra = document.querySelector(`.tara-button[data-letra="${produto.letra}"]`);
            if (btnLetra) { btnLetra.classList.add('selected'); btnLetra.querySelector('i')?.classList.remove('hidden'); letraPoteSel = produto.letra; spanLetra.textContent = `(${produto.letra})`; }
            else { letraPoteSel = 'Manual'; spanLetra.textContent = '(Manual)'; }
        } else {
            selecionaBotaoNenhuma();
            if (!produto.letra || produto.tara === 0 || produto.tara === null) {
                 pesoComPoteInp.value = '0.000'; pesoComPoteInp.classList.add('input-auto-filled');
            }
        }
    }
  } else {
    if(codigo) nomeDiv.textContent = 'Produto não cadastrado localmente'; else nomeDiv.textContent = '';
  }
  updateBotaoRegistrar(); atualizaDisplayCalculoPeso();
}

/* ---------- Estado Botão Registrar/Salvar ---------- */
function updateBotaoRegistrar() {
  const nomeOk = !!nomeUsuario; const codigoOk = codigoInp.value.trim() !== '';
  const pesoComPoteValor = pesoComPoteInp.value.trim(); const pesoExtraValor = pesoExtraInp.value.trim();
  const pesoOk = (pesoComPoteValor !== '') || (pesoComPoteValor === '' && pesoExtraValor !== '');
  btnReg.disabled = !(nomeOk && codigoOk && pesoOk);
  textoBotaoRegistrar.textContent = editandoItemId !== null ? 'Salvar Alterações' : 'Registrar Item Localmente';
}

/* ---------- Armazenamento Local ---------- */
function carregaLocais() { itens = JSON.parse(localStorage.getItem(ITENS_KEY) || '[]'); }
function salvaLocais() { localStorage.setItem(ITENS_KEY, JSON.stringify(itens)); renderizaLista(); }

/* ---------- Limpar Lista Local (MODIFICADO) ---------- */
function limparItensLocaisComOpcao() {
    if (enviando) {
        alert("Aguarde o término do envio atual antes de limpar a lista.");
        return;
    }
    if (itens.length === 0) {
        mostraStatus('A lista local já está vazia.', 'info');
        return;
    }

    if (confirm("Deseja limpar itens da lista local?\n(Itens enviados com sucesso serão mantidos por padrão)")) {
        if (confirm("Limpar TAMBÉM os itens já enviados com sucesso? (OK = Limpar TUDO, Cancelar = Limpar só Pendentes/Falhas)")) {
            itens = [];
            salvaLocais();
            mostraStatus('Toda a lista local foi limpa.', 'success');
        } else {
            const itensPendentesAntes = itens.filter(item => item.statusEnvio !== 'sucesso').length;
            if (itensPendentesAntes === 0) {
                mostraStatus('Nenhum item pendente ou com falha para limpar.', 'info');
                return;
            }
            itens = itens.filter(item => item.statusEnvio === 'sucesso');
            salvaLocais();
            mostraStatus(`Itens pendentes/com falha (${itensPendentesAntes}) foram limpos.`, 'success');
        }
    }
}


/* ---------- Validação e Feedback de Erro ---------- */
function formataEntradaNumerica(event) {
    let valor = event.target.value; valor = valor.replace(/[^0-9.,]/g, '').replace(',', '.');
    const partes = valor.split('.'); if (partes.length > 2) { valor = partes[0] + '.' + partes.slice(1).join(''); }
    event.target.value = valor;
}
function mostraMensagemErroCampo(campoOuId, mensagem) {
    const el = typeof campoOuId === 'string' ? $(campoOuId) : campoOuId; const inputEl = el.id.includes('Error') ? $(el.id.replace('Error', '')) : el;
    if (el.id.includes('Error')) { el.textContent = mensagem; } if (inputEl) inputEl.classList.add('input-error');
}
function limpaErroCampo(campoOuId) {
    const el = typeof campoOuId === 'string' ? $(campoOuId) : campoOuId; const inputEl = el.id.includes('Error') ? $(el.id.replace('Error', '')) : el;
    if (el.id.includes('Error')) { el.textContent = ''; } if (inputEl) inputEl.classList.remove('input-error');
}
function limpaMensagensErro() {
    [codigoProdutoError, pesoTaraKgError, pesoComPoteKgError, pesoExtraKgError, inputNomeUsuarioError].forEach(el => { if(el) limpaErroCampo(el); });
    [codigoInp, taraInp, pesoComPoteInp, pesoExtraInp, inpNome].forEach(inp => { if(inp) inp.classList.remove('input-error'); });
}
function validaCamposFormulario() {
    limpaMensagensErro(); let isValid = true;
    if (!codigoInp.value.trim()) { mostraMensagemErroCampo(codigoProdutoError, 'Código é obrigatório.'); isValid = false; }
    const taraStr = taraInp.value.replace(',', '.').trim(); const taraVal = parseFloat(taraStr);
    if (taraStr !== "" && isNaN(taraVal)) { mostraMensagemErroCampo(pesoTaraKgError, 'Tara inválida.'); isValid = false; }
    const pesoComPoteStr = pesoComPoteInp.value.replace(',', '.').trim(); const pesoComPoteVal = parseFloat(pesoComPoteStr);
    const pesoExtraStr = pesoExtraInp.value.replace(',', '.').trim(); const pesoExtraVal = parseFloat(pesoExtraStr);
    if (pesoComPoteStr === "" && pesoExtraStr === "") { mostraMensagemErroCampo(pesoComPoteKgError, 'Peso com pote ou Peso extra é obrigatório.'); isValid = false; }
    else if (pesoComPoteStr !== "" && isNaN(pesoComPoteVal)) { mostraMensagemErroCampo(pesoComPoteKgError, 'Peso com pote inválido.'); isValid = false; }
    if (pesoExtraStr !== "" && isNaN(pesoExtraVal)) { mostraMensagemErroCampo(pesoExtraKgError, 'Peso extra inválido.'); isValid = false; }
    return isValid;
}

/* ---------- Cálculo e Display Peso Líquido (Preview) ---------- */
function atualizaDisplayCalculoPeso() {
    const tara = parseFloat(taraInp.value.replace(',', '.')) || 0; const pesoComPote = parseFloat(pesoComPoteInp.value.replace(',', '.')) || 0; const pesoExtra = parseFloat(pesoExtraInp.value.replace(',', '.')) || 0;
    if (pesoComPoteInp.value.trim() === "" && pesoExtraInp.value.trim() === "") { calculoPesoLiquidoDisplay.textContent = ""; return; }
    const pesoLiquidoPote = pesoComPote - tara; const pesoLiquidoTotal = +(pesoLiquidoPote + pesoExtra).toFixed(3);
    calculoPesoLiquidoDisplay.textContent = `Peso Líquido Calculado: ${pesoLiquidoTotal.toFixed(3)} kg`;
}

/* ---------- Registrar ou Salvar Item Localmente ---------- */
function handleRegistrarOuSalvarItem() {
    if (!validaCamposFormulario()) { mostraStatus('Verifique os erros no formulário.', 'error'); return; }
    const codigo = codigoInp.value.trim(); let taraInput = parseFloat(taraInp.value.replace(',', '.')) || 0;
    const pesoComPote = parseFloat(pesoComPoteInp.value.replace(',', '.')) || 0;
    const pesoExtra = parseFloat(pesoExtraInp.value.replace(',', '.')) || 0;
    let taraCalculo = taraInput; let letraPoteCalculo = letraPoteSel;
    if (pesoComPote === 0 && (pesoComPoteInp.classList.contains('input-auto-filled') || pesoComPoteInp.value.trim() === "0" || pesoComPoteInp.value.trim() === "0.000")) {
        taraCalculo = 0; letraPoteCalculo = 'Nenhuma';
    }
    const pesoLiquidoPote = pesoComPote - taraCalculo; const pesoLiquidoTotal = +(pesoLiquidoPote + pesoExtra).toFixed(3);
    if (pesoLiquidoTotal <= 0 && !(pesoComPote === 0 && pesoExtra > 0 && taraCalculo === 0)) {
        if (!(pesoComPote === 0 && pesoExtra > 0 && taraCalculo === 0 && pesoLiquidoTotal === pesoExtra)) {
            mostraMensagemErroCampo(calculoPesoLiquidoDisplay, 'Peso Líquido Total zerado ou negativo.'); return;
        }
    }
    const produtoInfo = MAPA[codigo] || {};
    const itemData = {
        timestamp: new Date().toISOString(), usuario: nomeUsuario, codigo: codigo,
        nomeProduto: produtoInfo.Nome || 'PRODUTO NÃO CADASTRADO',
        pesoLiquido: pesoLiquidoTotal, tara: taraCalculo, pesoComPote: pesoComPote,
        pesoExtra: pesoExtra, letraPote: letraPoteCalculo, statusEnvio: null
    };
    if (editandoItemId !== null) {
        const index = itens.findIndex(item => item.id === editandoItemId);
        if (index > -1) { itens[index] = { ...itens[index], ...itemData, id: editandoItemId }; mostraStatus('Item atualizado localmente!', 'success'); }
        editandoItemId = null;
    } else { itemData.id = Date.now(); itens.push(itemData); mostraStatus('Item registrado localmente!', 'success'); }
    salvaLocais(); limparFormulario(); codigoInp.focus(); updateBotaoRegistrar();
}

function limparFormulario() {
    codigoInp.value = ''; taraInp.value = ''; pesoComPoteInp.value = ''; pesoExtraInp.value = '';
    nomeDiv.textContent = ''; calculoPesoLiquidoDisplay.textContent = "";
    
    // Limpa display de estoque
    estoqueSistemaContainer.classList.add('hidden');
    estoqueSistemaDisplay.textContent = '--';

    pesoComPoteInp.classList.remove('input-auto-filled');
    selecionaBotaoNenhuma(); editandoItemId = null;
    textoBotaoRegistrar.textContent = 'Registrar Item Localmente';
    btnReg.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
    btnReg.classList.add('bg-green-600', 'hover:bg-green-700');
    limpaMensagensErro();
}

/* ---------- Edição de Itens ---------- */
function iniciarEdicaoItem(id) {
    const itemParaEditar = itens.find(item => item.id === id); if (!itemParaEditar) return;
    limpaMensagensErro(); editandoItemId = id;
    codigoInp.value = itemParaEditar.codigo; taraInp.value = itemParaEditar.tara.toFixed(3);
    pesoComPoteInp.value = itemParaEditar.pesoComPote.toFixed(3);
    pesoExtraInp.value = itemParaEditar.pesoExtra.toFixed(3);
    nomeDiv.textContent = itemParaEditar.nomeProduto;
    
    // Atualiza estoque ao editar
    atualizaDisplayEstoque(itemParaEditar.codigo);

    desmarcaBotoesTara(); letraPoteSel = itemParaEditar.letraPote;
    const btnLetra = document.querySelector(`.tara-button[data-letra="${letraPoteSel}"]`);
    if (btnLetra) { btnLetra.classList.add('selected'); btnLetra.querySelector('i')?.classList.remove('hidden');}
    else { letraPoteSel = 'Manual'; }
    spanLetra.textContent = `(${letraPoteSel})`;
    pesoComPoteInp.classList.remove('input-auto-filled');
    textoBotaoRegistrar.textContent = 'Salvar Alterações';
    btnReg.classList.remove('bg-green-600', 'hover:bg-green-700');
    btnReg.classList.add('bg-yellow-500', 'hover:bg-yellow-600');
    updateBotaoRegistrar(); codigoInp.focus(); atualizaDisplayCalculoPeso();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Renderizar Lista de Pendentes (MODIFICADO) ---------- */
function renderizaLista() {
  tbody.innerHTML = '';
  const itensPendentes = itens.filter(item => item.statusEnvio !== 'sucesso');
  let pesoLiquidoTotalPendente = 0;
  itensPendentes.forEach(item => pesoLiquidoTotalPendente += item.pesoLiquido);
  totalizadorPendentes.textContent = `Pendentes: ${itensPendentes.length} | P.Líq. Pendente: ${pesoLiquidoTotalPendente.toFixed(3)} kg`;

  if (itens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-500 py-4">Nenhum item registrado localmente.</td></tr>';
    enviarTodosBtn.disabled = true;
    textoBotaoEnviar.textContent = 'Enviar Pendentes';
    return;
  }
  enviarTodosBtn.disabled = enviando || itensPendentes.length === 0;
  textoBotaoEnviar.textContent = itensPendentes.length > 0 ? `Enviar ${itensPendentes.length} Pendente(s)` : 'Nenhum Pendente';

  [...itens].reverse().forEach((item) => {
    const tr = document.createElement('tr');
    let rowClass = '';
    if (item.statusEnvio === 'sucesso') {
        rowClass = 'item-enviado';
    } else if (item.statusEnvio === 'falha') {
        rowClass = 'item-falha';
    }
    tr.className = rowClass;

    const horaFormatada = new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    tr.innerHTML = `
      <td class="border px-1 py-1 sm:px-2">${item.codigo}</td>
      <td class="border px-1 py-1 sm:px-2 text-right">${item.pesoLiquido.toFixed(3)}</td>
      <td class="border px-1 py-1 sm:px-2 text-right">${item.tara.toFixed(3)} (${item.letraPote})</td>
      <td class="border px-1 py-1 sm:px-2 text-xs text-center">${horaFormatada}</td>
      <td class="border px-1 py-1 sm:px-2 text-center">
        <button class="text-blue-500 hover:text-blue-700 p-1 mr-1 ${item.statusEnvio === 'sucesso' ? 'opacity-50 cursor-not-allowed' : ''}" data-edit-id="${item.id}" title="Editar este item" ${item.statusEnvio === 'sucesso' ? 'disabled' : ''}>
          <i class="fas fa-edit"></i>
        </button>
        <button class="text-red-500 hover:text-red-700 p-1" data-delete-id="${item.id}" title="Excluir este item">
          <i class="fas fa-trash-alt"></i>
        </button>
        ${item.statusEnvio === 'falha' ? '<i class="fas fa-exclamation-triangle text-yellow-500 item-status-icon" title="Falha no último envio"></i>' : ''}
        ${item.statusEnvio === 'sucesso' ? '<i class="fas fa-check-circle text-green-500 item-status-icon" title="Enviado com sucesso"></i>' : ''}
      </td>
    `;
    if (item.statusEnvio !== 'sucesso') {
        tr.querySelector(`button[data-edit-id="${item.id}"]`).addEventListener('click', () => iniciarEdicaoItem(item.id));
    }
    tr.querySelector(`button[data-delete-id="${item.id}"]`).addEventListener('click', (e) => {
        const row = e.target.closest('tr'); if (row) row.classList.add('fade-out');
        setTimeout(() => excluirItem(item.id), 280);
    });
    tbody.appendChild(tr);
  });
}
function excluirItem(id) {
    if (enviando) { alert("Aguarde o término do envio atual."); return; }
    const itemIndex = itens.findIndex(i => i.id === id);
    if (itemIndex > -1) {
        if (itens[itemIndex].statusEnvio === 'sucesso') {
            if (!confirm(`Este item já foi enviado. Deseja excluí-lo APENAS da lista local?`)) {
                 const row = tbody.querySelector(`button[data-delete-id="${id}"]`)?.closest('tr');
                 if(row) row.classList.remove('fade-out');
                return;
            }
        }
        itens.splice(itemIndex, 1); salvaLocais();
    }
}

/* ---------- Envio para Google Apps Script ---------- */
async function enviarTodos() {
  const itensParaEnviarAgora = itens.filter(item => item.statusEnvio !== 'sucesso');
  if (enviando || itensParaEnviarAgora.length === 0) {
       if (!enviando) mostraStatus('Nenhum item pendente ou com falha para enviar.', 'info');
       return;
  }
  enviando = true; enviarTodosBtn.disabled = true; textoBotaoEnviar.textContent = 'Enviando...'; btnLimpar.disabled = true; btnReg.disabled = true;
  progressBarContainer.style.display = 'block'; progressBar.style.width = '0%';
  let enviadosComSucessoCount = 0; let falhasCount = 0;
  for (let i = 0; i < itensParaEnviarAgora.length; i++) {
    const item = itensParaEnviarAgora[i]; const progresso = Math.round(((i + 1) / itensParaEnviarAgora.length) * 100);
    mostraStatus(`Enviando ${i + 1}/${itensParaEnviarAgora.length}: Código ${item.codigo}...`, 'sending', 0, progresso);
    try { const resultadoEnvio = await enviarItem(item); if (resultadoEnvio && resultadoEnvio.result === 'success' && resultadoEnvio.idLocal == item.id) { enviadosComSucessoCount++; const indexOriginal = itens.findIndex(original => original.id === item.id); if (indexOriginal > -1) itens[indexOriginal].statusEnvio = 'sucesso'; } else { throw new Error(resultadoEnvio.message || 'Resposta inesperada do servidor.'); }
    } catch (error) { console.error('Falha ao enviar item:', item.id, error); falhasCount++; const indexOriginal = itens.findIndex(original => original.id === item.id); if (indexOriginal > -1) itens[indexOriginal].statusEnvio = 'falha'; mostraStatus(`Falha item ${item.codigo}: ${error.message}`, 'error', 5000, progresso); await new Promise(resolve => setTimeout(resolve, ENVIO_DELAY_MS * 1.5)); }
    if (i < itensParaEnviarAgora.length - 1) { await new Promise(resolve => setTimeout(resolve, ENVIO_DELAY_MS)); }
  }
  salvaLocais();
  enviando = false; btnLimpar.disabled = false; updateBotaoRegistrar(); renderizaLista();
  progressBarContainer.style.display = 'none';
  if (falhasCount === 0 && enviadosComSucessoCount > 0) { mostraStatus(`Todos os ${enviadosComSucessoCount} itens pendentes foram enviados com sucesso!`, 'success'); }
  else if (falhasCount > 0 && enviadosComSucessoCount > 0) { mostraStatus(`${enviadosComSucessoCount} itens enviados, ${falhasCount} falharam.`, 'error'); }
  else if (falhasCount > 0 && enviadosComSucessoCount === 0) { mostraStatus(`Falha ao enviar todos os ${falhasCount} itens.`, 'error'); }
  else if (enviadosComSucessoCount === 0 && falhasCount === 0 && itensParaEnviarAgora.length > 0) { mostraStatus('Nenhum item processado. Verifique.', 'info'); }
}

async function enviarItem(item) {
  const formData = new FormData(); formData.append('timestamp', item.timestamp); formData.append('usuario', item.usuario); formData.append('codigo', item.codigo); formData.append('nomeProduto', item.nomeProduto); formData.append('pesoLiquido', item.pesoLiquido); formData.append('tara', item.tara); formData.append('pesoComPote', item.pesoComPote); formData.append('pesoExtra', item.pesoExtra); formData.append('letraPote', item.letraPote); formData.append('idLocal', item.id);
  try { const response = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: formData }); let responseData = {}; const contentType = response.headers.get("content-type"); if (contentType && contentType.indexOf("application/json") !== -1) { responseData = await response.json(); } else { const textResponse = await response.text(); console.error("Resposta não JSON:", response.status, textResponse); throw new Error(`Erro ${response.status}: Resposta inválida.`); } if (!response.ok) { console.error('Erro HTTP:', response.status, responseData); throw new Error(responseData.message || `Erro de rede ${response.status}`); } if(responseData.result !== 'success') { console.error('Script Erro:', responseData); throw new Error(responseData.message || `Erro script.`); } console.log('Sucesso script idLocal', item.id, ':', responseData); return responseData;
  } catch (error) { console.error("Falha fetch/processamento idLocal:", item.id, error); return { result: 'error', message: error.message, idLocal: item.id }; }
}

/* ---------- UI Feedback (Status) ---------- */
let statusTimeout;
function mostraStatus(mensagem, tipo = 'info', duracaoMs = 4000, progresso = -1) {
  clearTimeout(statusTimeout);
  statusMensagem.textContent = mensagem;
  statusDiv.className = `status-base status-${tipo}`;
  statusDiv.style.display = 'block';
  if (progresso >= 0) { progressBarContainer.style.display = 'block'; progressBar.style.width = `${progresso}%`; }
  else { progressBarContainer.style.display = 'none'; }
  if (tipo !== 'sending' && duracaoMs > 0) { statusTimeout = setTimeout(() => { statusDiv.style.display = 'none'; statusMensagem.textContent = ''; statusDiv.className = 'status-base'; progressBarContainer.style.display = 'none'; }, duracaoMs); }
}
