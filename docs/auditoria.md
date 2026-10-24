# Auditoría: qué hace y qué ve cada uno

Decidido con Juan el 2026-10-24. Boni registra de forma estructurada y verificable qué hace cada actor (los modelos
sobre todo, pero también el MCP, las extensiones, Boni y las personas) y qué datos le llegaron.

## Qué se guarda

- **Acciones** (`actions`): cada llamada a un modelo, cada herramienta del agente, cada llamada del MCP, cada página
  descargada, y las lecturas de las personas donde se pide. Con quién (`by`: `model:lector:<proveedor>/<modelo>`,
  `mcp:<dispositivo>`, `user:<dispositivo>`, `agent` para el código de Boni), cuándo, en qué ejecución, sobre qué, si
  se permitió o se denegó y por qué regla. Las acciones que todavía no existen (consulta SQL, leer un archivo,
  funciones de extensiones) entran con su propio nombre de herramienta.
- **Lo visto** (`access`): por cada acción y registro, qué campos llegaron en claro, cuáles solo como forma («texto,
  120 caracteres»), si llegó el texto de la nota y qué adjuntos. Solo identificadores: la auditoría no copia ningún
  valor.
- **Columnas de sistema** (`entity_meta`): creado por, modificado por, editores, quién lo ha visto y cuándo. Se
  actualizan en la misma transacción que el cambio o el acceso, para que una tabla de miles de filas las lea de una
  vez. Las escribe solo el código: un modelo no puede decir que fue otro.
- **El historial** (`ops`), que ya existía: cada cambio con el antes y el después, ahora con quién (`by`) y en qué
  acción.

## Por qué así

- **No es una colección normal**: una colección se puede editar y borrar, y los modelos la leerían. La auditoría está
  en tablas internas que solo se añaden, y en la app se verá como una colección de solo lectura («Auditoría»). La
  relación con cada registro es un índice inverso, no un campo: leer un registro no lo modifica.
- **Verificable**: cada fila del historial y cada acción llevan el hash de la anterior (dos cadenas). Borrar o cambiar
  una fila a mano rompe la cadena (`verify`). La copia diaria cifrada guarda las tablas con sus hashes.
- **Exacto en el borde**: se registra donde los datos llegan al modelo (cada llamada) o salen hacia él (cada respuesta
  del MCP). Cada valor del agente sabe de qué campo de qué registro viene (`from`, y `refs` para lo que el código
  junta, como las opciones de colecciones con ejemplos de títulos).
- **Autoría del texto**: como `git blame`, por línea o párrafo, comparando las versiones que el historial ya guarda.
  Git no: las notas viven en SQLite y el autor de git es texto libre.
- **Lecturas de las personas**: por defecto solo en colecciones Restringidas y Privadas; configurable
  (`audit/userReads`), pensando en un Boni con otras personas.
- **Nada se borra por defecto**. Boni mide el almacenamiento (`/api/data/audit/storage`) y aconseja qué podría irse
  (los textos completos de las llamadas a modelos, historiales muy largos); borrar es decisión de Juan.

## Coste

En el portátil, la primera vez que arranca el servidor con esta versión encadena 30.000 operaciones (≈70 MB) en 1,5 s
con 115 MB de memoria; en el NAS, unos segundos. Después, cada operación o acción añade una escritura pequeña.
