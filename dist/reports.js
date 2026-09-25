import {bestYieldAlternative} from './order.js';

const n=(v,d=1)=>Number(v).toLocaleString('es-CL',{maximumFractionDigits:d});
export const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const activeProducts=c=>c.products.filter(p=>p.active);
export const CUT_MACHINES=[
  {key:'carriage',name:'Carro Huincha',color:'#b42332'},
  {key:'bands',name:'Huinchas',color:'#7442a6'},
  {key:'multiple',name:'Múltiple',color:'#b45100'},
  {key:'edger',name:'Canteadora',color:'#263c52'}
];
const cutMachine=Object.fromEntries(CUT_MACHINES.map(machine=>[machine.key,machine]));

const mergedCuts=(entries,kerf,offset)=>{
  const cuts=new Map();
  for(const entry of entries){
    const key=entry.start.toFixed(4),current=cuts.get(key)??{start:entry.start,labels:new Set()};
    current.labels.add(entry.label);cuts.set(key,current);
  }
  return [...cuts.values()].sort((a,b)=>a.start-b.start).map((cut,index)=>({
    number:index+1,
    start:cut.start,
    position:cut.start+kerf/2+offset,
    kerf,
    detail:[...cut.labels].join(' / ')
  }));
};

// El Carro abre el trozo desde la cara derecha del esquema. Bajo 34 cm hace
// un solo corte; desde 34 cm hace uno por basa optimizada (hasta tres).
// Huinchas completa los demás límites de basas y laterales sin duplicarlos.
const longitudinalCuts=(r,c)=>{
  const slabs=[...new Map(r.pieces.filter(p=>p.origin==='lateral').map(p=>[`${p.x.toFixed(4)}:${p.w.toFixed(4)}`,{x:p.x,w:p.w}])).values()];
  const baseEntries=r.bases.flatMap((b,i)=>[
    {start:b.x-c.kerfBand,label:`cara izquierda de B${i+1}`},
    {start:b.x+b.width,label:`cara derecha de B${i+1}`}
  ]);
  const lateralEntries=slabs.flatMap((s,i)=>[
    {start:s.x-c.kerfBand,label:`cara izquierda de lateral L${i+1}`},
    {start:s.x+s.w,label:`cara derecha de lateral L${i+1}`}
  ]);
  const baseStarts=new Set(baseEntries.map(entry=>entry.start.toFixed(4)));
  const cuts=mergedCuts([...baseEntries,...lateralEntries],c.kerfBand,r.diameterMm/2);
  const baseCuts=cuts.filter(cut=>baseStarts.has(cut.start.toFixed(4)));
  const carriageCount=Math.min(baseCuts.length,r.diameterCm<34?1:Math.min(3,r.bases.length));
  const carriageStarts=new Set((carriageCount?baseCuts.slice(-carriageCount):[]).map(cut=>cut.start.toFixed(4)));
  const numbered=items=>items.map((cut,index)=>({...cut,number:index+1}));
  return {
    slabs,
    carriageCuts:numbered(cuts.filter(cut=>carriageStarts.has(cut.start.toFixed(4)))),
    bandCuts:numbered(cuts.filter(cut=>!carriageStarts.has(cut.start.toFixed(4))))
  };
};

// Operational sequence derived from the same kerf strips drawn by stageSVG.
// Positions are geometric references from the left or lower edge of the log.
export function cutSequence(r,c) {
  const outer=r.diameterMm/2;
  const {slabs,carriageCuts,bandCuts}=longitudinalCuts(r,c);

  const baseFor=piece=>{
    const x=Number(String(piece.base??'').split(':')[0]);
    return Number.isFinite(x)?r.bases.findIndex(base=>Math.abs(base.x-x)<.001):-1;
  };
  const multipleGroups=r.bases.map((base,index)=>{
    const pieces=r.pieces.filter(p=>p.origin!=='lateral'&&baseFor(p)===index),entries=[];
    for(const p of pieces){
      const product=c.products[p.productId];
      entries.push({start:p.y-c.kerfGang,label:`cara inferior de ${product.label}`},{start:p.y+p.h,label:`cara superior de ${product.label}`});
    }
    return {
      base:`B${index+1}`,
      width:base.width,
      height:base.coreTop-base.coreBottom,
      pieceCount:pieces.length,
      cuts:mergedCuts(entries,c.kerfGang,outer)
    };
  });

  const finishEntries=[];
  for(const p of r.pieces.filter(piece=>piece.origin!=='basa')){
    const product=c.products[p.productId],label=`${product.label} ${n(product.thickness)} × ${n(product.width)} mm`;
    if(p.origin==='lateral'){
      finishEntries.push({axis:'horizontal',start:p.y-c.kerfEdger,label},{axis:'horizontal',start:p.y+p.h,label});
    }else{
      finishEntries.push({axis:'vertical',start:p.x-c.kerfEdger,label},{axis:'vertical',start:p.x+p.w,label});
    }
  }
  const finishCuts=['vertical','horizontal'].flatMap(axis=>mergedCuts(finishEntries.filter(cut=>cut.axis===axis),c.kerfEdger,outer).map(cut=>({...cut,axis})));
  finishCuts.sort((a,b)=>a.axis.localeCompare(b.axis)||a.position-b.position);
  finishCuts.forEach((cut,index)=>{cut.number=index+1;});

  return {
    carriage:{name:'Carro Huincha',cuts:carriageCuts,outputs:r.diameterCm<34
      ?['Un corte separa semi-basa y lampazo para continuar en Huinchas']
      :[`${carriageCuts.length} ${carriageCuts.length===1?'corte':'cortes'} para ${r.bases.length} ${r.bases.length===1?'basa':'basas'} del esquema optimizado`]},
    bands:{name:'Huinchas',cuts:bandCuts,outputs:[
      ...(r.diameterCm<34?['Despiece de semi-basa y lampazo']:['Completa las caras de basas pendientes']),
      ...r.bases.map((b,i)=>`B${i+1}: basa de ${n(b.width)} mm → múltiple`),
      ...(slabs.length?[`${slabs.length} ${slabs.length===1?'lateral recuperable':'laterales recuperables'} → canteadora`]:['Sin laterales recuperables'])
    ]},
    multiple:{name:'Múltiple',groups:multipleGroups,outputs:[`${r.pieces.filter(p=>p.origin==='basa').length} piezas centrales`,`${r.pieces.filter(p=>p.origin==='cabezal').length} piezas de borde para terminación`]},
    edger:{name:'Canteadora',cuts:finishCuts,outputs:[`${r.pieces.length} piezas terminadas`,`${r.recoveryCount} piezas de recuperación`]},
    reference:'Posiciones medidas al centro de la sierra desde el borde izquierdo (verticales) o inferior (horizontales) del diámetro. Los giros físicos deben validarse en planta.'
  };
}

// These views follow the same rectangular slabs and circle used by the solver.
// Coordinates are relative to the log centre; kerfs are shown at true width.
export function stageSVG(r,c,stage=4,id='stage') {
  const R=r.diameterMm/2,U=r.radius,pad=R*.2,clip=`clip-${id}`;
  const viewStage=stage===0?4:stage;
  const stageName=['Vista final','Carro Huincha','Huinchas','Múltiple','Canteadora'][stage]??`Etapa ${stage}`;
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-R-pad} ${-R-pad} ${2*(R+pad)} ${2*(R+pad)}" role="img" aria-label="${stageName}, diámetro ${r.diameterCm} centímetros"><defs><clipPath id="${clip}"><circle r="${U}"/></clipPath></defs><rect x="${-R-pad}" y="${-R-pad}" width="${2*(R+pad)}" height="${2*(R+pad)}" rx="5" fill="#f5f8fc"/><circle r="${R}" fill="#edf2f8" stroke="#687489" stroke-width="1"/><g clip-path="url(#${clip})">`];
  const rect=(x,y,w,h,fill,stroke='#ffffff',region='')=>parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width=".35"${region?` data-region="${region}"`:''}/>`);
  const rows=new Map();
  for(const p of r.pieces){
    if(p.origin==='cabezal')rows.set(`${p.base}:${p.y}:${p.h}`,p);
  }
  const {slabs,carriageCuts,bandCuts}=longitudinalCuts(r,c);
  const chord=(x,w)=>Math.sqrt(Math.max(0,U*U-Math.max(x*x,(x+w)**2)));
  if(viewStage===1&&r.diameterCm<34&&carriageCuts.length){
    const boundary=carriageCuts[0].start,lampazoStart=boundary+c.kerfBand;
    rect(-U,-U,Math.max(0,boundary+U),2*U,'#c7d8ed','#ffffff','semi-basa');
    rect(lampazoStart,-U,Math.max(0,U-lampazoStart),2*U,'#ecd5a9','#ffffff','lampazo');
  }
  if(viewStage>=2&&viewStage<=3){
    for(const b of r.bases)rect(b.x,-U,b.width,2*U,'#c7d8ed','#ffffff','basa-final');
    for(const s of slabs){const h=chord(s.x,s.w);rect(s.x,-h,s.w,2*h,'#ecd5a9','#ffffff','lateral');}
  }
  const cuts=new Map();
  const cut=(key,x,y,w,h,machine)=>cuts.set(key,{x,y,w,h,machine});
  const addVertical=(entry,machine)=>cut(`v:${entry.start.toFixed(4)}`,entry.start,-U,c.kerfBand,2*U,machine);
  if(viewStage>=1)for(const entry of carriageCuts)addVertical(entry,'carriage');
  if(viewStage>=2)for(const entry of bandCuts)addVertical(entry,'bands');
  if(viewStage>=3){
    for(const p of r.pieces.filter(p=>p.origin==='basa'))rect(p.x,p.y,p.w,p.h,p.productId===0?'#467ded':p.productId===1?'#129680':'#edb552');
    for(const p of rows.values()){
      const b=r.bases.find(b=>Math.abs(b.x-Number(p.base.split(':')[0]))<.001);
      if(b)rect(b.x,p.y,b.width,p.h,'#ecd5a9');
    }
    for(const p of r.pieces.filter(p=>p.origin!=='lateral')){
      const b=r.bases.find(b=>Math.abs(b.x-Number(p.base.split(':')[0]))<.001);if(!b)continue;
      for(const y of [p.y-c.kerfGang,p.y+p.h])cut(`h:${b.x}:${y.toFixed(4)}`,b.x,y,b.width,c.kerfGang,'multiple');
    }
  }
  if(viewStage===4){
    for(const p of r.pieces)rect(p.x,p.y,p.w,p.h,p.productId===0?'#467ded':p.productId===1?'#129680':'#edb552');
    for(const p of r.pieces.filter(p=>p.origin!=='basa')){
      if(p.origin==='lateral')for(const y of [p.y-c.kerfEdger,p.y+p.h])cut(`e:${p.x}:${y.toFixed(4)}`,p.x,y,p.w,c.kerfEdger,'edger');
      else for(const x of [p.x-c.kerfEdger,p.x+p.w])cut(`e:${x.toFixed(4)}:${p.y}`,x,p.y,c.kerfEdger,p.h,'edger');
    }
  }
  for(const v of cuts.values())parts.push(`<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="${cutMachine[v.machine].color}" data-machine="${v.machine}"><title>Corte · ${cutMachine[v.machine].name}</title></rect>`);
  parts.push('</g>');
  // Basa dimensions and positions stay readable and refer to the selected plan.
  if(viewStage>=2)r.bases.forEach((b,i)=>parts.push(`<text x="${b.x+b.width/2}" y="${R*.90}" text-anchor="middle" font-size="${R*.064}" fill="#152238" stroke="white" stroke-width="${R*.008}" paint-order="stroke">B${i+1} · ${n(b.width)} mm</text>`));
  parts.push(`<text x="0" y="${-R*1.07}" text-anchor="middle" font-size="${R*.075}" fill="#152238">Ø ${r.diameterCm} cm · ${stageName}</text></svg>`);
  return parts.join('');
}

export function configurationFile(c) {
  const {products,...input}=c;
  return JSON.stringify({format:'corte-config',version:1,configuration:input},null,2);
}
export function parseConfiguration(text,normalize) {
  const file=JSON.parse(text);
  if(file?.format!=='corte-config'||file.version!==1)throw new Error('Selecciona una configuración guardada desde Corte.');
  return normalize(file.configuration);
}
export function resultsCSV(results,c) {
  const products=activeProducts(c),rows=[['Diámetro (cm)','Largo (mm)','Prioridad','Búsqueda','B activo','Carro / huinchas (mm)','Múltiple (mm)','Canteadora (mm)','Margen (mm)','Ancho mínimo basa','Ancho máximo basa',...products.map(p=>`${p.label} ${p.thickness}x${p.width} (piezas)`),'Volumen (m3)','Volumen objetivo (m3)','Volumen recuperación (m3)','Rendimiento planilla (%)','Aprovechamiento geométrico (%)','Basas (mm)','Estado']];
  for(const result of results){
    const r=bestYieldAlternative(result)?.pattern??result;
    rows.push([r.diameterCm,c.length,c.criterion,c.searchMode,c.targetBEnabled?'Sí':'No',c.kerfBand,c.kerfGang,c.kerfEdger,c.margin,c.minBaseWidth??'',c.maxBaseWidth??'',...products.map(p=>r.counts[p.id].quantity),r.volume,r.targetVolume,r.recoveryVolume,r.yield,r.geometricYield,r.bases.map(b=>b.width).join(' + '),r.status==='found'?'Encontrado':'No encontrado en la búsqueda']);
  }
  return '\ufeff'+rows.map(row=>row.map(v=>`"${String(typeof v==='number'?v.toFixed(6).replace(/\.?0+$/,'').replace('.',','):v).replaceAll('"','""')}"`).join(';')).join('\r\n');
}

export function historicalComparison(r,c,quantities) {
  const ps=activeProducts(c);
  if(quantities.length!==ps.length||quantities.some(q=>!Number.isInteger(q)||q<0))throw new Error('Ingresa cantidades históricas enteras y no negativas.');
  const area=ps.reduce((sum,p,i)=>sum+p.area*quantities[i],0);
  if(area<=0)throw new Error('Ingresa al menos una pieza histórica.');
  if(area>Math.PI*r.radius*r.radius+.001)throw new Error('Las piezas históricas superan el área útil del trozo. Revisa las cantidades.');
  const volume=area*c.length/1e9,yieldPercent=volume/r.referenceVolume*100;
  return {volume,yieldPercent,deltaVolume:r.volume-volume,deltaPoints:r.yield-yieldPercent};
}

export function printSheet(result,c,options={}) {
  const r=bestYieldAlternative(result)?.pattern??result;
  const products=activeProducts(c),esc=escapeHTML;
  const schemeLabel=options.schemeLabel??'Esquema de mayor rendimiento';
  const priority={both:c.targetBEnabled?'Ambos objetivos':'Objetivo A',targets:'Mayor volumen objetivo',total:'Mayor volumen total'}[c.criterion]??c.criterion;
  const date=new Date().toLocaleDateString('es-CL');
  const rows=products.map(p=>`<tr><td>${esc(p.label)}</td><td>${n(p.thickness)} × ${n(p.width)} × ${n(c.length)}</td><td class="print-number">${r.counts[p.id].quantity}</td></tr>`).join('');
  const basas=r.bases.map((b,i)=>`<tr><td>B${i+1}</td><td>${n(b.width)}</td><td>${n(b.x+r.diameterMm/2)}</td><td>${n(b.x+b.width+r.diameterMm/2)}</td><td>${n(b.coreTop-b.coreBottom)}</td></tr>`).join('');
  const sequence=cutSequence(r,c);
  const stages=[
    {name:'Carro Huincha',action:r.diameterCm<34?'1 corte: semi-basa y lampazo':`${sequence.carriage.cuts.length} cortes para ${r.bases.length} ${r.bases.length===1?'basa':'basas'}`},
    {name:'Huinchas',action:r.diameterCm<34?'Despiece de semi-basa y lampazo':'Completar basas y laterales'},
    {name:'Múltiple',action:'Despiece de basas'},
    {name:'Canteadora',action:'Terminar anchos'}
  ];
  const operationRows=(cuts,prefix)=>cuts.length
    ?cuts.map(cut=>`<tr><td><strong>${prefix}${cut.number}</strong></td><td>${n(cut.position)}</td><td>${n(cut.kerf)}</td><td>${esc(cut.axis?`${cut.axis} · ${cut.detail}`:cut.detail)}</td></tr>`).join('')
    :'<tr><td colspan="4">Sin cortes de esta máquina en el esquema.</td></tr>';
  const cutTable=(cuts,prefix)=>`<table class="print-cut-table"><thead><tr><th>Corte</th><th>Centro de sierra (mm)</th><th>Ancho de corte (mm)</th><th>Cara / referencia</th></tr></thead><tbody>${operationRows(cuts,prefix)}</tbody></table>`;
  const outputList=outputs=>`<p class="print-machine-output"><strong>Resultado:</strong> ${outputs.map(esc).join(' · ')}</p>`;
  const machineSection=(index,body,outputs)=>`<section class="print-machine"><div class="print-machine-head" style="border-left-color:${CUT_MACHINES[index].color}"><span class="print-machine-step">${index+1}</span><div><h3>${esc(stages[index].name)}</h3><p>${esc(stages[index].action)}</p></div></div>${body}${outputList(outputs)}</section>`;
  const multipleTables=sequence.multiple.groups.map(group=>`<div class="print-cut-group"><h4>Múltiple · ${esc(group.base)} · ${n(group.width)} mm de ancho · ${group.pieceCount} piezas</h4>${cutTable(group.cuts,`${group.base}-M`)}</div>`).join('');
  const productLegend=`<div class="print-product-legend"><span><i style="background:#467ded"></i>Objetivo A</span>${c.targetBEnabled?'<span><i style="background:#129680"></i>Objetivo B</span>':''}<span><i style="background:#edb552"></i>Recuperación</span></div>`;
  const cutLegend=`<div class="print-cut-legend"><strong>Cortes por máquina</strong>${CUT_MACHINES.map(machine=>`<span><i class="cut-swatch" style="background:${machine.color}"></i>${esc(machine.name)}</span>`).join('')}</div>`;
  const route=`<div class="print-route">${stages.map((stage,i)=>`<div class="print-route-step" style="border-top-color:${CUT_MACHINES[i].color}"><b>${i+1} · ${esc(stage.name)}</b><span>${esc(stage.action)}</span></div>`).join('')}</div>`;
  const previews=`<div class="print-stage-grid">${stages.map((stage,i)=>`<figure><figcaption><b>${i+1}</b> ${esc(stage.name)}</figcaption>${stageSVG(r,c,i+1,'print-stage-'+i)}</figure>`).join('')}</div>`;
  return `<section class="print-overview">
    <header class="print-header"><img src="./glover-logo.png" alt="Glover"><div><p class="print-kicker">Planificación Aserradero</p><h1>Ficha operativa de corte</h1><p>${esc(schemeLabel)} · ${esc(date)}</p></div></header>
    <div class="print-meta"><strong>Trozo Ø ${n(r.diameterCm)} cm</strong><span>Largo ${n(c.length)} mm</span><span>Prioridad: ${esc(priority)}</span></div>
    <div class="print-main"><section class="print-final-view"><h2>Vista final</h2>${stageSVG(r,c,0,'print-final')}${productLegend}</section><section class="print-output"><h2>Producción por trozo</h2><div class="print-stat-grid"><div><span>Rendimiento planilla</span><strong>${n(r.yield,2)} %</strong></div><div><span>Piezas totales</span><strong>${r.totalCount}</strong></div><div><span>Volumen útil</span><strong>${n(r.volume,4)} m³</strong></div></div><table class="print-production"><thead><tr><th>Producto</th><th>Escuadría × largo (mm)</th><th>Piezas</th></tr></thead><tbody>${rows}</tbody></table><p class="print-base-summary"><strong>Basas:</strong> ${r.bases.map((b,i)=>`B${i+1} ${n(b.width)} mm`).join(' · ')||'sin basas'}</p></section></div>
    <section class="print-process"><h2>Secuencia operativa</h2>${route}<h3>Vista por máquina</h3>${previews}${cutLegend}</section>
    <p class="print-review-note"><strong>Para revisión en planta.</strong> Esquema geométrico; validar cotas, giros físicos y restricciones de máquina antes de usarlo en producción. Los colores identifican productos y cortes; las franjas de sierra muestran su ancho.</p>
    <div class="print-technical"><strong>Parámetros de referencia:</strong> ancho de corte carro/huinchas ${n(c.kerfBand)} mm · múltiple ${n(c.kerfGang)} mm · canteadora ${n(c.kerfEdger)} mm · margen radial ${n(c.margin)} mm · ancho de basa ${c.minBaseWidth??'sin mínimo'} a ${c.maxBaseWidth??'sin máximo'} mm · búsqueda detallada cada 1 mm · objetivo B ${c.targetBEnabled?'activo':'desactivado'}. Aprovechamiento geométrico ${n(r.geometricYield,2)} %. Propuesta para sección circular y recta, sin defectos ni conicidad. La búsqueda no garantiza el óptimo global.</div>
  </section>
  <section class="print-cut-details"><header class="print-detail-head"><div><p class="print-kicker">Planificación Aserradero · ficha operativa</p><h2>Cotas de corte por máquina</h2></div><strong>Ø ${n(r.diameterCm)} cm · ${n(c.length)} mm</strong></header>
    <p class="print-reference-note">${esc(sequence.reference)} Las filas están ordenadas por posición geométrica, no por orden físico de pasadas.</p>
    ${machineSection(0,cutTable(sequence.carriage.cuts,'C'),sequence.carriage.outputs)}
    ${machineSection(1,cutTable(sequence.bands.cuts,'H'),sequence.bands.outputs)}
    ${machineSection(2,multipleTables||'<p>Sin basas para despiece.</p>',sequence.multiple.outputs)}
    ${machineSection(3,cutTable(sequence.edger.cuts,'E'),sequence.edger.outputs)}
    <section class="print-bases"><h3>Cotas de las basas</h3><p>Inicio y fin medidos desde el extremo izquierdo del diámetro.</p><table><thead><tr><th>Basa</th><th>Ancho (mm)</th><th>Inicio (mm)</th><th>Fin (mm)</th><th>Altura núcleo (mm)</th></tr></thead><tbody>${basas}</tbody></table></section>
  </section>`;
}
