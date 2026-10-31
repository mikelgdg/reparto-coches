/* test/solver.test.js — pruebas del motor con node */
'use strict';
const Solver = require('../js/solver.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-7); }

/* ---------- 1. evalRoute básico ---------- */
{
  const mDur = [[0, 3, 8], [2, 0, 4], [1, 5, 0]];
  const mDist = mDur;
  const r = Solver.evalRoute(mDur, mDist, 0, [1], 2);
  ok(r && approx(r.D, 3 + 4) && approx(r.dist, 7), 'evalRoute suma tramos correctamente');
  ok(r.tau[0] === 3 && approx(r.rides[0], 4), 'tau y rides según lo esperado');
  const bad = Solver.evalRoute(mDur, mDist, 0, [1], 9);
  ok(bad === null, 'end fuera de matriz devuelve null');
}

/* ---------- 2. fair elige orden distinto del de duración ---------- */
{
  // driver=0, B=1, C=2, venue=3
  const mDur = [
    [0, 1, 5, 2],
    [3, 0, 1, 0.5],
    [1, 1, 0, 1],
    [2, 1, 1, 0]
  ];
  const mDist = mDur.map(r => r.map(x => x * 1000));
  // porDur: B,C -> D = 1+1+1 = 3 (rideMax 2)
  // porFair: C,B -> D = 5+1+0.5 = 6.5 (rideMax 1.5)
  const res = Solver.solveDirection({
    direction: 'out', venueNode: 3, mode: 'fair',
    pax: [{ node: 1 }, { node: 2 }],
    cars: [{ driverNode: 0, cap: 2 }],
    mDur, mDist
  });
  ok(res.ok, 'solución existe (fair)');
  ok(res.cars[0].order.join() === '2,1', 'fair ordena C primero para reducir la peor parada');
  ok(approx(res.metrics.rideMax, 1.5), 'rideMax=1.5 con fair');
  const res2 = Solver.solveDirection({
    direction: 'out', venueNode: 3, mode: 'sum',
    pax: [{ node: 1 }, { node: 2 }],
    cars: [{ driverNode: 0, cap: 2 }],
    mDur, mDist
  });
  ok(res2.cars[0].order.join() === '1,2', 'sum usa la ruta de mínima duración');
  ok(approx(res2.metrics.total, 3 + 1 + 1 + 1), 'total = D + rides');
}

/* ---------- 3. plazas insuficientes ---------- */
{
  const mDur = [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]];
  const res = Solver.solveDirection({
    direction: 'out', venueNode: 3, mode: 'fair',
    pax: [{ node: 1 }, { node: 2 }, { node: 0 }],
    cars: [{ driverNode: 3, cap: 2 }],
    mDur, mDist: mDur
  });
  ok(!res.ok && res.missingSeats === 1, 'detecta plaza que falta');
}

/* ---------- 4. Held-Karp == fuerza bruta (k=8) ---------- */
{
  const n = 10; // 0 = driver, 1..8 = pax, 9 = venue
  const mDur = [];
  for (let i = 0; i < n; i++) {
    mDur[i] = [];
    for (let j = 0; j < n; j++) {
      mDur[i][j] = i === j ? 0 : 3 + ((i * 31 + j * 17) % 23) * 0.7;
    }
  }
  const nodes = [1, 2, 3, 4, 5, 6, 7, 8];
  let brute = Infinity, bruteOrder = null;
  function perms(arr, cur) {
    if (cur.length === arr.length) {
      const s = Solver.evalRoute(mDur, mDur, 0, cur, 9);
      if (s && s.D < brute) { brute = s.D; bruteOrder = s.order.slice(); }
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      if (cur.includes(arr[i])) continue;
      cur.push(arr[i]); perms(arr, cur); cur.pop();
    }
  }
  perms(nodes, []);
  const hk = Solver.heldKarp(mDur, 0, nodes, 9);
  ok(hk && approx(hk.D, brute), 'Held-Karp coincide con fuerza bruta en duración (k=8)');
  const s1 = Solver.evalRoute(mDur, mDur, 0, hk.order, 9);
  const s2 = Solver.evalRoute(mDur, mDur, 0, bruteOrder, 9);
  ok(approx(s1.D, s2.D), 'la ruta reconstruida del HK es consistente');
}

/* ---------- 5. dirección de vuelta ---------- */
{
  // venue=3 como origen; driver=0 como destino final
  const mDur = [
    [0, 1, 5, 2],
    [3, 0, 1, 0.5],
    [1, 1, 0, 1],
    [2, 1, 1, 0]
  ];
  const mDist = mDur;
  const res = Solver.solveDirection({
    direction: 'rtn', venueNode: 3, mode: 'sum',
    pax: [{ node: 1 }, { node: 2 }],
    cars: [{ driverNode: 0, cap: 2 }],
    mDur, mDist
  });
  // orden [1,2]: 1 + 1 + 1 = 3 ; orden [2,1]: 1 + 1 + 3 = 5 → mejor [1,2]
  ok(res.ok && res.cars[0].order.join() === '1,2', 'vuelta evalúa desde el venue hasta casa del conductor');
  ok(approx(res.cars[0].D, 3), 'duración de vuelta correcta');
}

/* ---------- 6. restricción keepGroups ---------- */
{
  const mDur = [
    [0, 1, 1, 1, 1],
    [1, 0, 1, 1, 1],
    [1, 1, 0, 1, 1],
    [1, 1, 1, 0, 1],
    [1, 1, 1, 1, 0]
  ];
  const mDist = mDur;
  // pax bits: 0→node 1, 1→node 2; coche 0 (driver 4) solo puede bit 0, coche 1 (driver 3) solo bit 1
  const res = Solver.solveDirection({
    direction: 'out', venueNode: 0, mode: 'fair',
    pax: [{ node: 1 }, { node: 2 }],
    cars: [{ driverNode: 4, cap: 2 }, { driverNode: 3, cap: 2 }],
    restriction: [0b01, 0b10],
    mDur, mDist
  });
  ok(res.ok && res.cars[0].order.join() === '1' && res.cars[1].order.join() === '2', 'restricción por coche respetada');
  const bad = Solver.solveDirection({
    direction: 'out', venueNode: 0, mode: 'fair',
    pax: [{ node: 1 }, { node: 2 }],
    cars: [{ driverNode: 4, cap: 2 }, { driverNode: 3, cap: 2 }],
    restriction: [0b01, 0b00],
    mDur, mDist
  });
  ok(!bad.ok && bad.restrictionFailed === true, 'restricción inviable marcada para fallback');
}

/* ---------- 7. sizes / round-trip collage ---------- */
{
  const res = Solver.solveDirection({
    direction: 'out', venueNode: 3, mode: 'spread',
    pax: [],
    cars: [{ driverNode: 0, cap: 3 }, { driverNode: 1, cap: 3 }],
    mDur: [
      [0, 2, 4, 4],
      [2, 0, 1, 9],
      [9, 9, 0, 9],
      [4, 9, 1, 0]
    ],
    mDist: [
      [0, 2, 4, 4],
      [2, 0, 1, 9],
      [9, 9, 0, 9],
      [4, 9, 1, 0]
    ]
  });
  ok(res.ok && approx(res.cars[0].D, 4) && approx(res.cars[1].D, 9), 'coches sin pasajeros usan la ruta directa');
  ok(approx(res.metrics.maxD, 9), 'spread: métrica = máximo de duraciones');
}

console.log('\n' + passed + ' pruebas OK, ' + failed + ' fallidas');
process.exit(failed ? 1 : 0);
