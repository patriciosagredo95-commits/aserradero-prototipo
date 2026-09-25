import {DIAMETERS,normalizeConfig} from './optimizer.js';
import {stageSVG,cutSequence,CUT_MACHINES,resultsCSV,printSheet,historicalComparison,activeProducts,escapeHTML} from './reports.js';
import {bestYieldAlternative,simulateOrder} from './order.js';

const $=id=>document.getElementById(id);
const fmt=(n,d=0)=>new Intl.NumberFormat('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
const dimensions=p=>`${fmt(p.thickness,p.thickness%1?1:0)} × ${fmt(p.width,p.width%1?1:0)}`;
const colors=['#467ded','#129680','#edb552'];
const state={results:new Map(),selected:28,snapshot:null,worker:null,runId:0,dirty:false,running:false,completion:null,selectedPiece:null,alternativeSelections:new Map()};
state.stage=0;state.historyKey=null;
state.activeTab='patterns';state.orderStock=Object.fromEntries(DIAMETERS.map(d=>[d,'0']));state.orderPlan=null;
const extraFields={minBaseWidth:'min-base-width',maxBaseWidth:'max-base-width'};
const resultAlternatives=result=>result?.alternatives?.length?result.alternatives:result?.status==='found'?[result]:[];
const selectedAlternativeIndex=(d=state.selected)=>{
  const result=state.results.get(d),alternatives=resultAlternatives(result),saved=state.alternativeSelections.get(d);
  if(Number.isInteger(saved)&&saved>=0&&saved<alternatives.length)return saved;
  return Math.max(0,(bestYieldAlternative(result)?.alternative??1)-1);
};
const selectedResult=(d=state.selected)=>resultAlternatives(state.results.get(d))[selectedAlternativeIndex(d)]??state.results.get(d);

function recoveryRow(p={thickness:22,width:60}) {
  const row=document.createElement('div');row.className='recovery-row';
  const e=document.createElement('label');e.textContent='Espesor';
  const thickness=document.createElement('input');Object.assign(thickness,{type:'number',min:'1',max:'1000',step:'0.1',value:String(p.thickness),className:'recovery-thickness'});e.append(thickness);
  const cross=document.createElement('span');cross.className='times';cross.textContent='×';cross.setAttribute('aria-hidden','true');
  const a=document.createElement('label');a.textContent='Ancho';
  const width=document.createElement('input');Object.assign(width,{type:'number',min:'1',max:'1000',step:'0.1',value:String(p.width),className:'recovery-width'});a.append(width);
  const remove=document.createElement('button');remove.type='button';remove.className='remove-button';remove.textContent='×';remove.setAttribute('aria-label','Quitar esta escuadría de recuperación');
  remove.addEventListener('click',()=>{row.remove();markDirty();updateAddButton();});
  row.append(e,cross,a,remove);$('recovery-inputs').append(row);updateAddButton();
}
function updateAddButton() {
  const full=$('recovery-inputs').children.length>=12;
  $('add-recovery').disabled=full;
  $('add-recovery').setAttribute('aria-label',full?'Máximo de 12 escuadrías de recuperación':'Agregar escuadría de recuperación');
}
function readConfig() {
  const input={targets:[{thickness:$('target-a-thickness').value,width:$('target-a-width').value},{thickness:$('target-b-thickness').value,width:$('target-b-width').value}],targetBEnabled:$('target-b-enabled').checked,recoveries:[...$('recovery-inputs').children].map(row=>({thickness:row.querySelector('.recovery-thickness').value,width:row.querySelector('.recovery-width').value})),criterion:$('criterion').value,searchMode:'detailed',minA:0,minB:0,
    length:$('length').value,kerfBand:$('kerf-band').value,kerfGang:$('kerf-gang').value,kerfEdger:$('kerf-edger').value,margin:$('margin').value,maxBases:$('max-bases').value};
  for(const [key,id] of Object.entries(extraFields))input[key]=$(id).value;
  normalizeConfig(input);return input;
}
function populateConfig(c) {
  $('target-a-thickness').value=c.targets[0].thickness;$('target-a-width').value=c.targets[0].width;
  $('target-b-thickness').value=c.targets[1].thickness;$('target-b-width').value=c.targets[1].width;
  $('recovery-inputs').replaceChildren();c.recoveries.forEach(recoveryRow);
  for(const [key,id] of Object.entries({length:'length',kerfBand:'kerf-band',kerfGang:'kerf-gang',kerfEdger:'kerf-edger',margin:'margin',maxBases:'max-bases',criterion:'criterion'}))$(id).value=c[key];
  for(const [key,id] of Object.entries(extraFields))$(id).value=c[key]??'';
  $('target-b-enabled').checked=c.targetBEnabled!==false;syncTargetB();updateCriterionHelp();updateAddButton();markDirty();
}
function updateCriterionHelp() {
  const text={both:'Busca A y B en el mismo trozo cuando encuentra una combinación. Después prioriza su volumen y la recuperación.',targets:'A y B tienen igual prioridad por volumen. Después aprovecha el espacio con las escuadrías de recuperación.',total:'Maximiza la suma de objetivos y recuperación. Puede seleccionar un esquema sin alguno de los objetivos.'};
  $('criterion-help').textContent=text[$('criterion').value];
  const active=$('target-b-enabled').checked;
  $('criterion').querySelector('[value="both"]').textContent=active?'Ambos objetivos, luego volumen objetivo':'Objetivo A, luego recuperación';
  if(!active)$('criterion-help').textContent=$('criterion').value==='total'?'Maximiza A más recuperación. Puede elegir un patrón sin A si no estableces un mínimo.':'Prioriza el volumen de A y después la recuperación. B está excluido del cálculo.';
  $('criterion-help').textContent+=' La vista preselecciona el mayor rendimiento y permite revisar dos alternativas.';
}
function syncTargetB() {
  const active=$('target-b-enabled').checked;
  $('target-b-fields').classList.toggle('disabled-fields',!active);
  $('target-b-fields').querySelectorAll('input').forEach(input=>input.disabled=!active);
  $('target-b-enabled').closest('.product-heading').querySelector('.toggle-text').textContent=active?'Activo':'Desactivado';
  $('target-b-enabled').setAttribute('aria-label','Activar objetivo B');
  updateCriterionHelp();
}
function markDirty() {
  if(!state.snapshot&&!state.running)return;
  state.dirty=true;$('stale-banner').hidden=false;
  if(!state.running)$('run-caption').textContent='Actualiza los resultados con la nueva configuración.';
  invalidateOrderPlan();
}
function showError(message) {$('form-error').textContent=message;$('form-error').hidden=false;}

function showWorkspaceTab(tab){
  state.activeTab=tab;
  for(const name of ['patterns','order']){
    const selected=name===tab,button=$(`tab-${name}`);
    button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
    $(`${name}-panel`).hidden=!selected;
  }
  if(tab==='patterns'&&state.results.has(state.selected))renderDiagram();
}
function renderOrderStockInputs(){
  $('order-inventory-grid').replaceChildren();
  for(const diameter of DIAMETERS){
    const label=document.createElement('label');label.textContent=`${diameter} cm`;
    const input=document.createElement('input');
    Object.assign(input,{type:'number',min:'0',max:'10000',step:'1',value:state.orderStock[diameter]});
    input.setAttribute('aria-label',`Cantidad de trozos de ${diameter} centímetros`);
    input.addEventListener('input',()=>{state.orderStock[diameter]=input.value;invalidateOrderPlan();});
    label.append(input);$('order-inventory-grid').append(label);
  }
}
function syncOrderMeta(){
  const c=state.snapshot;if(!c)return;
  $('order-b-metric').hidden=!c.targetBEnabled;
  document.querySelectorAll('.order-b-cell').forEach(cell=>cell.hidden=!c.targetBEnabled);
}
function refreshOrderStatus(){
  const ready=!!state.snapshot&&!state.running&&!state.dirty&&state.results.size===DIAMETERS.length;
  $('simulate-order').disabled=!ready;$('order-stale').hidden=!state.dirty;
  $('order-notice').textContent=state.running?'Calculando los patrones de los 13 diámetros…':state.dirty?'Vuelve a optimizar los parámetros de corte para simular el pedido.':!ready?'Esperando los patrones de los 13 diámetros.':state.orderPlan?'Simulación calculada con los patrones actuales.':'Ingresa los trozos y pulsa Optimizar uso de trozos.';
}
function invalidateOrderPlan(){
  state.orderPlan=null;$('order-results').hidden=true;refreshOrderStatus();
}
function renderOrderPlan(){
  const plan=state.orderPlan;if(!plan)return;
  const {totals}=plan;
  const noPatternLogs=plan.rows.filter(row=>row.status==='no_pattern').reduce((sum,row)=>sum+row.availableLogs,0);
  const message=totals.usedLogs?`Se procesan ${fmt(totals.usedLogs)} de ${fmt(totals.availableLogs)} trozos disponibles${noPatternLogs?`; ${fmt(noPatternLogs)} no tienen patrón de corte`:''}.`:'Los trozos ingresados no tienen un patrón de corte disponible.';
  $('order-fulfillment').textContent=message;
  $('order-fulfillment').classList.toggle('warning',!totals.usedLogs||noPatternLogs>0);
  $('order-total-logs').textContent=`${fmt(totals.usedLogs)} / ${fmt(totals.availableLogs)}`;
  $('order-total-a').textContent=fmt(totals.piecesA);
  $('order-total-b').textContent=fmt(totals.piecesB);
  $('order-total-volume').textContent=`${fmt(totals.volumeM3,4)} m³`;
  $('order-total-yield').textContent=totals.yieldPercent==null?'—':`${fmt(totals.yieldPercent,2)} %`;
  const chartRows=plan.rows.filter(row=>row.availableLogs>0);
  const highestYield=Math.max(0,...chartRows.map(row=>row.yieldPercent??0));
  const axisMax=Math.min(100,Math.max(60,Math.ceil(highestYield/10)*10));
  $('order-chart-count').textContent=`${chartRows.length} ${chartRows.length===1?'diámetro':'diámetros'} · ${fmt(totals.availableLogs)} trozos`;
  $('order-chart-main').style.setProperty('--bar-count',String(chartRows.length));
  $('order-chart-ticks').replaceChildren();$('order-chart-grid').replaceChildren();$('order-yield-chart').replaceChildren();$('order-breakdown-rows').replaceChildren();
  for(let tick=axisMax;tick>=0;tick-=10){
    const label=document.createElement('span');label.textContent=`${tick} %`;label.style.top=`${30+(axisMax-tick)/axisMax*238}px`;$('order-chart-ticks').append(label);
    const line=document.createElement('span');line.className='order-chart-gridline';$('order-chart-grid').append(line);
  }
  for(const row of chartRows){
    const bar=document.createElement('button');bar.type='button';bar.className='order-column';
    const mark=document.createElement('span');mark.className='order-column-mark';
    mark.style.setProperty('--bar-height',`${Math.max(0,Math.min(100,(row.yieldPercent??0)/axisMax*100))}%`);
    const fill=document.createElement('span');fill.className='order-column-bar';fill.hidden=row.yieldPercent==null;
    const value=document.createElement('span');value.className='order-column-value';
    value.textContent=row.yieldPercent==null?'Sin patrón':`${fmt(row.yieldPercent,2)} %`;
    if(row.yieldPercent==null)value.classList.add('empty');
    mark.append(fill,value);
    const diameter=document.createElement('span');diameter.className='order-column-diameter';diameter.textContent=String(row.diameterCm);
    bar.setAttribute('aria-label',`Diámetro ${row.diameterCm} centímetros, ${fmt(row.availableLogs)} trozos: ${value.textContent}. Ver esquema de corte.`);
    bar.addEventListener('click',()=>{showWorkspaceTab('patterns');selectDiameter(row.diameterCm);});
    bar.append(mark,diameter);$('order-yield-chart').append(bar);
  }
  for(const row of chartRows){
    const tr=document.createElement('tr');tr.dataset.used=String(row.usedLogs>0);
    const pattern=row.status==='no_pattern'?'Sin patrón':row.usedLogs?'Mayor rendimiento':'—';
    const cells=[`${row.diameterCm} cm`,fmt(row.availableLogs),fmt(row.usedLogs),pattern,fmt(row.piecesA),fmt(row.piecesB),fmt(row.recoveryPieces),`${fmt(row.volumeM3,4)} m³`,row.yieldPercent==null?'—':`${fmt(row.yieldPercent,2)} %`];
    cells.forEach((content,index)=>{const cell=document.createElement('td');cell.textContent=content;if(index===5){cell.className='order-b-cell';cell.hidden=!plan.targetBEnabled;}tr.append(cell);});
    $('order-breakdown-rows').append(tr);
  }
  $('order-results').hidden=false;
}

function renderTabs() {
  $('diameter-tabs').replaceChildren();
  for(const d of DIAMETERS){
    const b=document.createElement('button');b.type='button';b.className='diameter-button';b.dataset.diameter=d;b.setAttribute('aria-pressed',String(d===state.selected));b.setAttribute('aria-label',`Diámetro ${d} centímetros`);b.innerHTML=`${d}<small>cm</small>`;
    b.addEventListener('click',()=>selectDiameter(d));$('diameter-tabs').append(b);
  }
}
function selectDiameter(d) {
  if(!DIAMETERS.includes(d))throw new Error('Selecciona uno de los diámetros del catálogo.');
  state.selected=d;state.selectedPiece=null;
  for(const el of $('diameter-tabs').children)el.setAttribute('aria-pressed',String(Number(el.dataset.diameter)===d));
  renderTable();renderPattern();
}
function renderTable() {
  const c=state.snapshot;
  if(c){$('table-target-a').textContent=`A · ${dimensions(c.products[0])}`;$('table-target-b').textContent=c.targetBEnabled===false?'B · desactivado':`B · ${dimensions(c.products[1])}`;}
  $('results-rows').replaceChildren();
  for(const d of DIAMETERS){
    const r=selectedResult(d),tr=document.createElement('tr');
    tr.className=r?'result-row'+(d===state.selected?' selected':''):'pending-row';
    const cells=r?[`${d} cm`,String(r.counts[0].quantity),String(r.counts[1].quantity),String(r.recoveryCount),`${fmt(r.volume,4)} m³`,r.status==='no_pattern'?'Sin patrón':`${fmt(r.yield,2)} %`]:[`${d} cm`,'—','—','—','—','—'];
    cells.forEach((text,i)=>{const td=document.createElement('td');td.textContent=text;td.className=['diameter-cell','cell-a','cell-b','','','yield-cell'][i];tr.append(td);});
    const action=document.createElement('td');const button=document.createElement('button');button.type='button';button.className='row-link';button.textContent='↗';button.setAttribute('aria-label',`Ver esquema de diámetro ${d} cm`);button.disabled=!r;button.addEventListener('click',event=>{event.stopPropagation();selectDiameter(d);});action.append(button);tr.append(action);
    if(r)tr.addEventListener('click',()=>selectDiameter(d));$('results-rows').append(tr);
  }
  $('computed-label').textContent=`${state.results.size} / ${DIAMETERS.length} calculados`;
}

function renderAlternatives() {
  const result=state.results.get(state.selected),alternatives=resultAlternatives(result),panel=$('alternatives-panel'),grid=$('alternative-grid');
  grid.replaceChildren();panel.hidden=!alternatives.length;
  $('alternative-count').textContent=`${alternatives.length} / 2`;
  if(!alternatives.length)return;
  const activeIndex=selectedAlternativeIndex(),bestIndex=Math.max(0,(bestYieldAlternative(result)?.alternative??1)-1);
  alternatives.forEach((alternative,index)=>{
    const button=document.createElement('button');button.type='button';button.className='alternative-card';button.dataset.alternative=String(index);
    button.setAttribute('aria-pressed',String(index===activeIndex));
    button.setAttribute('aria-label',`Alternativa ${index+1}: rendimiento ${fmt(alternative.yield,2)} por ciento, ${alternative.totalCount} piezas`);
    const title=document.createElement('strong');title.textContent=`Alternativa ${index+1}${index===bestIndex?' · Mayor rendimiento':''}`;
    const production=document.createElement('span');
    const parts=[`A: ${alternative.counts[0].quantity}`];
    if(state.snapshot?.targetBEnabled)parts.push(`B: ${alternative.counts[1].quantity}`);
    parts.push(`Recuperación: ${alternative.recoveryCount}`);production.textContent=parts.join(' · ');
    const yieldValue=document.createElement('b');yieldValue.textContent=`${fmt(alternative.yield,2)} %`;
    const detail=document.createElement('small');detail.textContent=`${fmt(alternative.volume,4)} m³ · ${alternative.bases.length} ${alternative.bases.length===1?'basa':'basas'}`;
    button.append(title,production,yieldValue,detail);
    button.addEventListener('click',()=>{
      state.alternativeSelections.set(state.selected,index);state.selectedPiece=null;state.historyKey=null;
      renderTable();renderPattern();
    });
    grid.append(button);
  });
}

function renderPattern() {
  const r=selectedResult(),c=state.snapshot;
  renderAlternatives();
  $('print-sheet').disabled=!r||r.status!=='found';$('export-csv').disabled=state.running||state.results.size!==DIAMETERS.length;
  $('pattern-title').textContent=`Diámetro ${state.selected} cm`;
  if(!r||!c){
    $('pattern-subtitle').textContent=state.running?'Buscando el esquema de mayor rendimiento…':'Optimiza para ver el esquema.';
    $('pattern-state').textContent=state.running?'Calculando':'Pendiente';
    $('cut-diagram').innerHTML='<div class="diagram-placeholder">El esquema aparecerá al completar el cálculo.</div>';
    for(const id of ['yield-value','volume-value','geometric-value'])$(id).textContent='—';
    $('piece-list').replaceChildren();$('historical-inputs').replaceChildren();state.historyKey=null;return;
  }
  const alternatives=resultAlternatives(state.results.get(state.selected)),alternativeIndex=selectedAlternativeIndex(),bestIndex=Math.max(0,(bestYieldAlternative(state.results.get(state.selected))?.alternative??1)-1);
  $('pattern-subtitle').textContent=r.status==='found'?`Alternativa ${alternativeIndex+1} de ${alternatives.length}${alternativeIndex===bestIndex?' · Mayor rendimiento':''} · ${r.totalCount} piezas · ${r.bases.length} ${r.bases.length===1?'basa':'basas'} · ${fmt(c.length)} mm de largo`:'No se encontró un esquema para estas condiciones.';
  $('pattern-state').textContent=r.status==='no_pattern'?'No encontrado':r.mask===3?'Ambos objetivos':r.mask?(c.targetBEnabled?'Un objetivo':'Objetivo A'):'Solo recuperación';
  $('yield-value').textContent=`${fmt(r.yield,2)} %`;
  $('volume-value').textContent=`${fmt(r.volume,4)} m³`;
  $('geometric-value').textContent=`${fmt(r.geometricYield,2)} %`;
  $('length-label').textContent=`L = ${fmt(c.length)} mm`;
  $('piece-list').replaceChildren();
  for(const p of c.products){
    if(!p.active)continue;
    const n=r.counts[p.id].quantity;
    if(p.id>1&&!n)continue;
    const row=document.createElement('div');row.className='piece-total';
    const name=document.createElement('span');name.className='piece-total-label';const swatch=document.createElement('i');swatch.className='swatch '+(p.id===0?'a':p.id===1?'b':'recovery');
    name.append(swatch,document.createTextNode(`${p.id===0?'A · ':p.id===1?'B · ':''}${dimensions(p)}`));
    const count=document.createElement('strong');count.textContent=`${n} `;const unit=document.createElement('small');unit.textContent='pzas';count.append(unit);row.append(name,count);$('piece-list').append(row);
  }
  if(!r.recoveryCount){const p=document.createElement('p');p.className='field-help';p.textContent='Sin piezas de recuperación en este patrón.';$('piece-list').append(p);}
  $('diagram-detail').textContent='Selecciona una pieza para ver sus dimensiones y su ruta.';
  renderDiagram();
  renderHistoricalInputs();
}

function renderDiagram() {
  const r=selectedResult(),c=state.snapshot;if(!r||!c)return;
  document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.stage)===state.stage)));
  const machineLegend=$('machine-cut-legend');
  machineLegend.hidden=state.stage===0;
  machineLegend.innerHTML=state.stage?`<span class="machine-cut-legend-title">Cortes por máquina</span>${CUT_MACHINES.slice(0,state.stage).map(machine=>`<span><i class="cut-swatch" style="background:${machine.color}"></i>${escapeHTML(machine.name)}</span>`).join('')}`:'';
  if(state.stage){
    $('cut-diagram').innerHTML=stageSVG(r,c,state.stage,'screen');
    const count=cutSequence(r,c).carriage.cuts.length;
    $('diagram-detail').textContent=state.stage===1
      ?r.diameterCm<34?'Carro Huincha: un corte separa la semi-basa (azul claro) del lampazo (beige); Huinchas continúa el despiece.':`Carro Huincha: ${count} ${count===1?'corte':'cortes'} para ${r.bases.length} ${r.bases.length===1?'basa':'basas'} optimizadas.`
      :state.stage===2
        ?r.diameterCm<34?'Huinchas: despiece de semi-basa y lampazo; azul claro muestra basas y beige, laterales.':'Huinchas: completa las caras pendientes de las basas (azul claro) y separa laterales (beige).'
        :'Vista geométrica en la misma orientación para esta etapa.';
    return;
  }
  const outer=r.diameterMm/2,half=outer*1.2,available=Math.min($('cut-diagram').clientWidth||440,490),scale=available/(2*half),textSize=12/scale,line=1/scale;
  const bound=outer+11/scale;
  const parts=[];
  parts.push(`<svg viewBox="${-half} ${-half} ${2*half} ${2*half}" role="img" aria-labelledby="diagram-title diagram-desc" xmlns="http://www.w3.org/2000/svg"><title id="diagram-title">Esquema de corte para diámetro ${r.diameterCm} centímetros</title><desc id="diagram-desc">${r.totalCount} piezas. Objetivo A: ${r.counts[0].quantity}. Objetivo B: ${r.counts[1].quantity}. Recuperación: ${r.recoveryCount}. Selecciona una pieza para inspeccionarla.</desc><defs><pattern id="draft-grid" width="${r.diameterMm/10}" height="${r.diameterMm/10}" patternUnits="userSpaceOnUse"><path d="M ${r.diameterMm/10} 0 H 0 V ${r.diameterMm/10}" fill="none" stroke="#35445c" stroke-width="${line*.5}"/></pattern><clipPath id="log-clip"><circle r="${outer}"/></clipPath></defs>`);
  parts.push(`<circle r="${outer}" fill="#1d2d46"/><circle r="${outer}" fill="url(#draft-grid)"/><path d="M ${-outer} 0 H ${outer} M 0 ${-outer} V ${outer}" stroke="#4b5e79" stroke-width="${line*.6}" stroke-dasharray="${4/scale} ${4/scale}"/>`);
  if(c.margin)parts.push(`<circle r="${r.radius}" fill="none" stroke="#8395af" stroke-width="${line}" stroke-dasharray="${3/scale} ${3/scale}"/>`);
  parts.push('<g clip-path="url(#log-clip)">');
  for(let i=0;i<r.pieces.length;i++){
    const p=r.pieces[i],sku=c.products[p.productId],color=colors[Math.min(p.productId,2)],label=`${dimensions(sku)} mm · ${sku.label} · ${p.stage}`;
    const selected=state.selectedPiece===i;
    parts.push(`<g role="button" tabindex="0" data-piece="${i}" aria-label="${label}" class="piece-rect"><title>${label}</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${color}" stroke="${selected?'#ffffff':'#101c30'}" stroke-width="${selected?line*2:line*.35}"/>`);
    if(p.w*scale>=22&&p.h*scale>=15){const mark=p.productId===0?'A':p.productId===1?'B':String(sku.width);parts.push(`<text x="${p.x+p.w/2}" y="${p.y+p.h/2}" fill="${p.productId<2?'#ffffff':'#503913'}" text-anchor="middle" dominant-baseline="central" font-family="DM Sans,sans-serif" font-size="${textSize*.95}" font-weight="600" pointer-events="none">${mark}</text>`);}
    parts.push('</g>');
  }
  parts.push(`</g><circle r="${outer}" fill="none" stroke="#899bb5" stroke-width="${line}"/><path d="M ${-outer} ${-bound-3/scale} V ${-bound+3/scale} M ${outer} ${-bound-3/scale} V ${-bound+3/scale} M ${-outer} ${-bound} H ${outer}" stroke="#91a4bf" stroke-width="${line*.7}"/><rect x="${-30/scale}" y="${-bound-9/scale}" width="${60/scale}" height="${17/scale}" fill="#142238"/><text x="0" y="${-bound}" fill="#dce8f8" text-anchor="middle" dominant-baseline="middle" font-size="${textSize}" font-family="DM Sans,sans-serif">Ø ${r.diameterMm} mm</text>`);
  if(!r.pieces.length)parts.push(`<text x="0" y="0" text-anchor="middle" fill="#cfdef0" font-size="${textSize}" font-family="DM Sans,sans-serif">Sin patrón factible</text>`);
  parts.push('</svg>');$('cut-diagram').innerHTML=parts.join('');
}
function inspectPiece(index) {
  const r=selectedResult(),p=r?.pieces[index];if(!p)return;
  const keyboardFocus=document.activeElement?.hasAttribute('data-piece');
  state.selectedPiece=index;const sku=state.snapshot.products[p.productId];
  $('diagram-detail').textContent=`${sku.label} · ${dimensions(sku)} × ${fmt(state.snapshot.length)} mm · ${p.stage}`;
  renderDiagram();
  if(keyboardFocus)$('cut-diagram').querySelector(`[data-piece="${index}"]`)?.focus();
}

function runOptimization(provided) {
  let config;
  try{config=provided||readConfig();config=normalizeConfig(config);}catch(error){showError(error.message);return Promise.reject(error);}
  if(typeof Worker==='undefined'){const error=new Error('Este navegador no permite el cálculo en segundo plano. Abre la aplicación en un navegador actualizado.');showError(error.message);return Promise.reject(error);}
  if(state.worker)state.worker.terminate();
  if(state.completion)state.completion.reject(new Error('El cálculo fue reemplazado por una nueva configuración.'));
  state.runId++;const runId=state.runId;state.results=new Map();state.alternativeSelections=new Map();state.historyKey=null;state.snapshot=config;state.selected=28;state.running=true;state.dirty=false;state.selectedPiece=null;
  $('form-error').hidden=true;$('stale-banner').hidden=true;$('progress-track').hidden=false;$('progress-fill').style.width='0%';$('optimize-button').disabled=true;$('optimize-button').textContent='Calculando los 13 diámetros…';$('run-caption').textContent='Buscando configuraciones de basas y recuperación.';$('table-description').textContent='Selecciona una fila para inspeccionar el corte.';
  invalidateOrderPlan();syncOrderMeta();
  renderTabs();renderTable();renderPattern();
  const promise=new Promise((resolve,reject)=>{state.completion={resolve,reject};});
  const fail=message=>{
    state.running=false;$('optimize-button').disabled=false;$('optimize-button').innerHTML='Optimizar 13 diámetros <span aria-hidden="true">↗</span>';$('progress-track').hidden=true;$('run-caption').textContent='El cálculo no se completó.';$('table-description').textContent='Cálculo incompleto. Revisa el mensaje y vuelve a optimizar.';showError(message);
    refreshOrderStatus();
    state.worker?.terminate();state.worker=null;const completion=state.completion;state.completion=null;completion?.reject(new Error(message));
  };
  try{
    const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});state.worker=worker;
    worker.onmessage=event=>{
      const message=event.data;if(message.runId!==state.runId)return;
      if(message.type==='ready'){state.snapshot=message.config;syncOrderMeta();return;}
      if(message.type==='result'){
        state.results.set(message.result.diameterCm,message.result);
        $('progress-fill').style.width=`${message.completed/DIAMETERS.length*100}%`;
        $('run-caption').textContent=`${message.completed} de ${DIAMETERS.length} diámetros calculados.`;
        renderTable();if(state.selected===message.result.diameterCm)renderPattern();
      }
      if(message.type==='done'){
        state.running=false;state.worker?.terminate();state.worker=null;$('optimize-button').disabled=false;$('optimize-button').innerHTML='Optimizar 13 diámetros <span aria-hidden="true">↗</span>';$('progress-track').hidden=true;
        $('run-caption').textContent=state.dirty?'Hay cambios pendientes de optimizar.':'Los 13 diámetros están calculados.';
        renderPattern();refreshOrderStatus();const completion=state.completion;state.completion=null;completion?.resolve(resultsSummary());
      }
      if(message.type==='error')fail(message.message);
    };
    worker.onerror=()=>fail('No se pudo iniciar el motor de cálculo. Recarga la página y vuelve a intentar.');
    worker.postMessage({runId,config});
  }catch(error){fail(error.message);}
  return promise;
}
function resultsSummary() {
  return {inputChangesPending:state.dirty,selectedDiameterCm:state.selected,criterion:state.snapshot?.criterion,targetBEnabled:state.snapshot?.targetBEnabled,searchMode:state.snapshot?.searchMode,results:DIAMETERS.filter(d=>state.results.has(d)).map(d=>{const r=selectedResult(d);return {diameterCm:d,status:r.status,quantities:r.counts,volumeM3:r.volume,yieldPercent:r.yield,geometricYieldPercent:r.geometricYield,basesMm:r.bases.map(b=>b.width)};})};
}
function renderHistoricalInputs(){
  const key=`${state.runId}:${state.selected}`;
  if(key===state.historyKey){$('history-result').textContent='Pulsa Comparar cantidades para actualizar la comparación con este esquema.';return;}
  state.historyKey=key;$('historical-inputs').replaceChildren();$('historical-confirm').checked=false;$('history-result').textContent='';
  for(const p of activeProducts(state.snapshot)){
    const label=document.createElement('label');label.textContent=`${p.label} · ${dimensions(p)} mm`;
    const input=document.createElement('input');Object.assign(input,{type:'number',min:'0',step:'1',value:'0'});input.dataset.historyProduct=p.id;label.append(input);$('historical-inputs').append(label);
  }
}
function downloadFile(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showCurrentExportNotice(){
  $('export-notice').textContent=state.dirty?'Se exportaron los últimos resultados calculados. Hay cambios pendientes de optimizar.':'Se exportó la configuración calculada.';
}
function registerTools() {
  const context=document.modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const productSchema={type:'object',properties:{thickness:{type:'number',minimum:1,maximum:1000},width:{type:'number',minimum:1,maximum:1000}},required:['thickness','width'],additionalProperties:false};
  const definitions=[{
    name:'optimize_cutting_patterns',title:'Optimizar esquemas de corte',description:'Configura dos escuadrías objetivo y las recuperaciones, calcula los 13 diámetros del catálogo y actualiza los resultados visibles. Todas las medidas están en milímetros.',
    inputSchema:{type:'object',properties:{targets:{type:'array',items:productSchema,minItems:2,maxItems:2},targetBEnabled:{type:'boolean'},recoveries:{type:'array',items:productSchema,maxItems:12},criterion:{type:'string',enum:['both','targets','total']},length:{type:'number',minimum:500,maximum:12000},kerfBand:{type:'number',minimum:.1,maximum:15},kerfGang:{type:'number',minimum:.1,maximum:15},kerfEdger:{type:'number',minimum:.1,maximum:15},margin:{type:'number',minimum:0,maximum:15},maxBases:{type:'integer',minimum:1,maximum:3}},required:['targets','recoveries'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){const c=normalizeConfig({...readConfig(),...input});populateConfig(c);return runOptimization(c);}
  },{name:'get_cutting_results',title:'Consultar resultados de corte',description:'Devuelve el resumen de los diámetros calculados e indica si hay cambios de entrada pendientes de optimizar.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(){return resultsSummary();}},
  {name:'select_cutting_diameter',title:'Ver un diámetro',description:'Cambia el dibujo visible al diámetro calculado indicado.',inputSchema:{type:'object',properties:{diameterCm:{type:'number',enum:DIAMETERS}},required:['diameterCm'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!state.results.has(input?.diameterCm))throw new Error('Ese diámetro aún no tiene resultados.');selectDiameter(input.diameterCm);return {selectedDiameterCm:state.selected};}}];
  Object.assign(definitions[0].inputSchema.properties,{minBaseWidth:{type:['number','null'],minimum:1,maximum:420},maxBaseWidth:{type:['number','null'],minimum:1,maximum:420}});
  for(const definition of definitions){try{Promise.resolve(context.registerTool(definition,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

$('config-form').addEventListener('submit',event=>{event.preventDefault();void runOptimization().catch(()=>{});});
$('config-form').addEventListener('input',markDirty);
for(const tab of document.querySelectorAll('.workspace-tabs [role="tab"]')){
  tab.addEventListener('click',()=>showWorkspaceTab(tab.id==='tab-order'?'order':'patterns'));
  tab.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();const next=tab.id==='tab-order'?'patterns':'order';showWorkspaceTab(next);$(`tab-${next}`).focus();
  });
}
$('simulate-order').addEventListener('click',()=>{
  try{
    if(state.running||state.dirty||state.results.size!==DIAMETERS.length)throw new Error('Espera a que terminen de calcularse los 13 diámetros.');
    const plan=simulateOrder(state.results,state.orderStock,state.snapshot);
    if(!plan.totals.availableLogs)throw new Error('Ingresa al menos un trozo en alguno de los diámetros.');
    state.orderPlan=plan;renderOrderPlan();refreshOrderStatus();
  }catch(error){state.orderPlan=null;$('order-results').hidden=true;$('order-notice').textContent=error.message;}
});
$('criterion').addEventListener('change',()=>{updateCriterionHelp();markDirty();});
$('target-b-enabled').addEventListener('change',()=>{syncTargetB();markDirty();});
$('add-recovery').addEventListener('click',()=>{
  const existing=new Set([...$('recovery-inputs').children].map(row=>`${row.querySelector('.recovery-thickness').value}x${row.querySelector('.recovery-width').value}`));
  existing.add(`${$('target-a-thickness').value}x${$('target-a-width').value}`);
  if($('target-b-enabled').checked)existing.add(`${$('target-b-thickness').value}x${$('target-b-width').value}`);
  const choices=[92,95,82,102,70,80,100,130,155,50,55,65,85,90,105,115];const width=choices.find(w=>!existing.has(`22x${w}`));
  recoveryRow({thickness:22,width});markDirty();$('recovery-inputs').lastElementChild.querySelector('input').focus();
});
document.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>{state.stage=Number(button.dataset.stage);state.selectedPiece=null;renderDiagram();}));
$('export-csv').addEventListener('click',()=>{if(state.running||state.results.size!==DIAMETERS.length)return;downloadFile('esquemas-mayor-rendimiento.csv',resultsCSV(DIAMETERS.map(d=>state.results.get(d)),state.snapshot),'text/csv;charset=utf-8');showCurrentExportNotice();});
$('print-sheet').addEventListener('click',()=>{const r=selectedResult();if(r?.status!=='found')return;const number=selectedAlternativeIndex()+1;$('print-area').innerHTML=printSheet(r,state.snapshot,{schemeLabel:`Alternativa ${number}`});$('export-notice').textContent=`En la ventana de impresión selecciona Guardar como PDF. La ficha usa la alternativa ${number} seleccionada.`;window.print();});
$('compare-history').addEventListener('click',()=>{
  try{const r=selectedResult();if(r?.status!=='found')throw new Error('Selecciona un esquema calculado antes de comparar.');if(!$('historical-confirm').checked)throw new Error('Confirma que tu esquema histórico está validado y usa las mismas condiciones.');const quantities=[...$('historical-inputs').querySelectorAll('input')].map(input=>input.value.trim()===''?NaN:Number(input.value));const comparison=historicalComparison(r,state.snapshot,quantities);$('history-result').textContent=`Histórico: ${fmt(comparison.volume,4)} m³ (${fmt(comparison.yieldPercent,2)} %). Esquema actual: ${fmt(r.volume,4)} m³ (${fmt(r.yield,2)} %). Diferencia: ${comparison.deltaVolume>=0?'+':''}${fmt(comparison.deltaVolume,4)} m³ y ${comparison.deltaPoints>=0?'+':''}${fmt(comparison.deltaPoints,2)} puntos porcentuales.${state.dirty?' Comparación con la última configuración calculada.':''}`;}catch(error){$('history-result').textContent=error.message;}
});
$('cut-diagram').addEventListener('click',event=>{const hit=event.target.closest('[data-piece]');if(hit)inspectPiece(Number(hit.dataset.piece));});
$('cut-diagram').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){const hit=event.target.closest('[data-piece]');if(hit){event.preventDefault();inspectPiece(Number(hit.dataset.piece));}}});
if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(state.results.has(state.selected))renderDiagram();});observer.observe($('cut-diagram'));}
window.addEventListener('pagehide',()=>state.worker?.terminate(),{once:true});
recoveryRow({thickness:22,width:75});recoveryRow({thickness:22,width:60});syncTargetB();renderOrderStockInputs();refreshOrderStatus();renderTabs();renderTable();registerTools();
void runOptimization().catch(()=>{});
