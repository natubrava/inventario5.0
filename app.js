/* ========= CONFIG ========= */
const GOOGLE_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbwy_aKGV9xAd9sBJRGG66LohrR3s0l_DbDCnOveCEHaE_RGjNqgTHbkiBX8ngks3-nO/exec';
const APP_VERSION = 'v14.3 - Comparativo de Estoque'; // Atualizado
const ENVIO_DELAY_MS = 500;

// Configuração para busca de estoque
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
let MAPA_ESTOQUE_SISTEMA = {};
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
  await carregaPotes();
  carregarEstoqueDoSistema();
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
      // Atualiza o cálculo sempre que qualquer campo muda
      if (inp === pesoComPoteInp || inp === taraInp || inp === pesoExtraInp || inp === codigoInp) {
        atualizaDisplayCalculoPeso();
      }
      updateBotaoRegistrar();
    });
    if (inp.inputMode === 'decimal' || inp.inputMode === 'numeric') {
        inp.addEventListener('input', formataEntradaNumerica);
    }
  });

  codigoInp.addEventListener('blur', buscaTaraAutomatica);
  // Adicionado delay curto no input para garantir atualização suave sem travar digitação rápida
  codigoInp.addEventListener('input', () => {
      const codigo = codigoInp.value.trim();
      atualizaDisplayEstoque(codigo);
      // Chama o calculo aqui também caso o código mude e já tenhamos peso inserido
      atualizaDisplayCalculoPeso(); 
  });
  
  // Delegação de eventos para os botões de imagem
  letras.addEventListener('click', handleTaraRapidaClick);
  
  // Evento para o botão Nenhuma (que pode estar fora do container principal agora)
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
    try {
        let response;
        const urlComTimestamp = STOCK_CONFIG.SHEET_CSV_URL + '&t=' + Date.now();
        
        try {
            response = await fetch(urlComTimestamp, { cache: 'no-store' });
            if (!response.ok) throw new Error('Falha direta');
        } catch (e) {
            response = await fetchWithProxy(STOCK_CONFIG.SHEET_CSV_URL);
        }

        const csvText = await response.text();
        const linhas = parseCSVSimples(csvText);
        
        MAPA_ESTOQUE_SISTEMA = {};
        
        linhas.forEach(item => {
            if(!item.SKU) return;
            const sku = String(item.SKU).trim();
            const isGranel = (item.CATEGORIA || '').toUpperCase() === 'GRANEL';
            let estoqueString = String(item.ESTOQUE || '0').replace(',', '.');
            let estoqueVal = parseFloat(estoqueString);
            if (isNaN(estoqueVal)) estoqueVal = 0;
            
            MAPA_ESTOQUE_SISTEMA[sku] = {
                estoque: estoqueVal,
                isGranel: isGranel
            };
        });
        if(codigoInp.value) {
            atualizaDisplayEstoque(codigoInp.value);
            atualizaDisplayCalculoPeso(); // Recalcula caso o estoque chegue depois
        }
    } catch (error) {
        console.error("Erro estoque:", error);
    }
}

async function fetchWithProxy(url) {
  for (const proxy of STOCK_CONFIG.PROXIES) {
    try {
      const response = await fetch(proxy + encodeURIComponent(url), { cache: 'no-store' });
      if (response.ok) return response;
    } catch (error) { continue; }
  }
  throw new Error('Falha nos proxies');
}

function parseCSVSimples(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
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
        let valorTexto = "";
        if (itemSistema.isGranel) {
            valorTexto = itemSistema.estoque.toFixed(3) + " kg";
        } else {
            if (Number.isInteger(itemSistema.estoque)) {
                valorTexto = itemSistema.estoque + " un";
            } else {
                valorTexto = itemSistema.estoque.toFixed(2).replace('.',',') + " un";
            }
        }
        estoqueSistemaDisplay.textContent = valorTexto;
        if (itemSistema.estoque < 0) {
            estoqueSistemaDisplay.classList.add('text-red-600');
            estoqueSistemaDisplay.classList.remove('text-blue-700');
        } else {
            estoqueSistemaDisplay.classList.remove('text-red-600');
            estoqueSistemaDisplay.classList.add('text-blue-700');
        }
    } else {
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
  const n = inpNome.value.trim(); if (!n) { mostraMensagemErroCampo(inputNomeUsuarioError, 'Nome obrigatório.'); inpNome.focus(); return; }
  limpaErroCampo(inputNomeUsuarioError);
  nomeUsuario = n; localStorage.setItem(NOME_USUARIO_KEY, n); mostrarNome(); fecharModalNome(); updateBotaoRegistrar();
}
function mostrarNome() {
  nomeDisp.textContent = nomeUsuario ? `Usuário: ${nomeUsuario}` : 'Usuário: (Toque para definir)';
}

/* ---------- Carregar Potes e Gerar Imagens ---------- */
async function carregaPotes() {
  try { 
      const response = await fetch('potes.json'); 
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`); 
      const data = await response.json(); 
      MAPA = data.reduce((map, pote) => { map[String(pote.codigo).trim()] = pote; return map; }, {}); 
      console.log('Potes carregados:', Object.keys(MAPA).length); 
      geraBotoesTara(); 
  } catch (error) { 
      console.error("Erro ao carregar potes.json:", error); 
      letras.innerHTML = '<span class="text-red-500 text-xs">Erro dados.</span>'; 
  }
}

/* ---------- NOVA FUNÇÃO: Gerar Botões com Imagens e Fallback ---------- */
function geraBotoesTara() {
    letras.innerHTML = ''; 
    const potesUnicos = {};
    Object.values(MAPA).forEach(p => { 
        if (p.letra && p.tara !== undefined && p.letra !== 'Nenhuma' && !potesUnicos[p.letra]) { 
            potesUnicos[p.letra] = p.tara; 
        } 
    });

    Object.keys(potesUnicos).sort().forEach(letra => { 
        const tara = potesUnicos[letra]; 
        
        // Criar elemento Container do Botão
        const btn = document.createElement('button'); 
        btn.className = 'tara-button'; 
        btn.dataset.taraKg = tara; 
        btn.dataset.letra = letra;
        btn.title = `Pote ${letra} (${tara}kg)`;

        // 1. Tenta criar a imagem
        const img = document.createElement('img');
        img.src = `pote_${letra}.png`;
        img.alt = letra;
        img.className = 'w-full h-full object-contain pointer-events-none'; // object-contain mantém proporção
        
        // 2. Cria o texto de Fallback (Escondido por padrão)
        const fallbackText = document.createElement('span');
        fallbackText.textContent = letra;
        fallbackText.className = 'text-xl font-bold text-gray-600 absolute inset-0 flex items-center justify-center bg-gray-100 hidden';

        // 3. Overlay de Check (Selecionado)
        const checkOverlay = document.createElement('div');
        checkOverlay.className = 'check-overlay';
        checkOverlay.innerHTML = '<i class="fas fa-check text-white text-xl drop-shadow-md"></i>';

        // Lógica de Erro: Se imagem falhar, mostra texto
        img.onerror = function() {
            this.style.display = 'none';
            fallbackText.classList.remove('hidden');
        };

        btn.appendChild(img);
        btn.appendChild(fallbackText);
        btn.appendChild(checkOverlay);

        letras.appendChild(btn); 
    });
}

/* ---------- Funções de Tara (Adaptadas para seleção visual) ---------- */
function handleTaraRapidaClick(event) {
    // Procura o botão .tara-button mais próximo do clique
    const btn = event.target.closest('.tara-button'); 
    if (!btn) return;
    
    desmarcaBotoesTara(); 
    
    // Marca visualmente
    btn.classList.add('selected');
    // Nota: O ícone de check agora é controlado via CSS (.check-overlay)
    
    // Atualiza valores
    taraInp.value = parseFloat(btn.dataset.taraKg).toFixed(3); 
    limpaErroCampo(pesoTaraKgError);
    
    letraPoteSel = btn.dataset.letra; 
    spanLetra.textContent = `(${letraPoteSel})`;
    
    // Lógica se for "Nenhuma"
    if (letraPoteSel === 'Nenhuma') {
        pesoComPoteInp.value = '0.000'; 
        pesoComPoteInp.classList.add('input-auto-filled');
        limpaErroCampo(pesoComPoteKgError); 
        pesoExtraInp.focus(); pesoExtraInp.select();
    } else {
        pesoComPoteInp.classList.remove('input-auto-filled'); 
        pesoComPoteInp.focus(); pesoComPoteInp.select();
    }
    
    atualizaDisplayCalculoPeso(); 
    updateBotaoRegistrar();
}

function desmarcaBotoesTara() {
    document.querySelectorAll('.tara-button.selected').forEach(b => { 
        b.classList.remove('selected'); 
    });
    // Remove também do botão "Nenhuma" separado se houver
    const btnNenhuma = document.querySelector('.tara-button[data-letra="Nenhuma"]');
    if(btnNenhuma) btnNenhuma.classList.remove('selected');
}

function handleTaraManualInput() {
    desmarcaBotoesTara(); 
    letraPoteSel = 'Manual'; 
    spanLetra.textContent = '(Manual)';
    pesoComPoteInp.classList.remove('input-auto-filled');
    
    if (!taraInp.value.trim()) { 
        selecionaBotaoNenhuma(); 
    } else { 
        limpaErroCampo(pesoTaraKgError); 
    }
    atualizaDisplayCalculoPeso();
}

function selecionaBotaoNenhuma() {
    desmarcaBotoesTara(); 
    const btnNenhumaFixo = document.querySelector('.tara-button[data-letra="Nenhuma"]');
    if(btnNenhumaFixo) { 
        btnNenhumaFixo.classList.add('selected'); 
        taraInp.value = parseFloat(btnNenhumaFixo.dataset.taraKg).toFixed(3); 
        letraPoteSel = 'Nenhuma'; 
        spanLetra.textContent = '(Nenhuma)'; 
    }
    atualizaDisplayCalculoPeso();
}

/* ---------- Busca Tara Automática (CORRIGIDA) ---------- */
function buscaTaraAutomatica() {
  const codigo = codigoInp.value.trim(); 
  limpaErroCampo(codigoProdutoError);
  atualizaDisplayEstoque(codigo);

  const produto = MAPA[codigo];
  pesoComPoteInp.classList.remove('input-auto-filled');
  
  if (produto) {
    nomeDiv.textContent = produto.Nome || 'Produto sem nome';
    
    // CORREÇÃO CRÍTICA AQUI:
    // A lógica anterior impedia atualização se já houvesse tara.
    // Agora, PRIORIZAMOS o cadastro do produto. Se o produto tem Pote definido, usamos ele.
    
    if (produto.tara !== undefined && produto.tara !== null && produto.letra && produto.letra !== "Nenhuma") {
        // Tem letra cadastrada e tara válida: IMPÕE a tara do produto
        taraInp.value = parseFloat(produto.tara).toFixed(3); 
        desmarcaBotoesTara();
        
        // Tenta achar o botão da imagem e selecionar
        const btnLetra = document.querySelector(`.tara-button[data-letra="${produto.letra}"]`);
        if (btnLetra) { 
            btnLetra.classList.add('selected'); 
            letraPoteSel = produto.letra; 
            spanLetra.textContent = `(${produto.letra})`; 
        } else { 
            // Caso raro: tem letra no JSON mas não gerou botão (ex: letra nova sem reload)
            letraPoteSel = 'Manual'; 
            spanLetra.textContent = '(Manual)'; 
        }
    } else {
        // O produto NÃO tem Pote definido no JSON (ex: produtos de prateleira/pacote)
        // Nesses casos, verificamos se devemos limpar ou manter o manual.
        // Se o produto explicitamente diz "tara: 0" ou letra vazia, sugerimos "Nenhuma".
        
        // Se o usuário NÃO digitou nada manualmente ainda, ou se estava em "Nenhuma", forçamos "Nenhuma"
        if (!taraInp.value.trim() || letraPoteSel === 'Nenhuma' || letraPoteSel !== 'Manual') {
             selecionaBotaoNenhuma();
             // Auto-preenche peso se for zero
             if (!produto.letra || produto.tara === 0 || produto.tara === null) {
                 pesoComPoteInp.value = '0.000'; 
                 pesoComPoteInp.classList.add('input-auto-filled');
            }
        }
    }
  } else {
    nomeDiv.textContent = codigo ? 'Produto não cadastrado localmente' : '';
  }
  updateBotaoRegistrar(); atualizaDisplayCalculoPeso();
}

/* ---------- Estado Botão Registrar/Salvar ---------- */
function updateBotaoRegistrar() {
  const nomeOk = !!nomeUsuario; const codigoOk = codigoInp.value.trim() !== '';
  const pesoComPoteValor = pesoComPoteInp.value.trim(); const pesoExtraValor = pesoExtraInp.value.trim();
  const pesoOk = (pesoComPoteValor !== '') || (pesoComPoteValor === '' && pesoExtraValor !== '');
  btnReg.disabled = !(nomeOk && codigoOk && pesoOk);
  textoBotaoRegistrar.textContent = editandoItemId !== null ? 'SALVAR ALTERAÇÕES' : 'REGISTRAR';
}

/* ---------- Armazenamento Local ---------- */
function carregaLocais() { itens = JSON.parse(localStorage.getItem(ITENS_KEY) || '[]'); }
function salvaLocais() { localStorage.setItem(ITENS_KEY, JSON.stringify(itens)); renderizaLista(); }

/* ---------- Limpar Lista Local ---------- */
function limparItensLocaisComOpcao() {
    if (enviando) { alert("Aguarde o envio."); return; }
    if (itens.length === 0) { mostraStatus('Lista vazia.', 'info'); return; }

    if (confirm("Limpar lista local?")) {
        if (confirm("Limpar TUDO (incluindo enviados)?\nOK=Sim, Cancelar=Só pendentes")) {
            itens = []; salvaLocais(); mostraStatus('Lista limpa.', 'success');
        } else {
            const pendentes = itens.filter(item => item.statusEnvio !== 'sucesso').length;
            if (pendentes === 0) { mostraStatus('Nada pendente para limpar.', 'info'); return; }
            itens = itens.filter(item => item.statusEnvio === 'sucesso');
            salvaLocais(); mostraStatus(`Pendentes limpos.`, 'success');
        }
    }
}

/* ---------- Validação e Feedback ---------- */
function formataEntradaNumerica(event) {
    let valor = event.target.value; valor = valor.replace(/[^0-9.,]/g, '').replace(',', '.');
    const partes = valor.split('.'); if (partes.length > 2) { valor = partes[0] + '.' + partes.slice(1).join(''); }
    event.target.value = valor;
}
function mostraMensagemErroCampo(campoOuId, mensagem) {
    const el = typeof campoOuId === 'string' ? $(campoOuId) : campoOuId; 
    if (el.id.includes('Error')) el.textContent = mensagem; 
    const inputEl = document.getElementById(el.id.replace('Error', ''));
    if (inputEl) inputEl.classList.add('input-error');
}
function limpaErroCampo(campoOuId) {
    const el = typeof campoOuId === 'string' ? $(campoOuId) : campoOuId; 
    if (el.id.includes('Error')) el.textContent = ''; 
    const inputEl = document.getElementById(el.id.replace('Error', ''));
    if (inputEl) inputEl.classList.remove('input-error');
}
function limpaMensagensErro() {
    [codigoProdutoError, pesoTaraKgError, pesoComPoteKgError, pesoExtraKgError, inputNomeUsuarioError].forEach(el => { if(el) limpaErroCampo(el); });
    [codigoInp, taraInp, pesoComPoteInp, pesoExtraInp, inpNome].forEach(inp => { if(inp) inp.classList.remove('input-error'); });
}
function validaCamposFormulario() {
    limpaMensagensErro(); let isValid = true;
    if (!codigoInp.value.trim()) { mostraMensagemErroCampo(codigoProdutoError, 'Cod obrigatório.'); isValid = false; }
    const taraStr = taraInp.value.replace(',', '.').trim(); const taraVal = parseFloat(taraStr);
    if (taraStr !== "" && isNaN(taraVal)) { mostraMensagemErroCampo(pesoTaraKgError, 'Inválido.'); isValid = false; }
    const pesoComPoteStr = pesoComPoteInp.value.replace(',', '.').trim(); const pesoComPoteVal = parseFloat(pesoComPoteStr);
    const pesoExtraStr = pesoExtraInp.value.replace(',', '.').trim(); const pesoExtraVal = parseFloat(pesoExtraStr);
    if (pesoComPoteStr === "" && pesoExtraStr === "") { mostraMensagemErroCampo(pesoComPoteKgError, 'Informe um peso.'); isValid = false; }
    else if (pesoComPoteStr !== "" && isNaN(pesoComPoteVal)) { mostraMensagemErroCampo(pesoComPoteKgError, 'Inválido.'); isValid = false; }
    if (pesoExtraStr !== "" && isNaN(pesoExtraVal)) { mostraMensagemErroCampo(pesoExtraKgError, 'Inválido.'); isValid = false; }
    return isValid;
}

/* ---------- Cálculo Peso Líquido (Com Diferença) ---------- */
function atualizaDisplayCalculoPeso() {
    const tara = parseFloat(taraInp.value.replace(',', '.')) || 0; 
    const pesoComPote = parseFloat(pesoComPoteInp.value.replace(',', '.')) || 0; 
    const pesoExtra = parseFloat(pesoExtraInp.value.replace(',', '.')) || 0;
    
    if (pesoComPoteInp.value.trim() === "" && pesoExtraInp.value.trim() === "") { 
        calculoPesoLiquidoDisplay.textContent = ""; 
        return; 
    }
    
    const pesoLiquidoPote = pesoComPote - tara; 
    const pesoLiquidoTotal = +(pesoLiquidoPote + pesoExtra).toFixed(3);
    
    let htmlContent = `Líquido: <span class="font-bold text-gray-800">${pesoLiquidoTotal.toFixed(3)} kg</span>`;

    // LÓGICA DE DIFERENÇA DO SISTEMA
    const codigo = codigoInp.value.trim();
    if (codigo && MAPA_ESTOQUE_SISTEMA[codigo]) {
        const estoqueSistema = MAPA_ESTOQUE_SISTEMA[codigo].estoque;
        const diferenca = pesoLiquidoTotal - estoqueSistema;
        const difAbs = Math.abs(diferenca);
        
        let corClasse = "text-gray-500"; // Neutro
        let animacaoClasse = "";
        let sinal = diferenca > 0 ? "+" : "";

        // Tolerância pequena para erro de arredondamento (ex: 0.005)
        if (difAbs > 0.005) {
            if (diferenca < 0) {
                corClasse = "text-red-600"; // Falta estoque físico em relação ao sistema
            } else {
                corClasse = "text-blue-600"; // Sobra estoque físico
            }
        } else {
            corClasse = "text-green-600"; // Exato (ou muito perto)
        }

        // Animação cintilante se a diferença for maior que 0.300
        if (difAbs > 0.300) {
            animacaoClasse = "animate-soft-pulse";
        }

        // Adiciona ao HTML
        htmlContent += `<span class="ml-2 text-[0.7rem] ${corClasse} ${animacaoClasse} font-bold">(Dif: ${sinal}${diferenca.toFixed(3)})</span>`;
    }

    calculoPesoLiquidoDisplay.innerHTML = htmlContent;
}

/* ---------- Registrar/Salvar (Com Feedback de Diferença) ---------- */
function handleRegistrarOuSalvarItem() {
    if (!validaCamposFormulario()) { mostraStatus('Erro no formulário.', 'error'); return; }
    const codigo = codigoInp.value.trim(); 
    let taraInput = parseFloat(taraInp.value.replace(',', '.')) || 0;
    const pesoComPote = parseFloat(pesoComPoteInp.value.replace(',', '.')) || 0;
    const pesoExtra = parseFloat(pesoExtraInp.value.replace(',', '.')) || 0;
    
    let taraCalculo = taraInput; 
    let letraPoteCalculo = letraPoteSel;
    
    if (pesoComPote === 0 && (pesoComPoteInp.classList.contains('input-auto-filled') || pesoComPoteInp.value.trim() === "0" || pesoComPoteInp.value.trim() === "0.000")) {
        taraCalculo = 0; letraPoteCalculo = 'Nenhuma';
    }
    
    const pesoLiquidoPote = pesoComPote - taraCalculo; 
    let pesoLiquidoTotal = +(pesoLiquidoPote + pesoExtra).toFixed(3);
    
    // Se der negativo, assume 0 (ajuste pedido anteriormente)
    if (pesoLiquidoTotal < 0) pesoLiquidoTotal = 0;

    // --- CAPTURA A DIFERENÇA ANTES DE LIMPAR ---
    let mensagemStatus = 'Registrado!';
    if (codigo && MAPA_ESTOQUE_SISTEMA[codigo]) {
        const estoqueSistema = MAPA_ESTOQUE_SISTEMA[codigo].estoque;
        const diferenca = pesoLiquidoTotal - estoqueSistema;
        const sinal = diferenca > 0 ? "+" : "";
        // Adiciona a diferença na mensagem de sucesso para visualização rápida pós-Enter
        mensagemStatus = `Registrado! (Dif: ${sinal}${diferenca.toFixed(3)})`;
    }
    // -------------------------------------------
    
    const produtoInfo = MAPA[codigo] || {};
    const itemData = {
        timestamp: new Date().toISOString(), usuario: nomeUsuario, codigo: codigo,
        nomeProduto: produtoInfo.Nome || 'PRODUTO NÃO CADASTRADO',
        pesoLiquido: pesoLiquidoTotal, tara: taraCalculo, pesoComPote: pesoComPote,
        pesoExtra: pesoExtra, letraPote: letraPoteCalculo, statusEnvio: null
    };
    
    if (editandoItemId !== null) {
        const index = itens.findIndex(item => item.id === editandoItemId);
        if (index > -1) { itens[index] = { ...itens[index], ...itemData, id: editandoItemId }; mostraStatus('Atualizado!', 'success'); }
        editandoItemId = null;
    } else { 
        itemData.id = Date.now(); 
        itens.push(itemData); 
        mostraStatus(mensagemStatus, 'success', 8000); // 8 segundos para ler
    }
    salvaLocais(); limparFormulario(); codigoInp.focus(); updateBotaoRegistrar();
}

function limparFormulario() {
    codigoInp.value = ''; taraInp.value = ''; pesoComPoteInp.value = ''; pesoExtraInp.value = '';
    nomeDiv.textContent = ''; calculoPesoLiquidoDisplay.textContent = "";
    estoqueSistemaContainer.classList.add('hidden');
    estoqueSistemaDisplay.textContent = '--';
    pesoComPoteInp.classList.remove('input-auto-filled');
    selecionaBotaoNenhuma(); editandoItemId = null;
    textoBotaoRegistrar.textContent = 'REGISTRAR';
    btnReg.classList.remove('bg-yellow-500', 'hover:bg-yellow-600');
    btnReg.classList.add('bg-green-600', 'hover:bg-green-700');
    limpaMensagensErro();
}

/* ---------- Edição ---------- */
function iniciarEdicaoItem(id) {
    const itemParaEditar = itens.find(item => item.id === id); if (!itemParaEditar) return;
    limpaMensagensErro(); editandoItemId = id;
    codigoInp.value = itemParaEditar.codigo; 
    taraInp.value = itemParaEditar.tara.toFixed(3);
    pesoComPoteInp.value = itemParaEditar.pesoComPote.toFixed(3);
    pesoExtraInp.value = itemParaEditar.pesoExtra.toFixed(3);
    nomeDiv.textContent = itemParaEditar.nomeProduto;
    atualizaDisplayEstoque(itemParaEditar.codigo);
    
    desmarcaBotoesTara(); 
    letraPoteSel = itemParaEditar.letraPote;
    const btnLetra = document.querySelector(`.tara-button[data-letra="${letraPoteSel}"]`);
    if (btnLetra) { 
        btnLetra.classList.add('selected'); 
    } else { 
        letraPoteSel = 'Manual'; 
    }
    spanLetra.textContent = `(${letraPoteSel})`;
    pesoComPoteInp.classList.remove('input-auto-filled');
    textoBotaoRegistrar.textContent = 'SALVAR';
    btnReg.classList.remove('bg-green-600', 'hover:bg-green-700');
    btnReg.classList.add('bg-yellow-500', 'hover:bg-yellow-600');
    updateBotaoRegistrar(); codigoInp.focus(); atualizaDisplayCalculoPeso();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Lista Pendentes ---------- */
function renderizaLista() {
  tbody.innerHTML = '';
  const itensPendentes = itens.filter(item => item.statusEnvio !== 'sucesso');
  let pesoLiquidoTotalPendente = 0;
  itensPendentes.forEach(item => pesoLiquidoTotalPendente += item.pesoLiquido);
  totalizadorPendentes.textContent = `Pend: ${itensPendentes.length} | ${pesoLiquidoTotalPendente.toFixed(3)} kg`;

  if (itens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-4 text-xs">Lista vazia.</td></tr>';
    enviarTodosBtn.disabled = true;
    textoBotaoEnviar.textContent = 'ENVIAR PENDENTES';
    return;
  }
  enviarTodosBtn.disabled = enviando || itensPendentes.length === 0;
  textoBotaoEnviar.textContent = itensPendentes.length > 0 ? `ENVIAR (${itensPendentes.length})` : 'ENVIAR';

  [...itens].reverse().forEach((item) => {
    const tr = document.createElement('tr');
    tr.className = item.statusEnvio === 'sucesso' ? 'item-enviado' : (item.statusEnvio === 'falha' ? 'item-falha' : '');
    const horaFormatada = new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    tr.innerHTML = `
      <td class="text-xs font-mono">${item.codigo}</td>
      <td class="text-right font-bold text-xs">${item.pesoLiquido.toFixed(3)}</td>
      <td class="text-right text-[0.7rem] text-gray-500">${item.tara.toFixed(3)}<br>(${item.letraPote})</td>
      <td class="text-center text-[0.7rem] text-gray-400">${horaFormatada}</td>
      <td class="text-center">
        <button class="text-blue-500 hover:text-blue-700 p-1 ${item.statusEnvio === 'sucesso' ? 'hidden' : ''}" data-edit-id="${item.id}">
          <i class="fas fa-edit"></i>
        </button>
        <button class="text-red-500 hover:text-red-700 p-1" data-delete-id="${item.id}">
          <i class="fas fa-trash-alt"></i>
        </button>
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
    if (enviando) { alert("Enviando..."); return; }
    const itemIndex = itens.findIndex(i => i.id === id);
    if (itemIndex > -1) {
        if (itens[itemIndex].statusEnvio === 'sucesso') {
            if (!confirm(`Item já enviado. Excluir da lista?`)) {
                 renderizaLista(); return;
            }
        }
        itens.splice(itemIndex, 1); salvaLocais();
    }
}

/* ---------- Envio ---------- */
async function enviarTodos() {
  const itensParaEnviarAgora = itens.filter(item => item.statusEnvio !== 'sucesso');
  if (enviando || itensParaEnviarAgora.length === 0) return;
  
  enviando = true; enviarTodosBtn.disabled = true; textoBotaoEnviar.textContent = 'ENVIANDO...'; 
  btnLimpar.disabled = true; btnReg.disabled = true;
  progressBarContainer.style.display = 'block'; progressBar.style.width = '0%';
  
  let enviadosComSucessoCount = 0; let falhasCount = 0;
  
  for (let i = 0; i < itensParaEnviarAgora.length; i++) {
    const item = itensParaEnviarAgora[i]; 
    const progresso = Math.round(((i + 1) / itensParaEnviarAgora.length) * 100);
    mostraStatus(`Env: ${item.codigo}...`, 'sending', 0, progresso);
    
    try { 
        const resultadoEnvio = await enviarItem(item); 
        if (resultadoEnvio && resultadoEnvio.result === 'success' && resultadoEnvio.idLocal == item.id) { 
            enviadosComSucessoCount++; 
            const idx = itens.findIndex(original => original.id === item.id); 
            if (idx > -1) itens[idx].statusEnvio = 'sucesso'; 
        } else { throw new Error(resultadoEnvio.message || 'Erro servidor.'); }
    } catch (error) { 
        console.error('Falha:', item.id, error); 
        falhasCount++; 
        const idx = itens.findIndex(original => original.id === item.id); 
        if (idx > -1) itens[idx].statusEnvio = 'falha'; 
        mostraStatus(`Erro ${item.codigo}`, 'error', 2000, progresso); 
        await new Promise(resolve => setTimeout(resolve, ENVIO_DELAY_MS)); 
    }
    if (i < itensParaEnviarAgora.length - 1) await new Promise(r => setTimeout(r, ENVIO_DELAY_MS));
  }
  salvaLocais();
  enviando = false; btnLimpar.disabled = false; updateBotaoRegistrar(); renderizaLista();
  progressBarContainer.style.display = 'none';
  if (falhasCount === 0 && enviadosComSucessoCount > 0) mostraStatus('Sucesso total!', 'success');
  else if (falhasCount > 0) mostraStatus(`${falhasCount} falhas.`, 'error');
}

async function enviarItem(item) {
  const formData = new FormData(); 
  formData.append('timestamp', item.timestamp); formData.append('usuario', item.usuario); 
  formData.append('codigo', item.codigo); formData.append('nomeProduto', item.nomeProduto); 
  formData.append('pesoLiquido', item.pesoLiquido); formData.append('tara', item.tara); 
  formData.append('pesoComPote', item.pesoComPote); formData.append('pesoExtra', item.pesoExtra); 
  formData.append('letraPote', item.letraPote); formData.append('idLocal', item.id);
  
  try { 
      const response = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: formData }); 
      let responseData = {}; 
      const contentType = response.headers.get("content-type"); 
      if (contentType && contentType.indexOf("application/json") !== -1) { responseData = await response.json(); } 
      else { throw new Error(`Erro ${response.status}`); } 
      if (!response.ok) throw new Error(responseData.message || `Erro ${response.status}`); 
      if(responseData.result !== 'success') throw new Error(responseData.message); 
      return responseData;
  } catch (error) { return { result: 'error', message: error.message, idLocal: item.id }; }
}

/* ---------- UI Status ---------- */
let statusTimeout;
function mostraStatus(mensagem, tipo = 'info', duracaoMs = 4000, progresso = -1) {
  clearTimeout(statusTimeout);
  statusMensagem.textContent = mensagem;
  statusDiv.className = `status-base status-${tipo}`;
  statusDiv.style.display = 'block';
  if (progresso >= 0) { progressBarContainer.style.display = 'block'; progressBar.style.width = `${progresso}%`; }
  else { progressBarContainer.style.display = 'none'; }
  if (tipo !== 'sending' && duracaoMs > 0) { 
      statusTimeout = setTimeout(() => { 
          statusDiv.style.display = 'none'; 
          statusMensagem.textContent = ''; 
          statusDiv.className = 'status-base'; 
      }, duracaoMs); 
  }
}

