"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// PANEL DE INICIO ("recibidor")
//
// Primera pantalla que ve una persona con la sesión iniciada. No es un menú
// con cuatro botones: cada bloque lleva un dato real del estado de esa persona,
// para que entrar aquí sirva de algo y no sea un clic de peaje.
//
// Deliberadamente NO se muestra a visitantes sin cuenta: ellos entran directos
// a la biblioteca, que es el escaparate de la plataforma, y no tendría sentido
// recibirlos con bloques de "tus sesiones" y "tu progreso" que no pueden usar.
// ---------------------------------------------------------------------------

function fechaRelativa(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  // Comparamos por día de calendario, no por horas transcurridas: una sesión
  // de ayer por la noche debe decir "ayer", no "hace 10 horas".
  const hoy = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dias = Math.round((b - a) / 86400000);

  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 7) return `hace ${dias} días`;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function plural(n, singular, pluralForma) {
  return n === 1 ? singular : pluralForma;
}

export default function HomeTab({
  user,
  profile,
  exerciseCount,
  favoriteCount,
  articleCount,
  tutorialDoc,
  healthScreening,
  onNavigate,
  onOpenTutorial,
  onOpenHealthTest,
}) {
  const [stats, setStats] = useState(null); // null = aún cargando
  const [statsError, setStatsError] = useState(false);

  // Las sesiones y las sesiones completadas no están cargadas en la pantalla
  // principal (viven dentro de sus propias pestañas), así que el panel hace su
  // propia consulta. Son dos consultas pequeñas y acotadas al usuario.
  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      const [rutinasRes, completadasRes] = await Promise.all([
        supabase.from("routines").select("id").eq("user_id", user.id),
        supabase
          .from("routine_completions")
          .select("completed_at, routines(name)")
          .eq("user_id", user.id)
          .order("completed_at", { ascending: false }),
      ]);

      if (cancelado) return;

      if (rutinasRes.error || completadasRes.error) {
        // El panel no es crítico: si falla, los bloques siguen siendo
        // navegables y simplemente no muestran cifras.
        setStatsError(true);
        setStats({ rutinas: 0, completadasTotal: 0, completadasSemana: 0, ultima: null });
        return;
      }

      const completadas = completadasRes.data || [];
      const hace7dias = Date.now() - 7 * 86400000;

      setStats({
        rutinas: (rutinasRes.data || []).length,
        completadasTotal: completadas.length,
        completadasSemana: completadas.filter((c) => new Date(c.completed_at).getTime() >= hace7dias).length,
        ultima: completadas[0]
          ? { nombre: completadas[0].routines?.name || "Sesión", cuando: fechaRelativa(completadas[0].completed_at) }
          : null,
      });
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [user.id]);

  const nombre = (profile?.full_name || "").trim().split(/\s+/)[0];

  // Mientras no hay cifras todavía mostramos un guion en lugar de un cero, para
  // no afirmar "0 sesiones" a alguien que sí tiene sesiones creadas.
  const cargando = stats === null;
  const dash = "—";

  // Jerarquía de lectura de cada bloque, de más a menos visible:
  //   1. nombre del apartado
  //   2. tu dato (lo que te concierne a ti)
  //   3. dato general o contexto
  // No todos los bloques llenan los tres niveles igual: "Mis sesiones" no tiene
  // cifra general, y "Artículos de valor" no tiene dato personal porque no
  // registramos qué has leído. En ese caso el segundo nivel lo ocupa la cifra
  // general y el tercero pasa a ser una descripción del apartado.
  const bloques = [
    {
      tab: "library",
      titulo: "Biblioteca de ejercicios",
      personal:
        favoriteCount > 0
          ? `${favoriteCount} en favoritos`
          : "Sin favoritos todavía",
      general: `${exerciseCount} ejercicios en total`,
    },
    {
      tab: "sessions",
      titulo: "Mis sesiones",
      personal: cargando
        ? dash
        : stats.rutinas === 0
        ? "Ninguna sesión creada"
        : `${stats.rutinas} ${plural(stats.rutinas, "sesión creada", "sesiones creadas")}`,
      general: cargando
        ? "Consultando tus sesiones"
        : stats.ultima
        ? `Última entrenada: ${stats.ultima.nombre} · ${stats.ultima.cuando}`
        : stats.rutinas === 0
        ? "Diseña la primera o deja que la genere por ti"
        : "Todavía no has entrenado ninguna de ellas",
    },
    {
      tab: "progress",
      titulo: "Mi progreso",
      personal: cargando
        ? dash
        : `${stats.completadasSemana} ${plural(stats.completadasSemana, "sesión", "sesiones")} esta semana`,
      general: cargando
        ? "Consultando tu historial"
        : stats.completadasTotal === 0
        ? "Completa una sesión para ver tu evolución"
        : `${stats.completadasTotal} ${plural(stats.completadasTotal, "sesión completada", "sesiones completadas")} en total`,
    },
    {
      tab: "docs",
      titulo: "Artículos de valor",
      personal: `${articleCount} ${plural(articleCount, "artículo", "artículos")}`,
      general: "Teoría y práctica para diseñar tus propias rutinas",
    },
  ];

  return (
    <div className="home-panel">
      <div className="home-greeting">
        <h2>{nombre ? `Hola, ${nombre}` : "Hola"}</h2>
        <p>¿Por dónde quieres empezar hoy?</p>
      </div>

      <div className="home-grid">
        {bloques.map((b) => (
          <button key={b.tab} className="home-card" onClick={() => onNavigate(b.tab)}>
            <span className="home-card-title">{b.titulo}</span>
            <span className="home-card-personal">{b.personal}</span>
            <span className="home-card-general">{b.general}</span>
            <span className="home-card-arrow" aria-hidden="true">
              →
            </span>
          </button>
        ))}
      </div>

      <div className="home-secondary">
        {tutorialDoc && (
          <button className="home-mini-card" onClick={onOpenTutorial}>
            <span className="home-mini-icon" aria-hidden="true">
              📖
            </span>
            <span>
              <strong>Guía rápida de la app</strong>
              <em>Cómo sacarle partido a todo lo que hay aquí</em>
            </span>
          </button>
        )}

        <button className="home-mini-card" onClick={onOpenHealthTest}>
          <span className="home-mini-icon" aria-hidden="true">
            🩺
          </span>
          <span>
            <strong>
              Test de prevención
              {healthScreening?.has_flag && <span className="health-flag-dot" title="Recomendación pendiente de revisar" />}
            </strong>
            <em>
              {healthScreening?.completed_at
                ? "Ya lo has hecho. Puedes revisarlo cuando quieras"
                : "Conoce tu estado de salud antes de entrenar por tu cuenta"}
            </em>
          </span>
        </button>
      </div>

      {statsError && (
        <p className="home-stats-error">
          No se han podido cargar tus cifras en este momento. Los apartados siguen funcionando con normalidad.
        </p>
      )}
    </div>
  );
}
