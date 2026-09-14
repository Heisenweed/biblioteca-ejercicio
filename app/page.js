"use client";

import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthContext";
import SessionsTab from "./SessionsTab";

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
  app_guide: "Guía de la app",
  exercise_science: "Ciencia del ejercicio",
  wellness_basics: "Hábitos y bienestar",
};

// Calcula la edad a partir de la fecha de nacimiento, para que no haya que
// actualizarla manualmente cada año.
function calcAge(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const monthDiff = today.getMonth() - b.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < b.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function unique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b, "es"));
}

function involvementPct(m) {
  if (m.pct !== null && m.pct !== undefined) return m.pct;
  if (m.involvement === "primary") return 70;
  if (m.involvement === "secondary") return 40;
  return 20;
}

// Comprueba si un ejercicio coincide con el texto de búsqueda, mirando no solo
// el nombre sino también patrones, músculos, equipamiento, objetivos y tags —
// así una búsqueda como "rodilla" encuentra ejercicios de extensión de rodilla
// aunque esa palabra no esté en el nombre del ejercicio.
function matchesSearch(e, searchTerm) {
  if (!searchTerm) return true;
  const q = searchTerm.trim().toLowerCase();
  const haystack = [
    e.name,
    e.short_description,
    ...(e.patterns || []),
    ...(e.muscles || []).map((m) => m.name),
    ...(e.equipment || []).map((eq) => eq.name),
    ...(e.objectives || []),
    ...(e.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

// Comprueba si un ejercicio cumple un subconjunto de filtros. Se usa tanto
// para el resultado final (con todos los filtros) como para calcular, para
// cada desplegable, qué opciones siguen teniendo sentido dado el resto de
// filtros ya activos — sin contar el propio filtro que se está calculando.
function matchesFilters(e, f) {
  const catName = CATEGORY_NAMES[e.category] || e.category;
  if (f.search && !matchesSearch(e, f.search)) return false;
  if (f.category && catName !== f.category) return false;
  if (f.bodyRegion && !(e.body_regions || []).includes(f.bodyRegion)) return false;
  if (f.pattern && !(e.patterns || []).includes(f.pattern)) return false;
  if (f.muscle && !(e.muscles || []).some((m) => m.name === f.muscle)) return false;
  if (f.equip && !(e.equipment || []).some((eq) => eq.name === f.equip)) return false;
  if (f.level && e.level !== f.level) return false;
  if (f.objective && !(e.objectives || []).includes(f.objective)) return false;
  return true;
}

export default function HomePage() {
  const { user, authLoading, signInWithPassword, signUpWithPassword, signInWithGoogle, signOut } = useAuth();

  const [activeTab, setActiveTab] = useState("library");
  const [exercises, setExercises] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [docSearch, setDocSearch] = useState("");
  const [docCategory, setDocCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [healthModalOpen, setHealthModalOpen] = useState(false);
  const [healthScreening, setHealthScreening] = useState(null); // null = aún no cargado/hecho
  const [favorites, setFavorites] = useState(new Set());
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [bodyRegion, setBodyRegion] = useState("");
  const [pattern, setPattern] = useState("");
  const [muscle, setMuscle] = useState("");
  const [equip, setEquip] = useState("");
  const [level, setLevel] = useState("");
  const [objective, setObjective] = useState("");
  const [sortKey, setSortKey] = useState("relevancia");

  const [modal, setModal] = useState(null); // { type: 'exercise'|'document', data }

  useEffect(() => {
    async function fetchAll() {
      return Promise.all([
        supabase.from("exercises_full").select("*").order("name"),
        supabase.from("documents").select("*").order("created_at"),
      ]);
    }

    // Un token de sesión corrupto o con la hora desajustada hace que Supabase
    // rechace TODAS las peticiones, incluidas las de datos públicos. En ese
    // caso cerramos la sesión automáticamente y reintentamos como visitante,
    // para que la persona pueda seguir usando la biblioteca en vez de quedarse
    // ante una pantalla de error sin salida.
    function isTokenProblem(msg) {
      if (!msg) return false;
      const m = msg.toLowerCase();
      return m.includes("jwt") || m.includes("token") || m.includes("issued at");
    }

    async function loadData() {
      setLoading(true);
      setError(null);
      let [exRes, docRes] = await fetchAll();

      if (isTokenProblem(exRes.error?.message) || isTokenProblem(docRes.error?.message)) {
        try {
          await supabase.auth.signOut();
        } catch (e) {
          // Si ni siquiera se puede cerrar sesión limpiamente, seguimos igual:
          // el reintento de abajo dirá si el problema persiste.
        }
        [exRes, docRes] = await fetchAll();
      }

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
      // La guía de uso de la app siempre va primera, sea cual sea su fecha de
      // creación — tiene sentido que sea lo primero que ve alguien nuevo.
      // El resto de documentos mantiene su orden cronológico entre ellos.
      const sortedDocs = [...(docRes.data || [])].sort((a, b) => {
        if (a.category === "app_guide" && b.category !== "app_guide") return -1;
        if (b.category === "app_guide" && a.category !== "app_guide") return 1;
        return 0;
      });
      setDocuments(sortedDocs);
      setLoading(false);
    }
    loadData();
  }, []);

  // Carga los favoritos del usuario en cuanto inicia sesión, y los vacía al
  // cerrarla. Cada usuario solo puede ver los suyos (política de seguridad
  // ya aplicada en la base de datos).
  useEffect(() => {
    if (!user) {
      setFavorites(new Set());
      setShowOnlyFavorites(false);
      return;
    }
    supabase
      .from("user_favorites")
      .select("exercise_id")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (!error && data) {
          setFavorites(new Set(data.map((f) => f.exercise_id)));
        }
      });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    supabase
      .from("profiles")
      .select("full_name, birth_date, weight_kg, height_cm")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (!error) setProfile(data);
      });
  }, [user]);

  async function saveProfile(updates) {
    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    if (!error) {
      setProfile((prev) => ({ ...prev, ...updates }));
    }
    return error;
  }

  useEffect(() => {
    if (!user) {
      setHealthScreening(null);
      return;
    }
    supabase
      .from("health_screening")
      .select("answers, has_flag, completed_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setHealthScreening(data));
  }, [user]);

  async function saveHealthScreening(answers) {
    const hasFlag = Object.values(answers).some(Boolean);
    const { error } = await supabase
      .from("health_screening")
      .upsert({ user_id: user.id, answers, has_flag: hasFlag, completed_at: new Date().toISOString() });
    if (!error) {
      setHealthScreening({ answers, has_flag: hasFlag, completed_at: new Date().toISOString() });
    }
    return { error, hasFlag };
  }

  async function toggleFavorite(exerciseId) {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    const isFav = favorites.has(exerciseId);
    // Actualización optimista: se refleja al instante, y se revierte si algo falla.
    setFavorites((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(exerciseId);
      else next.add(exerciseId);
      return next;
    });
    if (isFav) {
      const { error } = await supabase
        .from("user_favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("exercise_id", exerciseId);
      if (error) setFavorites((prev) => new Set(prev).add(exerciseId));
    } else {
      const { error } = await supabase
        .from("user_favorites")
        .insert({ user_id: user.id, exercise_id: exerciseId });
      if (error) {
        setFavorites((prev) => {
          const next = new Set(prev);
          next.delete(exerciseId);
          return next;
        });
      }
    }
  }

  // Cada desplegable calcula sus propias opciones aplicando TODOS los demás
  // filtros activos excepto el suyo propio. Resultado: si seleccionas
  // "Sentadilla" como patrón, el desplegable de músculo deja de mostrar
  // "Deltoides" porque ningún ejercicio real cumple ambas condiciones a la
  // vez. Funciona en cualquier orden en que actives los filtros.
  const categoryOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, bodyRegion, pattern, muscle, equip, level, objective }));
    return unique(subset.map((e) => CATEGORY_NAMES[e.category] || e.category));
  }, [exercises, search, bodyRegion, pattern, muscle, equip, level, objective]);

  const bodyRegionOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, category, pattern, muscle, equip, level, objective }));
    return unique(subset.flatMap((e) => e.body_regions || []));
  }, [exercises, search, category, pattern, muscle, equip, level, objective]);

  const patternOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, category, bodyRegion, muscle, equip, level, objective }));
    return unique(subset.flatMap((e) => e.patterns || []));
  }, [exercises, search, category, bodyRegion, muscle, equip, level, objective]);

  const muscleOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, category, bodyRegion, pattern, equip, level, objective }));
    return unique(subset.flatMap((e) => (e.muscles || []).map((m) => m.name)));
  }, [exercises, search, category, bodyRegion, pattern, equip, level, objective]);

  const equipOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, category, bodyRegion, pattern, muscle, level, objective }));
    return unique(subset.flatMap((e) => (e.equipment || []).map((eq) => eq.name)));
  }, [exercises, search, category, bodyRegion, pattern, muscle, level, objective]);

  const levelOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, category, bodyRegion, pattern, muscle, equip, objective }));
    return unique(subset.map((e) => e.level)).sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b]);
  }, [exercises, search, category, bodyRegion, pattern, muscle, equip, objective]);

  const objectiveOptions = useMemo(() => {
    const subset = exercises.filter((e) => matchesFilters(e, { search, category, bodyRegion, pattern, muscle, equip, level }));
    return unique(subset.flatMap((e) => e.objectives || []));
  }, [exercises, search, category, bodyRegion, pattern, muscle, equip, level]);

  // Si un filtro ya seleccionado deja de ser una opción válida (porque otro
  // filtro cambió y ya no hay ningún ejercicio que cumpla ambos), se trata
  // como "sin seleccionar" tanto visualmente como en el resultado — sin
  // necesidad de que el usuario lo quite a mano.
  const effectiveCategory = categoryOptions.includes(category) ? category : "";
  const effectiveBodyRegion = bodyRegionOptions.includes(bodyRegion) ? bodyRegion : "";
  const effectivePattern = patternOptions.includes(pattern) ? pattern : "";
  const effectiveMuscle = muscleOptions.includes(muscle) ? muscle : "";
  const effectiveEquip = equipOptions.includes(equip) ? equip : "";
  const effectiveLevel = levelOptions.includes(level) ? level : "";
  const effectiveObjective = objectiveOptions.includes(objective) ? objective : "";

  const filtered = useMemo(() => {
    let list = exercises.filter((e) =>
      matchesFilters(e, {
        search,
        category: effectiveCategory,
        bodyRegion: effectiveBodyRegion,
        pattern: effectivePattern,
        muscle: effectiveMuscle,
        equip: effectiveEquip,
        level: effectiveLevel,
        objective: effectiveObjective,
      })
    );

    if (showOnlyFavorites) {
      list = list.filter((e) => favorites.has(e.id));
    }

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
  }, [
    exercises,
    search,
    effectiveCategory,
    effectiveBodyRegion,
    effectivePattern,
    effectiveMuscle,
    effectiveEquip,
    effectiveLevel,
    effectiveObjective,
    sortKey,
    showOnlyFavorites,
    favorites,
  ]);

  // Pequeño "pulso" visual en el contador cada vez que cambia el número de
  // resultados, para que se note que el filtrado ha ocurrido aunque no haya
  // botón de "Aplicar" — el filtrado sigue siendo instantáneo, solo lo hacemos
  // más perceptible.
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 350);
    return () => clearTimeout(t);
  }, [filtered.length]);

  // Filtro y búsqueda para la pestaña de artículos — el tutorial de la app
  // vive fuera de aquí, en su propio botón en la pantalla principal.
  const articleDocuments = useMemo(() => documents.filter((d) => d.category !== "app_guide"), [documents]);
  const tutorialDoc = useMemo(() => documents.find((d) => d.category === "app_guide"), [documents]);

  const docCategoryOptions = useMemo(
    () => unique(articleDocuments.map((d) => DOC_CATEGORY_NAMES[d.category] || d.category)),
    [articleDocuments]
  );

  const filteredDocuments = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    return articleDocuments.filter((d) => {
      const catName = DOC_CATEGORY_NAMES[d.category] || d.category;
      if (docCategory && catName !== docCategory) return false;
      if (q && !(d.title.toLowerCase().includes(q) || (d.summary || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [articleDocuments, docSearch, docCategory]);

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
      <div className="account-bar">
        {!authLoading && (user ? (
          <>
            <span className="account-email">{profile?.full_name || user.email}</span>
            <button className="account-btn" onClick={() => setProfileModalOpen(true)}>
              Editar perfil
              {healthScreening?.has_flag && <span className="health-flag-dot" title="Recomendación de salud pendiente de revisar" />}
            </button>
            <button className="account-btn" onClick={() => signOut()}>Cerrar sesión</button>
          </>
        ) : (
          <button className="account-btn account-btn-primary" onClick={() => setAuthModalOpen(true)}>
            Iniciar sesión
          </button>
        ))}
      </div>

      <header className="hero">
        <div className="eyebrow">Tu biblioteca personal de entrenamiento</div>
        <h1>Biblioteca de ejercicios</h1>
        <p>
          Filtra ejercicios por músculo, patrón de movimiento, equipamiento, nivel y objetivo. Y no te quedes solo
          en la teoría: diseña, guarda y sigue tus propias sesiones de entrenamiento aquí mismo, con los artículos
          de valor para aprender el porqué de cada decisión.
        </p>
        {tutorialDoc && (
          <button className="tutorial-cta" onClick={() => openDocument(tutorialDoc)}>
            📖 ¿Primera vez aquí? Mira la guía rápida de la app
          </button>
        )}
        {!loading && !error && (
          <div className="counter">
            {exercises.length} ejercicios · {documents.length} documentos cargados
          </div>
        )}
        <p className="health-disclaimer">
          Antes de entrenar por tu cuenta, es importante conocer tu estado de salud. Tienes disponible un{" "}
          <button
            className="health-disclaimer-link"
            onClick={() => (user ? setHealthModalOpen(true) : setAuthModalOpen(true))}
          >
            test rápido de prevención
          </button>
          .
        </p>
      </header>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "library" ? "active" : ""}`}
          onClick={() => setActiveTab("library")}
        >
          Biblioteca de ejercicios
        </button>
        <button className={`tab-btn ${activeTab === "docs" ? "active" : ""}`} onClick={() => setActiveTab("docs")}>
          Artículos de valor
        </button>
        <button
          className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
          onClick={() => setActiveTab("sessions")}
        >
          Mis sesiones
        </button>
      </div>

      {loading && <div className="loading-state">Cargando datos desde Supabase…</div>}

      {error && (
        <div className="error-state">
          No se pudieron cargar los datos: {error}
          <br />
          <br />
          Prueba a recargar la página. Si el problema continúa, cierra sesión y vuelve a entrar, o abre la
          aplicación en una ventana privada del navegador.
        </div>
      )}

      {!loading && !error && activeTab === "library" && (
        <>
          <div className="filters">
            <div className="filter-group">
              <label>Buscar</label>
              <input
                type="text"
                placeholder="Nombre, músculo, equipamiento, objetivo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>Tipo</label>
              <select value={effectiveCategory} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Todos</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Parte del cuerpo</label>
              <select value={effectiveBodyRegion} onChange={(e) => setBodyRegion(e.target.value)}>
                <option value="">Todas</option>
                {bodyRegionOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Grupo muscular</label>
              <select value={effectiveMuscle} onChange={(e) => setMuscle(e.target.value)}>
                <option value="">Todos</option>
                {muscleOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Patrón de movimiento</label>
              <select value={effectivePattern} onChange={(e) => setPattern(e.target.value)}>
                <option value="">Todos</option>
                {patternOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Objetivo</label>
              <select value={effectiveObjective} onChange={(e) => setObjective(e.target.value)}>
                <option value="">Todos</option>
                {objectiveOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Equipamiento</label>
              <select value={effectiveEquip} onChange={(e) => setEquip(e.target.value)}>
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
              <select value={effectiveLevel} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Todos</option>
                {levelOptions.map((k) => (
                  <option key={k} value={k}>
                    {LEVEL_NAMES[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="live-filter-note">Los resultados se actualizan al instante con cada filtro. No hace falta pulsar nada.</p>

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
            <label className="fav-toggle">
              <input
                type="checkbox"
                checked={showOnlyFavorites}
                onChange={(e) => {
                  if (!user) {
                    setAuthModalOpen(true);
                    return;
                  }
                  setShowOnlyFavorites(e.target.checked);
                }}
              />
              ★ Solo favoritos
            </label>
          </div>

          <div className={`counter ${pulse ? "counter-pulse" : ""}`} style={{ marginBottom: 12 }}>
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
                  {ex.photo_url && (
                    <img src={ex.photo_url} alt={ex.name} className="card-photo" loading="lazy" />
                  )}
                  <div className="card-top">
                    <h3>{ex.name}</h3>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                      <button
                        className={`fav-star ${favorites.has(ex.id) ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(ex.id);
                        }}
                        aria-label="Marcar como favorito"
                      >
                        {favorites.has(ex.id) ? "★" : "☆"}
                      </button>
                      <span className={`badge ${LEVEL_CLASS[ex.level]}`}>{LEVEL_NAMES[ex.level]}</span>
                    </div>
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
            Contenido formativo para aprender a diseñar tus propias rutinas: teoría y aplicación práctica
            sobre esta misma biblioteca.
          </p>
          <div className="filters" style={{ marginBottom: 18 }}>
            <div className="filter-group">
              <label>Buscar</label>
              <input
                type="text"
                placeholder="Título o resumen…"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
            </div>
            <div className="filter-group">
              <label>Categoría</label>
              <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)}>
                <option value="">Todas</option>
                {docCategoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="docs-list">
            {filteredDocuments.length === 0 && (
              <div className="empty">Ningún documento coincide con esa búsqueda.</div>
            )}
            {filteredDocuments.map((doc) => (
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

      {!loading && !error && activeTab === "sessions" && (
        <SessionsTab user={user} exercises={exercises} onRequestLogin={() => setAuthModalOpen(true)} />
      )}

      {modal && (
        <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          {modal.type === "exercise" && (
            <ExerciseModal
              ex={modal.data}
              onClose={closeModal}
              isFavorite={favorites.has(modal.data.id)}
              onToggleFavorite={() => toggleFavorite(modal.data.id)}
            />
          )}
          {modal.type === "document" && <DocumentModal doc={modal.data} onClose={closeModal} />}
        </div>
      )}

      {authModalOpen && (
        <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && setAuthModalOpen(false)}>
          <AuthModal
            onClose={() => setAuthModalOpen(false)}
            signInWithPassword={signInWithPassword}
            signUpWithPassword={signUpWithPassword}
            signInWithGoogle={signInWithGoogle}
          />
        </div>
      )}

      {profileModalOpen && (
        <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && setProfileModalOpen(false)}>
          <ProfileModal
            profile={profile}
            onClose={() => setProfileModalOpen(false)}
            onSave={saveProfile}
            healthScreening={healthScreening}
            onOpenHealthTest={() => {
              setProfileModalOpen(false);
              setHealthModalOpen(true);
            }}
          />
        </div>
      )}

      {healthModalOpen && (
        <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && setHealthModalOpen(false)}>
          <HealthTestModal
            existing={healthScreening}
            onClose={() => setHealthModalOpen(false)}
            onSave={saveHealthScreening}
          />
        </div>
      )}
    </div>
  );
}

function ExerciseModal({ ex, onClose, isFavorite, onToggleFavorite }) {
  return (
    <div className="modal">
      <button className="close-btn" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <button className={`fav-star fav-star-modal ${isFavorite ? "active" : ""}`} onClick={onToggleFavorite} aria-label="Marcar como favorito">
        {isFavorite ? "★ En favoritos" : "☆ Añadir a favoritos"}
      </button>
      <h2>{ex.name}</h2>
      {ex.photo_url && <img src={ex.photo_url} alt={ex.name} className="modal-photo" />}
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

function AuthModal({ onClose, signInWithPassword, signUpWithPassword, signInWithGoogle }) {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    const { error } =
      mode === "login" ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
    setSubmitting(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (mode === "signup") {
      setInfoMsg("Cuenta creada. Revisa tu email para confirmar la cuenta antes de iniciar sesión.");
      return;
    }
    onClose();
  }

  return (
    <div className="modal auth-modal">
      <button className="close-btn" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <h2>{mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</h2>
      <p className="auth-subtitle">
        {mode === "login"
          ? "Necesario para guardar favoritos y diseñar tus propias sesiones."
          : "Es gratis. La suscripción de pago todavía no está activa."}
      </p>

      <button type="button" className="google-btn" onClick={() => signInWithGoogle()}>
        <span className="google-icon" aria-hidden="true">G</span>
        Continuar con Google
      </button>

      <div className="auth-divider"><span>o con tu email</span></div>

      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {errorMsg && <p className="auth-error">{errorMsg}</p>}
        {infoMsg && <p className="auth-info">{infoMsg}</p>}

        <button type="submit" className="account-btn account-btn-primary" disabled={submitting} style={{ width: "100%" }}>
          {submitting ? "Un momento…" : mode === "login" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>

      <p className="auth-switch">
        {mode === "login" ? (
          <>¿No tienes cuenta? <button type="button" onClick={() => setMode("signup")}>Crear una</button></>
        ) : (
          <>¿Ya tienes cuenta? <button type="button" onClick={() => setMode("login")}>Iniciar sesión</button></>
        )}
      </p>
    </div>
  );
}

function ProfileModal({ profile, onClose, onSave, healthScreening, onOpenHealthTest }) {
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [birthDate, setBirthDate] = useState(profile?.birth_date ?? "");
  const [weight, setWeight] = useState(profile?.weight_kg ?? "");
  const [height, setHeight] = useState(profile?.height_cm ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [savedOk, setSavedOk] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSavedOk(false);
    const error = await onSave({
      full_name: fullName.trim() || null,
      birth_date: birthDate === "" ? null : birthDate,
      weight_kg: weight === "" ? null : Number(weight),
      height_cm: height === "" ? null : Number(height),
    });
    setSaving(false);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setSavedOk(true);
    }
  }

  return (
    <div className="modal auth-modal">
      <button className="close-btn" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <h2>Editar perfil</h2>
      <p className="auth-subtitle">Este nombre es lo único que ven otras personas, nunca tu email.</p>

      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Nombre visible
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Cómo quieres que te llamen" />
        </label>
        <label>
          Fecha de nacimiento
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          {calcAge(birthDate) !== null && (
            <span className="field-hint">{calcAge(birthDate)} años</span>
          )}
        </label>
        <label>
          Peso (kg)
          <input type="number" min="0" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </label>
        <label>
          Estatura (cm)
          <input type="number" min="0" value={height} onChange={(e) => setHeight(e.target.value)} />
        </label>

        {errorMsg && <p className="auth-error">{errorMsg}</p>}
        {savedOk && <p className="auth-info">Perfil actualizado.</p>}

        <button type="submit" className="account-btn account-btn-primary" disabled={saving} style={{ width: "100%" }}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
      </form>

      <div className="health-test-section">
        <div className="section-label" style={{ marginTop: 0 }}>Test de prevención</div>
        {healthScreening ? (
          <p className="auth-subtitle">
            Hecho el {new Date(healthScreening.completed_at).toLocaleDateString("es-ES")}
            {healthScreening.has_flag && <span className="health-flag-text"> · con recomendación pendiente</span>}
          </p>
        ) : (
          <p className="auth-subtitle">Todavía no lo has hecho.</p>
        )}
        <button type="button" className="account-btn" onClick={onOpenHealthTest} style={{ width: "100%" }}>
          {healthScreening ? "Repetir el test" : "Hacer el test"}
        </button>
      </div>
    </div>
  );
}

function HealthTestModal({ existing, onClose, onSave }) {
  const QUESTIONS = [
    ["q1", "¿Un médico te ha diagnosticado alguna afección cardíaca y te ha recomendado limitar la actividad física por ello?"],
    ["q2", "¿Sientes dolor en el pecho al hacer esfuerzo físico o en reposo?"],
    ["q3", "¿Has perdido el conocimiento o el equilibrio de forma brusca en el último año, o sufres mareos frecuentes?"],
    ["q4", "¿Tienes algún problema óseo o articular que ya te haya hecho modificar tu actividad física en el pasado?"],
    ["q5", "¿Tomas actualmente medicación para la tensión arterial o el corazón?"],
    ["q6", "¿Estás embarazada o has dado a luz en las últimas semanas?"],
    ["q7", "¿Conoces alguna otra razón médica por la que deberías evitar hacer ejercicio sin supervisión?"],
  ];

  const [answers, setAnswers] = useState(() => {
    const init = {};
    QUESTIONS.forEach(([key]) => {
      init[key] = existing?.answers?.[key] ?? null;
    });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // null | { hasFlag: bool }

  const allAnswered = QUESTIONS.every(([key]) => answers[key] === true || answers[key] === false);

  async function handleSubmit() {
    setSaving(true);
    const { error, hasFlag } = await onSave(answers);
    setSaving(false);
    if (!error) setResult({ hasFlag });
  }

  if (result) {
    return (
      <div className="modal auth-modal">
        <button className="close-btn" onClick={onClose} aria-label="Cerrar">
          ✕
        </button>
        <h2>Resultado</h2>
        {result.hasFlag ? (
          <p className="health-result-flag">
            Según tus respuestas, te recomendamos consultar con un profesional de la salud antes de continuar
            entrenando por tu cuenta. Esto no bloquea tu acceso a la aplicación: es solo una recomendación.
          </p>
        ) : (
          <p className="auth-info">No se ha detectado ninguna señal de alerta en tus respuestas. Buen entrenamiento.</p>
        )}
        <button className="account-btn account-btn-primary" onClick={onClose} style={{ width: "100%", marginTop: 14 }}>
          Cerrar
        </button>
      </div>
    );
  }

  return (
    <div className="modal auth-modal health-test-modal">
      <button className="close-btn" onClick={onClose} aria-label="Cerrar">
        ✕
      </button>
      <h2>Test de prevención</h2>
      <p className="auth-subtitle">
        Responde con sinceridad. Esto no bloquea tu acceso a la app en ningún caso, solo te orienta sobre si
        conviene consultar con un profesional antes de entrenar por tu cuenta.
      </p>

      <div className="health-questions">
        {QUESTIONS.map(([key, text], i) => (
          <div className="health-question" key={key}>
            <p>{i + 1}. {text}</p>
            <div className="health-question-options">
              <label>
                <input
                  type="radio"
                  name={key}
                  checked={answers[key] === true}
                  onChange={() => setAnswers((prev) => ({ ...prev, [key]: true }))}
                />
                Sí
              </label>
              <label>
                <input
                  type="radio"
                  name={key}
                  checked={answers[key] === false}
                  onChange={() => setAnswers((prev) => ({ ...prev, [key]: false }))}
                />
                No
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        className="account-btn account-btn-primary"
        style={{ width: "100%", marginTop: 14 }}
        disabled={!allAnswered || saving}
        onClick={handleSubmit}
      >
        {saving ? "Guardando…" : "Ver resultado"}
      </button>
    </div>
  );
}
