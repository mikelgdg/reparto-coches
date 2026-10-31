/* js/solver.js
 * RepartoCars — motor de optimización (puro, sin DOM).
 *
 * Problema: asignar pasajeros a coches con capacidad limitada, eligiendo el
 * orden óptimo de recogidas dentro de cada coche (mini-TSP con inicio = origen
 * del conductor o restaurante, fin = destino según trayecto), minimizando un
 * objetivo seleccionable sobre la matriz de tiempos de conducción.
 *
 * Objetivos ('mode'):
 *  - 'fair'   : minimizar el MÁXIMO tiempo en coche de un pasajero (nadie lo
 *               pasa mal). Desempates: menor suma de tiempos de pasajeros,
 *               luego menor suma de duraciones de coche.
 *  - 'sum'    : minimizar el tiempo total de persona-minutos (conductor
 *               incluido: duración de su ruta + rides). Desempates: menor
 *               duración máxima de coche.
 *  - 'spread' : minimizar la duración máxima de coche (con salida común de
 *               todos a la misma hora, minimiza la llegada más tardía).
 *               Desempates: menor suma de duraciones.
 *
 * Escalado: el orden intra-coche se resuelve por permutación exhaustiva
 * (k <= 7 paradas) o por Held-Karp DP (k >= 8) para duración; para 'fair' con
 * k >= 8 se barre la primera parada de forma exhaustiva y el resto se deja
 * óptimo de duración (heurística documentada). Las asignaciones entre coches
 * se enumeran exhaustivamente con poda por capacidad y fallas inviables.
 *
 * Unidades: minutos (float). Convierte las matrices antes de llamar.
 * Nombres de nodos: índices enteros. Solo se usan mDur[ i ][ j ] y mDist[ i ][ j ].
 */
(function (global) {
  'use strict';

  var EPS = 1e-9;

  /* ---------- utilidades geométricas de matriz ---------- */

  /**
   * snp: crea snapshot de una ruta evaluada.
   *   { order:[node], D, dist, tau:[t por parada], rides:[t por parada],
   *     rideMax, rideSum }
   */
  function snapshot(order, D, dist, tau) {
    var rides = [], rideMax = 0, rideSum = 0, i;
    for (i = 0; i < tau.length; i++) {
      rides[i] = D - tau[i];
      if (rides[i] > rideMax) rideMax = rides[i];
      rideSum += rides[i];
    }
    return {
      order: order.slice(),
      D: D, dist: dist, tau: tau.slice(),
      rides: rides, rideMax: rideMax, rideSum: rideSum
    };
  }

  /** Evalúa una ruta: start -> order... -> end. Devuelve null si hay tramo inviable. */
  function evalRoute(mDur, mDist, start, order, end) {
    var t = 0, d = 0, i, leg, prev = start, tau = [];
    for (i = 0; i < order.length; i++) {
      leg = (mDur[prev] || {})[order[i]];
      if (leg == null || !isFinite(leg)) return null;
      t += leg; tau.push(t); prev = order[i];
    }
    leg = (mDur[prev] || {})[end];
    if (leg == null || !isFinite(leg)) return null;
    var D = t + leg;
    // distancia
    var dist = 0; prev = start;
    for (i = 0; i < order.length; i++) {
      leg = (mDist[prev] || {})[order[i]];
      if (leg != null && isFinite(leg)) dist += leg;
      prev = order[i];
    }
    leg = (mDist[prev] || {})[end];
    if (leg != null && isFinite(leg)) dist += leg;
    return snapshot(order, D, dist, tau);
  }

  /** Enumeración exhaustiva de permutaciones. */
  function permute(arr, cb) {
    var n = arr.length, used = new Array(n).fill(false), cur = [];
    (function rec() {
      if (cur.length === n) { cb(cur); return; }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; cur.push(arr[i]); rec(); cur.pop(); used[i] = false;
      }
    })();
  }

  /** Paso del Brutus: mejor porDur y porFair de un subconjunto de paradas. */
  function bruteBest(mDur, mDist, start, end, nodes) {
    var byDur = null, byFair = null;
    permute(nodes, function (order) {
      var s = evalRoute(mDur, mDist, start, order, end);
      if (!s) return;
      if (!byDur || s.D < byDur.D - EPS) byDur = s;
      if (!byFair ||
          s.rideMax < byFair.rideMax - EPS ||
          (Math.abs(s.rideMax - byFair.rideMax) <= EPS && s.D < byFair.D - EPS)) {
        byFair = s;
      }
    });
    return { byDur: byDur, byFair: byFair };
  }

  /* ---------- Held-Karp (k >= 8) ---------- */

  /**
   * Ruta de duración mínima start -> nodes[] -> end, devolviendo {D, order}.
   * Los tramos imposibles (Infinity / null) se tratan como inviables.
   */
  function heldKarp(mDur, start, nodes, end) {
    var k = nodes.length;
    if (k === 0) {
      var direct = (mDur[start] || {})[end];
      if (direct == null || !isFinite(direct)) return null;
      return { D: direct, order: [] };
    }
    var full = (1 << k) - 1, size = full + 1, i, j, mask;
    var INF = Infinity;
    var f = new Float64Array(size * k).fill(INF);
    var par = new Int16Array(size * k).fill(-1);

    for (i = 0; i < k; i++) {
      var t0 = (mDur[start] || {})[nodes[i]];
      if (t0 != null && isFinite(t0)) f[(1 << i) * k + i] = t0;
    }
    for (mask = 1; mask <= full; mask++) {
      for (i = 0; i < k; i++) {
        var fi = f[mask * k + i];
        if (!isFinite(fi)) continue;
        for (j = 0; j < k; j++) {
          if (mask & (1 << j)) continue;
          var leg = (mDur[nodes[i]] || {})[nodes[j]];
          if (leg == null || !isFinite(leg)) continue;
          var nmask = mask | (1 << j);
          var v = fi + leg;
          if (v < f[nmask * k + j] - EPS) {
            f[nmask * k + j] = v;
            par[nmask * k + j] = i;
          }
        }
      }
    }
    var bestD = INF, bestLast = -1;
    for (i = 0; i < k; i++) {
      var tail = (mDur[nodes[i]] || {})[end];
      if (tail == null || !isFinite(tail)) continue;
      var tot = f[full * k + i] + tail;
      if (tot < bestD - EPS) { bestD = tot; bestLast = i; }
    }
    if (bestLast < 0) return null;
    // reconstrucción
    var order = [], m = full, cur = bestLast;
    while (true) {
      order.push(nodes[cur]);
      var p = par[m * k + cur];
      if (p < 0) break;
      m ^= (1 << cur);
      cur = p;
    }
    order.reverse();
    return { D: bestD, order: order };
  }

  /** Mejor porFair con k >= 8: primera parada exhaustiva + resto HK. */
  function fairBestHK(mDur, mDist, start, end, nodes) {
    var best = null, h, i;
    for (h = 0; h < nodes.length; h++) {
      var first = nodes[h];
      var leg0 = (mDur[start] || {})[first];
      if (leg0 == null || !isFinite(leg0)) continue;
      var rest = [];
      for (i = 0; i < nodes.length; i++) if (i !== h) rest.push(nodes[i]);
      var sub = heldKarp(mDur, first, rest, end);
      if (!sub) continue;
      var s = evalRoute(mDur, mDist, start, [first].concat(sub.order), end);
      if (!s) continue;
      if (!best ||
          s.rideMax < best.rideMax - EPS ||
          (Math.abs(s.rideMax - best.rideMax) <= EPS && s.D < best.D - EPS)) {
        best = s;
      }
    }
    return best;
  }

  /* ---------- motor ---------- */

  /**
   * solveDirection(o):
   *   o.direction : 'out' (coches van al venue) | 'rtn' (vuelven al origen)
   *   o.venueNode : índice del nodo 'venue'
   *   o.pax       : [ { node } ] pasajeros (índice interno = bit)
   *   o.cars      : [ { driverNode, cap } ]
   *   o.mDur / o.mDist : matrices cuadradas en minutos / metros
   *   o.mode      : 'fair' | 'sum' | 'spread'
   *   o.restriction : opcional, array bitmasks: coche c solo puede llevar
   *                 pasajeros ja asignados en su grupo de la ida (keepGroups)
   */
  function solveDirection(o) {
    var pax = o.pax || [], cars = o.cars || [], nP = pax.length, i;
    var mode = o.mode || 'fair';
    var mDur = o.mDur, mDist = o.mDist;
    var venue = o.venueNode;
    var isOut = o.direction !== 'rtn';

    if (!mDur || !mDist) return { ok: false, msg: 'matrices ausentes' };

    // capacidad
    var capTotal = 0;
    for (i = 0; i < cars.length; i++) capTotal += Math.max(0, cars[i].cap | 0);
    if (nP > capTotal) {
      return { ok: false, missingSeats: nP - capTotal, capTotal: capTotal };
    }

    // ruta por (coche, mask) — memo
    var cache = {};
    function routeFor(ci, mask) {
      var key = ci + '|' + mask;
      if (cache[key]) return cache[key];
      var car = cars[ci];
      var start = isOut ? car.driverNode : venue;
      var end   = isOut ? venue : car.driverNode;
      var res;
      if (!mask) {
        var solo = evalRoute(mDur, mDist, start, [], end);
        res = solo ? { byDur: solo, byFair: solo } : null;
        cache[key] = res;
        return res;
      }
      var nodes = [];
      for (var b = 0; b < nP; b++) if (mask & (1 << b)) nodes.push(pax[b].node);
      if (nodes.length <= 7) {
        var both = bruteBest(mDur, mDist, start, end, nodes);
        res = both.byDur ? both : null;
      } else {
        var hk = heldKarp(mDur, start, nodes, end);
        var byDur = hk ? evalRoute(mDur, mDist, start, hk.order, end) : null;
        var byFair = fairBestHK(mDur, mDist, start, end, nodes);
        res = byDur ? { byDur: byDur, byFair: byFair || byDur } : null;
      }
      cache[key] = res;
      return res;
    }

    // restricciones keepGroups: por coche, lista de bits permitidos
    var allowed = null;
    if (o.restriction) {
      allowed = [];
      for (i = 0; i < cars.length; i++) allowed[i] = o.restriction[i] || 0;
    }

    // enumeración exhaustiva de asignaciones
    var assign = new Array(cars.length).fill(0);
    var used = new Array(cars.length).fill(0);
    var bestVec = null, bestAssign = null;

    function vecFor(assign) {
      // devuelve [metricas] para el modo, o null si algún coche inviable
      var chosen = [], ci;
      for (ci = 0; ci < cars.length; ci++) {
        var routes = routeFor(ci, assign[ci]);
        if (!routes) return null;
        chosen.push(mode === 'fair' ? routes.byFair : routes.byDur);
      }
      var maxRide = 0, rideSum = 0, sumD = 0, maxD = 0, sumTotal = 0, ci2;
      for (ci2 = 0; ci2 < chosen.length; ci2++) {
        var s = chosen[ci2]; if (!s) return null;
        if (s.rideMax > maxRide) maxRide = s.rideMax;
        rideSum += s.rideSum;
        sumD += s.D;
        if (s.D > maxD) maxD = s.D;
        sumTotal += s.D + s.rideSum;
      }
      if (mode === 'fair')      return [maxRide, rideSum, sumD];
      if (mode === 'sum')       return [sumTotal, maxD, rideSum];
      return [maxD, sumD, rideSum]; // spread
    }

    function rec(b) {
      if (b === nP) {
        var v = vecFor(assign);
        if (v == null) return;
        if (bestVec == null || lexLess(v, bestVec)) { bestVec = v; bestAssign = assign.slice(); }
        return;
      }
      var car;
      for (car = 0; car < cars.length; car++) {
        if (used[car] >= cars[car].cap) continue;
        if (allowed && !(allowed[car] & (1 << b))) continue;
        used[car]++; assign[car] |= (1 << b);
        rec(b + 1);
        used[car]--; assign[car] &= ~(1 << b);
      }
    }

    rec(0);

    if (bestAssign == null) {
      // con keepGroups puede ser inviable aun teniendo plazas; sin keepGroups
      // solo ocurre si algún tramo de la matriz es inviable
      if (allowed) return { ok: false, restrictionFailed: true };
      return { ok: false, msg: 'no existe ruta válida entre algunos puntos' };
    }

    // construir resultado
    var outCars = [], metrics = { rideMax: 0, rideSum: 0, sumD: 0, maxD: 0, rideSumTotal: 0 };
    for (i = 0; i < cars.length; i++) {
      var mask = bestAssign[i];
      var rts = routeFor(i, mask);
      var sel = (mode === 'fair') ? (rts.byFair || rts.byDur) : rts.byDur;
      var carRes = {
        driverNode: cars[i].driverNode,
        cap: cars[i].cap,
        order: sel.order,
        D: sel.D,
        dist: sel.dist,
        tau: sel.tau,
        rides: sel.order.map(function (node, k) { return { node: node, ride: sel.rides[k] }; }),
        rideMax: sel.rideMax,
        rideSum: sel.rideSum
      };
      outCars.push(carRes);
      if (sel.rideMax > metrics.rideMax) metrics.rideMax = sel.rideMax;
      metrics.rideSum += sel.rideSum;
      metrics.rideSumTotal += sel.rideSum;
      metrics.sumD += sel.D;
      if (sel.D > metrics.maxD) metrics.maxD = sel.D;
    }
    if (mode === 'sum') metrics.total = bestVec[0];
    else if (mode === 'fair') metrics.total = metrics.rideSum + metrics.sumD;
    else metrics.total = null;

    return {
      ok: true,
      mode: mode,
      cars: outCars,
      metrics: metrics,
      score: bestVec
    };
  }

  function lexLess(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] < b[i] - EPS) return true;
      if (a[i] > b[i] + EPS) return false;
    }
    return false;
  }

  var Solver = {
    solveDirection: solveDirection,
    evalRoute: evalRoute,
    heldKarp: heldKarp
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Solver;
  else global.Solver = Solver;
})(typeof window !== 'undefined' ? window : globalThis);
