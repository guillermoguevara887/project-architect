# Product Vision

Date: 2026-07-18

## Vision General

Project Architect es una aplicacion inteligente para organizar proyectos de programacion, inteligencia artificial, investigacion computacional, ciencia, concursos y hackathons.

No es un gestor generico de tareas. No debe convertirse en un clon de Jira. Su valor principal no es administrar listas largas de trabajo, sino ayudar al usuario a convertir una idea incompleta, una pregunta abierta o una convocatoria competitiva en una secuencia de sprints utiles, adaptativos y controlados por el usuario.

El usuario puede empezar con una idea vaga, una pregunta, una hipotesis, un objetivo general o un concurso con reglas externas. La aplicacion debe aceptar incertidumbre desde el inicio.

## Principio Central

El ciclo principal del producto es:

```text
ejecutar -> registrar resultados -> analizar -> proponer -> negociar con el usuario -> aprobar -> generar el siguiente sprint
```

La IA recomienda, pero el usuario conserva siempre el control.

Project Architect no debe planificar todo el proyecto desde el principio. Cada sprint debe producir informacion nueva. Esa informacion cambia el contexto del proyecto y determina el siguiente paso.

## Tipos Iniciales De Proyecto

### Investigacion O Exploracion

Un proyecto de investigacion o exploracion comienza con una pregunta, idea u objetivo abierto. El resultado final puede ser incierto.

Ejemplos:

- Encontrar patrones ocultos en el Manuscrito Voynich.
- Explorar si un dataset contiene senales predictivas utiles.
- Investigar una tecnica de IA y construir una prueba de concepto.
- Comparar enfoques computacionales para un problema cientifico.

La aplicacion debe ayudar a formular hipotesis, disenar exploraciones acotadas, registrar hallazgos y decidir el siguiente sprint segun evidencia.

### Concurso O Hackathon

Un proyecto de concurso o hackathon comienza con una convocatoria, reglas, criterios, fecha limite y entregables. El objetivo externo existe, pero todavia debe encontrarse y construirse una solucion.

Ejemplos:

- Hackathon con tema, criterios de evaluacion y fecha limite.
- Concurso de ciencia de datos con dataset y metricas.
- Reto de programacion con reglas y entregables.
- Convocatoria academica o tecnica con requisitos formales.

La aplicacion debe ayudar a interpretar reglas, detectar restricciones, proponer rutas de solucion, organizar el primer sprint y adaptar el plan conforme aparezcan resultados.

## Flujo Inicial

1. El usuario llega a un dashboard minimalista.
2. El usuario pulsa "Nuevo proyecto".
3. El usuario introduce:
   - nombre del proyecto;
   - tipo: investigacion/exploracion o concurso/hackathon;
   - idea u objetivo global.
4. El proyecto se guarda en PostgreSQL.
5. El usuario inicia un descubrimiento determinista adaptado al tipo de proyecto.
6. La aplicacion recopila contexto por secciones, guarda respuestas progresivamente y detecta obligatorias faltantes.
7. El usuario revisa y confirma el contexto.
8. En una fase futura, la IA analiza el contexto confirmado y propone varias rutas posibles para comenzar.
9. El usuario puede:
   - aceptar una ruta;
   - elegir otra;
   - escribir su propia direccion;
   - pedir modificaciones.
10. Despues de aprobar una direccion, la IA genera el primer sprint.
11. El sprint puede incluir:
   - configuracion;
   - herramientas;
   - stack tecnologico;
   - datasets;
   - documentacion;
   - papers;
   - libros;
   - experimentos;
   - tareas concretas.
12. Las tareas se convierten en tarjetas editables.
13. El usuario puede crear, editar, mover y eliminar tarjetas.
14. Los cambios se guardan en la base de datos y se reflejan en el estado estructurado del proyecto.

## Cierre Del Sprint

Al terminar un sprint se registran:

- tareas completadas;
- tareas incompletas;
- resultados;
- descubrimientos;
- problemas encontrados;
- decisiones;
- notas del usuario.

La IA analiza esta informacion junto con el objetivo global y propone el siguiente objetivo.

El usuario puede:

- aceptar la propuesta;
- modificarla;
- reemplazarla;
- escribir su propio objetivo;
- pedir una nueva propuesta.

La IA genera el siguiente sprint solamente despues de la aprobacion explicita del usuario.

## Control Del Usuario

La IA no debe avanzar el proyecto por su cuenta. Puede recomendar rutas, objetivos, experimentos, lecturas, herramientas y tareas, pero cada cambio estructural importante requiere aprobacion humana.

Decisiones que requieren aprobacion explicita:

- direccion inicial del proyecto;
- objetivo de un sprint;
- generacion de un nuevo sprint;
- cierre de un sprint;
- cambio de tipo o enfoque del proyecto;
- aceptacion de una propuesta de la IA como estado oficial del proyecto.

## JSON Maestro

El JSON maestro debe representar el estado estructurado del proyecto de forma util para la IA y para la interfaz. Sin embargo, no debe convertirse en una segunda fuente de verdad dificil de sincronizar.

### Recomendacion

La fuente de verdad debe ser PostgreSQL, con tablas normalizadas para proyectos, contexto, rutas propuestas, sprints, tarjetas, resultados, descubrimientos, decisiones y notas.

El JSON maestro debe manejarse como una vista estructurada o snapshot derivado de PostgreSQL.

### Forma Segura De Manejarlo

1. PostgreSQL guarda las entidades canonicas.
2. El backend construye el JSON maestro desde esas entidades cuando la IA o la UI lo necesitan.
3. Opcionalmente, el backend guarda snapshots versionados del JSON maestro para auditoria, reproduccion de prompts y trazabilidad.
4. Cada snapshot debe incluir version, fecha, origen y referencia a las versiones de datos usadas para generarlo.
5. El cliente no debe editar el JSON maestro directamente.
6. Los cambios del usuario deben entrar por acciones de dominio: editar contexto, aprobar ruta, crear tarjeta, mover tarjeta, cerrar sprint, registrar resultado.
7. Despues de cada accion confirmada, el backend puede regenerar el JSON maestro o marcarlo como pendiente de regeneracion.

### Evitar

- Guardar solo un JSON gigante como estado canonico del proyecto.
- Permitir que la IA sobrescriba el estado oficial sin aprobacion del usuario.
- Mantener campos duplicados sin version, timestamp o regla clara de precedencia.
- Hacer que frontend, API e IA escriban distintas versiones del mismo estado.

## Estructura Conceptual Del JSON Maestro

El JSON maestro podria incluir:

```json
{
  "project": {
    "id": "project-id",
    "name": "Project name",
    "type": "research_exploration",
    "globalObjective": "Open-ended objective",
    "status": "active"
  },
  "context": {
    "currentBriefVersion": 1,
    "constraints": [],
    "knownFacts": [],
    "openQuestions": []
  },
  "approvedDirection": {
    "id": "direction-id",
    "summary": "Chosen direction",
    "rationale": "Why this direction was approved"
  },
  "sprints": [
    {
      "id": "sprint-id",
      "number": 1,
      "objective": "Sprint objective",
      "status": "active",
      "cards": [],
      "results": [],
      "discoveries": [],
      "problems": [],
      "decisions": []
    }
  ]
}
```

Este ejemplo es conceptual. No implica implementacion inmediata ni un contrato definitivo.

## Implicaciones Para El Producto

- El dashboard inicial debe ser simple.
- El flujo de creacion debe capturar poca informacion, pero guardarla bien.
- La primera interaccion inteligente debe proponer rutas, no un plan completo.
- El sprint activo debe ser el centro operativo.
- El tablero existe para ejecutar un sprint, no para administrar todo el universo del proyecto.
- El cierre de sprint es tan importante como la creacion de tareas.
- La memoria del proyecto debe estar estructurada para que la IA pueda razonar sobre lo que paso.

## Fuera De Alcance Inmediato

- Plan maestro completo del proyecto.
- Roadmap cerrado desde el inicio.
- Integracion con OpenAI u otros proveedores durante el descubrimiento determinista.
- Preguntas generadas dinamicamente por IA.
- Kanban avanzado.
- Gestion de equipos.
- Automatizaciones complejas.
- Integracion con MemoOS.
- IA autonoma que cree sprints sin aprobacion.
- Edicion directa del JSON maestro desde la interfaz.
