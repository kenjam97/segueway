"use client";
import { useCallback, useEffect, useState } from "react";
import { emptyLibrary } from "./model";
import { editorHistoryReducer, type EditorHistory, type EventAction } from "./reducer";
import { loadLibrary, saveLibrary } from "./storage";

export function useEvents() {
  const [history, setHistory] = useState<EditorHistory>(() => ({ library: emptyLibrary(), undo: null }));
  const library = history.library;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => {
    try { setHistory({ library: loadLibrary(window.localStorage), undo: null }); setLoaded(true); setLoadError(null); }
    catch { setLoadError("Saved events could not be loaded. Your stored data has been kept untouched. Check browser storage access, then retry."); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!loaded || loadError) return;
    try { saveLibrary(window.localStorage, library); setSaveError(null); setSaved(true); }
    catch { setSaveError("Changes could not be saved in this browser. Keep this page open and free some browser storage, then retry saving."); setSaved(false); }
  }, [library, loaded, loadError]);
  const dispatch = (action: EventAction) => { setSaved(false); setHistory(state => editorHistoryReducer(state, action)); };
  const undo = () => { setSaved(false); setHistory(state => editorHistoryReducer(state, { type: "undo" })); };
  const retrySave = () => {
    try { saveLibrary(window.localStorage, library); setSaveError(null); setSaved(true); }
    catch { setSaved(false); }
  };
  return { library, dispatch, loaded, loadError, saveError, saved, load, retrySave, undo, undoLabel: history.undo?.label };
}
