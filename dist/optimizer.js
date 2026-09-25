export const DIAMETERS = Object.freeze([16,18,20,22,24,26,28,30,32,34,36,38,42]);
export const SEARCH_STEP_MM = 1;
const EPS=1e-7;
const bitCount=m=>(m&1)+((m>>1)&1);
const empty=()=>({primary:0,total:0,mask:0,pieces:[],bases:[]});

export function normalizeConfig(input) {
  if(!input||!Array.isArray(input.targets)||input.targets.length!==2) throw new Error('Ingresa las dos escuadrías objetivo.');
  const targetBEnabled=input.targetBEnabled!==false;
  if(!Array.isArray(input.recoveries)) throw new Error('La lista de recuperación no es válida.');
  if(input.recoveries.length>12) throw new Error('Este prototipo admite hasta 12 escuadrías de recuperación.');
  const number=(v,label,min,max,decimal=true)=>{
    const n=Number(v);
    if(v===''||v===null||typeof v==='boolean'||!Number.isFinite(n)||n<min||n>max) throw new Error(`${label}: ingresa un valor entre ${min} y ${max}.`);
    const scale=decimal?10:1;
    if(Math.abs(n*scale-Math.round(n*scale))>1e-6) throw new Error(`${label}: usa ${decimal?'como máximo un decimal':'un número entero'}.`);
    return Math.round(n*scale)/scale;
  };
  const products=[];const seen=new Set();
  [...input.targets,...input.recoveries].forEach((p,i)=>{
    const objective=i<2;
    const name=objective?`Objetivo ${i===0?'A':'B'}`:`Recuperación ${i-1}`;
    if(i===1&&!targetBEnabled){
      products.push({id:1,thickness:p?.thickness??'',width:p?.width??'',role:'target',active:false,mask:0,label:name,area:0});
      return;
    }
    const thickness=number(p?.thickness,`${name}, espesor`,1,1000);
    const width=number(p?.width,`${name}, ancho`,1,1000);
    const key=`${thickness}x${width}`;
    if(seen.has(key)) throw new Error(`La escuadría ${thickness} × ${width} está repetida. Ingresa cada escuadría una sola vez.`);
    seen.add(key);
    const active=objective?(i===0||targetBEnabled):true;
    products.push({id:i,thickness,width,role:objective?'target':'recovery',active,mask:objective&&active?1<<i:0,label:name,area:thickness*width});
  });
  if(!['both','targets','total'].includes(input.criterion)) throw new Error('Selecciona una prioridad válida.');
  const searchMode='detailed';
  const optional=(v,label,min,max)=>v===''||v==null?null:number(v,label,min,max);
  const minBaseWidth=optional(input.minBaseWidth,'Ancho mínimo de basa',1,420);
  const maxBaseWidth=optional(input.maxBaseWidth,'Ancho máximo de basa',1,420);
  if(minBaseWidth!=null&&maxBaseWidth!=null&&minBaseWidth>maxBaseWidth)throw new Error('El ancho mínimo de basa supera el máximo.');
  return {products,targets:products.slice(0,2).map(p=>({thickness:p.thickness,width:p.width})),targetBEnabled,recoveries:products.slice(2).map(p=>({thickness:p.thickness,width:p.width})),criterion:input.criterion,searchMode,minBaseWidth,maxBaseWidth,
    minA:0,minB:0,
    length:number(input.length,'Largo del trozo',500,12000,false),
    kerfBand:number(input.kerfBand,'Kerf del carro y huinchas',0.1,15),kerfGang:number(input.kerfGang,'Kerf de sierras múltiples',0.1,15),kerfEdger:number(input.kerfEdger,'Kerf de canteadora',0.1,15),
    margin:number(input.margin,'Margen radial',0,15),maxBases:number(input.maxBases,'Máximo de basas',1,3,false)};
}

function betterFixedMask(a,b,mode) {
  if(!b)return true;
  const first=mode==='total'?'total':'primary',second=mode==='total'?'primary':'total';
  if(Math.abs(a[first]-b[first])>EPS)return a[first]>b[first];
  if(Math.abs(a[second]-b[second])>EPS)return a[second]>b[second];
  const ac=a.count??a.pieces.length,bc=b.count??b.pieces.length;
  return ac<bc;
}
function keepBest(list,p,mode) {if(betterFixedMask(p,list[p.mask],mode))list[p.mask]=p;}
function combine(left,right,mode) {
  const out=[];
  for(const a of left)if(a)for(const b of right)if(b){
    const p={primary:a.primary+b.primary,total:a.total+b.total,mask:a.mask|b.mask,pieces:[...a.pieces,...b.pieces],bases:[...(a.bases||[]),...(b.bases||[])]};
    keepBest(out,p,mode);
  }
  return out;
}

// Exact one-dimensional packing in 0.1 mm units, inside each sampled region.
// Each item owns its following internal kerf; query capacity includes one kerf
// back, giving sum(dimensions) + (n-1)*kerf for a nonempty packing.
function buildPacker(products,axis,kerf,mode) {
  const maximum=Math.ceil((430+kerf)*10);
  const states=Array.from({length:maximum+1},()=>[]);
  states[0][0]={primary:0,total:0,mask:0,count:0,used:0,item:null,prev:null};
  for(let c=0;c<=maximum;c++)for(let mask=0;mask<4;mask++){
    const previous=states[c][mask];if(!previous)continue;
    for(const p of products){
      const next=c+Math.round((p[axis]+kerf)*10);if(next>maximum)continue;
      const candidate={primary:previous.primary+(p.role==='target'?p.area:0),total:previous.total+p.area,mask:mask|p.mask,count:previous.count+1,used:next/10-kerf,item:p,prev:previous};
      if(betterFixedMask(candidate,states[next][candidate.mask],mode))states[next][candidate.mask]=candidate;
    }
  }
  const prefix=[];let best=[];
  for(let c=0;c<=maximum;c++){
    best=best.slice();
    for(let mask=0;mask<4;mask++){const n=states[c][mask];if(n&&betterFixedMask(n,best[mask],mode))best[mask]=n;}
    prefix[c]=best;
  }
  const itemCache=new WeakMap();
  return {
    query(available){const c=Math.min(maximum,Math.floor((available+kerf)*10+EPS));return c<0?[]:prefix[c];},
    items(node){if(itemCache.has(node))return itemCache.get(node);const items=[];for(let n=node;n?.item;n=n.prev)items.push(n.item);items.reverse();itemCache.set(node,items);return items;}
  };
}

export function createOptimizer(input) {
  const config=normalizeConfig(input),{products,criterion:mode,kerfBand:kb,kerfGang:kg,kerfEdger:ke}=config;
  const activeProducts=products.filter(p=>p.active);
  const widths=[...new Set(activeProducts.map(p=>p.width))].filter(w=>w<=420&&w>=(config.minBaseWidth??0)&&w<=(config.maxBaseWidth??420)).sort((a,b)=>b-a);
  const thicknesses=[...new Set(activeProducts.map(p=>p.thickness))].filter(t=>t<=420).sort((a,b)=>a-b);
  const corePack=new Map(widths.map(w=>[w,buildPacker(activeProducts.filter(p=>p.width===w),'thickness',kg,mode)]));
  const edgePack=new Map(thicknesses.map(t=>[t,buildPacker(activeProducts.filter(p=>p.thickness===t),'width',ke,mode)]));
  const minThickness=Math.min(...activeProducts.map(p=>p.thickness));

  function solve(diameterCm) {
    if(!DIAMETERS.includes(diameterCm))throw new Error('El diámetro no pertenece al catálogo.');
    const D=diameterCm*10,R=D/2-config.margin;
    const columns=new Map(),sides=new Map();let evaluated=0,winner=null;
    const shortlist=[];
    const chordAt=(a,b)=>Math.sqrt(Math.max(0,R*R-Math.max(a*a,b*b)));

    function edgeRows(rawStart,rawEnd,slabStart,t,orientation,region,layer,base) {
      // Reserve one edger kerf at each edge even when an existing face is square.
      const capacity=rawEnd-rawStart-2*ke,packer=edgePack.get(t);
      if(capacity<=0||!packer)return [];
      const plans=[];
      for(const node of packer.query(capacity))if(node?.count){
        let v=(rawStart+rawEnd-node.used)/2;
        const pieces=packer.items(node).map(p=>{
          const rect=orientation==='horizontal'?{x:v,y:slabStart,w:p.width,h:t}:{x:slabStart,y:v,w:t,h:p.width};
          v+=p.width+ke;
          return {...rect,productId:p.id,origin:region,layer,base,stage:orientation==='horizontal'?'Carro huincha → huinchas → múltiple → canteadora':'Carro huincha → huinchas → canteadora'};
        });
        plans[node.mask]={primary:node.primary,total:node.total,mask:node.mask,pieces,bases:[]};
      }
      return plans;
    }

    function caps(x,w,edge,sign,depth,base,layer=0) {
      const out=[empty()];if(!depth)return out;
      for(const t of thicknesses){
        const start=sign>0?edge+kg:edge-kg-t;
        const end=start+t;
        if(Math.max(Math.abs(start),Math.abs(end))>=R)continue;
        const c=chordAt(start,end),lo=Math.max(x,-c),hi=Math.min(x+w,c);
        const rows=edgeRows(lo,hi,start,t,'horizontal','cabezal',`${sign>0?'superior':'inferior'}-${layer}`,base);
        if(!rows.some(Boolean))continue;
        const after=caps(x,w,sign>0?end:start,sign,depth-1,base,layer+1);
        for(const p of combine(rows,after,mode))if(p)keepBest(out,p,mode);
      }
      return out;
    }

    function column(x,w) {
      const key=`${x.toFixed(4)}:${w}`;if(columns.has(key))return columns.get(key);
      if(x<-R-EPS||x+w>R+EPS)return [];
      const height=2*chordAt(x,x+w),packer=corePack.get(w),best=[];
      const usedNodes=new Set();
      for(let reserve=0;reserve<=4;reserve++){
        const allowance=height-reserve*(minThickness+kg);
        for(const node of packer.query(allowance)){
          if(!node?.count||node.used>height+EPS||usedNodes.has(node))continue;
          usedNodes.add(node);
          const shift=Math.floor(Math.max(0,(height-node.used)/2)*10)/10;
          const shifts=shift>0.15?[0,-shift,shift]:[0];
          for(const center of shifts){
            const bottom=center-node.used/2,top=center+node.used/2;
            let y=bottom;
            const pieces=packer.items(node).map(p=>{const b={x,y,w,h:p.thickness,productId:p.id,origin:'basa',layer:'central',base:key,stage:'Carro huincha → huinchas → múltiple'};y+=p.thickness+kg;return b;});
            const core={primary:node.primary,total:node.total,mask:node.mask,pieces,bases:[{x,width:w,coreBottom:bottom,coreTop:top}]};
            const upper=caps(x,w,top,1,2,key),lower=caps(x,w,bottom,-1,2,key);
            const sideCaps=combine(upper,lower,mode);
            for(const candidate of combine([core],sideCaps,mode))if(candidate)keepBest(best,candidate,mode);
          }
        }
      }
      columns.set(key,best);return best;
    }

    function lateral(edge,sign,depth=2,layer=0) {
      const cacheKey=`${edge.toFixed(4)}:${sign}:${depth}`;
      if(sides.has(cacheKey))return sides.get(cacheKey);
      const out=[empty()];if(!depth)return out;
      for(const t of thicknesses){
        const start=sign>0?edge+kb:edge-kb-t,end=start+t;
        if(Math.max(Math.abs(start),Math.abs(end))>=R)continue;
        const c=chordAt(start,end);
        const rows=edgeRows(-c,c,start,t,'vertical','lateral',`${sign>0?'derecha':'izquierda'}-${layer}`,null);
        if(!rows.some(Boolean))continue;
        const next=lateral(sign>0?end:start,sign,depth-1,layer+1);
        for(const p of combine(rows,next,mode))if(p)keepBest(out,p,mode);
      }
      sides.set(cacheKey,out);return out;
    }

    function wins(p,old) {
      if(!old)return true;
      if(mode==='both'&&bitCount(p.mask)!==bitCount(old.mask))return bitCount(p.mask)>bitCount(old.mask);
      if(betterFixedMask(p,old,mode))return true;
      if(betterFixedMask(old,p,mode))return false;
      if(p.bases.length!==old.bases.length)return p.bases.length<old.bases.length;
      return Math.abs(p.offset)<Math.abs(old.offset)-EPS;
    }

    function evaluate(sequence,totalWidth) {
      // Mirror-equivalent width sequences are covered by reflected offsets.
      if(sequence.join(',')>sequence.slice().reverse().join(','))return;
      const lo=-R,hi=R-totalWidth;if(hi<lo)return;
      const centered=-totalWidth/2;
      const positions=new Set([centered]);
      for(let x=lo;x<=hi+EPS;x+=SEARCH_STEP_MM)positions.add(Math.round(x*10)/10);
      positions.add(Math.round(hi*10)/10);
      for(const x of [...positions])positions.add(Math.round((-totalWidth-x)*10)/10);
      for(const start of positions){
        let x=start,combinations=[empty()],possible=true;
        for(const w of sequence){
          const options=column(x,w);
          if(!options.some(Boolean)){possible=false;break;}
          combinations=combine(combinations,options,mode);x+=w+kb;
        }
        if(!possible)continue;
        evaluated++;
        const left=lateral(start,-1),right=lateral(start+totalWidth,1);
        combinations=combine(combine(combinations,left,mode),right,mode);
        for(const p of combinations)if(p){
          p.offset=start+totalWidth/2;
          const counts=products.map(sku=>p.pieces.filter(b=>b.productId===sku.id).length);
          if(counts[0]<config.minA||counts[1]<config.minB)continue;
          if(wins(p,winner))winner=p;
          const signature=counts.join(',')+'|'+p.bases.map(b=>b.width).sort((a,b)=>a-b).join(',');
          const duplicate=shortlist.findIndex(item=>item.signature===signature);
          if(duplicate>=0){if(!wins(p,shortlist[duplicate]))continue;shortlist.splice(duplicate,1);}
          p.signature=signature;shortlist.push(p);shortlist.sort((a,b)=>wins(a,b)?-1:wins(b,a)?1:0);
          shortlist.length=Math.min(shortlist.length,2);
        }
      }
    }
    function sequences(seq=[],sum=0) {
      if(seq.length)evaluate(seq,sum);
      if(seq.length>=config.maxBases)return;
      for(const w of widths){const next=sum+w+(seq.length?kb:0);if(next<2*R-EPS)sequences([...seq,w],next);}
    }
    sequences();
    // Oversized products can leave the searched family without a feasible pattern.
    if(!winner)winner=empty();
    const summarize=plan=>{
    const counts=products.map(p=>({productId:p.id,quantity:plan.pieces.filter(b=>b.productId===p.id).length}));
    const totalArea=plan.total,primaryArea=plan.primary;
    const volume=totalArea*config.length/1e9;
    const refVolume=D*D*config.length/1e9;
    const cylinderVolume=Math.PI*D*D/4*config.length/1e9;
    const result={diameterCm,diameterMm:D,radius:R,pieces:plan.pieces,bases:plan.bases,counts,mask:plan.mask,
      volume,targetVolume:primaryArea*config.length/1e9,recoveryVolume:(totalArea-primaryArea)*config.length/1e9,
      referenceVolume:refVolume,cylinderVolume,yield:volume/refVolume*100,geometricYield:volume/cylinderVolume*100,
      recoveryCount:counts.filter(c=>c.productId>1).reduce((s,c)=>s+c.quantity,0),
      totalCount:plan.pieces.length,offset:plan.offset??0,evaluated,searchStepMm:SEARCH_STEP_MM,
      status:plan.pieces.length?'found':'no_pattern'};
    assertGeometry(result,config);
    return result;
    };
    const alternatives=shortlist.map(summarize);
    return {...(alternatives[0]??summarize(winner)),alternatives};
  }
  return {config,solve};
}

export function assertGeometry(result,config) {
  const tolerance=1e-4;
  for(const p of result.pieces){
    if(p.w<=0||p.h<=0)throw new Error('Se detectó una pieza sin dimensiones válidas.');
    for(const x of [p.x,p.x+p.w])for(const y of [p.y,p.y+p.h])if(x*x+y*y>result.radius**2+tolerance)throw new Error('Una pieza quedó fuera del trozo útil.');
    const sku=config.products[p.productId];
    const dimensions=(Math.abs(p.w-sku.width)<EPS&&Math.abs(p.h-sku.thickness)<EPS)||(Math.abs(p.h-sku.width)<EPS&&Math.abs(p.w-sku.thickness)<EPS);
    if(!dimensions)throw new Error('Las dimensiones de una pieza no coinciden con la escuadría.');
  }
  for(let i=0;i<result.pieces.length;i++)for(let j=i+1;j<result.pieces.length;j++){
    const a=result.pieces[i],b=result.pieces[j];
    if(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>tolerance&&Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>tolerance)throw new Error('Se detectó superposición de piezas.');
  }
  const area=result.pieces.reduce((s,p)=>s+p.w*p.h,0);
  if(Math.abs(area*config.length/1e9-result.volume)>1e-7)throw new Error('El volumen no coincide con las piezas dibujadas.');
  if(result.geometricYield>100+tolerance)throw new Error('El rendimiento geométrico excede el volumen del trozo.');
  return true;
}
