"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const LEVEL_NAMES = { beginner: "Principiante", intermediate: "Intermedio", advanced: "Avanzado" };

const CATEGORY_NAMES = {
  strength: "Fuerza",
  stretch_dynamic: "Estiramiento dinámico",
  stretch_static_active: "Estiramiento activo",
  stretch_static_passive: "Estiramiento pasivo",
  conditioning: "Acondicionamiento",
};

// Misma lógica de coincidencia que la biblioteca, para que el diseñador se
// comporte exactamente igual que la pestaña principal.
function matchesPickerFilters(e, f) {
  const catName = CATEGORY_NAMES[e.category] || e.category;
  if (f.search && !e.name.toLowerCase().includes(f.search.trim().toLowerCase())) return false;
  if (f.category && catName !== f.category) return false;
  if (f.bodyRegion && !(e.body_regions || []).includes(f.bodyRegion)) return false;
  if (f.muscle && !(e.muscles || []).some((m) => m.name === f.muscle)) return false;
  if (f.pattern && !(e.patterns || []).includes(f.pattern)) return false;
  if (f.objective && !(e.objectives || []).includes(f.objective)) return false;
  if (f.equip && !(e.equipment || []).some((eq) => eq.name === f.equip)) return false;
  if (f.level && e.level !== f.level) return false;
  return true;
}

function unique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b, "es"));
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

let tempIdCounter = 0;
function newTempId() {
  tempIdCounter += 1;
  return `tmp-${tempIdCounter}`;
}

// Extrae un número orientativo de un texto de repeticiones ("8-12" -> 8).
// Se usa solo para pre-rellenar; el usuario siempre puede corregirlo.
function parseRepsHint(reps) {
  if (!reps) return "";
  const m = String(reps).match(/\d+/);
  return m ? m[0] : "";
}

function estimateItemSeconds(item) {
  if (item.mode === "time") return Number(item.duration_seconds) || 30;
  return 40;
}

function buildRenderGroups(items) {
  const groups = [];
  const seen = new Set();
  for (const item of items) {
    if (item.superset_group != null) {
      if (seen.has(item.superset_group)) continue;
      seen.add(item.superset_group);
      groups.push({
        type: "group",
        groupId: item.superset_group,
        items: items.filter((i) => i.superset_group === item.superset_group),
      });
    } else {
      groups.push({ type: "single", item });
    }
  }
  return groups;
}

function estimateTotalMinutes(items) {
  const groups = buildRenderGroups(items);
  let totalSeconds = 0;
  for (const g of groups) {
    if (g.type === "single") {
      const rounds = Number(g.item.sets) || 1;
      totalSeconds +=
        rounds * estimateItemSeconds(g.item) + Math.max(0, rounds - 1) * (Number(g.item.rest_seconds) || 0);
    } else {
      const rounds = Number(g.items[0].sets) || 1;
      const perRound = g.items.reduce((sum, it) => sum + estimateItemSeconds(it), 0);
      const restAfterRound = Number(g.items[g.items.length - 1].rest_seconds) || 0;
      totalSeconds += rounds * perRound + Math.max(0, rounds - 1) * restAfterRound;
    }
  }
  return Math.round(totalSeconds / 60);
}

export default function SessionsTab({ user, exercises, onRequestLogin }) {
  const [view, setView] = useState("list"); // 'list' | 'builder' | 'detail' | 'training'
  const [routines, setRoutines] = useState([]);
  const [routinesLoading, setRoutinesLoading] = useState(false);
  const [detailRoutine, setDetailRoutine] = useState(null);

  // ---- Constructor ----
  const [editingRoutineId, setEditingRoutineId] = useState(null);
  const [builderName, setBuilderName] = useState("");
  const [targetDuration, setTargetDuration] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fBodyRegion, setFBodyRegion] = useState("");
  const [fPattern, setFPattern] = useState("");
  const [fMuscle, setFMuscle] = useState("");
  const [fEquip, setFEquip] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [fObjective, setFObjective] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [items, setItems] = useState([]);
  const [selectedForGroup, setSelectedForGroup] = useState(new Set());
  const [peekKey, setPeekKey] = useState(null); // qué ejercicio tiene la info desplegada
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ---- Modo entrenamiento ----
  const [trainingRoutine, setTrainingRoutine] = useState(null);
  const [trainingLog, setTrainingLog] = useState([]); // [{exerciseId, name, mode, sets:[{weight,reps,duration,done}], lastTime}]
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [trainingError, setTrainingError] = useState(null);

  useEffect(() => {
    if (!user || view !== "list") return;
    setRoutinesLoading(true);
    supabase
      .from("routines")
      .select("*, routine_exercises(*), routine_completions(id, completed_at)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setRoutines(data || []);
        setRoutinesLoading(false);
      });
  }, [user, view]);

  // Cada desplegable calcula sus opciones aplicando todos los demás filtros
  // activos menos el suyo, igual que en la biblioteca.
  const baseF = { search: fSearch, category: fCategory, bodyRegion: fBodyRegion, pattern: fPattern, muscle: fMuscle, equip: fEquip, level: fLevel, objective: fObjective };

  const categoryOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, category: "" }));
    return unique(sub.map((e) => CATEGORY_NAMES[e.category] || e.category));
  }, [exercises, fSearch, fBodyRegion, fPattern, fMuscle, fEquip, fLevel, fObjective]);

  const bodyRegionOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, bodyRegion: "" }));
    return unique(sub.flatMap((e) => e.body_regions || []));
  }, [exercises, fSearch, fCategory, fPattern, fMuscle, fEquip, fLevel, fObjective]);

  const muscleOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, muscle: "" }));
    return unique(sub.flatMap((e) => (e.muscles || []).map((m) => m.name)));
  }, [exercises, fSearch, fCategory, fBodyRegion, fPattern, fEquip, fLevel, fObjective]);

  const patternOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, pattern: "" }));
    return unique(sub.flatMap((e) => e.patterns || []));
  }, [exercises, fSearch, fCategory, fBodyRegion, fMuscle, fEquip, fLevel, fObjective]);

  const objectiveOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, objective: "" }));
    return unique(sub.flatMap((e) => e.objectives || []));
  }, [exercises, fSearch, fCategory, fBodyRegion, fPattern, fMuscle, fEquip, fLevel]);

  const equipOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, equip: "" }));
    return unique(sub.flatMap((e) => (e.equipment || []).map((eq) => eq.name)));
  }, [exercises, fSearch, fCategory, fBodyRegion, fPattern, fMuscle, fLevel, fObjective]);

  const levelOptions = useMemo(() => {
    const sub = exercises.filter((e) => matchesPickerFilters(e, { ...baseF, level: "" }));
    return unique(sub.map((e) => e.level));
  }, [exercises, fSearch, fCategory, fBodyRegion, fPattern, fMuscle, fEquip, fObjective]);

  const filteredExercises = useMemo(
    () => exercises.filter((e) => matchesPickerFilters(e, baseF)),
    [exercises, fSearch, fCategory, fBodyRegion, fPattern, fMuscle, fEquip, fLevel, fObjective]
  );

  const hasActivePickerFilter = Boolean(
    fSearch.trim() || fCategory || fBodyRegion || fPattern || fMuscle || fEquip || fLevel || fObjective
  );

  function togglePeek(key) {
    setPeekKey((prev) => (prev === key ? null : key));
  }

  function resetBuilderFilters() {
    setFCategory("");
    setFBodyRegion("");
    setFPattern("");
    setFMuscle("");
    setFEquip("");
    setFLevel("");
    setFObjective("");
    setFSearch("");
  }

  function startNewSession() {
    setEditingRoutineId(null);
    setBuilderName("");
    setTargetDuration("");
    resetBuilderFilters();
    setItems([]);
    setSelectedForGroup(new Set());
    setSaveError(null);
    setView("builder");
  }

  // Carga una sesión ya guardada dentro del constructor para poder modificarla.
  function startEditSession(routine) {
    setEditingRoutineId(routine.id);
    setBuilderName(routine.name || "");
    setTargetDuration(routine.target_duration_minutes ?? "");
    resetBuilderFilters();
    setSelectedForGroup(new Set());
    setSaveError(null);

    const loaded = [...(routine.routine_exercises || [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((ri) => {
        const ex = exercises.find((e) => e.id === ri.exercise_id) || { id: ri.exercise_id, name: "Ejercicio" };
        return {
          tempId: newTempId(),
          exercise: ex,
          mode: ri.duration_seconds != null ? "time" : "reps",
          sets: ri.sets ?? 3,
          reps: ri.reps ?? "10",
          duration_seconds: ri.duration_seconds ?? 30,
          rest_seconds: ri.rest_seconds ?? 60,
          load_note: ri.load_note ?? "",
          notes: ri.notes ?? "",
          superset_group: ri.superset_group,
        };
      });
    setItems(loaded);
    setView("builder");
  }

  function addExercise(ex) {
    setItems((prev) => [
      ...prev,
      {
        tempId: newTempId(),
        exercise: ex,
        mode: "reps",
        sets: 3,
        reps: "10",
        duration_seconds: 30,
        rest_seconds: 60,
        load_note: "",
        notes: "",
        superset_group: null,
      },
    ]);
  }

  function removeItem(tempId) {
    setItems((prev) => prev.filter((i) => i.tempId !== tempId));
    setSelectedForGroup((prev) => {
      const next = new Set(prev);
      next.delete(tempId);
      return next;
    });
  }

  function moveItem(index, direction) {
    setItems((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateItem(tempId, field, value) {
    setItems((prev) => prev.map((i) => (i.tempId === tempId ? { ...i, [field]: value } : i)));
  }

  function toggleSelectForGroup(tempId) {
    setSelectedForGroup((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }

  function groupSelected() {
    if (selectedForGroup.size < 2) return;
    const existingGroupIds = items.map((i) => i.superset_group).filter((g) => g != null);
    const nextGroupId = existingGroupIds.length ? Math.max(...existingGroupIds) + 1 : 1;
    const referenceSets = items.find((x) => selectedForGroup.has(x.tempId))?.sets ?? 3;
    setItems((prev) =>
      prev.map((i) =>
        selectedForGroup.has(i.tempId) ? { ...i, superset_group: nextGroupId, sets: referenceSets } : i
      )
    );
    setSelectedForGroup(new Set());
  }

  function ungroup(groupId) {
    setItems((prev) => prev.map((i) => (i.superset_group === groupId ? { ...i, superset_group: null } : i)));
  }

  function setGroupRounds(groupId, value) {
    setItems((prev) => prev.map((i) => (i.superset_group === groupId ? { ...i, sets: value } : i)));
  }

  function setGroupRest(groupId, value) {
    setItems((prev) => {
      const groupItems = prev.filter((i) => i.superset_group === groupId);
      const lastId = groupItems[groupItems.length - 1]?.tempId;
      return prev.map((i) => (i.tempId === lastId ? { ...i, rest_seconds: value } : i));
    });
  }

  async function saveRoutine() {
    if (!builderName.trim() || items.length === 0) return;
    setSaving(true);
    setSaveError(null);

    try {
      let routineId = editingRoutineId;

      if (editingRoutineId) {
        const { error: updErr } = await supabase
          .from("routines")
          .update({
            name: builderName.trim(),
            target_duration_minutes: targetDuration ? Number(targetDuration) : null,
          })
          .eq("id", editingRoutineId);
        if (updErr) throw updErr;

        // Se reemplazan los ejercicios por completo: más simple y fiable que
        // intentar reconciliar altas, bajas y reordenaciones una a una.
        const { error: delErr } = await supabase
          .from("routine_exercises")
          .delete()
          .eq("routine_id", editingRoutineId);
        if (delErr) throw delErr;
      } else {
        const { data: routine, error: routineError } = await supabase
          .from("routines")
          .insert({
            user_id: user.id,
            name: builderName.trim(),
            target_duration_minutes: targetDuration ? Number(targetDuration) : null,
            design_filters: {
              patterns: fPattern,
              muscle: fMuscle,
              equipment: fEquip,
              level: fLevel,
              objective: fObjective,
            },
          })
          .select()
          .single();
        if (routineError) throw routineError;
        routineId = routine.id;
      }

      const rows = items.map((item, index) => ({
        routine_id: routineId,
        exercise_id: item.exercise.id,
        order_index: index,
        sets: item.sets ? Number(item.sets) : null,
        reps: item.mode === "reps" ? item.reps : null,
        duration_seconds: item.mode === "time" ? Number(item.duration_seconds) : null,
        rest_seconds: item.rest_seconds ? Number(item.rest_seconds) : null,
        load_note: item.load_note || null,
        notes: item.notes || null,
        superset_group: item.superset_group,
      }));

      const { error: itemsError } = await supabase.from("routine_exercises").insert(rows);
      if (itemsError) throw itemsError;

      setSaving(false);
      setEditingRoutineId(null);
      setView("list");
    } catch (err) {
      setSaveError(err?.message || "No se pudo guardar la sesión. Inténtalo de nuevo.");
      setSaving(false);
    }
  }

  async function deleteRoutine(id) {
    await supabase.from("routines").delete().eq("id", id);
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }

  async function undoCompletion(completionId, routineId) {
    await supabase.from("routine_completions").delete().eq("id", completionId);
    const updateWith = (r) =>
      r.id === routineId
        ? { ...r, routine_completions: (r.routine_completions || []).filter((c) => c.id !== completionId) }
        : r;
    setRoutines((prev) => prev.map(updateWith));
    setDetailRoutine((prev) => (prev && prev.id === routineId ? updateWith(prev) : prev));
  }

  function openDetail(routine) {
    setDetailRoutine(routine);
    setView("detail");
  }

  // ------------------------------------------------------------------
  // MODO ENTRENAMIENTO
  // ------------------------------------------------------------------
  async function startTraining(routine) {
    setTrainingRoutine(routine);
    setTrainingError(null);
    setTrainingLoading(true);
    setView("training");

    const ordered = [...(routine.routine_exercises || [])].sort((a, b) => a.order_index - b.order_index);
    const exerciseIds = ordered.map((ri) => ri.exercise_id);

    // Trae los registros previos del usuario para estos ejercicios, para
    // pre-rellenar con lo que hizo la última vez.
    let lastByExercise = {};
    if (exerciseIds.length) {
      const { data: previous } = await supabase
        .from("exercise_set_logs")
        .select("exercise_id, set_number, weight_kg, reps_done, duration_seconds, created_at")
        .eq("user_id", user.id)
        .in("exercise_id", exerciseIds)
        .order("created_at", { ascending: false })
        .limit(400);

      if (previous) {
        for (const log of previous) {
          if (!lastByExercise[log.exercise_id]) lastByExercise[log.exercise_id] = [];
          // Solo nos quedamos con la tanda más reciente de cada ejercicio.
          const bucket = lastByExercise[log.exercise_id];
          const newestDate = bucket.length ? bucket[0].created_at : log.created_at;
          if (log.created_at === newestDate) bucket.push(log);
        }
      }
    }

    const built = ordered.map((ri) => {
      const ex = exercises.find((e) => e.id === ri.exercise_id);
      const name = ex?.name || "Ejercicio";
      const mode = ri.duration_seconds != null ? "time" : "reps";
      const numSets = Math.max(1, Number(ri.sets) || 1);
      const prev = (lastByExercise[ri.exercise_id] || []).sort((a, b) => a.set_number - b.set_number);

      const sets = Array.from({ length: numSets }, (_, i) => {
        const p = prev[i];
        return {
          weight: p?.weight_kg != null ? String(p.weight_kg) : "",
          reps: p?.reps_done != null ? String(p.reps_done) : parseRepsHint(ri.reps),
          duration: p?.duration_seconds != null ? String(p.duration_seconds) : String(ri.duration_seconds ?? 30),
          done: false,
        };
      });

      let lastTimeLabel = null;
      if (prev.length) {
        const p = prev[0];
        if (mode === "time") {
          lastTimeLabel = `Última vez: ${p.duration_seconds ?? "?"}s`;
        } else {
          const w = p.weight_kg != null ? `${p.weight_kg} kg × ` : "";
          lastTimeLabel = `Última vez: ${w}${p.reps_done ?? "?"} rep`;
        }
      }

      return {
        exerciseId: ri.exercise_id,
        name,
        mode,
        prescription: mode === "time" ? `${ri.sets ?? 1} × ${ri.duration_seconds}s` : `${ri.sets ?? 1} × ${ri.reps ?? "-"}`,
        loadNote: ri.load_note,
        supersetGroup: ri.superset_group,
        sets,
        lastTimeLabel,
      };
    });

    setTrainingLog(built);
    setTrainingLoading(false);
  }

  function updateSet(exerciseIndex, setIndex, field, value) {
    setTrainingLog((prev) =>
      prev.map((item, i) => {
        if (i !== exerciseIndex) return item;
        const sets = item.sets.map((s, j) => (j === setIndex ? { ...s, [field]: value } : s));
        return { ...item, sets };
      })
    );
  }

  function toggleSetDone(exerciseIndex, setIndex) {
    setTrainingLog((prev) =>
      prev.map((item, i) => {
        if (i !== exerciseIndex) return item;
        const sets = item.sets.map((s, j) => (j === setIndex ? { ...s, done: !s.done } : s));
        return { ...item, sets };
      })
    );
  }

  const completedSetsCount = useMemo(
    () => trainingLog.reduce((sum, it) => sum + it.sets.filter((s) => s.done).length, 0),
    [trainingLog]
  );
  const totalSetsCount = useMemo(
    () => trainingLog.reduce((sum, it) => sum + it.sets.length, 0),
    [trainingLog]
  );

  async function finishTraining() {
    setFinishing(true);
    setTrainingError(null);
    try {
      const { data: completion, error: compErr } = await supabase
        .from("routine_completions")
        .insert({ routine_id: trainingRoutine.id, user_id: user.id })
        .select()
        .single();
      if (compErr) throw compErr;

      const rows = [];
      trainingLog.forEach((item) => {
        item.sets.forEach((s, idx) => {
          if (!s.done) return; // solo se guardan las series marcadas como hechas
          rows.push({
            completion_id: completion.id,
            user_id: user.id,
            exercise_id: item.exerciseId,
            exercise_name: item.name,
            set_number: idx + 1,
            weight_kg: s.weight === "" ? null : Number(s.weight),
            reps_done: item.mode === "reps" && s.reps !== "" ? Number(s.reps) : null,
            duration_seconds: item.mode === "time" && s.duration !== "" ? Number(s.duration) : null,
          });
        });
      });

      if (rows.length) {
        const { error: logErr } = await supabase.from("exercise_set_logs").insert(rows);
        if (logErr) throw logErr;
      }

      setFinishing(false);
      setTrainingRoutine(null);
      setTrainingLog([]);
      setView("list");
    } catch (err) {
      setTrainingError(err?.message || "No se pudo guardar el entrenamiento.");
      setFinishing(false);
    }
  }

  // ------------------------------------------------------------------
  if (!user) {
    return (
      <div className="sessions-locked">
        <p>Necesitas una cuenta gratuita para diseñar y guardar tus propias sesiones.</p>
        <button className="account-btn account-btn-primary" onClick={onRequestLogin}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  // ---------------- VISTA: MODO ENTRENAMIENTO ----------------
  if (view === "training" && trainingRoutine) {
    return (
      <div className="training-view">
        <button className="account-btn" onClick={() => setView("list")}>← Salir sin guardar</button>
        <h2 className="session-detail-title">{trainingRoutine.name}</h2>
        <div className="session-date">Entrenando · {formatDate(new Date().toISOString())}</div>

        {trainingLoading && <div className="loading-state">Preparando tu sesión…</div>}

        {!trainingLoading && (
          <>
            <div className="training-progress">
              {completedSetsCount} de {totalSetsCount} series completadas
            </div>

            <div className="training-list">
              {trainingLog.map((item, exIdx) => (
                <div className={`training-exercise ${item.supersetGroup != null ? "in-circuit" : ""}`} key={item.exerciseId + exIdx}>
                  <div className="training-exercise-head">
                    <span className="session-item-name">{item.name}</span>
                    {item.supersetGroup != null && <span className="circuit-chip">Circuito</span>}
                  </div>
                  <div className="training-prescription">
                    Plan: {item.prescription}
                    {item.loadNote ? ` · ${item.loadNote}` : ""}
                  </div>
                  {item.lastTimeLabel && <div className="training-lasttime">{item.lastTimeLabel}</div>}

                  <div className="training-sets">
                    {item.sets.map((s, setIdx) => (
                      <div className={`training-set-row ${s.done ? "done" : ""}`} key={setIdx}>
                        <span className="set-label">{setIdx + 1}</span>
                        {item.mode === "reps" ? (
                          <>
                            <input
                              type="number"
                              inputMode="decimal"
                              placeholder="kg"
                              value={s.weight}
                              onChange={(e) => updateSet(exIdx, setIdx, "weight", e.target.value)}
                            />
                            <span className="set-x">×</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              placeholder="rep"
                              value={s.reps}
                              onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                            />
                          </>
                        ) : (
                          <>
                            <input
                              type="number"
                              inputMode="numeric"
                              placeholder="seg"
                              value={s.duration}
                              onChange={(e) => updateSet(exIdx, setIdx, "duration", e.target.value)}
                            />
                            <span className="set-x">seg</span>
                          </>
                        )}
                        <button
                          className={`set-done-btn ${s.done ? "active" : ""}`}
                          onClick={() => toggleSetDone(exIdx, setIdx)}
                          aria-label="Marcar serie como hecha"
                        >
                          ✓
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {trainingError && <p className="auth-error">{trainingError}</p>}

            <button
              className="account-btn account-btn-primary"
              style={{ marginTop: 20, width: "100%" }}
              disabled={finishing}
              onClick={finishTraining}
            >
              {finishing ? "Guardando…" : "Terminar y guardar sesión"}
            </button>
            <p className="training-hint">
              Solo se guardan las series que hayas marcado con ✓. La próxima vez aparecerán ya rellenadas con
              estos valores.
            </p>
          </>
        )}
      </div>
    );
  }

  // ---------------- VISTA: DETALLE ----------------
  if (view === "detail" && detailRoutine) {
    const detailItems = [...(detailRoutine.routine_exercises || [])].sort(
      (a, b) => a.order_index - b.order_index
    );
    const renderGroups = buildRenderGroups(
      detailItems.map((ri) => ({
        ...ri,
        exercise: exercises.find((e) => e.id === ri.exercise_id) || { name: "Ejercicio", level: "beginner" },
      }))
    );

    return (
      <div className="sessions-detail">
        <button className="account-btn" onClick={() => setView("list")}>← Volver a mis sesiones</button>
        <h2 className="session-detail-title">{detailRoutine.name}</h2>
        <div className="session-date">Creada el {formatDate(detailRoutine.created_at)}</div>
        {detailRoutine.target_duration_minutes && (
          <p className="docs-intro">Duración prevista: {detailRoutine.target_duration_minutes} min</p>
        )}

        <div className="detail-actions">
          <button className="account-btn account-btn-primary" onClick={() => startTraining(detailRoutine)}>
            ▶ Entrenar ahora
          </button>
          <button className="account-btn" onClick={() => startEditSession(detailRoutine)}>
            Editar sesión
          </button>
        </div>

        {(detailRoutine.routine_completions || []).length > 0 && (
          <div className="completion-history">
            <div className="section-label" style={{ marginTop: 0 }}>Historial de veces realizada</div>
            {[...detailRoutine.routine_completions]
              .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
              .map((c) => (
                <CompletionRow
                  key={c.id}
                  completion={c}
                  onUndo={() => undoCompletion(c.id, detailRoutine.id)}
                />
              ))}
          </div>
        )}

        <div className="section-label">Ejercicios de la sesión</div>
        <div className="session-detail-list">
          {renderGroups.map((g, i) =>
            g.type === "single" ? (
              <div className="session-item-card" key={g.item.id || i}>
                <button
                  className="exercise-peek-name session-item-name"
                  onClick={() => togglePeek(`det-${g.item.id || i}`)}
                >
                  {g.item.exercise.name}
                  <span className="peek-caret">{peekKey === `det-${g.item.id || i}` ? "▾" : "▸"}</span>
                </button>
                <div className="session-item-prescription">
                  {g.item.sets} × {g.item.reps || `${g.item.duration_seconds}s`}
                  {g.item.rest_seconds ? ` · descanso ${g.item.rest_seconds}s` : ""}
                  {g.item.load_note ? ` · ${g.item.load_note}` : ""}
                </div>
                {g.item.notes && <div className="session-item-notes">{g.item.notes}</div>}
                {peekKey === `det-${g.item.id || i}` && <ExercisePeek exercise={g.item.exercise} />}
              </div>
            ) : (
              <div className="session-group-card" key={`g-${g.groupId}`}>
                <div className="session-group-label">Circuito · {g.items[0].sets} rondas</div>
                {g.items.map((it) => (
                  <div className="session-item-card session-item-in-group" key={it.id}>
                    <div className="session-item-name">{it.exercise.name}</div>
                    <div className="session-item-prescription">
                      {it.reps || `${it.duration_seconds}s`}
                      {it.load_note ? ` · ${it.load_note}` : ""}
                    </div>
                  </div>
                ))}
                <div className="session-item-prescription" style={{ marginTop: 6 }}>
                  Descanso entre rondas: {g.items[g.items.length - 1].rest_seconds || 0}s
                </div>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // ---------------- VISTA: LISTA ----------------
  if (view === "list") {
    return (
      <div className="sessions-list-view">
        <p className="docs-intro">
          Diseña tus propias sesiones eligiendo ejercicios de la biblioteca, entrénalas y registra lo que haces.
        </p>

        <SessionCalendar
          routines={routines}
          onOpenRoutine={(routineId) => {
            const r = routines.find((x) => x.id === routineId);
            if (r) openDetail(r);
          }}
        />

        <button className="account-btn account-btn-primary" onClick={startNewSession} style={{ marginBottom: 18 }}>
          + Nueva sesión
        </button>
        {routinesLoading && <div className="loading-state">Cargando tus sesiones…</div>}
        {!routinesLoading && routines.length === 0 && (
          <div className="empty">Todavía no has guardado ninguna sesión.</div>
        )}
        <div className="docs-list">
          {routines.map((r) => {
            const completions = r.routine_completions || [];
            const last = completions.length
              ? [...completions].sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0]
              : null;
            return (
              <div className="doc-card" key={r.id} onClick={() => openDetail(r)} tabIndex={0}>
                <div className="doc-card-top">
                  <h3>{r.name}</h3>
                  <div className="doc-meta">
                    <button
                      className="account-btn account-btn-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        startTraining(r);
                      }}
                    >
                      ▶ Entrenar
                    </button>
                    <button
                      className="account-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditSession(r);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      className="account-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRoutine(r.id);
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                <p>
                  {(r.routine_exercises || []).length} ejercicios
                  {r.target_duration_minutes ? ` · ~${r.target_duration_minutes} min previstos` : ""}
                </p>
                <div className="session-date">
                  Creada el {formatDate(r.created_at)}
                  {last ? (
                    <> · ✓ Última vez: {formatDate(last.completed_at)} · hecha {completions.length}{" "}
                      {completions.length === 1 ? "vez" : "veces"}</>
                  ) : (
                    <> · aún no realizada</>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------- VISTA: CONSTRUCTOR ----------------
  const estimatedMinutes = estimateTotalMinutes(items);
  const renderGroups = buildRenderGroups(items);

  return (
    <div className="session-builder">
      <button
        className="account-btn"
        onClick={() => {
          setEditingRoutineId(null);
          setView("list");
        }}
      >
        ← Cancelar
      </button>

      {editingRoutineId && <div className="editing-banner">Estás editando una sesión ya guardada</div>}

      <div className="filters" style={{ marginTop: 14 }}>
        <div className="filter-group">
          <label>
            Nombre de la sesión <span className="required-mark">* obligatorio</span>
          </label>
          <input
            type="text"
            value={builderName}
            onChange={(e) => setBuilderName(e.target.value)}
            placeholder="Torso lunes"
          />
        </div>
        <div className="filter-group">
          <label>
            Duración disponible (min) <span className="optional-mark">(opcional)</span>
          </label>
          <input
            type="number"
            value={targetDuration}
            onChange={(e) => setTargetDuration(e.target.value)}
            placeholder="45"
          />
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 8 }}>Filtrar la biblioteca</div>
      <div className="filters">
        <div className="filter-group">
          <label>Buscar</label>
          <input
            type="text"
            placeholder="Nombre del ejercicio…"
            value={fSearch}
            onChange={(e) => setFSearch(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <label>Tipo</label>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="">Todos</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Parte del cuerpo</label>
          <select value={fBodyRegion} onChange={(e) => setFBodyRegion(e.target.value)}>
            <option value="">Todas</option>
            {bodyRegionOptions.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Grupo muscular</label>
          <select value={fMuscle} onChange={(e) => setFMuscle(e.target.value)}>
            <option value="">Todos</option>
            {muscleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Patrón de movimiento</label>
          <select value={fPattern} onChange={(e) => setFPattern(e.target.value)}>
            <option value="">Todos</option>
            {patternOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Objetivo</label>
          <select value={fObjective} onChange={(e) => setFObjective(e.target.value)}>
            <option value="">Todos</option>
            {objectiveOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Equipamiento</label>
          <select value={fEquip} onChange={(e) => setFEquip(e.target.value)}>
            <option value="">Todos</option>
            {equipOptions.map((eq) => <option key={eq} value={eq}>{eq}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Nivel</label>
          <select value={fLevel} onChange={(e) => setFLevel(e.target.value)}>
            <option value="">Todos</option>
            {levelOptions.map((k) => <option key={k} value={k}>{LEVEL_NAMES[k]}</option>)}
          </select>
        </div>
      </div>

      {hasActivePickerFilter && (
        <button className="account-btn" onClick={resetBuilderFilters} style={{ marginBottom: 10 }}>
          Limpiar filtros
        </button>
      )}

      <div className="picker-grid">
        {!hasActivePickerFilter && (
          <div className="empty">Escribe una búsqueda o elige un filtro arriba para ver ejercicios aquí.</div>
        )}
        {hasActivePickerFilter &&
          filteredExercises.slice(0, 30).map((ex) => (
            <div className="picker-card" key={ex.id}>
              <div className="picker-card-row">
                <button className="exercise-peek-name" onClick={() => togglePeek(`pick-${ex.id}`)}>
                  {ex.name}
                  <span className="peek-caret">{peekKey === `pick-${ex.id}` ? "▾" : "▸"}</span>
                </button>
                <button className="account-btn account-btn-primary" onClick={() => addExercise(ex)}>+ Añadir</button>
              </div>
              {peekKey === `pick-${ex.id}` && <ExercisePeek exercise={ex} />}
            </div>
          ))}
        {hasActivePickerFilter && filteredExercises.length === 0 && (
          <div className="empty">Ningún ejercicio coincide con estos filtros.</div>
        )}
      </div>

      <div className="section-label" style={{ marginTop: 24 }}>
        Tu sesión ({items.length} ejercicios · ≈ {estimatedMinutes} min estimados)
      </div>

      {selectedForGroup.size >= 2 && (
        <button className="account-btn account-btn-primary" onClick={groupSelected} style={{ marginBottom: 10 }}>
          Agrupar {selectedForGroup.size} en circuito
        </button>
      )}

      <div className="session-items-list">
        {renderGroups.map((g) => {
          if (g.type === "single") {
            const item = g.item;
            const globalIndex = items.findIndex((i) => i.tempId === item.tempId);
            return (
              <div className="session-item-editor" key={item.tempId}>
                <div className="session-item-editor-top">
                  <input
                    type="checkbox"
                    checked={selectedForGroup.has(item.tempId)}
                    onChange={() => toggleSelectForGroup(item.tempId)}
                    title="Seleccionar para agrupar en circuito"
                  />
                  <button
                    className="exercise-peek-name session-item-name"
                    onClick={() => togglePeek(`item-${item.tempId}`)}
                  >
                    {item.exercise.name}
                    <span className="peek-caret">{peekKey === `item-${item.tempId}` ? "▾" : "▸"}</span>
                  </button>
                  <div className="session-item-controls">
                    <button className="account-btn" onClick={() => moveItem(globalIndex, -1)}>↑</button>
                    <button className="account-btn" onClick={() => moveItem(globalIndex, 1)}>↓</button>
                    <button className="account-btn" onClick={() => removeItem(item.tempId)}>Quitar</button>
                  </div>
                </div>
                <div className="session-item-fields">
                  <label>Series
                    <input type="number" value={item.sets} onChange={(e) => updateItem(item.tempId, "sets", e.target.value)} />
                  </label>
                  <label className="mode-toggle">
                    <select value={item.mode} onChange={(e) => updateItem(item.tempId, "mode", e.target.value)}>
                      <option value="reps">Repeticiones</option>
                      <option value="time">Tiempo (s)</option>
                    </select>
                    {item.mode === "reps" ? (
                      <input type="text" value={item.reps} onChange={(e) => updateItem(item.tempId, "reps", e.target.value)} placeholder="8-12" />
                    ) : (
                      <input type="number" value={item.duration_seconds} onChange={(e) => updateItem(item.tempId, "duration_seconds", e.target.value)} />
                    )}
                  </label>
                  <label>Descanso (s)
                    <input type="number" value={item.rest_seconds} onChange={(e) => updateItem(item.tempId, "rest_seconds", e.target.value)} />
                  </label>
                  <label>Carga / nota
                    <input type="text" value={item.load_note} onChange={(e) => updateItem(item.tempId, "load_note", e.target.value)} placeholder="20kg, RIR 2..." />
                  </label>
                </div>
                {peekKey === `item-${item.tempId}` && <ExercisePeek exercise={item.exercise} />}
              </div>
            );
          }

          return (
            <div className="session-group-editor" key={`group-${g.groupId}`}>
              <div className="session-group-editor-top">
                <span>Circuito</span>
                <label>Rondas
                  <input type="number" value={g.items[0].sets} onChange={(e) => setGroupRounds(g.groupId, e.target.value)} />
                </label>
                <button className="account-btn" onClick={() => ungroup(g.groupId)}>Desagrupar</button>
              </div>
              {g.items.map((item) => {
                const globalIndex = items.findIndex((i) => i.tempId === item.tempId);
                return (
                  <div className="session-item-editor session-item-in-group" key={item.tempId}>
                    <div className="session-item-editor-top">
                      <span className="session-item-name">{item.exercise.name}</span>
                      <div className="session-item-controls">
                        <button className="account-btn" onClick={() => moveItem(globalIndex, -1)}>↑</button>
                        <button className="account-btn" onClick={() => moveItem(globalIndex, 1)}>↓</button>
                        <button className="account-btn" onClick={() => removeItem(item.tempId)}>Quitar</button>
                      </div>
                    </div>
                    <div className="session-item-fields">
                      <label className="mode-toggle">
                        <select value={item.mode} onChange={(e) => updateItem(item.tempId, "mode", e.target.value)}>
                          <option value="reps">Repeticiones</option>
                          <option value="time">Tiempo (s)</option>
                        </select>
                        {item.mode === "reps" ? (
                          <input type="text" value={item.reps} onChange={(e) => updateItem(item.tempId, "reps", e.target.value)} placeholder="8-12" />
                        ) : (
                          <input type="number" value={item.duration_seconds} onChange={(e) => updateItem(item.tempId, "duration_seconds", e.target.value)} />
                        )}
                      </label>
                      <label>Carga / nota
                        <input type="text" value={item.load_note} onChange={(e) => updateItem(item.tempId, "load_note", e.target.value)} />
                      </label>
                    </div>
                  </div>
                );
              })}
              <label className="session-item-fields" style={{ marginTop: 6 }}>
                Descanso entre rondas (s)
                <input
                  type="number"
                  value={g.items[g.items.length - 1].rest_seconds}
                  onChange={(e) => setGroupRest(g.groupId, e.target.value)}
                />
              </label>
            </div>
          );
        })}
        {items.length === 0 && <div className="empty">Añade ejercicios de la lista de arriba para empezar.</div>}
      </div>

      {saveError && <p className="auth-error">{saveError}</p>}
      {!saveError && !builderName.trim() && (
        <p className="auth-info">Ponle un nombre a la sesión (arriba del todo) para poder guardarla.</p>
      )}
      {!saveError && builderName.trim() && items.length === 0 && (
        <p className="auth-info">Añade al menos un ejercicio antes de guardar.</p>
      )}

      <button
        className="account-btn account-btn-primary"
        style={{ marginTop: 18, width: "100%" }}
        disabled={!builderName.trim() || items.length === 0 || saving}
        onClick={saveRoutine}
      >
        {saving ? "Guardando…" : editingRoutineId ? "Guardar cambios" : "Guardar sesión"}
      </button>
    </div>
  );
}

// Muestra una fecha del historial y, al desplegarla, lo que se registró ese día.
function CompletionRow({ completion, onUndo }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && logs === null) {
      setLoading(true);
      const { data } = await supabase
        .from("exercise_set_logs")
        .select("exercise_name, set_number, weight_kg, reps_done, duration_seconds")
        .eq("completion_id", completion.id)
        .order("set_number");
      setLogs(data || []);
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    if (!logs) return [];
    const map = new Map();
    for (const l of logs) {
      if (!map.has(l.exercise_name)) map.set(l.exercise_name, []);
      map.get(l.exercise_name).push(l);
    }
    return [...map.entries()];
  }, [logs]);

  return (
    <div className="completion-block">
      <div className="completion-row">
        <button className="completion-date-btn" onClick={toggle}>
          {open ? "▾" : "▸"} {formatDate(completion.completed_at)}
        </button>
        <button className="account-btn" onClick={onUndo}>Deshacer</button>
      </div>
      {open && (
        <div className="completion-detail">
          {loading && <span className="training-lasttime">Cargando…</span>}
          {!loading && grouped.length === 0 && (
            <span className="training-lasttime">Sin series registradas ese día.</span>
          )}
          {!loading &&
            grouped.map(([name, sets]) => (
              <div className="completion-exercise" key={name}>
                <span className="completion-exercise-name">{name}</span>
                <span className="completion-sets">
                  {sets
                    .map((s) =>
                      s.duration_seconds != null
                        ? `${s.duration_seconds}s`
                        : `${s.weight_kg != null ? s.weight_kg + "kg × " : ""}${s.reps_done ?? "?"}`
                    )
                    .join(" · ")}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendario mensual de sesiones realizadas.
// No consulta nada nuevo: se construye a partir de las rutinas ya cargadas,
// que traen sus propias marcas de sesión completada.
// ---------------------------------------------------------------------------
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function toDayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SessionCalendar({ routines, onOpenRoutine }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(null);

  // Mapa: "2026-09-14" -> [{ routineId, routineName }]
  const byDay = useMemo(() => {
    const map = {};
    for (const r of routines) {
      for (const c of r.routine_completions || []) {
        const key = toDayKey(new Date(c.completed_at));
        if (!map[key]) map[key] = [];
        map[key].push({ routineId: r.id, routineName: r.name });
      }
    }
    return map;
  }, [routines]);

  const totalCompletions = useMemo(
    () => Object.values(byDay).reduce((sum, arr) => sum + arr.length, 0),
    [byDay]
  );

  const grid = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    // getDay(): 0 = domingo. Lo convertimos a semana que empieza en lunes.
    const leading = (first.getDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.year, cursor.month, d));
    return cells;
  }, [cursor]);

  function shiftMonth(delta) {
    setSelectedDay(null);
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const todayKey = toDayKey(new Date());
  const monthCount = grid.filter((d) => d && byDay[toDayKey(d)]).length;

  if (totalCompletions === 0) return null;

  if (!open) {
    return (
      <button className="calendar-toggle" onClick={() => setOpen(true)}>
        📅 Ver calendario de entrenamientos
      </button>
    );
  }

  return (
    <div className="calendar-card">
      <div className="calendar-head">
        <button className="calendar-nav" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button>
        <span className="calendar-title">
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </span>
        <button className="calendar-nav" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {grid.map((day, i) => {
          if (!day) return <span className="calendar-cell empty-cell" key={`e-${i}`} />;
          const key = toDayKey(day);
          const sessions = byDay[key];
          const isToday = key === todayKey;
          const isSelected = selectedDay === key;
          return (
            <button
              key={key}
              className={`calendar-cell ${sessions ? "has-session" : ""} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`}
              onClick={() => setSelectedDay(sessions ? (isSelected ? null : key) : null)}
              disabled={!sessions}
            >
              <span className="calendar-daynum">{day.getDate()}</span>
              {sessions && <span className="calendar-dot" />}
            </button>
          );
        })}
      </div>

      <div className="calendar-footer">
        {monthCount > 0
          ? `${monthCount} ${monthCount === 1 ? "día entrenado" : "días entrenados"} este mes`
          : "Sin sesiones registradas este mes"}
      </div>

      {selectedDay && byDay[selectedDay] && (
        <div className="calendar-daydetail">
          <div className="calendar-daydetail-date">
            {new Date(selectedDay + "T12:00:00").toLocaleDateString("es-ES", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          {byDay[selectedDay].map((s, i) => (
            <button className="calendar-session-link" key={i} onClick={() => onOpenRoutine(s.routineId)}>
              ▸ {s.routineName}
            </button>
          ))}
        </div>
      )}

      <button className="calendar-hide" onClick={() => setOpen(false)}>
        Ocultar calendario
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumen desplegable de un ejercicio, para consultarlo sin salir del
// diseñador. Usa los datos ya cargados en memoria, no consulta nada nuevo.
// ---------------------------------------------------------------------------
function ExercisePeek({ exercise }) {
  if (!exercise) return null;
  const muscles = exercise.muscles || [];
  const primary = muscles.filter((m) => m.involvement === "primary");
  const secondary = muscles.filter((m) => m.involvement === "secondary");
  const stabilizers = muscles.filter((m) => m.involvement === "stabilizer");

  return (
    <div className="exercise-peek">
      {exercise.photo_url && (
        <img src={exercise.photo_url} alt={exercise.name} className="exercise-peek-photo" loading="lazy" />
      )}
      {exercise.short_description && <p className="exercise-peek-desc">{exercise.short_description}</p>}

      {primary.length > 0 && (
        <div className="exercise-peek-row">
          <span className="exercise-peek-label">Principal</span>
          <span className="exercise-peek-muscles primary">{primary.map((m) => m.name).join(", ")}</span>
        </div>
      )}
      {secondary.length > 0 && (
        <div className="exercise-peek-row">
          <span className="exercise-peek-label">Secundario</span>
          <span className="exercise-peek-muscles">{secondary.map((m) => m.name).join(", ")}</span>
        </div>
      )}
      {stabilizers.length > 0 && (
        <div className="exercise-peek-row">
          <span className="exercise-peek-label">Estabiliza</span>
          <span className="exercise-peek-muscles">{stabilizers.map((m) => m.name).join(", ")}</span>
        </div>
      )}
      {(exercise.equipment || []).length > 0 && (
        <div className="exercise-peek-row">
          <span className="exercise-peek-label">Material</span>
          <span className="exercise-peek-muscles">
            {exercise.equipment.map((eq) => eq.name).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}
