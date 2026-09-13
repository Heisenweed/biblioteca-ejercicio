"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const LEVEL_NAMES = { beginner: "Principiante", intermediate: "Intermedio", advanced: "Avanzado" };

function unique(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b, "es"));
}

let tempIdCounter = 0;
function newTempId() {
  tempIdCounter += 1;
  return `tmp-${tempIdCounter}`;
}

// Estima cuántos segundos ocupa una serie/ronda de un ejercicio, para el
// cálculo de duración en tiempo real. Es una estimación, no un cronómetro.
function estimateItemSeconds(item) {
  if (item.mode === "time") return Number(item.duration_seconds) || 30;
  return 40; // tiempo estimado de una serie de repeticiones estándar
}

// Agrupa los ejercicios en bloques para renderizar: los que comparten
// superset_group se muestran juntos como un circuito.
function buildRenderGroups(items) {
  const groups = [];
  const seen = new Set();
  for (const item of items) {
    if (item.superset_group != null) {
      if (seen.has(item.superset_group)) continue;
      seen.add(item.superset_group);
      groups.push({ type: "group", groupId: item.superset_group, items: items.filter((i) => i.superset_group === item.superset_group) });
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
      totalSeconds += rounds * estimateItemSeconds(g.item) + Math.max(0, rounds - 1) * (Number(g.item.rest_seconds) || 0);
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
  const [view, setView] = useState("list"); // 'list' | 'builder' | 'detail'
  const [routines, setRoutines] = useState([]);
  const [routinesLoading, setRoutinesLoading] = useState(false);
  const [detailRoutine, setDetailRoutine] = useState(null);

  // ---- Estado del constructor ----
  const [builderName, setBuilderName] = useState("");
  const [targetDuration, setTargetDuration] = useState("");
  const [fPattern, setFPattern] = useState("");
  const [fMuscle, setFMuscle] = useState("");
  const [fEquip, setFEquip] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [fObjective, setFObjective] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [items, setItems] = useState([]); // los ejercicios ya añadidos a la sesión
  const [selectedForGroup, setSelectedForGroup] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!user || view !== "list") return;
    setRoutinesLoading(true);
    supabase
      .from("routines")
      .select("*, routine_exercises(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error) setRoutines(data || []);
        setRoutinesLoading(false);
      });
  }, [user, view]);

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

  const filteredExercises = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return exercises.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (fPattern && !(e.patterns || []).includes(fPattern)) return false;
      if (fMuscle && !(e.muscles || []).some((m) => m.name === fMuscle)) return false;
      if (fEquip && !(e.equipment || []).some((eq) => eq.name === fEquip)) return false;
      if (fLevel && e.level !== fLevel) return false;
      if (fObjective && !(e.objectives || []).includes(fObjective)) return false;
      return true;
    });
  }, [exercises, fSearch, fPattern, fMuscle, fEquip, fLevel, fObjective]);

  function startNewSession() {
    setBuilderName("");
    setTargetDuration("");
    setFPattern("");
    setFMuscle("");
    setFEquip("");
    setFLevel("");
    setFObjective("");
    setFSearch("");
    setItems([]);
    setSelectedForGroup(new Set());
    setSaveError(null);
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
    setItems((prev) =>
      prev.map((i) => (selectedForGroup.has(i.tempId) ? { ...i, superset_group: nextGroupId, sets: prev.find((x) => selectedForGroup.has(x.tempId)).sets } : i))
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

    const { data: routine, error: routineError } = await supabase
      .from("routines")
      .insert({
        user_id: user.id,
        name: builderName.trim(),
        target_duration_minutes: targetDuration ? Number(targetDuration) : null,
        design_filters: { patterns: fPattern, muscle: fMuscle, equipment: fEquip, level: fLevel, objective: fObjective },
      })
      .select()
      .single();

    if (routineError) {
      setSaveError(routineError.message);
      setSaving(false);
      return;
    }

    const rows = items.map((item, index) => ({
      routine_id: routine.id,
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
    setSaving(false);

    if (itemsError) {
      setSaveError(itemsError.message);
      return;
    }

    setView("list");
  }

  async function deleteRoutine(id) {
    await supabase.from("routines").delete().eq("id", id);
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }

  function openDetail(routine) {
    setDetailRoutine(routine);
    setView("detail");
  }

  // ---------------------------------------------------------------------
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

  if (view === "detail" && detailRoutine) {
    const detailItems = [...(detailRoutine.routine_exercises || [])].sort((a, b) => a.order_index - b.order_index);
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
        {detailRoutine.target_duration_minutes && (
          <p className="docs-intro">Duración prevista: {detailRoutine.target_duration_minutes} min</p>
        )}
        <div className="session-detail-list">
          {renderGroups.map((g, i) =>
            g.type === "single" ? (
              <div className="session-item-card" key={g.item.id || i}>
                <div className="session-item-name">{g.item.exercise.name}</div>
                <div className="session-item-prescription">
                  {g.item.sets} × {g.item.reps || `${g.item.duration_seconds}s`}
                  {g.item.rest_seconds ? ` · descanso ${g.item.rest_seconds}s` : ""}
                  {g.item.load_note ? ` · ${g.item.load_note}` : ""}
                </div>
                {g.item.notes && <div className="session-item-notes">{g.item.notes}</div>}
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

  if (view === "list") {
    return (
      <div className="sessions-list-view">
        <p className="docs-intro">
          Diseña tus propias sesiones eligiendo ejercicios de la biblioteca, con tu propio volumen y orden.
        </p>
        <button className="account-btn account-btn-primary" onClick={startNewSession} style={{ marginBottom: 18 }}>
          + Nueva sesión
        </button>
        {routinesLoading && <div className="loading-state">Cargando tus sesiones…</div>}
        {!routinesLoading && routines.length === 0 && (
          <div className="empty">Todavía no has guardado ninguna sesión.</div>
        )}
        <div className="docs-list">
          {routines.map((r) => (
            <div className="doc-card" key={r.id} onClick={() => openDetail(r)} tabIndex={0}>
              <div className="doc-card-top">
                <h3>{r.name}</h3>
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
              <p>
                {(r.routine_exercises || []).length} ejercicios
                {r.target_duration_minutes ? ` · ~${r.target_duration_minutes} min previstos` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- view === "builder" ----
  const estimatedMinutes = estimateTotalMinutes(items);
  const renderGroups = buildRenderGroups(items);

  return (
    <div className="session-builder">
      <button className="account-btn" onClick={() => setView("list")}>← Cancelar</button>

      <div className="filters" style={{ marginTop: 14 }}>
        <div className="filter-group">
          <label>Nombre de la sesión</label>
          <input type="text" value={builderName} onChange={(e) => setBuilderName(e.target.value)} placeholder="Torso lunes" />
        </div>
        <div className="filter-group">
          <label>Duración disponible (min)</label>
          <input type="number" value={targetDuration} onChange={(e) => setTargetDuration(e.target.value)} placeholder="45" />
        </div>
      </div>

      <div className="section-label" style={{ marginTop: 8 }}>Filtrar la biblioteca</div>
      <div className="filters">
        <div className="filter-group">
          <label>Buscar</label>
          <input type="text" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        </div>
        <div className="filter-group">
          <label>Patrón</label>
          <select value={fPattern} onChange={(e) => setFPattern(e.target.value)}>
            <option value="">Todos</option>
            {patternOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Músculo</label>
          <select value={fMuscle} onChange={(e) => setFMuscle(e.target.value)}>
            <option value="">Todos</option>
            {muscleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
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
            {Object.entries(LEVEL_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label>Objetivo</label>
          <select value={fObjective} onChange={(e) => setFObjective(e.target.value)}>
            <option value="">Todos</option>
            {objectiveOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      <div className="picker-grid">
        {filteredExercises.slice(0, 24).map((ex) => (
          <div className="picker-card" key={ex.id}>
            <span>{ex.name}</span>
            <button className="account-btn account-btn-primary" onClick={() => addExercise(ex)}>+ Añadir</button>
          </div>
        ))}
        {filteredExercises.length === 0 && <div className="empty">Ningún ejercicio coincide con estos filtros.</div>}
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
        {renderGroups.map((g, gi) => {
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
                  <span className="session-item-name">{item.exercise.name}</span>
                  <div className="session-item-controls">
                    <button className="account-btn" onClick={() => moveItem(globalIndex, -1)}>↑</button>
                    <button className="account-btn" onClick={() => moveItem(globalIndex, 1)}>↓</button>
                    <button className="account-btn" onClick={() => removeItem(item.tempId)}>Quitar</button>
                  </div>
                </div>
                <div className="session-item-fields">
                  <label>Series<input type="number" value={item.sets} onChange={(e) => updateItem(item.tempId, "sets", e.target.value)} /></label>
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
                  <label>Descanso (s)<input type="number" value={item.rest_seconds} onChange={(e) => updateItem(item.tempId, "rest_seconds", e.target.value)} /></label>
                  <label>Carga / nota<input type="text" value={item.load_note} onChange={(e) => updateItem(item.tempId, "load_note", e.target.value)} placeholder="20kg, RIR 2..." /></label>
                </div>
              </div>
            );
          }

          return (
            <div className="session-group-editor" key={`group-${g.groupId}`}>
              <div className="session-group-editor-top">
                <span>Circuito</span>
                <label>Rondas <input type="number" value={g.items[0].sets} onChange={(e) => setGroupRounds(g.groupId, e.target.value)} /></label>
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
                      <label>Carga / nota<input type="text" value={item.load_note} onChange={(e) => updateItem(item.tempId, "load_note", e.target.value)} /></label>
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

      <button
        className="account-btn account-btn-primary"
        style={{ marginTop: 18, width: "100%" }}
        disabled={!builderName.trim() || items.length === 0 || saving}
        onClick={saveRoutine}
      >
        {saving ? "Guardando…" : "Guardar sesión"}
      </button>
    </div>
  );
}
