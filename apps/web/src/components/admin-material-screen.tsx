"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

export const MATERIAL_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
type LevelId = typeof MATERIAL_LEVELS[number];
type Unit = {
  unitId: string;
  unitOrder: number;
  documentId: string;
  sourceTitle: string | null;
  originalFilename: string | null;
  storageStatus: "pending" | "ready" | "failed";
  extractionStatus: "pending" | "ready" | "failed";
  processingStatus: "pending" | "running" | "ready" | "failed";
  processingError: string | null;
};
type Level = { levelId: LevelId; units: Unit[]; nextUnitOrder: number; nextUnitId: string };
type ViewState = { kind: "loading" } | { kind: "forbidden" } | { kind: "error" } | { kind: "ready"; levels: Level[] };

async function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el PDF."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function AdminMaterialScreen({ levelId }: { levelId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const validLevel = levelId && MATERIAL_LEVELS.includes(levelId as LevelId) ? levelId as LevelId : null;

  async function load() {
    const response = await fetch("/api/admin/curriculum-material", { credentials: "include", cache: "no-store" });
    if (response.status === 401) { router.replace("/"); return; }
    if (response.status === 403) { setState({ kind: "forbidden" }); return; }
    if (!response.ok) throw new Error("No se pudo cargar el material curricular.");
    const result = await response.json() as { levels?: Level[] };
    if (!Array.isArray(result.levels)) throw new Error("Respuesta inválida.");
    setState({ kind: "ready", levels: result.levels });
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/curriculum-material", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) { router.replace("/"); return; }
        if (response.status === 403) { setState({ kind: "forbidden" }); return; }
        if (!response.ok) throw new Error("No se pudo cargar el material curricular.");
        const result = await response.json() as { levels?: Level[] };
        if (active) setState(Array.isArray(result.levels) ? { kind: "ready", levels: result.levels } : { kind: "error" });
      })
      .catch(() => { if (active) setState({ kind: "error" }); });
    return () => { active = false; };
  }, [router]);

  async function upload(event: FormEvent<HTMLFormElement>, level: LevelId, unitOrder: number) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0 || !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Selecciona un PDF válido.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/curriculum-material/${level}/units/${unitOrder}`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileBase64: await fileBase64(file), originalFilename: file.name, sourceTitle: String(data.get("sourceTitle") ?? "") }),
      });
      if (response.status === 401) { router.replace("/"); return; }
      if (response.status === 403) { setState({ kind: "forbidden" }); return; }
      if (!response.ok) throw new Error(response.status === 409 ? "La unidad ya existe o el archivo no coincide con el reintento." : "No se pudo subir el PDF.");
      form.reset();
      setMessage("Material cargado. Ya puedes procesarlo.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir el PDF.");
      try { await load(); } catch { /* Keep the upload error visible. */ }
    } finally { setBusy(false); }
  }

  async function process(level: LevelId, unitOrder: number) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/curriculum-material/${level}/units/${unitOrder}/process`, { method: "POST", credentials: "include" });
      if (response.status === 401) { router.replace("/"); return; }
      if (response.status === 403) { setState({ kind: "forbidden" }); return; }
      if (!response.ok) throw new Error("No se pudo procesar el material. Puedes reintentarlo sin volver a subir el PDF.");
      setMessage("Procesamiento completado.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo procesar el material.");
      try { await load(); } catch { /* Keep the processing error visible. */ }
    } finally { setBusy(false); }
  }

  if (levelId && !validLevel) return <main className="flow-shell"><p className="form-error">Nivel no válido.</p></main>;
  if (state.kind === "loading") return <main className="flow-shell"><p className="loading-message">Cargando material curricular…</p></main>;
  if (state.kind === "forbidden") return <main className="flow-shell"><p className="form-error" role="alert">Acceso denegado.</p></main>;
  if (state.kind === "error") return <main className="flow-shell"><p className="form-error" role="alert">No se pudo cargar el material curricular.</p></main>;

  const level = validLevel ? state.levels.find((entry) => entry.levelId === validLevel) : null;
  return <main className="flow-shell"><section className="account-card admin-card">
    <p className="brand">MemoOS</p>
    <Link className="back-link" href={validLevel ? "/admin/material" : "/admin"}>{validLevel ? "Volver a niveles" : "Volver a Administración"}</Link>
    <h1>Material curricular{validLevel ? ` — ${validLevel}` : ""}</h1>
    {message ? <p role="status">{message}</p> : null}
    {!validLevel ? <nav aria-label="Niveles curriculares"><ul>{MATERIAL_LEVELS.map((id) => <li key={id}><Link href={`/admin/material/${id}`}>{id}</Link></li>)}</ul></nav> : null}
    {validLevel && level ? <div>
      {level.units.map((unit) => <section className="account-section" key={unit.unitId}>
        <h2>Unidad {unit.unitOrder} — {unit.storageStatus === "ready" ? "Material cargado" : "Subida pendiente"}</h2>
        <p>{unit.sourceTitle}</p>
        <p>Almacenamiento: {unit.storageStatus}. Extracción: {unit.extractionStatus}. Procesamiento: {unit.processingStatus}.</p>
        {unit.processingError ? <p role="alert">Error: {unit.processingError}</p> : null}
        {unit.storageStatus === "ready" && unit.processingStatus !== "ready" ? <button type="button" disabled={busy} onClick={() => void process(validLevel, unit.unitOrder)}>Reintentar procesamiento sin reupload</button> : null}
        {unit.storageStatus === "failed" ? <form className="auth-form" onSubmit={(event) => void upload(event, validLevel, unit.unitOrder)}>
          <p>La subida falló. Reintenta con el mismo PDF y título.</p>
          <label>Título<input name="sourceTitle" defaultValue={unit.sourceTitle ?? ""} required /></label>
          <label>PDF<input name="file" type="file" accept="application/pdf,.pdf" required /></label>
          <button type="submit" disabled={busy}>Reintentar subida</button>
        </form> : null}
      </section>)}
      <section className="account-section"><h2>Unidad {level.nextUnitOrder} — Subir documento</h2>
        <form className="auth-form" onSubmit={(event) => void upload(event, validLevel, level.nextUnitOrder)}>
          <label>Título<input name="sourceTitle" required maxLength={240} /></label>
          <label>PDF<input name="file" type="file" accept="application/pdf,.pdf" required /></label>
          <button type="submit" disabled={busy}>Subir documento</button>
        </form>
      </section>
    </div> : null}
  </section></main>;
}
