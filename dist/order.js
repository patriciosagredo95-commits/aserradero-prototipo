import {DIAMETERS} from './optimizer.js';

const MAX_LOGS_PER_DIAMETER=10000;
const EPS=1e-10;

// La vista y el pedido usan el mismo esquema de mayor rendimiento entre los
// candidatos ya calculados. El desempate favorece el volumen objetivo.
export function bestYieldAlternative(result){
  const alternatives=result?.alternatives?.length?result.alternatives:result?.status==='found'?[result]:[];
  return alternatives.reduce((winner,pattern,index)=>{
    if(pattern.status!=='found'||!Number.isFinite(pattern.volume)||!Number.isFinite(pattern.referenceVolume)||pattern.referenceVolume<=0)return winner;
    const yieldPercent=100*pattern.volume/pattern.referenceVolume;
    if(!winner||yieldPercent>winner.yieldPercent+EPS||
      (Math.abs(yieldPercent-winner.yieldPercent)<=EPS&&(pattern.targetVolume??0)>(winner.pattern.targetVolume??0)+EPS)){
      return {pattern,alternative:index+1,yieldPercent};
    }
    return winner;
  },null);
}

function logCount(value,diameter){
  const number=Number(value===''||value==null?0:value);
  if(!Number.isSafeInteger(number)||number<0||number>MAX_LOGS_PER_DIAMETER){
    throw new Error(`Trozos de ${diameter} cm: ingresa un entero entre 0 y ${MAX_LOGS_PER_DIAMETER.toLocaleString('es-CL')}.`);
  }
  return number;
}

// El stock fija el número de trozos. Cada diámetro se optimiza de forma independiente
// usando el patrón de mayor rendimiento entre los candidatos ya calculados.
export function simulateOrder(resultsByDiameter,stockByDiameter,config={}){
  const targetBEnabled=config.targetBEnabled!==false;
  const rows=DIAMETERS.map(diameterCm=>{
    const availableLogs=logCount(stockByDiameter instanceof Map?stockByDiameter.get(diameterCm):stockByDiameter?.[diameterCm],diameterCm);
    const best=bestYieldAlternative(resultsByDiameter.get(diameterCm));
    const usedLogs=best?availableLogs:0,pattern=best?.pattern;
    const volumeM3=usedLogs*(pattern?.volume??0);
    const referenceVolumeM3=usedLogs*(pattern?.referenceVolume??0);
    return {diameterCm,availableLogs,usedLogs,unusedLogs:availableLogs-usedLogs,
      alternative:usedLogs?best.alternative:null,
      piecesA:usedLogs*(pattern?.counts?.[0]?.quantity??0),
      piecesB:targetBEnabled?usedLogs*(pattern?.counts?.[1]?.quantity??0):0,
      recoveryPieces:usedLogs*(pattern?.recoveryCount??0),
      volumeM3,referenceVolumeM3,yieldPercent:usedLogs?100*volumeM3/referenceVolumeM3:null,
      status:availableLogs&&!best?'no_pattern':usedLogs?'used':'no_stock'};
  });
  const totals=rows.reduce((sum,row)=>({
    availableLogs:sum.availableLogs+row.availableLogs,usedLogs:sum.usedLogs+row.usedLogs,
    piecesA:sum.piecesA+row.piecesA,piecesB:sum.piecesB+row.piecesB,
    recoveryPieces:sum.recoveryPieces+row.recoveryPieces,
    volumeM3:sum.volumeM3+row.volumeM3,referenceVolumeM3:sum.referenceVolumeM3+row.referenceVolumeM3
  }),{availableLogs:0,usedLogs:0,piecesA:0,piecesB:0,recoveryPieces:0,volumeM3:0,referenceVolumeM3:0});
  totals.unusedLogs=totals.availableLogs-totals.usedLogs;
  totals.yieldPercent=totals.referenceVolumeM3?100*totals.volumeM3/totals.referenceVolumeM3:null;
  return {targetBEnabled,rows,totals};
}
