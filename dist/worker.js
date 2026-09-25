import {createOptimizer,DIAMETERS} from './optimizer.js';
self.onmessage=event=>{
  const {runId,config}=event.data;
  try{
    const optimizer=createOptimizer(config);
    self.postMessage({type:'ready',runId,config:optimizer.config});
    const order=[28,...DIAMETERS.filter(d=>d!==28)];
    for(let i=0;i<order.length;i++){
      const result=optimizer.solve(order[i]);
      self.postMessage({type:'result',runId,result,completed:i+1,total:DIAMETERS.length});
    }
    self.postMessage({type:'done',runId});
  }catch(error){self.postMessage({type:'error',runId,message:error.message||'No se pudo completar el cálculo.'});}
};
