"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Fórmula de Epley: estima el peso máximo para una repetición a partir de una
// serie real. Es una estimación ampliamente usada, no una medición exacta.
function estimate1RM(weight, reps) {
  if (!weight || !reps) return null;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function formatDateLong(iso) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Devuelve el lunes de la semana a la que pertenece una fecha.
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayKey(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Gráficas dibujadas a mano en SVG: sin librerías externas, sin dependencias
// nuevas y sin riesgo de romper el build.
// ---------------------------------------------------------------------------

function LineChart({ points, unit = "" }) {
  if (!points || points.length === 0) return null;

  const W = 320;
  const H = 120;
  const PAD_L = 34;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 20;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Un poco de margen arriba y abajo para que la línea no toque los bordes.
  const span = max - min || Math.max(1, max * 0.1);
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;

  const x = (i) =>
    points.length === 1
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + (i * (W - PAD_L - PAD_R)) / (points.length - 1);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const areaPath = `${path} L${x(points.length - 1)},${H - PAD_B} L${x(0)},${H - PAD_B} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Gráfica de progresión">
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="chart-axis" />
      <text x={PAD_L - 5} y={y(max) + 4} className="chart-axis-label" textAnchor="end">
        {round1(max)}
      </text>
      <text x={PAD_L - 5} y={y(min) + 4} className="chart-axis-label" textAnchor="end">
        {round1(min)}
      </text>

      <path d={areaPath} className="chart-area" />
      <path d={path} className="chart-line" />

      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r="3" className="chart-point">
          <title>{`${p.label}: ${round1(p.value)}${unit}`}</title>
        </circle>
      ))}

      <text x={x(0)} y={H - 6} className="chart-axis-label" textAnchor="start">
        {points[0].label}
      </text>
      {points.length > 1 && (
        <text x={x(points.length - 1)} y={H - 6} className="chart-axis-label" textAnchor="end">
          {points[points.length - 1].label}
        </text>
      )}
    </svg>
  );
}

function BarChart({ bars, unit = "" }) {
  if (!bars || bars.length === 0) return null;

  const W = 320;
  const H = 120;
  const PAD_L = 34;
  const PAD_R = 8;
  const PAD_T = 10;
  const PAD_B = 22;

  const max = Math.max(...bars.map((b) => b.value)) || 1;
  const innerW = W - PAD_L - PAD_R;
  const barW = Math.max(3, (innerW / bars.length) * 0.62);
  const step = innerW / bars.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="Gráfica de volumen">
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="chart-axis" />
      <text x={PAD_L - 5} y={PAD_T + 8} className="chart-axis-label" textAnchor="end">
        {round1(max)}
      </text>

      {bars.map((b, i) => {
        const h = (b.value / max) * (H - PAD_T - PAD_B);
        const bx = PAD_L + i * step + (step - barW) / 2;
        return (
          <rect
            key={i}
            x={bx}
            y={H - PAD_B - h}
            width={barW}
            height={Math.max(h, b.value > 0 ? 1.5 : 0)}
            rx="2"
            className={b.highlight ? "chart-bar highlight" : "chart-bar"}
          >
            <title>{`${b.label}: ${round1(b.value)}${unit}`}</title>
          </rect>
        );
      })}

      <text x={PAD_L} y={H - 6} className="chart-axis-label" textAnchor="start">
        {bars[0].label}
      </text>
      {bars.length > 1 && (
        <text x={W - PAD_R} y={H - 6} className="chart-axis-label" textAnchor="end">
          {bars[bars.length - 1].label}
        </text>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export default function ProgressTab({ user, exercises, profile, onRequestLogin, onSaveProfileWeight }) {
  const [logs, setLogs] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [weights, setWeights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      supabase
        .from("exercise_set_logs")
        .select("exercise_id, exercise_name, weight_kg, reps_done, duration_seconds, created_at")
        .eq("user_id", user.id)
        .order("created_at"),
      supabase
        .from("routine_completions")
        .select("id, completed_at")
        .eq("user_id", user.id)
        .order("completed_at"),
      supabase
        .from("body_weight_logs")
        .select("weight_kg, measured_on")
        .eq("user_id", user.id)
        .order("measured_on"),
    ]).then(([logRes, compRes, weightRes]) => {
      if (cancelled) return;
      setLogs(logRes.data || []);
      setCompletions(compRes.data || []);
      setWeights(weightRes.data || []);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // ---- Resumen general ----
  const summary = useMemo(() => {
    const totalSessions = completions.length;
    const dayKeys = new Set(completions.map((c) => dayKey(c.completed_at)));

    const now = new Date();
    const thisWeekStart = startOfWeek(now);
    const sessionsThisWeek = completions.filter((c) => new Date(c.completed_at) >= thisWeekStart).length;

    const last30 = new Date(now);
    last30.setDate(last30.getDate() - 30);
    const sessionsLast30 = completions.filter((c) => new Date(c.completed_at) >= last30).length;

    // Racha: semanas consecutivas hacia atrás con al menos una sesión.
    let streakWeeks = 0;
    let cursor = new Date(thisWeekStart);
    while (true) {
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const has = completions.some((c) => {
        const d = new Date(c.completed_at);
        return d >= cursor && d < weekEnd;
      });
      if (!has) break;
      streakWeeks += 1;
      cursor.setDate(cursor.getDate() - 7);
      if (streakWeeks > 260) break; // tope de seguridad
    }

    const totalVolume = logs.reduce(
      (sum, l) => sum + (l.weight_kg || 0) * (l.reps_done || 0),
      0
    );

    return { totalSessions, uniqueDays: dayKeys.size, sessionsThisWeek, sessionsLast30, streakWeeks, totalVolume };
  }, [completions, logs]);

  // ---- Volumen por semana (últimas 12) ----
  const weeklyVolume = useMemo(() => {
    const weeks = [];
    const thisWeekStart = startOfWeek(new Date());
    for (let i = 11; i >= 0; i--) {
      const start = new Date(thisWeekStart);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      const vol = logs
        .filter((l) => {
          const d = new Date(l.created_at);
          return d >= start && d < end;
        })
        .reduce((sum, l) => sum + (l.weight_kg || 0) * (l.reps_done || 0), 0);
      weeks.push({
        label: start.toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
        value: vol,
        highlight: i === 0,
      });
    }
    return weeks;
  }, [logs]);

  const hasWeeklyVolume = weeklyVolume.some((w) => w.value > 0);

  // ---- Ejercicios con registro, para el selector ----
  const loggedExercises = useMemo(() => {
    const map = new Map();
    for (const l of logs) {
      if (!map.has(l.exercise_id)) map.set(l.exercise_id, l.exercise_name);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [logs]);

  useEffect(() => {
    if (!selectedExerciseId && loggedExercises.length > 0) {
      setSelectedExerciseId(loggedExercises[0].id);
    }
  }, [loggedExercises, selectedExerciseId]);

  // ---- Progresión del ejercicio seleccionado ----
  const exerciseProgress = useMemo(() => {
    if (!selectedExerciseId) return null;
    const mine = logs.filter((l) => l.exercise_id === selectedExerciseId && l.weight_kg != null);
    if (mine.length === 0) return { sessions: [], best: null, bestReps: null, empty: true };

    // Agrupamos por día: nos interesa la mejor serie de cada jornada.
    const byDay = new Map();
    for (const l of mine) {
      const key = dayKey(l.created_at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(l);
    }

    const sessions = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, sets]) => {
        const maxWeight = Math.max(...sets.map((s) => s.weight_kg || 0));
        const best1RM = Math.max(
          ...sets.map((s) => estimate1RM(s.weight_kg, s.reps_done) || 0)
        );
        const volume = sets.reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps_done || 0), 0);
        return { date: key, maxWeight, best1RM, volume, sets };
      });

    const best = mine.reduce((acc, l) => (!acc || l.weight_kg > acc.weight_kg ? l : acc), null);
    const bestReps = mine.reduce(
      (acc, l) => (!acc || (l.reps_done || 0) > (acc.reps_done || 0) ? l : acc),
      null
    );

    return { sessions, best, bestReps, empty: false };
  }, [logs, selectedExerciseId]);

  // ---- Volumen por grupo muscular (últimos 30 días) ----
  const muscleVolume = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const recent = logs.filter((l) => new Date(l.created_at) >= since);
    if (recent.length === 0) return [];

    const totals = {};
    for (const l of recent) {
      const ex = exercises.find((e) => e.id === l.exercise_id);
      if (!ex) continue;
      const vol = (l.weight_kg || 0) * (l.reps_done || 0);
      if (vol === 0) continue;
      // El volumen se reparte según la implicación real de cada músculo, un
      // dato que ya tenemos calculado ficha a ficha.
      const primary = (ex.muscles || []).filter((m) => m.involvement === "primary");
      if (primary.length === 0) continue;
      const share = vol / primary.length;
      for (const m of primary) {
        totals[m.name] = (totals[m.name] || 0) + share;
      }
    }

    const max = Math.max(...Object.values(totals), 1);
    return Object.entries(totals)
      .map(([name, value]) => ({ name, value, pct: (value / max) * 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [logs, exercises]);

  // ---- Datos corporales ----
  const bmi = useMemo(() => {
    const w = weights.length ? weights[weights.length - 1].weight_kg : profile?.weight_kg;
    const h = profile?.height_cm;
    if (!w || !h) return null;
    const m = h / 100;
    return round1(w / (m * m));
  }, [weights, profile]);

  const weightPoints = useMemo(
    () =>
      weights.map((w) => ({
        label: formatDateShort(w.measured_on),
        value: Number(w.weight_kg),
      })),
    [weights]
  );

  async function addWeight() {
    const value = Number(newWeight);
    if (!value || value <= 0) return;
    setSavingWeight(true);
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("body_weight_logs")
      .upsert({ user_id: user.id, weight_kg: value, measured_on: today }, { onConflict: "user_id,measured_on" });
    if (!error) {
      const { data } = await supabase
        .from("body_weight_logs")
        .select("weight_kg, measured_on")
        .eq("user_id", user.id)
        .order("measured_on");
      setWeights(data || []);
      setNewWeight("");
      // Mantenemos el peso del perfil sincronizado con la última medición.
      if (onSaveProfileWeight) onSaveProfileWeight(value);
    }
    setSavingWeight(false);
  }

  // ------------------------------------------------------------------
  if (!user) {
    return (
      <div className="sessions-locked">
        <p>Necesitas una cuenta gratuita para ver tu progresión.</p>
        <button className="account-btn account-btn-primary" onClick={onRequestLogin}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  if (loading) return <div className="loading-state">Cargando tu progresión…</div>;

  const hasAnyLog = logs.length > 0;

  return (
    <div className="progress-tab">
      <p className="docs-intro">
        Tu progresión se construye con las sesiones que registras. Cuantas más anotes, más útil será esta
        pantalla.
      </p>

      {/* ---- Resumen ---- */}
      <div className="section-label">Resumen</div>
      <div className="stat-grid">
        <div className="stat-box">
          <span className="stat-value">{summary.totalSessions}</span>
          <span className="stat-label">sesiones completadas</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{summary.sessionsThisWeek}</span>
          <span className="stat-label">esta semana</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{summary.sessionsLast30}</span>
          <span className="stat-label">últimos 30 días</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{summary.streakWeeks}</span>
          <span className="stat-label">
            {summary.streakWeeks === 1 ? "semana seguida" : "semanas seguidas"}
          </span>
        </div>
      </div>

      {!hasAnyLog && (
        <div className="progress-empty">
          Todavía no has registrado ninguna serie. Al entrenar una sesión, elige{" "}
          <strong>“Sí, registrar mi entrenamiento”</strong> y aquí empezarás a ver tu progresión.
        </div>
      )}

      {/* ---- Volumen semanal ---- */}
      {hasWeeklyVolume && (
        <>
          <div className="section-label">Volumen por semana</div>
          <div className="chart-card">
            <BarChart bars={weeklyVolume} unit=" kg" />
            <div className="chart-caption">
              Kilos totales movidos por semana (peso × repeticiones), últimas 12 semanas. La última barra es la
              semana en curso.
            </div>
          </div>
        </>
      )}

      {/* ---- Progresión por ejercicio ---- */}
      {loggedExercises.length > 0 && (
        <>
          <div className="section-label">Progresión por ejercicio</div>
          <div className="chart-card">
            <div className="filter-group" style={{ marginBottom: 14 }}>
              <label>Ejercicio</label>
              <select value={selectedExerciseId} onChange={(e) => setSelectedExerciseId(e.target.value)}>
                {loggedExercises.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </div>

            {exerciseProgress && !exerciseProgress.empty && (
              <>
                <div className="pr-row">
                  <div className="pr-box">
                    <span className="pr-value">{round1(exerciseProgress.best.weight_kg)} kg</span>
                    <span className="pr-label">
                      mejor peso · {exerciseProgress.best.reps_done ?? "?"} rep
                    </span>
                  </div>
                  <div className="pr-box">
                    <span className="pr-value">
                      {round1(
                        estimate1RM(exerciseProgress.best.weight_kg, exerciseProgress.best.reps_done) || 0
                      )}{" "}
                      kg
                    </span>
                    <span className="pr-label">1RM estimado</span>
                  </div>
                </div>

                {exerciseProgress.sessions.length > 1 ? (
                  <>
                    <LineChart
                      points={exerciseProgress.sessions.map((s) => ({
                        label: formatDateShort(s.date),
                        value: s.best1RM,
                      }))}
                      unit=" kg"
                    />
                    <div className="chart-caption">
                      Evolución de tu 1RM estimado. Es una estimación a partir de tus series reales (fórmula de
                      Epley), no una medición directa.
                    </div>
                  </>
                ) : (
                  <div className="chart-caption">
                    Necesitas al menos dos días registrados con este ejercicio para ver la gráfica de evolución.
                  </div>
                )}

                <div className="exercise-history">
                  {[...exerciseProgress.sessions].reverse().slice(0, 8).map((s) => (
                    <div className="exercise-history-row" key={s.date}>
                      <span className="exercise-history-date">{formatDateLong(s.date)}</span>
                      <span className="exercise-history-sets">
                        {s.sets
                          .map((x) => `${round1(x.weight_kg)}×${x.reps_done ?? "?"}`)
                          .join(" · ")}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {exerciseProgress && exerciseProgress.empty && (
              <div className="chart-caption">
                Este ejercicio tiene registros, pero sin peso anotado (por ejemplo, de peso corporal o por
                tiempo), así que no puede representarse en kilos.
              </div>
            )}
          </div>
        </>
      )}

      {/* ---- Reparto por grupo muscular ---- */}
      {muscleVolume.length > 0 && (
        <>
          <div className="section-label">Reparto por músculo (últimos 30 días)</div>
          <div className="chart-card">
            {muscleVolume.map((m) => (
              <div className="muscle-vol-row" key={m.name}>
                <span className="muscle-vol-name">{m.name}</span>
                <span className="muscle-vol-bar">
                  <span className="muscle-vol-fill" style={{ width: `${m.pct}%` }} />
                </span>
                <span className="muscle-vol-value">{Math.round(m.value)} kg</span>
              </div>
            ))}
            <div className="chart-caption">
              Volumen repartido según la implicación principal de cada ejercicio. Sirve para detectar
              desequilibrios, no como medida exacta.
            </div>
          </div>
        </>
      )}

      {/* ---- Datos corporales ---- */}
      <div className="section-label">Datos corporales</div>
      <div className="chart-card">
        <div className="body-row">
          <div className="filter-group" style={{ flex: "1 1 140px" }}>
            <label>Anotar peso de hoy (kg)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={newWeight}
              onChange={(e) => setNewWeight(e.target.value)}
              placeholder="72.5"
            />
          </div>
          <button
            className="account-btn account-btn-primary"
            onClick={addWeight}
            disabled={savingWeight || !newWeight}
            style={{ alignSelf: "flex-end" }}
          >
            {savingWeight ? "Guardando…" : "Guardar"}
          </button>
        </div>

        {bmi !== null && (
          <div className="bmi-row">
            <span className="bmi-value">{bmi}</span>
            <span className="bmi-label">
              IMC actual, calculado con tu último peso y tu estatura. Es un indicador poblacional orientativo:
              no distingue entre músculo y grasa, así que en personas musculadas puede salir alto sin que
              signifique nada preocupante.
            </span>
          </div>
        )}

        {bmi === null && (
          <div className="chart-caption">
            Añade tu estatura en “Editar perfil” y anota tu peso aquí para calcular tu IMC.
          </div>
        )}

        {weightPoints.length > 1 && (
          <>
            <LineChart points={weightPoints} unit=" kg" />
            <div className="chart-caption">Evolución de tu peso corporal.</div>
          </>
        )}
        {weightPoints.length === 1 && (
          <div className="chart-caption">
            Tienes una medición registrada. Anota alguna más para ver la evolución.
          </div>
        )}
      </div>
    </div>
  );
}
