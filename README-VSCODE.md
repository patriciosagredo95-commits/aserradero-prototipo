# Proyecto Corte · Optimizador de aserradero

## Abrir en VS Code

1. Descarga y descomprime el proyecto.
2. Abre VS Code y selecciona **Archivo → Abrir carpeta**.
3. Elige la carpeta `aserradero-prototipo`.
4. Abre el panel de Codex desde VS Code para pedir cambios sobre el proyecto completo.

## Requisitos

- Node.js 20 o superior.
- VS Code.

## Verificar el motor

Desde la terminal integrada de VS Code:

```bash
npm test
```

Las pruebas revisan los 13 diámetros, la geometría, el objetivo B opcional, las alternativas, las etapas de corte, la simulación de trozos, las exportaciones y la comparación histórica.

## Archivos principales

- `dist/index.html`: interfaz y controles.
- `dist/styles.css`: diseño visual.
- `dist/app.js`: interacción de la aplicación.
- `dist/optimizer.js`: motor matemático de optimización.
- `dist/order.js`: simulación del lote a partir de los trozos disponibles por diámetro.
- `dist/reports.js`: vistas por etapas, cotas, CSV, configuración y ficha PDF.
- `dist/worker.js`: cálculo en segundo plano.
- `tests/`: pruebas automatizadas.

La aplicación es estática. Para probarla localmente se puede abrir `dist/index.html` con una extensión como Live Server. Para publicar cambios en el enlace de Sites se debe conservar `.openai/hosting.json` y seguir el flujo de publicación del proyecto original.
