# M14 v2 — Fix 7: applicability por cambio concreto

`M14_FIX_7_STATUS: PASS`
`POSTGRESQL_REGRESSION: PASS`
`READY_FOR_FINAL_M14_REAUDIT: YES`

Fix 7 cierra el HIGH confirmado en la reauditoría: un finding podía declarar un
subject aplicable al target junto a otro no aplicable y añadir knowledge al segundo.
La comprobación anterior exigía alguna evaluación S2 aplicable por claim, mientras
el mapping solo exigía que el subject real estuviese incluido en `subjectRefs`.
Esas dos condiciones podían cumplirse con subjects distintos.

`researchTargetApplicabilityIssueV2` sigue siendo el contrato compartido de
producer y reconciler. Ahora recibe el mapping de cada finding y exige que el
subject real de cada cambio esté contenido en una evaluación aplicable de S2 para
el claim de ese finding. La comparación usa identidad de feature/mechanism/item,
no posición de array ni el primer subject aplicable. Cuando se inicializa un
feature antes unknown, sus campos de nivel feature siguen sirviendo de contexto
estructural para un mechanism aplicable; cada cambio dentro de `mechanisms` debe
estar autorizado por el mecanismo realmente modificado. SubjectRefs contextuales
no usados no invalidan por sí solos un cambio legítimo. No cambian S2, S1, los
contratos públicos, los estados epistemológicos ni schema/migrations.

`sharedSlotEffects` se calcula después de aplicar esa comprobación al delta
primario. Sigue siendo un diagnóstico before/after sobre claims históricos, no
una escritura separada ni autoridad para otro subject. Lifecycle reconstruye
el mapping desde el candidate y repite el mismo gate con el parent real antes
de aceptar constructor, validator, S3B write/read o decisión humana.

Probes nuevos: subjectRefs age+foreign en ambos órdenes, feature amplio con
mapping al mecanismo foreign, un finding con dos cambios, dos findings con uno
malicioso, inicialización feature con segundo mecanismo ajeno y cambio de orden
de mecanismos: REJECT para los deltas ajenos con hashes oficiales correctos.
Varios subjects aplicables, subject ajeno solo contextual y foreign bajo el
target action válido: PASS. Las regresiones Fix 3/4/5/6 siguen pasando.

Regresión posterior al último cambio: M14/S3A/S3B dirigidos **163/163**; API
completa **895/895**; PostgreSQL M14 **34/34**, lifecycle **29/29**,
Registry/M4/M13 **44/44**, migrations **20/20**, total **127/127**.
Skipped/cancelled/todo: **0/0/0**. Typecheck API, web y tests/fixtures M14;
lint completo y dirigido; build completo: PASS. Las cuatro suites PostgreSQL
se ejecutaron secuencialmente en contenedores locales desechables.

Este documento registra implementación y regresión. No sustituye la siguiente
reauditoría independiente.

## Registro histórico de Fix 4

`M14_FIX_4_STATUS: PASS`
`POSTGRESQL_REGRESSION: BLOCKED_BY_LOCAL_DOCKER`
`READY_FOR_FINAL_M14_REAUDIT: BLOCKED_BY_LOCAL_DOCKER`

Fix 4 implementado y regresión sin PostgreSQL completada. Los resultados de Fix 3
más abajo son históricos, no equivalen a una ejecución PostgreSQL del Fix 4.

Este documento registra implementación y regresión; no realiza ni sustituye la
auditoría final independiente.

## Historial de auditoría

1. La implementación inicial pasó sus suites básicas: M14 30 unitarios / 8
   PostgreSQL; API 814. Ese PASS inicial no cerraba los riesgos adversariales.
2. La auditoría de cierre encontró HIGH: contaminación de knowledge por copiar
   un slot completo con findings insuficientes; MEDIUM: provenance transitoria
   perdida al persistir el candidate. Resultado: NEEDS_FIX.
3. Fix 1 se detuvo sin editar archivos porque S1/S3A eran contratos cerrados y
   no podían representar la provenance requerida. No se disfrazaron metadatos
   de investigación como citations, evidence summaries ni knowledge.
4. El usuario autorizó explícitamente extender de forma opcional y compatible
   el origin S3A del candidate, usando persistence S3B existente.
5. Fix 2 añadió esa extensión y derivó el merge desde cambios exactos declarados
   por findings. Pasó 49 tests M14, API 833 y PostgreSQL 107.
6. La auditoría final posterior encontró un único HIGH: S3A/S3B aceptaban mapping
   durable falso con hashes correctos. Resultado: M14_FINAL_AUDIT_STATUS: NEEDS_FIX.
7. Fix 3 reconcilia parent + provenance contra candidate en el gate compartido.
   Los resultados actuales de abajo corresponden a esta corrección exclusiva.
8. La reauditoría posterior confirmó los tres probes del Fix 3 cerrados, pero
   detectó HIGH: nuevos conflictos ajenos aceptados por S3A/S3B con hashes válidos.
9. Fix 4 extrae y reutiliza el contrato de conflictos del productor. No modifica
   hashes, S1/S2, provenance, lifecycle humano, ownership ni persistencia.

## Fix 4: conflictos parent → candidate

La causa era una diferencia de admisión: el productor limitaba los conflictos
nuevos al target y findings propuestos; el reconciler solo preservaba el prefijo
histórico de conflictos. Una contradicción entre claims vecinos podía entrar al
snapshot M14, sin cambiar provenance, y afectar a S2 tras un ACCEPT explícito.

`researchConflictIssueV2` en `scoped-knowledge-v2.ts` es la regla compartida.
Comprueba status unresolved, target exacto, participación de al menos un claim
propuesto y compatibilidad de los claims restantes. Mantiene la prohibición de
combinar conflictos nuevos con knowledge changes. `proposal-v2.ts` conserva
sus resultados error/invalid_proposal o gap_unresolved/conflicting_knowledge;
lifecycle rechaza los mismos casos antes de admitir un candidate.

El reconciler primero exige igualdad exacta de los registros históricos. Así,
conflictos unchanged permanecen sin reautorización; modified, retargeted, replaced
y removed se rechazan. Solo el sufijo nuevo pasa por la regla compartida, usando
los claim IDs de los findings ya validados contra parent, origin/run y target.
Un conflicto histórico ajeno no impide un cambio legítimo de knowledge.

S3A construction/validation/review y S3B write/decode mantienen sus llamadas al
gate existente; no se crean reglas paralelas en el store. Content/context SHA
permanecen idénticos en fórmula y responsabilidades. Legacy no M14 conserva su
comportamiento.

### Probes de conflictos A–L

| Caso | Resultado local |
| --- | --- |
| A: reproducción original con conflicto ajeno y hashes correctos | REJECT constructor/validator |
| B: escritura S3B real del artifact falso | Test añadido; bloqueado por Docker |
| C: lectura/decoder con parent real | REJECT en decoder puro; test PostgreSQL bloqueado |
| D: human ACCEPT del artifact falso | REJECT antes de crear canonical |
| E: conflicto legítimo de dos findings | PASS productor/lifecycle/decoder |
| F: conflicto histórico intacto más append legítimo | PASS productor/lifecycle/decoder |
| G: modificar target, claims, status o significado histórico | REJECT |
| H: eliminar conflicto histórico | REJECT |
| I: target ajeno con un finding participante | REJECT productor/lifecycle/decoder |
| J: target exacto pero ningún finding participante | REJECT productor/lifecycle/decoder |
| K: asociación incompatible | Claim ajeno REJECT; el contrato referencia claim IDs, no contiene un mapping separado conflict→finding. Invertir findings conserva el conflicto válido |
| L: conflicto nuevo más knowledge changes | No candidate: gap_unresolved en productor; REJECT en lifecycle |

Los envelopes adversariales usan constructor oficial y el helper oficial de SHA;
no hashes viejos. Los casos válidos pasan también por el mismo fixture de filas
del decoder, evitando que un error estructural del fixture explique los rechazos.

La regresión S2 reproduce covered → partial al evaluar el snapshot malicioso en
preview, demuestra rechazo de ACCEPT y confirma que el parent sigue intacto y
covered. No se modifica S2. La integración preparada verifica además ausencia
de INSERT parcial, rechazo al leer una representación inyectada en DB desechable
y que no se crea decisión/canonical a partir del artifact falso.

### Verificación Fix 4

- M14/S3A/S3B dirigidos: 133/133 PASS (81 M14, 32 S3A, 20 S3B).
- Fix 3: probes de mapping ausente/preexistente/subject falso siguen rechazados;
  append, dos findings, shared effects legítimos y legacy siguen pasando;
  effects falsos, reorder/replace y el nuevo probe delete se rechazan.
- Typecheck adicional de tests/fixtures M14 y PostgreSQL: PASS.
- API completa: 865/865 PASS, sin fallos/skips/cancelaciones, incluidos M13 v2 y
  legacy, M4/Registry y S1/S2. Typecheck API/web, lint completo y dirigido: PASS.
- Build: PASS, API compilada y web cache hit de Turborepo; aviso histórico del
  plugin Next.js de ESLint en los logs del build web, sin error.
- `git diff --check` y whitespace/conflictos de las 15 rutas pendientes: PASS.
- PostgreSQL M14: intento fallido antes de crear contenedor, endpoint
  `dockerDesktopLinuxEngine` inexistente; `docker info` confirma motor inaccesible.
  Las suites S3B, Registry/M4/M13 y migrations quedan sin ejecutar por el mismo
  bloqueo. No se usó Railway ni se transfieren los PASS históricos.
- Se añaden 15 unitarios (14 de conflictos y 1 de delete) y 3 casos PostgreSQL
  preparados: artifact ajeno write/read/human review, conflicto nuevo válido y
  conflicto histórico intacto más knowledge. Integración M14 prevista: 22 casos.

Comandos dirigidos adicionales (los comandos completos de tipos/lint/build y API
son los listados en la sección histórica de regresión):

```text
node apps/api/node_modules/tsx/dist/cli.mjs --test apps/api/tests/m14-controlled-research-v2.test.ts apps/api/tests/profile-lifecycle-v2.test.ts apps/api/tests/profile-lifecycle-store-v2.test.ts
docker info --format '{{.ServerVersion}}'
node scripts/test-migrations-postgres.mjs m14-controlled-research-v2
```

Fix 4 modifica siete rutas existentes: scoped-knowledge-v2.ts, proposal-v2.ts,
fixture M14, tests M14 unitarios/PostgreSQL, README-v2 y este informe. No añade
rutas. Estado inicial capturado: main, HEAD/origin/main
`7f4b69e4a0879fe6fb6f3e15c8de8a03e77b1a38`, divergencia 0/0, staging vacío,
15 rutas pendientes (5 tracked modificadas + 10 untracked), manifiesto de 308
archivos. Sin commit, push, deploy, nuevas migraciones/schema, secrets ni dumps.
Estado final: mismas 15 rutas y staging vacío. Comparación del manifiesto confirma
solo esas siete rutas cambiadas y ningún archivo añadido/eliminado. El intento
Docker falló antes de crear contenedores; esta ejecución no creó contenedores ni
volúmenes PostgreSQL. No se ejecutó la reauditoría final.

## Fix 3: causa y validación semántica

El productor ya construía cambios acotados, pero el lifecycle verificaba solamente
shape, referencias y presencia de hojas en el snapshot. No comprobaba que una hoja
fuese nueva respecto al parent ni que su subject fuera el real; tampoco reconstruía
todo el cambio. El constructor podía sellar esa contradicción. Los hashes cumplían
su función de integridad, sin demostrar correspondencia semántica.

`reconcileResearchKnowledgeV2` resuelve el claim nuevo de cada finding, sus
evidencias y target, y obtiene del candidate el valor de cada path declarado.
Reutiliza `buildScopedKnowledgeV2` para insertar exclusivamente esas hojas sobre
el parent: sin sobrescrituras, reorder, duplicados, solapamientos ni sparse arrays.
El mapping derivado debe coincidir por changeId/findingRef/path/subject real; se
verifica pertenencia a los subjects del claim, no solo compatibilidad de slot.
La comparación no depende del orden de findings.

El knowledge reconstruido debe ser exactamente el knowledge del candidate. Así,
mapping vacío/parcial, hojas preexistentes, valores idénticos, subjects falsos y
cambios extra en el mismo slot u otro quedan rechazados. Identidad y registros
previos de evidencia se conservan; todos los claims/evidencias nuevos se vinculan
a findings, incluso si son evidence-only. Se excluyen de la comparación los campos
legítimos de lifecycle como status/version. No se introduce un diff engine ni
nuevas clases de edición.

`researchSharedSlotEffectsV2` centraliza el cálculo existente del productor; el
gate recalcula y compara exactamente estos diagnósticos. No son autoridad para
introducir cambios ni moverlos entre findings incompatibles.

S3A llama al gate desde constructor, validator y revisión humana. S3B ya llama al
validator con el parent real al persistir y decodificar historia. No se duplican
reglas ni se añade un camino alternativo. Un parse de shape/hashes sin parent no
constituye admisión. Sin extensión M14 se mantiene el comportamiento legacy.

El hash de contexto se extrae sin cambios a un helper interno para compartir el
código oficial con las pruebas. No es una API pública ni valida admisión. Content
SHA sigue dependiendo solo del snapshot; context SHA sigue incluyendo lineage.

### Probes A–L

| Probe | Resultado |
| --- | --- |
| A: mapping vacío/ausente con delta real | REJECT |
| B: mapping a values[0] preexistente | REJECT |
| C: feature inexistente o existente incorrecto | REJECT |
| D: cambio extra sin mapping, mismo slot u otro | REJECT |
| E: mapping sin cambio real/valor idéntico | REJECT |
| F: un finding válido | PASS, hashes idénticos |
| G: dos findings independientes | PASS; invertir orden válido; intercambiar autoría incompatible REJECT |
| H: shared effect legítimo | PASS |
| I: shared effect inventado, target ajeno o estado falso | REJECT |
| J: round-trip PostgreSQL válido | PASS |
| K: artifact falso con SHA oficial correcto | REJECT en writer y decoder PostgreSQL |
| L: candidate legacy sin extensión | PASS, sin defaults ni cambios de hash |

También se rechazan reorder, replace, path duplicado, índice fuera de rango,
finding omitido conservando su evidencia y reescritura de evidencia previa.
Las pruebas construyen el snapshot mediante S3A y recalculan context SHA mediante
el helper oficial. Verifican rechazo en constructor/validator/revisión humana;
los probes PostgreSQL comprueban ausencia de escritura parcial y, mediante
inyección acotada en DB desechable, rechazo al leer artifacts hash-valid falsos.

## HIGH: findings → cambios → snapshot

La autoridad es `findings[].knowledgeChanges[] = {changeId, path, value}`.
Cada cambio declara una hoja real del valor S1 del slot: campo textual,
elemento textual de array o colección explícitamente vacía. No se inventan
IDs de valores ni nuevas referencias S1. Un mechanism, feature, script/system
o structural item necesita declaraciones para cada hoja material nueva.

El patch se construye desde esas declaraciones sobre una copia del canonical.
Cada dirección debe resolver después de normalizar S1 al valor exacto declarado
y a un sujeto contenido por los subjectRefs del finding. Un finding de mechanism
no autoriza metadatos del feature ni otro mechanism. Los sujetos deben continuar
abordando el target conforme a S2; no se relajó matchesSubject ni la política.

El merge permite inicializar unknown y añadir elementos a arrays existentes;
conserva valores previos, orden, otros slots, identidad y evidencia anterior.
No admite sobrescrituras, paths duplicados/solapados, objetos o listas completas
como unidad de cambio, estructuras inválidas ni reemplazos de not_applicable.

`knowledgeAddition` se conserva solamente como assertion opcional de consistencia.
No es fuente del patch. Debe coincidir exactamente con el valor derivado y con
los findings que realmente aportaron cambios. Cualquier contenido extra rechaza
la propuesta completa como invalid_proposal/Overbroad, indicando su dirección.
No hay filtrado parcial silencioso.

El probe original se reprodujo con X =
`age.basic_expression.verbalSystem.tense`, finding de mecanismo de edad,
mecanismo/value adicional y claim preexistente de Y =
`action.basic_pattern.verbalSystem.tense`. Copiar el blob habría hecho Y covered;
M14 lo rechaza antes del writer y canonical Y permanece missing.

Un hecho completamente respaldado sí puede ayudar a Y por las reglas existentes
de S2. `sharedSlotEffects` registra before/after de los targets que comparten slot,
tanto en propuesta como en provenance durable. Compara claims existentes antes
y después del patch, con el mismo requirementRef/options y el dominio respectivo;
es diagnóstico, no una nueva autorización de research. No se crean claims para Y.

Dos findings pueden autorizar dos deltas válidos; hay test de append de dos
valores y de merge determinista, preservando todo el knowledge unrelated.

## MEDIUM: contexto durable del candidate

Se amplía únicamente `origin.researchProvenance?` de S3A:
`kind: m14-controlled-research-v2`, `version: 1.0.0`.
El contrato es estricto y no añade defaults a artifacts previos.

Incluye:
- runRef y proposal SHA existente;
- Registry record ID, SHA y binding completo, con canonical record ID/SHA;
- requirement, target, gap/reason, modo durable, options si existen, política
  efectiva S2 y digest del resultado M13;
- provider identity, responseRef/model solamente si están disponibles;
- por finding: claimRef, evidenceRef/sourceRef, materialRef/extractionRef
  opcionales y mapping explícito changeId → slot/path/subject;
- diagnósticos compactos de slots compartidos.

Los statements, fuentes, locators y valores se recuperan del snapshot por esas
referencias. No se persisten prompt, respuesta completa ni objetos redundantes
del gap. Material/extraction/response refs ausentes siguen ausentes.

`originRef = m14.<hash>` es complemento lógico; no se presenta como manifest
resoluble por sí solo ni se añade un manifest store.

S3A valida el contexto contra parent, origin, claims, evidencia y hojas del
snapshot. S3B comprueba además canonicalRecordId contra el parent durable.
Persistence y lectura reutilizan snapshot_json/lineage JSONB y los validadores
existentes. El test real deja escapar solo el candidate ID del bloque de research,
descarta provider result/proposal y reconstruye la trazabilidad desde un store nuevo.

## Compatibilidad, hashes y lifecycle

- Candidates sin researchProvenance siguen siendo válidos sin alterar sus bytes
  ni añadir campos por defecto; probado en S3A y PostgreSQL.
- Content SHA sigue siendo SHA-256 del snapshot Profile normalizado.
- Candidate/context SHA sigue sellando snapshot + lineage; incluye naturalmente
  la nueva provenance. Con Profile fijo, cambiar origin cambia solo context SHA.
- Las referencias origin de claims ya formaban parte del contenido previamente.
  No se redefinen ni se introduce un tercer hash.
- La promoción humana conserva exactamente las reglas anteriores: solo cambia
  status a canonical; el proceso de research permanece en lineage del candidate.
- M14 solo puede persistir review candidates. No dispone de ACCEPT, REJECT,
  Registry writes ni canonical direct write.
- Parent exacto, ownership, fake gaps, M13 error/authorized, failure/timeout,
  unresolved, S1 inválido, retries, histórico A y promoción concurrente mantienen
  sus bloqueos. S3B sigue cerrando la carrera con su lock y stale_parent.
- Cero tablas, columnas o migraciones nuevas. Cero SQL directo desde M14.
  LanguageProfileV2, Requirement Evidence S1/S2 y promoción no se modificaron.

## Regresión del fix 3

| Comprobación | Resultado |
| --- | --- |
| M14 unitarios, incluidos nuevos tests de origin S3A | 66/66 PASS dentro de API |
| Tests S3A originales | 32/32 PASS dentro de API |
| S3B unitarios | 20/20 PASS dentro de API |
| API completa | 850/850 PASS; 0 failures/skips/cancellations |
| M14/S3B PostgreSQL | 19/19 PASS |
| Registry Grounding + M4 + M13 PostgreSQL | 44/44 PASS |
| S3B PostgreSQL original | 29/29 PASS |
| Migration integration | 20/20 PASS |
| Total PostgreSQL | 112/112 PASS |
| M13 v2 y legacy, M4, Registry, S1/S2 | PASS en API completa |
| Typecheck API y web | PASS, sin emisión/incremental |
| Typecheck adicional de tests/fixtures M14 | PASS |
| Lint API y web | PASS |
| ESLint dirigido, incluidos tests/fixtures nuevos | PASS |
| Build del gate CI (`corepack pnpm build`) | PASS; API compilada, web cache hit de Turborepo |
| git diff --check / whitespace / conflictos | PASS |

Fix 2 añade 19 tests unitarios (11 de M14 y 8 de origin S3A) y 6 PostgreSQL.
Se prueban versiones/shape inválidos, hashes/contexto manipulados, legacy read-back,
referencias opcionales ausentes, mapping durable, efecto compartido legítimo,
probe original y varios tipos de contaminación. Los tests anteriores siguen
cubriendo invariantes de authority, ownership, concurrencia y lifecycle.
Fix 3 añade 17 unitarios y 5 PostgreSQL; las tres reproducciones originales quedan
bloqueadas semánticamente. En el primer intento paralelo, M14/S3B PostgreSQL
fallaron en setup con `57P03: the database system is starting up`; sus reintentos
secuenciales pasaron íntegros. No se cambió el runner para este incidente.
El build web reproduce un aviso existente sobre el plugin Next.js de ESLint,
sin error; API y web completan el gate.

PostgreSQL se ejecutó solo en contenedores locales desechables con las migraciones
existentes autorizadas 0000–0027. El runner vacía DATABASE_URL y elimina contenedor
y volúmenes en finally. No se usó Railway ni producción.

Comandos:
```text
node apps/api/node_modules/tsx/dist/cli.mjs --test apps/api/tests/*.test.ts
node scripts/test-migrations-postgres.mjs m14-controlled-research-v2
node scripts/test-migrations-postgres.mjs registry-grounding-v2
node scripts/test-migrations-postgres.mjs profile-lifecycle-v2
node scripts/test-migrations-postgres.mjs migrations
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false
corepack pnpm lint
corepack pnpm build
node node_modules/typescript/bin/tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --esModuleInterop --strict --noUncheckedIndexedAccess --skipLibCheck --types node --typeRoots apps/api/node_modules/@types apps/api/tests/m14-controlled-research-v2.test.ts apps/api/tests/integration/m14-controlled-research-v2.postgres.test.ts
node node_modules/eslint/bin/eslint.js apps/api/tests/fixtures/m14-controlled-research-v2.ts apps/api/tests/m14-controlled-research-v2.test.ts apps/api/tests/integration/m14-controlled-research-v2.postgres.test.ts --max-warnings=0
git diff --check
```

## Archivos y Git

Fix 2 afecta 12 rutas; dos son nuevas frente al checkpoint M14 anterior:
- NUEVA: apps/api/src/languages/profile/candidate-research-provenance-v2.ts
- NUEVA: apps/api/src/languages/profile-research/scoped-knowledge-v2.ts
- apps/api/src/languages/profile/profile-lifecycle-v2.ts
- apps/api/src/languages/profile/profile-lifecycle-store-v2.ts
- apps/api/src/languages/profile-research/contracts-v2.ts
- apps/api/src/languages/profile-research/proposal-v2.ts
- apps/api/src/languages/profile-research/controlled-research-v2.ts
- apps/api/tests/fixtures/m14-controlled-research-v2.ts
- apps/api/tests/m14-controlled-research-v2.test.ts
- apps/api/tests/integration/m14-controlled-research-v2.postgres.test.ts
- apps/api/src/languages/profile/README-v2.md
- docs/M14_CONTROLLED_RESEARCH_REPORT.md

Además siguen pendientes las dos entradas de ejecución del checkpoint previo,
sin nuevos cambios en este fix:
- package.json
- scripts/test-migrations-postgres.mjs

El estado previo a fix 3 se capturó con esas 14 rutas: 5 tracked modificadas y
9 untracked. Fix 3 modifica exclusivamente estas responsabilidades:

- `scoped-knowledge-v2.ts`: reconciliación parent-aware y cálculo compartido de efectos.
- `profile-lifecycle-v2.ts`: gate semántico común; mantiene el hashing anterior.
- NUEVA `profile/profile-candidate-context-sha-v2.ts`: primitiva interna SHA existente.
- `proposal-v2.ts`: reutiliza el cálculo compartido de efectos, sin nuevo contrato.
- Fixture y tests M14 unitarios/PostgreSQL: envelopes oficiales y probes A–L.
- README-v2 y este informe: documentación del fix y su regresión.

S3B store, contratos, servicio, package y runner conservan sus cambios anteriores;
no reciben cambios adicionales en fix 3. Working tree M14 total: 15 rutas,
5 tracked modificadas + 10 untracked; la única ruta añadida es el helper SHA.
Rama main; HEAD y origin/main:
`7f4b69e4a0879fe6fb6f3e15c8de8a03e77b1a38`.
Divergencia 0/0; staging vacío. Sin commit, push ni deploy.
La comparación SHA-256 contra el manifiesto previo de 307 archivos detecta
únicamente los ocho archivos existentes indicados para fix 3; se añade el helper
SHA como novena ruta del fix. No hay cambios ajenos ni archivos temporales nuevos
en el estado de Git. `git diff --check` y la revisión de whitespace/conflictos de
las 15 rutas pendientes pasan.

Limpieza comprobada: ningún contenedor `memoos-migration-test-*` permanece.
Los cuatro volúmenes Docker restantes se crearon entre 2026-08-17 y 2026-09-04,
antes de esta ejecución; no son recursos de estas pruebas y no se modificaron.
No se crearon ni modificaron migraciones/schema; solo se ejecutaron las migraciones
existentes autorizadas en contenedores locales desechables. Sin Railway,
producción, secrets ni dumps.

## Fuera de alcance

Reviewer auth, PDF ingestion/upload/extraction/OCR, integración de provider
productivo y ampliaciones generales de literal-types/readonly siguen deferred.
No se añadieron routes/UI, nuevos permisos ni infraestructura lateral.
La correspondencia estructural finding→cambio no valida la verdad lingüística
del provider: claims continúan needs_review y relaciones unvalidated.
