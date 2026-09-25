import test from 'node:test';
import assert from 'node:assert/strict';
import {bestYieldAlternative,simulateOrder} from '../dist/order.js';

const pattern=(diameterCm,{a=0,b=0,recovery=0,volume,referenceVolume})=>({
  diameterCm,status:'found',counts:[{quantity:a},{quantity:b}],recoveryCount:recovery,
  volume,referenceVolume,targetVolume:volume/2
});
const result=(diameterCm,alternatives)=>({...alternatives[0],alternatives});

test('vista y pedido usan el esquema de mayor rendimiento, no el primer candidato',()=>{
  const alternatives=[
    pattern(24,{a:4,volume:1,referenceVolume:2}),
    pattern(24,{a:3,volume:.65,referenceVolume:1})
  ];
  const calculated=result(24,alternatives);
  assert.equal(bestYieldAlternative(calculated).alternative,2);
  assert.equal(bestYieldAlternative(calculated).yieldPercent,65);
  const plan=simulateOrder(new Map([[24,calculated]]),{24:2});
  const row=plan.rows.find(item=>item.diameterCm===24);
  assert.equal(row.alternative,2);
  assert.equal(row.piecesA,6);
  assert.equal(row.yieldPercent,65);
  assert.equal(bestYieldAlternative({status:'no_pattern',alternatives:[]}),null);
});

test('pedido de trozos elige el mayor rendimiento y pondera el rendimiento del lote',()=>{
  const results=new Map([
    [24,result(24,[pattern(24,{a:4,volume:.6,referenceVolume:1}),pattern(24,{a:3,b:1,recovery:1,volume:.7,referenceVolume:1})])],
    [34,result(34,[pattern(34,{a:2,b:2,recovery:3,volume:1.2,referenceVolume:2})])],
    [16,{status:'no_pattern',alternatives:[]}]
  ]);
  const plan=simulateOrder(results,{16:2,24:1,34:2},{targetBEnabled:true});
  assert.equal(plan.rows.find(row=>row.diameterCm===24).alternative,2);
  assert.equal(plan.rows.find(row=>row.diameterCm===34).yieldPercent,60);
  assert.equal(plan.rows.find(row=>row.diameterCm===16).status,'no_pattern');
  assert.equal(plan.totals.availableLogs,5);
  assert.equal(plan.totals.usedLogs,3);
  assert.equal(plan.totals.unusedLogs,2);
  assert.equal(plan.totals.piecesA,7);
  assert.equal(plan.totals.piecesB,5);
  assert.equal(plan.totals.recoveryPieces,7);
  assert.ok(Math.abs(plan.totals.volumeM3-3.1)<1e-9);
  assert.ok(Math.abs(plan.totals.yieldPercent-62)<1e-9);
});

test('pedido sin trozos conserva rendimiento vacío y B desactivado no suma piezas B',()=>{
  const results=new Map([[24,result(24,[pattern(24,{a:2,b:5,volume:.6,referenceVolume:1})])]]);
  const empty=simulateOrder(results,{},{});
  assert.equal(empty.totals.usedLogs,0);
  assert.equal(empty.totals.yieldPercent,null);
  const plan=simulateOrder(results,{24:3},{targetBEnabled:false});
  assert.equal(plan.totals.piecesA,6);
  assert.equal(plan.totals.piecesB,0);
  assert.equal(plan.totals.usedLogs,3);
});

test('cantidades de trozos deben ser enteras no negativas',()=>{
  const results=new Map();
  assert.throws(()=>simulateOrder(results,{24:-1}),/Trozos de 24 cm/);
  assert.throws(()=>simulateOrder(results,{24:1.5}),/entero/);
  assert.throws(()=>simulateOrder(results,{24:10001}),/10\.000/);
});
