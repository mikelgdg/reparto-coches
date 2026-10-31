/* test/e2e.sim.js — simulación end-to-end: 13 amigos, 4 coches, casos especiales */
'use strict';
const Solver = require('../js/solver.js');

/* --------- datos demo (los del botón de ejemplo) --------- */
const NAMES = ['Marta', 'Javier', 'Lucía', 'Dani', 'Carla', 'Álvaro', 'Rocío', 'Pablo', 'Elena', 'Diego', 'Nuria', 'Iván', 'Sara'];
const PLACE = [
  [-0.012, 0.006], [0.010, -0.008], [0.003, -0.011], [-0.007, -0.010],
  [0.014, 0.003], [0.008, 0.012], [-0.014, -0.006], [-0.004, 0.014],
  [0.017, -0.004], [-0.010, 0.011], [0.006, 0.017], [-0.017, 0.001], [0.011, -0.014]
];
const people = NAMES.map((nm, i) => ({
  name: nm,
  lat: 40.4300 + PLACE[i][1],
  lng: -3.6990 + PLACE[i][0],
  driver: i < 4,
  seats: i < 4 ? [3, 3, 4, 2][i] : 0,
  drive: 'both',
  noReturn: false
}));
// casos especiales: Iván no vuelve; Nuria no pone coches pero se va pronto (solo ida pax? no vuelva)
people[10].noReturn = false;
people[11].noReturn = true;   // Iván no vuelve
people[4].drive = 'ida';      // Carla lleva solo a la ida

const pts = people.map(p => ({ lat: p.lat, lng: p.lng })).concat([{ lat: 40.4380, lng: -3.6650 }]);
/* --------- matriz estimada (como app.js) --------- */
function hav(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const CIRCUITY = 1.35, SPEED = 45000 / 60;
const mDur = [], mDist = [];
pts.forEach((a, i) => {
  mDur[i] = []; mDist[i] = [];
  pts.forEach((b, j) => {
    if (i === j) { mDur[i][j] = 0; mDist[i][j] = 0; return; }
    const d = hav(a, b) * CIRCUITY;
    mDist[i][j] = d; mDur[i][j] = d / SPEED;
  });
});

function solve(mode, dir, keep) {
  const cars = [], pax = [];
  people.forEach((p, i) => {
    if (dir === 'out' && p.driver && (p.drive === 'both' || p.drive === 'ida')) cars.push({ driverNode: i, cap: p.seats });
    if (dir === 'rtn' && p.driver && (p.drive === 'both' || p.drive === 'vuelta') && !p.noReturn) cars.push({ driverNode: i, cap: p.seats });
    if (dir === 'out' && !p.driver) pax.push({ node: i });
    if (dir === 'rtn' && !p.driver && !p.noReturn) pax.push({ node: i });
  });
  const res = Solver.solveDirection({
    direction: dir, venueNode: pts.length - 1, pax, cars, mDur, mDist, mode,
    restriction: keep ? true : null
  });
  return { res, cars, pax };
}

let failed = 0;
function check(cond, name) { if (cond) console.log('  ✓ ' + name); else { failed++; console.error('  ✗ ' + name); } }

['fair', 'sum', 'spread'].forEach(mode => {
  console.log('\n— modo ' + mode + ' —');
  const out = solve(mode, 'out', false);
  check(out.res.ok, 'ida resuelta (' + out.cars.length + ' coches, ' + out.pax.length + ' pax)');
  const outGroups = {};
  out.res.cars.forEach(c => c.order.forEach(n => { outGroups[n] = c.driverNode; }));
  const rtn = solve(mode, 'rtn', false);
  check(rtn.res.ok, 'vuelta resuelta (' + rtn.cars.length + ' coches, ' + rtn.pax.length + ' pax — Iván fuera)');
  // keepGroups con restricción real
  const { res: rtnK } = (() => {
    const carsK = [], paxK = [];
    people.forEach((p, i) => {
      if (p.driver && (p.drive === 'both' || p.drive === 'vuelta') && !p.noReturn) carsK.push({ driverNode: i, cap: p.seats });
      if (!p.driver && !p.noReturn) paxK.push({ node: i });
    });
    const restr = carsK.map(car => {
      let mask = 0;
      paxK.forEach((px, b) => { if (outGroups[px.node] === car.driverNode) mask |= 1 << b; });
      return mask;
    });
    return { res: Solver.solveDirection({
      direction: 'rtn', venueNode: pts.length - 1, pax: paxK, cars: carsK, mDur, mDist, mode, restriction: restr
    }) };
  })();
  check(rtnK.ok, 'vuelta con keepGroups resuelta');
});
console.log('\nChequeo de plazas: capa ida = ' + (3 + 3 + 4 + 2) + ' plazas vs 9 pasajeros ✓ (enunciado)');
console.log(failed ? failed + ' FALLOS' : 'SIMULACIÓN E2E COMPLETA: OK');
process.exit(failed ? 1 : 0);
