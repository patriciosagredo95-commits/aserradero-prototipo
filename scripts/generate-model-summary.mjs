import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFileSync(join(root, relativePath), 'utf8');

const optimizer = read('dist/optimizer.js');
const application = read('dist/app.js');
const interfaceHTML = read('dist/index.html');
const reports = read('dist/reports.js');
const order = read('dist/order.js');

function requiredMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`No se pudo obtener ${label} desde el proyecto.`);
  return match[1];
}

function inputAttributes(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = requiredMatch(interfaceHTML, new RegExp(`(<input\\b[^>]*\\bid="${escaped}"[^>]*>)`), `el campo ${id}`);
  const attribute = name => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
  return { value: attribute('value'), min: attribute('min'), max: attribute('max') };
}

const diameters = requiredMatch(optimizer, /DIAMETERS\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/, 'los diámetros')
  .split(',').map(value => Number(value.trim()));
const searchStep = Number(requiredMatch(optimizer, /SEARCH_STEP_MM\s*=\s*([\d.]+)/, 'el paso de búsqueda'));
const maxAlternatives = Number(requiredMatch(optimizer, /shortlist\.length=Math\.min\(shortlist\.length,(\d+)\)/, 'el máximo de alternativas'));
const maxRecoveries = Number(requiredMatch(optimizer, /recoveries\.length>(\d+)/, 'el máximo de recuperaciones'));
const maxLogsPerDiameter = Number(requiredMatch(order, /MAX_LOGS_PER_DIAMETER=(\d+)/, 'el máximo de trozos por diámetro'));

const defaults = {
  objectiveA: `${inputAttributes('target-a-thickness').value} × ${inputAttributes('target-a-width').value} mm`,
  objectiveB: `${inputAttributes('target-b-thickness').value} × ${inputAttributes('target-b-width').value} mm`,
  length: inputAttributes('length').value,
  kerfBand: inputAttributes('kerf-band').value,
  kerfGang: inputAttributes('kerf-gang').value,
  kerfEdger: inputAttributes('kerf-edger').value,
  margin: inputAttributes('margin').value,
  maxBases: inputAttributes('max-bases').value,
};

const recoveryMatches = [...application.matchAll(/recoveryRow\(\{thickness:([\d.]+),width:([\d.]+)\}\)/g)];
const defaultRecoveries = [...new Set(recoveryMatches.map(match => `${match[1]} × ${match[2]} mm`))];

const criteriaBody = requiredMatch(interfaceHTML, /<select\s+id="criterion"[^>]*>([\s\S]*?)<\/select>/, 'las prioridades');
const criteria = [...criteriaBody.matchAll(/<option\s+value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
  .map(([, value, label]) => ({ value, label }));
const criterionLabel = value => criteria.find(item => item.value === value)?.label ?? value;

const machines = [...reports.matchAll(/\{key:'[^']+',name:'([^']+)',color:'[^']+'\}/g)].map(match => match[1]);
if (!machines.length) throw new Error('No se pudo obtener la secuencia de máquinas.');

const sourceFiles = ['dist/optimizer.js', 'dist/order.js', 'dist/reports.js', 'dist/app.js', 'dist/index.html'];
const latestSourceDate = sourceFiles
  .map(file => statSync(join(root, file)).mtime)
  .sort((a, b) => b - a)[0]
  .toLocaleDateString('es-CL');

const summary = `<!-- ARCHIVO GENERADO: ejecutar \`npm run docs:model\`. No editar los valores extraídos a mano. -->

# Resumen sencillo del modelo de optimización de corte

> Documento para conversación con gerencia. Los parámetros vigentes se extraen del código y se actualizan con \`npm run docs:model\` y, automáticamente, antes de \`npm test\`.

## En una frase

**Corte transforma las medidas de los productos que se quieren obtener y las condiciones de aserrío en una recomendación de corte para cada diámetro de trozo, buscando aprovechar la mayor cantidad posible de madera útil.**

## Explicación de 30 segundos

El usuario indica las escuadrías prioritarias, los productos de recuperación y las pérdidas de corte de cada máquina. El modelo prueba distintas posiciones y combinaciones dentro de un trozo circular. Descarta cualquier alternativa con piezas fuera del trozo o superpuestas y conserva hasta ${maxAlternatives} propuestas diferentes por diámetro. La aplicación preselecciona la propuesta de mayor rendimiento y permite revisar ambas, con sus cantidades, volumen, porcentaje de aprovechamiento y ruta de corte por máquina.

Es una **herramienta de apoyo a la planificación**. No reemplaza la validación de planta ni garantiza haber encontrado el óptimo matemático global.

## Qué decisión apoya

- Elegir un patrón de corte repetible para cada diámetro disponible.
- Comparar cuánto producto objetivo y recuperación entrega cada patrón.
- Estimar la producción de un lote al ingresar la cantidad de trozos por diámetro.
- Comparar el resultado propuesto con un esquema histórico previamente validado.
- Entregar al equipo operativo una ficha con la secuencia de cortes.

## Cómo toma la decisión

1. **Define el espacio útil.** Representa el trozo como un círculo recto de diámetro constante y resta el margen radial configurado.
2. **Genera alternativas.** Combina hasta ${defaults.maxBases} basas, piezas centrales, cabezales y laterales. Desplaza los conjuntos cada ${searchStep} mm para explorar distintas posiciones.
3. **Considera pérdidas reales de corte.** Reserva el kerf correspondiente al carro/huinchas, la múltiple y la canteadora.
4. **Ordena según la prioridad elegida.** La prioridad guía qué candidatos sobreviven durante la búsqueda.
5. **Conserva diversidad.** Mantiene hasta ${maxAlternatives} candidatos con distinta producción o composición de basas.
6. **Preselecciona el mayor rendimiento.** La vista comienza con el candidato que tiene mayor rendimiento de planilla; ante empate, favorece el mayor volumen objetivo. El usuario puede cambiar a la segunda alternativa para revisarla e imprimirla.
7. **Valida la geometría.** Comprueba dimensiones, ubicación dentro del círculo, ausencia de superposición y consistencia del volumen.

### Prioridades disponibles

| Opción visible | Qué favorece primero |
|---|---|
| ${criterionLabel('both')} | Incluir A y B cuando existe una combinación; después, mayor volumen objetivo y recuperación. |
| ${criterionLabel('targets')} | Mayor volumen conjunto de A y B; después, recuperación. |
| ${criterionLabel('total')} | Mayor volumen total, incluyendo recuperación; puede aceptar un patrón sin alguno de los objetivos. |

**Punto importante:** la prioridad configura la búsqueda, mientras que el esquema preseleccionado es el de mayor rendimiento entre los candidatos conservados. Por eso “prioridad” y “alternativa inicial” no significan exactamente lo mismo.

## Información que utiliza

| Entrada | Para qué se usa | Configuración inicial |
|---|---|---|
| Objetivo A | Producto principal que siempre se considera | ${defaults.objectiveA} |
| Objetivo B | Segundo producto prioritario; puede desactivarse | ${defaults.objectiveB}, activo |
| Recuperaciones | Productos secundarios para aprovechar espacios | ${defaultRecoveries.join(' y ')} |
| Largo del trozo | Convierte el área de la sección en volumen | ${defaults.length} mm |
| Kerf carro / huinchas | Pérdida por cortes longitudinales | ${defaults.kerfBand} mm |
| Kerf múltiple | Pérdida entre piezas dentro de las basas | ${defaults.kerfGang} mm |
| Kerf canteadora | Pérdida al dimensionar piezas laterales y cabezales | ${defaults.kerfEdger} mm |
| Margen radial | Zona exterior que no se considera utilizable | ${defaults.margin} mm |
| Basas | Cantidad máxima y límites opcionales de ancho | Hasta ${defaults.maxBases}; sin límites de ancho al inicio |

El catálogo vigente contiene **${diameters.length} diámetros**: ${diameters.map(value => `${value} cm`).join(', ')}. Se pueden definir hasta **${maxRecoveries} escuadrías de recuperación** y hasta **${maxLogsPerDiameter.toLocaleString('es-CL')} trozos por diámetro** en la simulación del lote.

## Qué entrega

Para cada diámetro, el sistema informa:

- cantidades de Objetivo A, Objetivo B y recuperaciones;
- volumen útil por trozo;
- rendimiento de planilla y aprovechamiento geométrico;
- cantidad y ancho de las basas;
- dibujo del patrón y vistas por etapa;
- ruta operativa: ${machines.join(' → ')};
- exportación CSV del mayor rendimiento y ficha imprimible/PDF de la alternativa seleccionada.

La simulación del lote multiplica el patrón elegido por los trozos disponibles de cada diámetro. Suma piezas y volúmenes, y calcula el rendimiento total de forma ponderada por volumen de referencia. No realiza una programación de máquinas ni mezcla patrones para cumplir una orden comercial específica.

## Cómo leer los indicadores

**Volumen aserrado**  
= suma del área de todas las piezas × largo del trozo.

**Rendimiento de planilla**  
= volumen aserrado ÷ (diámetro² × largo).  
Este es el indicador principal mostrado y conserva la convención de la planilla histórica. Su denominador es un prisma cuadrado, no el volumen físico del cilindro.

**Aprovechamiento geométrico**  
= volumen aserrado ÷ (π × diámetro² ÷ 4 × largo).  
Este indicador compara la madera obtenida con el volumen geométrico del trozo circular ideal.

Para comunicar resultados, conviene indicar siempre cuál de los dos porcentajes se está usando.

## Alcance y límites que gerencia debe conocer

- Modela trozos circulares, rectos, sin corteza, de diámetro constante y sin defectos.
- No considera conicidad, curvatura, calidad de madera, velocidad, tiempos de preparación ni capacidad diaria.
- No conoce todavía el número real de sierras, separaciones admisibles o todas las restricciones físicas de cada máquina.
- Explora una familia acotada de soluciones: hasta ${defaults.maxBases} basas, hasta dos capas de cabezal y dos tablas laterales por lado.
- La búsqueda por posición usa pasos de ${searchStep} mm y descartes internos para reducir el cálculo. **No garantiza el óptimo global ni todas las combinaciones posibles.**
- “No encontrado” significa que el motor no halló un patrón dentro de su espacio de búsqueda; no demuestra que sea físicamente imposible.
- La comparación histórica usa cantidades ingresadas manualmente y no valida el dibujo histórico.
- Todo patrón debe revisarse con Operaciones antes de usarlo en producción.

## Mensaje sugerido para gerencia

> “El prototipo estandariza la búsqueda de patrones de corte para ${diameters.length} diámetros. Usa nuestras escuadrías y pérdidas de sierra, verifica que las piezas quepan y compara alternativas con una métrica común. Nos ayuda a estimar rendimiento y producción antes de cortar, pero la recomendación sigue requiriendo validación de planta porque el modelo aún no incorpora todas las restricciones de las máquinas ni certifica el óptimo global.”

## Cómo se mantiene actualizado

- Los valores de catálogo, parámetros iniciales, prioridades y máquinas se extraen directamente de [\`dist/optimizer.js\`](dist/optimizer.js), [\`dist/index.html\`](dist/index.html), [\`dist/app.js\`](dist/app.js), [\`dist/reports.js\`](dist/reports.js) y [\`dist/order.js\`](dist/order.js).
- Ejecuta \`npm run docs:model\` para regenerar este archivo en cualquier momento.
- \`npm test\` lo regenera antes de ejecutar las pruebas, por lo que los cambios habituales del proyecto actualizan el documento durante la verificación.
- Si cambia la lógica conceptual, los supuestos o el significado de una métrica, también debe actualizarse la explicación en [\`scripts/generate-model-summary.mjs\`](scripts/generate-model-summary.mjs) en el mismo cambio.

Fuentes del modelo revisadas por última vez: **${latestSourceDate}**.
`;

writeFileSync(join(root, 'Resumen Modelo.md'), summary, 'utf8');
console.log('Resumen Modelo.md actualizado.');
