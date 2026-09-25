<!-- ARCHIVO GENERADO: ejecutar `npm run docs:model`. No editar los valores extraídos a mano. -->

# Resumen sencillo del modelo de optimización de corte

> Documento para conversación con gerencia. Los parámetros vigentes se extraen del código y se actualizan con `npm run docs:model` y, automáticamente, antes de `npm test`.

## En una frase

**Corte transforma las medidas de los productos que se quieren obtener y las condiciones de aserrío en una recomendación de corte para cada diámetro de trozo, buscando aprovechar la mayor cantidad posible de madera útil.**

## Explicación de 30 segundos

El usuario indica las escuadrías prioritarias, los productos de recuperación y las pérdidas de corte de cada máquina. El modelo prueba distintas posiciones y combinaciones dentro de un trozo circular. Descarta cualquier alternativa con piezas fuera del trozo o superpuestas y conserva hasta 2 propuestas diferentes por diámetro. La aplicación preselecciona la propuesta de mayor rendimiento y permite revisar ambas, con sus cantidades, volumen, porcentaje de aprovechamiento y ruta de corte por máquina.

Es una **herramienta de apoyo a la planificación**. No reemplaza la validación de planta ni garantiza haber encontrado el óptimo matemático global.

## Qué decisión apoya

- Elegir un patrón de corte repetible para cada diámetro disponible.
- Comparar cuánto producto objetivo y recuperación entrega cada patrón.
- Estimar la producción de un lote al ingresar la cantidad de trozos por diámetro.
- Comparar el resultado propuesto con un esquema histórico previamente validado.
- Entregar al equipo operativo una ficha con la secuencia de cortes.

## Cómo toma la decisión

1. **Define el espacio útil.** Representa el trozo como un círculo recto de diámetro constante y resta el margen radial configurado.
2. **Genera alternativas.** Combina hasta 3 basas, piezas centrales, cabezales y laterales. Desplaza los conjuntos cada 1 mm para explorar distintas posiciones.
3. **Considera pérdidas reales de corte.** Reserva el kerf correspondiente al carro/huinchas, la múltiple y la canteadora.
4. **Ordena según la prioridad elegida.** La prioridad guía qué candidatos sobreviven durante la búsqueda.
5. **Conserva diversidad.** Mantiene hasta 2 candidatos con distinta producción o composición de basas.
6. **Preselecciona el mayor rendimiento.** La vista comienza con el candidato que tiene mayor rendimiento de planilla; ante empate, favorece el mayor volumen objetivo. El usuario puede cambiar a la segunda alternativa para revisarla e imprimirla.
7. **Valida la geometría.** Comprueba dimensiones, ubicación dentro del círculo, ausencia de superposición y consistencia del volumen.

### Prioridades disponibles

| Opción visible | Qué favorece primero |
|---|---|
| Ambos objetivos, luego volumen objetivo | Incluir A y B cuando existe una combinación; después, mayor volumen objetivo y recuperación. |
| Mayor volumen objetivo | Mayor volumen conjunto de A y B; después, recuperación. |
| Mayor volumen total | Mayor volumen total, incluyendo recuperación; puede aceptar un patrón sin alguno de los objetivos. |

**Punto importante:** la prioridad configura la búsqueda, mientras que el esquema preseleccionado es el de mayor rendimiento entre los candidatos conservados. Por eso “prioridad” y “alternativa inicial” no significan exactamente lo mismo.

## Información que utiliza

| Entrada | Para qué se usa | Configuración inicial |
|---|---|---|
| Objetivo A | Producto principal que siempre se considera | 22 × 125 mm |
| Objetivo B | Segundo producto prioritario; puede desactivarse | 22 × 110 mm, activo |
| Recuperaciones | Productos secundarios para aprovechar espacios | 22 × 75 mm y 22 × 60 mm |
| Largo del trozo | Convierte el área de la sección en volumen | 4000 mm |
| Kerf carro / huinchas | Pérdida por cortes longitudinales | 3.4 mm |
| Kerf múltiple | Pérdida entre piezas dentro de las basas | 4.2 mm |
| Kerf canteadora | Pérdida al dimensionar piezas laterales y cabezales | 3.8 mm |
| Margen radial | Zona exterior que no se considera utilizable | 0 mm |
| Basas | Cantidad máxima y límites opcionales de ancho | Hasta 3; sin límites de ancho al inicio |

El catálogo vigente contiene **13 diámetros**: 16 cm, 18 cm, 20 cm, 22 cm, 24 cm, 26 cm, 28 cm, 30 cm, 32 cm, 34 cm, 36 cm, 38 cm, 42 cm. Se pueden definir hasta **12 escuadrías de recuperación** y hasta **10.000 trozos por diámetro** en la simulación del lote.

## Qué entrega

Para cada diámetro, el sistema informa:

- cantidades de Objetivo A, Objetivo B y recuperaciones;
- volumen útil por trozo;
- rendimiento de planilla y aprovechamiento geométrico;
- cantidad y ancho de las basas;
- dibujo del patrón y vistas por etapa;
- ruta operativa: Carro Huincha → Huinchas → Múltiple → Canteadora;
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
- Explora una familia acotada de soluciones: hasta 3 basas, hasta dos capas de cabezal y dos tablas laterales por lado.
- La búsqueda por posición usa pasos de 1 mm y descartes internos para reducir el cálculo. **No garantiza el óptimo global ni todas las combinaciones posibles.**
- “No encontrado” significa que el motor no halló un patrón dentro de su espacio de búsqueda; no demuestra que sea físicamente imposible.
- La comparación histórica usa cantidades ingresadas manualmente y no valida el dibujo histórico.
- Todo patrón debe revisarse con Operaciones antes de usarlo en producción.

## Mensaje sugerido para gerencia

> “El prototipo estandariza la búsqueda de patrones de corte para 13 diámetros. Usa nuestras escuadrías y pérdidas de sierra, verifica que las piezas quepan y compara alternativas con una métrica común. Nos ayuda a estimar rendimiento y producción antes de cortar, pero la recomendación sigue requiriendo validación de planta porque el modelo aún no incorpora todas las restricciones de las máquinas ni certifica el óptimo global.”

## Cómo se mantiene actualizado

- Los valores de catálogo, parámetros iniciales, prioridades y máquinas se extraen directamente de [`dist/optimizer.js`](dist/optimizer.js), [`dist/index.html`](dist/index.html), [`dist/app.js`](dist/app.js), [`dist/reports.js`](dist/reports.js) y [`dist/order.js`](dist/order.js).
- Ejecuta `npm run docs:model` para regenerar este archivo en cualquier momento.
- `npm test` lo regenera antes de ejecutar las pruebas, por lo que los cambios habituales del proyecto actualizan el documento durante la verificación.
- Si cambia la lógica conceptual, los supuestos o el significado de una métrica, también debe actualizarse la explicación en [`scripts/generate-model-summary.mjs`](scripts/generate-model-summary.mjs) en el mismo cambio.

Fuentes del modelo revisadas por última vez: **24-09-2026**.
