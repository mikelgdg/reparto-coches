# 🚗 RepartoCars

Miniapp web para calcular **el mejor reparto de coches** para una cena entre amigos: quién recoge a
quién, en qué orden, cuánto tarda cada uno y los casos especiales (solo la ida, no vuelve…).

Está pensada para 13 personas pero funciona con cualquier número (hasta ~15-20 con varios coches).

## Cómo usarla

1. **Marca el restaurante**: pulsa «Marcar en el mapa» y haz clic, o búscalo arriba.
2. **Añade amigos**: «Añadir amigo» → clic en el mapa cerca de su casa. Cada uno puede abrirse él
   mismo si tú le mandas el enlace.
3. **Marca quién conduce** y cuántas plazas tiene el coche (asientos totales, tú incluido — el motor
   reserva 1 asiento para ti y reparte la gasolina entre todos los ocupantes). Conductor con casos:
   - *solo ida / solo vuelta* (select junto a las plazas)
   - pasajero **no vuelve** 🏠 (checkbox)
   - pasajero **🛴 otro transporte** (moto, taxi, coche ajeno…): sale del reparto de coches
   - pasajero con **promesa «va sí o sí con X»** (ida/vuelta): restricción dura que el motor
     garantiza o te avisa antes de calcular si es imposible
4. Ajusta en «Datos de la cena»: hora de llegada, hora de salida del restaurante, objetivo, €/km,
   y el **🛡️ margen de seguridad** de llegada (automático o fijo en minutos).
5. **Calcular reparto** → resultados por coche con horarios (incluido el margen) + resumen por
   persona + tabla **🔎 ¿Sobra algún coche?**: qué pasa si quitas cada coche uno a uno
   (coste en tiempos vs. ahorro en €).
6. «Copiar resumen (WhatsApp)» manda la estructura completa en texto.

## ¿Cómo funciona por dentro?

- **Estructura**: el estado completo vive en la URL (`#s=…`) y en el borrador local. **No hay
  servidor ni base de datos.** El que edita y comparte, comparte su versión.
- **Matriz de tiempos**: con clave de OpenRouteService se pide una matriz real 14×14 de tiempos y
  distancias en coche (1 petición). Sin clave, se estima con distancia en línea recta ×1,4 a 45 km/h.
- **Algoritmo** (puro en el navegador, vía `js/solver.js`):
  1. Enumeración exhaustiva de asignaciones pasajero→coche con poda por capacidad.
  2. Por coche, **mini-TSP** del orden de recogidas: fuerza bruta por permutaciones (≤ 7 paradas) o
     Held-Karp DP (≥ 8). Caché por (coche, subconjunto).
  3. Objetivos:
     - `fair` — minimiza el peor tiempo de pasajero (max-min), luego suma, luego duraciones.
     - `sum` — minimiza persona-minutos totales (conductor incluido).
     - `spread` — salida común; minimiza la duración máxima de coche (llegada más tardía).
  4. La vuelta se resuelve como problema independiente (no-vuelven y "solo ida" se caen, los
     "solo vuelta" entran) y, si marcas «misma gente por coche», se añade la restricción de
     mantener los grupos con fallback automático si queda inviable.

## Pruebas

```bash
node test/solver.test.js   # 17 pruebas unitarias del motor
node test/e2e.sim.js       # simulación end-to-end del escenario de 13 personas
```

## Clave OpenRouteService (opcional, tiempos de máxima calidad)

> ⚠️ Octubre 2026: el panel de cuentas de ORS está temporalmente apagado por el incidente
> de seguridad de PHP (PHP2Shell). Mientras tanto, la app **ya calcula con tiempos reales
> de calle** vía el servidor demo de OSRM, sin necesidad de clave.

Cuando vuelva el registro:

1. Crea cuenta gratis en <https://openrouteservice.org/dev/#/signup>.
2. Dashboard → «Token» → copia tu API key.
3. Pégala en la app: Ajustes → 🔑 Tiempos de conducción → Guardar. Se queda solo en tu navegador.

Si ORS falla en mitad de la noche, la app cae automáticamente a OSRM y si también falla,
a estimación local — y avisa en pantalla de qué proveedor ha tocado.

## Despliegue (para compartirla)

Es un site estático: sirve `index.html` + `css/` + `js/` desde cualquier hosting.

```bash
# local
python3 -m http.server 8000
# → http://localhost:8000
```

- **GitHub Pages**: sube la carpeta a un repo → Settings → Pages → rama `main`, carpeta raíz.
- **Vercel / Netlify**: «deploy static», sin configurar nada (0 min, gratis).

## Estructura

```
index.html        UI
css/style.css
js/solver.js      motor puro (asignación + TSP, testeado)
js/app.js         UI, mapa, matrices, estado en URL
test/             pruebas node
```

Mapa © OpenStreetMap · Tiempos reales: OpenRouteService.
