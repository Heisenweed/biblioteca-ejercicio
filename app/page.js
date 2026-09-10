"use client";

import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { supabase } from "../lib/supabaseClient";

const LEVEL_NAMES = { beginner: "Principiante", intermediate: "Intermedio", advanced: "Avanzado" };
const LEVEL_CLASS = { beginner: "beginner", intermediate: "intermediate", advanced: "advanced" };
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

const CATEGORY_NAMES = {
  strength: "Fuerza",
  stretch_dynamic: "Estiramiento dinámico",
  stretch_static_active: "Estiramiento activo",
  stretch_static_passive: "Estiramiento pasivo",
  conditioning: "Acondicionamiento",
};

const DOC_CATEGORY_NAMES = {
  fundamentals: "Fundamentos",
  programming: "Programación",
  technique: "Técnica",
  case_study: "Caso práctico",
  nutrition_basics: "Nutrición básica",
};

function unique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b, "es"));
}

function involvementPct(m) {
  if (m.pct !== null && m.pct !== undefined) return m.pct;
  if (m.involvement === "primary") return 70;
  if (m.involvement === "secondary") return 40;
  return 20;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState("library");
  const [exercises, setExercises] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [pattern, setPattern] = useState("");
  const [muscle, setMuscle] = useState("");
  const [equip, setEquip] = useState("");
  const [level, setLevel] = useState("");
  const [objective, setObjective] = useState("");
  const [sortKey, setSortKey] = useState("relevancia");

  const [modal, setModal] = useState(null); // { type: 'exercise'|'document', data }

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      const [exRes, docRes] = await Promise.all([
        supabase.from("exercises_full").select("*").order("name"),
        supabase.from("documents").select("*").order("created_at"),
      ]);

      if (exRes.error) {
        setError(exRes.error.message);
        setLoading(false);
        return;
      }
      if (docRes.error) {
        setError(docRes.error.message);
        setLoading(false);
        return;
      }

      setExercises(exRes.data || []);
      setDocuments(docRes.data || []);
      setLoading(false);
    }
    loadData();
  }, []);

  const patternOptions = useMemo(() => unique(exercises.flatMap((e) => e.patterns || [])), [exercises]);
  const muscleOptions = useMemo(
    () => unique(exercises.flatMap((e) => (e.muscles || []).map((m) => m.name))),
    [exercises]
  );
  const equipOptions = useMemo(
    () => unique(exercises.flatMap((e) => (e.equipment || []).map((eq) => eq.name))),
    [exercises]
  );
  const objectiveOptions = useMemo(() => unique(exercises.flatMap((e) => e.objectives || [])), [exercises]);
  const categoryOptions = useMemo(() => unique(exercises.map((e) => CATEGORY_NAMES[e.category] || e.category)), [
    exercises,
  ]);

  const filtered = useMemo(() => {
    let list = exercises.filter((e) => {
      const catName = CATEGORY_NAMES[e.category] || e.category;
      if (search && !e.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (category && catName !== category) return false;
      if (pattern && !(e.patterns || []).includes(pattern)) return false;
      if (muscle && !(e.muscles || []).some((m) => m.name === muscle)) return false;
      if (equip && !(e.equipment || []).some((eq) => eq.name === equip)) return false;
      if (level && e.level !== level) return false;
      if (objective && !(e.objectives || []).includes(objective)) return false;
      return true;
    });

    list = [...list];
    switch (sortKey) {
      case "alfa-az":
        list.sort((a, b) => a.name.localeCompare(b.name, "es"));
        break;
      case "alfa-za":
        list.sort((a, b) => b.name.localeCompare(a.name, "es"));
        break;
      case "nivel-asc":
        list.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.name.localeCompare(b.name, "es"));
        break;
      case "nivel-desc":
        list.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.name.localeCompare(b.name, "es"));
        break;
      case "equipo-asc":
        list.sort((a, b) => (a.equipment || []).length - (b.equipment || []).length || a.name.localeCompare(b.name, "es"));
        break;
      case "musculos-desc":
        list.sort((a, b) => (b.muscles || []).length - (a.muscles || []).length || a.name.localeCompare(b.name, "es"));
        break;
      default:
        break;
    }
    return list;
  }, [exercises, search, category, pattern, muscle, equip, level, objective, sortKey]);

  function openExercise(ex) {
    setModal({ type: "exercise", data: ex });
  }
  function openDocument(doc) {
    setModal({ type: "document", data: doc });
  }
  function closeModal() {
    setModal(null);
  }

  return (
    <div className="wrap">
      <header className="hero">
        <div className="eyebrow">Biblioteca conectada a base de datos real</div>
        <h1>Biblioteca de ejercicios</h1>
        <p>
          Filtra ejercicios por músculo, patrón de movimiento, equipamiento, nivel y objetivo, o lee los
          documentos formativos para aprender a diseñar tus propias rutinas.
        </p>
        {!loading && !error && (
          <div className="counter">
            {exercises.length} ejercicios · {documents.length} documentos cargados
          </div>
        )}
      </header>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "library" ? "active" : ""}`}
          onClick={() => setActiveTab("library")}
        >
          Biblioteca de ejercicios
        </button>
        <button className={`tab-btn ${activeTab === "docs" ? "active" : ""}`} onClick={() => setActiveTab("docs")}>
          Documentos formativos
        </button>
      </div>

      {loading && <div className="loading-state">Cargando datos desde Supabase…</div>}

      {error && (
        <div className="error-state">
          No se pudo conectar con la base de datos: {error}
          <br />
          Revisa que las variables NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY estén bien
          configuradas, y que hayas ejecutado 12_create_exercise_view.sql en Supabase.
        </div>
      )}

      {!loading && !error && activeTab === "library" && (
        <>
          <div className="filters">
            <div className="filter-group">
              <label>Buscar</label>
              <input
                type="text"
                placeholder="Nombre del ejercicio…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>Tipo</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Todos</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Patrón de movimiento</label>
              <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
                <option value="">Todos</option>
                {patternOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Grupo muscular</label>
              <select value={muscle} onChange={(e) => setMuscle(e.target.value)}>
                <option value="">Todos</option>
                {muscleOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Equipamiento</label>
              <select value={equip} onChange={(e) => setEquip(e.target.value)}>
                <option value="">Todos</option>
                {equipOptions.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Nivel</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Todos</option>
                {Object.entries(LEVEL_NAMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Objetivo</label>
              <select value={objective} onChange={(e) => setObjective(e.target.value)}>
                <option value="">Todos</option>
                {objectiveOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="sort-row">
            <label>Ordenar por</label>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="relevancia">Relevancia (por defecto)</option>
              <option value="alfa-az">Alfabético (A → Z)</option>
              <option value="alfa-za">Alfabético (Z → A)</option>
              <option value="nivel-asc">Dificultad (fácil → difícil)</option>
              <option value="nivel-desc">Dificultad (difícil → fácil)</option>
              <option value="equipo-asc">Equipamiento necesario (menos → más)</option>
              <option value="musculos-desc">Nº de músculos implicados (más → menos)</option>
            </select>
          </div>

          <div className="counter" style={{ marginBottom: 12 }}>
            {filtered.length} de {exercises.length} ejercicios
          </div>

          <div className="grid">
            {filtered.length === 0 && (
              <div className="empty">Ningún ejercicio cumple esa combinación de filtros.</div>
            )}
            {filtered.map((ex) => {
              const sortedMuscles = [...(ex.muscles || [])].sort((a, b) => {
                const order = { primary: 0, secondary: 1, stabilizer: 2 };
                return order[a.involvement] - order[b.involvement];
              });
              const catName = CATEGORY_NAMES[ex.category] || ex.category;
              return (
                <div className="card" key={ex.id} onClick={() => openExercise(ex)} tabIndex={0}>
                  <div className="card-top">
                    <h3>{ex.name}</h3>
                    <span className={`badge ${LEVEL_CLASS[ex.level]}`}>{LEVEL_NAMES[ex.level]}</span>
                  </div>
                  <div className="tags-row" style={{ marginBottom: 10 }}>
                    <span className={`badge-category ${ex.category?.startsWith("stretch") ? "stretch" : ""}`}>
                      {catName}
                    </span>
                  </div>
                  <p className="short">{ex.short_description}</p>
                  <div className="bars">
                    {sortedMuscles.slice(0, 3).map((m) => (
                      <div className="bar-row" key={m.slug}>
                        <div className="bar-label">{m.name}</div>
                        <div className="bar-track">
                          <div
                            className={`bar-fill ${m.involvement}`}
                            style={{ width: `${involvementPct(m)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="tags-row">
                    {(ex.equipment || []).map((eq) => (
                      <span className="chip" key={eq.name}>
                        {eq.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && !error && activeTab === "docs" && (
        <>
          <p className="docs-intro">
            Contenido formativo para aprender a diseñar tus propias rutinas — teoría y aplicación práctica
            sobre esta misma biblioteca.
          </p>
          <div className="docs-list">
            {documents.map((doc) => (
              <div className="doc-card" key={doc.id} onClick={() => openDocument(doc)} tabIndex={0}>
                <div className="doc-card-top">
                  <h3>{doc.title}</h3>
                  <div className="doc-meta">
                    <span className="badge-category">{DOC_CATEGORY_NAMES[doc.category] || doc.category}</span>
                    <span className={doc.is_premium ? "badge-premium" : "badge-free"}>
                      {doc.is_premium ? "Premium" : "Gratis"}
                    </span>
                  </div>
                </div>
                <p>{doc.summary}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {modal && (
        <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          {modal.type === "exercise" && <ExerciseModal ex={modal.data} onClose={closeModal} />}
          {modal.type === "document" && <DocumentModal doc={modal.data} onClose={closeModal} />}
        </div>
      )}
    </div>
  );
}

function ExerciseModal({ ex, onClose }) {
  return (
    <div className="modal">
      <button className="close-btn" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <h2>{ex.name}</h2>
      <div className="modal-meta">
        <span className={`badge ${LEVEL_CLASS[ex.level]}`}>{LEVEL_NAMES[ex.level]}</span>
        <span className={`badge-category ${ex.category?.startsWith("stretch") ? "stretch" : ""}`}>
          {CATEGORY_NAMES[ex.category] || ex.category}
        </span>
        {ex.is_unilateral && <span className="chip">Unilateral</span>}
        {(ex.patterns || []).map((p) => (
          <span className="chip" key={p}>
            {p}
          </span>
        ))}
      </div>
      <p>{ex.instructions}</p>

      <div className="section-label">Implicación muscular</div>
      <div className="bars">
        {(ex.muscles || []).map((m) => (
          <div className="bar-row" key={m.slug}>
            <div className="bar-label">{m.name}</div>
            <div className="bar-track">
              <div className={`bar-fill ${m.involvement}`} style={{ width: `${involvementPct(m)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="section-label">Equipamiento</div>
      <div className="tags-row">
        {(ex.equipment || []).map((eq) => (
          <span className="chip" key={eq.name}>
            {eq.name}
            {!eq.required ? " (opcional)" : ""}
          </span>
        ))}
      </div>

      <div className="section-label">Objetivo</div>
      <div className="tags-row">
        {(ex.objectives || []).map((o) => (
          <span className="chip" key={o}>
            {o}
          </span>
        ))}
      </div>

      {(ex.contraindications || []).length > 0 && (
        <>
          <div className="section-label">Precaución</div>
          <p className="contra">{ex.contraindications.map((c) => c.name).join(", ")}</p>
        </>
      )}
    </div>
  );
}

function DocumentModal({ doc, onClose }) {
  const html = marked.parse(doc.content_markdown || "");
  return (
    <div className="modal reader-modal">
      <button className="close-btn" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <div className="modal-meta">
        <span className="badge-category">{DOC_CATEGORY_NAMES[doc.category] || doc.category}</span>
        <span className={doc.is_premium ? "badge-premium" : "badge-free"}>
          {doc.is_premium ? "Premium" : "Gratis"}
        </span>
      </div>
      <div className="reader-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
