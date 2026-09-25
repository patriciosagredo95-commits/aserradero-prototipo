import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DIAMETERS,createOptimizer,normalizeConfig,assertGeometry} from '../dist/optimizer.js';
import {configurationFile,parseConfiguration,resultsCSV,printSheet,stageSVG,cutSequence,CUT_MACHINES,historicalComparison} from '../dist/reports.js';
import {bestYieldAlternative} from '../dist/order.js';
const input={targets:[{thickness:22,width:125},{thickness:22,width:110}],recoveries:[{thickness:22,width:75},{thickness:22,width:60}],criterion:'both',length:4000,kerfBand:3.4,kerfGang:4.2,kerfEdger:3.8,margin:0,maxBases:3};

test('la interfaz ofrece dos alternativas seleccionables por diámetro',()=>{
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.match(html,/id="alternative-grid"/);
  assert.match(html,/id="alternative-count">0 \/ 2/);
  assert.match(app,/alternativeSelections/);
  assert.match(app,/Alternativa \$\{index\+1\}/);
});

test('inactive B is excluded from validation, duplicates and all 13 solutions; activation restores validation',()=>{
  const c={...input,targetBEnabled:false,targets:[input.targets[0],{thickness:'',width:'invalid'}]};
  const engine=createOptimizer(c);
  for(const d of DIAMETERS){const r=engine.solve(d);assert.equal(r.counts[1].quantity,0);assert.ok(r.pieces.every(p=>p.productId!==1));}
  assert.throws(()=>normalizeConfig({...c,targetBEnabled:true}));
  assert.doesNotThrow(()=>normalizeConfig({...input,targetBEnabled:false,targets:[input.targets[0],input.recoveries[0]]}));
  assert.throws(()=>normalizeConfig({...input,targets:[input.targets[0],input.recoveries[0]]}),/repetida/);
});

test('alternatives are distinct and geometrically valid; search is always detailed at 1 mm',()=>{
  const engine=createOptimizer(input),detailed=engine.solve(32);
  assert.equal(engine.config.searchMode,'detailed');
  assert.equal(detailed.searchStepMm,1);
  assert.equal(detailed.alternatives.length,2);
  const signatures=detailed.alternatives.map(r=>r.counts.map(c=>c.quantity).join(',')+'|'+r.bases.map(b=>b.width).sort().join(','));
  assert.equal(new Set(signatures).size,2);
  detailed.alternatives.forEach(r=>assertGeometry(r,engine.config));
  const legacyEngine=createOptimizer({...input,searchMode:'fast'}),legacy=legacyEngine.solve(32);
  assert.equal(legacyEngine.config.searchMode,'detailed');
  assert.equal(legacy.searchStepMm,1);
  assert.equal(legacy.targetVolume,detailed.targetVolume);
  assert.equal(legacy.volume,detailed.volume);
});

test('hidden legacy minima are cleared and every alternative respects basa width limits',()=>{
  const engine=createOptimizer({...input,minA:300,minB:300,minBaseWidth:100,maxBaseWidth:125}),r=engine.solve(32);
  assert.equal(engine.config.minA,0);assert.equal(engine.config.minB,0);
  assert.ok(r.alternatives.length);
  for(const a of r.alternatives)assert.ok(a.bases.every(b=>b.width>=100&&b.width<=125));
  assert.throws(()=>normalizeConfig({...input,minBaseWidth:200,maxBaseWidth:100}));
});

test('configuration round trip, CSV quantities, printable stages and historical delta are consistent',()=>{
  const engine=createOptimizer({...input,searchMode:'detailed',minA:2,minB:1,maxBaseWidth:125}),r=engine.solve(28),c=engine.config;
  assert.deepEqual(parseConfiguration(configurationFile(c),normalizeConfig),c);
  assert.throws(()=>parseConfiguration('{"format":"bad"}',normalizeConfig));
  const csv=resultsCSV([r],c);assert.equal(csv.split('\r\n').length,2);assert.ok(csv.includes('Volumen objetivo'));assert.ok(!csv.includes('Alternativa'));
  const best=bestYieldAlternative(r)?.pattern;assert.ok(best);assert.equal(csv,resultsCSV([{...best,alternatives:[best]}],c));
  const sequence=cutSequence(r,c);assert.equal(sequence.carriage.cuts.length,1);assert.ok(sequence.bands.cuts.length);assert.equal(sequence.multiple.groups.length,r.bases.length);assert.ok(sequence.multiple.groups.every(group=>group.cuts.length));assert.ok(sequence.reference.includes('Posiciones'));
  const sheet=printSheet(r,c);assert.equal((sheet.match(/<svg\b/g)||[]).length,5);assert.match(sheet,/esquema de mayor rendimiento/i);assert.ok(!/alternativa\s+\d/i.test(sheet));assert.ok(/Ruta|Secuencia operativa/.test(sheet));assert.ok(sheet.includes('Carro Huincha'));assert.ok(sheet.includes('Huinchas'));assert.ok(sheet.includes('Múltiple'));assert.ok(sheet.includes('Canteadora'));assert.ok(sheet.includes('Cotas de las basas'));assert.ok(sheet.includes('Cortes por máquina'));assert.ok(CUT_MACHINES.every(machine=>sheet.includes(`background:${machine.color}`)));assert.ok(!/NaN|undefined/.test(sheet));
  assert.match(printSheet(r.alternatives[1],c,{schemeLabel:'Alternativa 2'}),/Alternativa 2/);
  const history=historicalComparison(r,c,r.counts.map(p=>p.quantity));assert.equal(history.deltaVolume,0);assert.equal(history.deltaPoints,0);
  assert.throws(()=>historicalComparison(r,c,[-1,0,0,0]));assert.throws(()=>historicalComparison(r,c,[100000,0,0,0]));
});

test('Carro Huincha begins with one cut below 34 cm; Huinchas completes all longitudinal cuts',()=>{
  const sorted=values=>[...new Set(values.map(value=>Number(value).toFixed(4)))].sort((a,b)=>Number(a)-Number(b));
  const fromSequence=(cuts,r,c)=>sorted(cuts.map(cut=>cut.position-r.diameterMm/2-c.kerfBand/2));
  const fromSVG=(svg,machine)=>sorted([...svg.matchAll(/<rect x="([^"]+)" y="[^"]+" width="[^"]+" height="[^"]+" fill="[^"]+" data-machine="([^"]+)"/g)]
    .filter(match=>match[2]===machine).map(match=>Number(match[1])));
  const printNumber=value=>Number(value).toLocaleString('es-CL',{maximumFractionDigits:1});
  const cases=[
    {name:'anchos habituales',config:input,diameters:[24,28,32,34,36,42]},
    {name:'tres basas angostas',config:{...input,targets:[{thickness:22,width:75},{thickness:22,width:70}],recoveries:[{thickness:22,width:50},{thickness:22,width:40}]},diameters:[32,34]}
  ];
  for(const {name,config,diameters} of cases){
    const engine=createOptimizer(config),c=engine.config;
    for(const diameter of diameters){
      const result=engine.solve(diameter),r=bestYieldAlternative(result)?.pattern??result;
      const before=JSON.stringify(r),sequence=cutSequence(r,c);
      const basas=sorted(r.bases.flatMap(b=>[b.x-c.kerfBand,b.x+b.width]));
      const slabs=[...new Map(r.pieces.filter(p=>p.origin==='lateral').map(p=>[`${p.x.toFixed(4)}:${p.w.toFixed(4)}`,p])).values()];
      const lateral=sorted(slabs.flatMap(p=>[p.x-c.kerfBand,p.x+p.w]));
      const expected=sorted([...basas,...lateral]);
      const carriage=fromSequence(sequence.carriage.cuts,r,c),bands=fromSequence(sequence.bands.cuts,r,c);
      const context=`${name}, Ø${diameter}`;
      assertGeometry(r,c);
      if(diameter<34)assert.equal(carriage.length,1,`${context}: Carro hace un corte inicial`);
      else {
        assert.ok(carriage.length>=1&&carriage.length<=3,`${context}: Carro hace de uno a tres cortes`);
        assert.equal(carriage.length,r.bases.length,`${context}: desde 34 cm hay un corte del Carro por basa optimizada`);
      }
      assert.ok(carriage.some(start=>basas.includes(start)),`${context}: al menos un corte de Carro limita una basa`);
      assert.deepEqual(sorted([...carriage,...bands]),expected,`${context}: ambas máquinas completan los cortes longitudinales`);
      assert.equal(carriage.length+bands.length,expected.length,`${context}: ningún corte se duplica entre máquinas`);
      if(name==='tres basas angostas'){
        assert.equal(r.bases.length,3,`${context}: el caso debe contener tres basas`);
        assert.equal(basas.length,4,`${context}: las tres basas producen cuatro fronteras`);
      }

      const carriageSVG=stageSVG(r,c,1,`carriage-${diameter}-${name}`),bandsSVG=stageSVG(r,c,2,`bands-${diameter}-${name}`);
      assert.deepEqual(fromSVG(carriageSVG,'carriage'),carriage,`${context}: dibujo de Carro y cotas coinciden`);
      assert.deepEqual(fromSVG(carriageSVG,'bands'),[],`${context}: Carro no anticipa cortes de Huinchas`);
      assert.deepEqual(fromSVG(bandsSVG,'carriage'),carriage,`${context}: Huinchas conserva cortes de Carro`);
      assert.deepEqual(fromSVG(bandsSVG,'bands'),bands,`${context}: dibujo de Huinchas y cotas coinciden`);
      if(diameter<34){
        assert.match(carriageSVG,/<rect\b[^>]*data-region="semi-basa"/,`${context}: Carro muestra la semi-basa`);
        assert.match(carriageSVG,/<rect\b[^>]*data-region="lampazo"/,`${context}: Carro muestra el lampazo`);
        assert.doesNotMatch(carriageSVG,/data-region="basa-final"/,`${context}: Carro no muestra basas finalizadas`);
        assert.match(bandsSVG,/<rect\b[^>]*data-region="basa-final"/,`${context}: Huinchas muestra las basas finalizadas`);
        if(slabs.length)assert.match(bandsSVG,/<rect\b[^>]*data-region="lateral"/,`${context}: Huinchas muestra laterales`);
      }

      const machineSections=[...printSheet(r,c).matchAll(/<section class="print-machine">([\s\S]*?)<\/section>/g)].map(match=>match[1]);
      assert.equal(machineSections.length,4);
      for(const [index,prefix,cuts] of [[0,'C',sequence.carriage.cuts],[1,'H',sequence.bands.cuts]]){
        const rows=[...machineSections[index].matchAll(new RegExp(`<tr><td><strong>${prefix}(\\d+)<\\/strong><\\/td><td>([^<]+)<\\/td>`,'g'))];
        assert.equal(rows.length,cuts.length,`${context}: tabla ${prefix} coincide con el dibujo`);
        cuts.forEach((cut,i)=>{assert.equal(Number(rows[i][1]),cut.number);assert.equal(rows[i][2],printNumber(cut.position));});
      }
      assert.equal(JSON.stringify(r),before,`${context}: los reportes no alteran la solución optimizada`);
    }
  }
  const oneBaseEngine=createOptimizer({...input,maxBases:1}),oneBaseResult=oneBaseEngine.solve(34);
  const oneBase=bestYieldAlternative(oneBaseResult)?.pattern??oneBaseResult;
  assert.equal(oneBase.bases.length,1);
  assert.equal(cutSequence(oneBase,oneBaseEngine.config).carriage.cuts.length,1,'Ø34 con una basa usa un corte de Carro');
});

test('printable sheet puts production and final diagram before the cutting route, with operator-friendly cut tables',()=>{
  const engine=createOptimizer(input),r=engine.solve(28),sheet=printSheet(r,engine.config);
  const headings=[...sheet.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(match=>({position:match.index,text:match[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}));
  const heading=pattern=>headings.find(item=>pattern.test(item.text));
  const title=heading(/ficha|planificaci[oó]n/i);
  const production=heading(/producci[oó]n por trozo/i);
  const finalView=heading(/vista final/i);
  const route=heading(/ruta|secuencia operativa/i);
  assert.ok(title,'La ficha debe comenzar con un título');
  assert.ok(production,'Debe resumir la producción por trozo');
  assert.ok(finalView,'Debe mostrar la vista final');
  assert.ok(route,'Debe identificar la ruta de máquinas');
  assert.ok(title.position<production.position&&title.position<finalView.position&&production.position<route.position&&finalView.position<route.position,
    'La cabecera, producción y vista final deben preceder la ruta de máquinas');

  assert.equal((sheet.match(/<svg\b/g)||[]).length,5,'Una vista final y cuatro vistas por máquina');
  const tables=[...sheet.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .map(match=>({position:match.index,html:match[0],header:match[0].match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1]??''}));
  const cutTables=tables.filter(table=>/\b(?:Corte|Centro de sierra|Pasada|Kerf)\b/i.test(table.header));
  assert.ok(cutTables.length>=4,'Debe haber tablas de corte para las cuatro máquinas');
  assert.ok(cutTables[0].position>route.position,'Las tablas de corte deben aparecer después de la ruta');
  for(const table of cutTables){
    assert.match(table.header, /<th\b[^>]*>\s*Corte\s*<\/th>/i);
    assert.match(table.header, /Centro de sierra/i);
    assert.doesNotMatch(table.html, /\b(?:Pasada|Kerf)\b/i);
  }
});

test('edger cut IDs stay unique across axes and the second base identifies Múltiple on print',()=>{
  const engine=createOptimizer(input),r=engine.solve(34),c=engine.config;
  const sequence=cutSequence(r,c),ids=sequence.edger.cuts.map(cut=>cut.number);
  assert.ok(ids.length>0);
  assert.deepEqual(ids,Array.from({length:ids.length},(_,index)=>index+1));
  assert.ok(sequence.multiple.groups.some(group=>group.base==='B2'));
  assert.match(printSheet(r,c),/Múltiple · B2/);
});

test('CSV and printable sheet use only the highest-yield scheme, including a no-pattern CSV row',()=>{
  const engine=createOptimizer(input),base=engine.solve(28),c=engine.config;
  const lower={...base,volume:base.volume/2,yield:base.yield/2,alternatives:[]};
  const higher={...base,alternatives:[]};
  const mixed={...lower,alternatives:[lower,higher]};
  assert.equal(resultsCSV([mixed],c),resultsCSV([higher],c));
  assert.equal(printSheet(mixed,c),printSheet(higher,c));
  const noPattern={...base,status:'no_pattern',alternatives:[],counts:base.counts.map(count=>({...count,quantity:0})),bases:[],pieces:[],volume:0,targetVolume:0,recoveryVolume:0,yield:0,geometricYield:0};
  const rows=resultsCSV([mixed,noPattern],c).split('\r\n');
  assert.equal(rows.length,3);
  assert.ok(rows[2].includes('No encontrado en la búsqueda'));
});

test('each machine has a distinct cut color and kerf strips avoid finished pieces',()=>{
  const engine=createOptimizer(input),r=engine.solve(32);
  assert.equal(new Set(CUT_MACHINES.map(machine=>machine.color)).size,CUT_MACHINES.length);
  for(let stage=1;stage<=4;stage++){
    const svg=stageSVG(r,engine.config,stage);
    const cuts=[...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="([^"]+)" data-machine="([^"]+)"/g)].map(m=>({x:+m[1],y:+m[2],w:+m[3],h:+m[4],color:m[5],machine:m[6]}));
    assert.deepEqual(new Set(cuts.map(cut=>cut.machine)),new Set(CUT_MACHINES.slice(0,stage).map(machine=>machine.key)));
    for(const cut of cuts){
      assert.equal(cut.color,CUT_MACHINES.find(machine=>machine.key===cut.machine).color);
      for(const p of r.pieces){const dx=Math.min(cut.x+cut.w,p.x+p.w)-Math.max(cut.x,p.x),dy=Math.min(cut.y+cut.h,p.y+p.h)-Math.max(cut.y,p.y);assert.ok(dx<=1e-4||dy<=1e-4,'Kerf overlaps finished wood');}
    }
  }
});
