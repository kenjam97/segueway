import type { EventLibrary, PlaybackMode, SectionTrack } from "./model";

export type EventAction =
  | { type: "create-event"; id: string; name: string }
  | { type: "select-event"; id: string }
  | { type: "rename-event"; id: string; name: string }
  | { type: "create-section"; eventId: string; id: string; name: string }
  | { type: "rename-section"; eventId: string; sectionId: string; name: string }
  | { type: "delete-section"; eventId: string; sectionId: string }
  | { type: "move-section"; eventId: string; sectionId: string; direction: -1 | 1 }
  | { type: "reorder-section"; eventId: string; sectionId: string; beforeId: string }
  | { type: "set-mode"; eventId: string; sectionId: string; mode: PlaybackMode }
  | { type: "add-track"; eventId: string; sectionId: string; track: SectionTrack }
  | { type: "remove-track"; eventId: string; sectionId: string; entryId: string }
  | { type: "reorder-track"; eventId: string; sectionId: string; entryId: string; beforeId: string }
  | { type: "move-track"; eventId: string; sectionId: string; entryId: string; direction: -1 | 1 };

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= items.length) return items;
  const result = [...items];
  [result[index], result[destination]] = [result[destination], result[index]];
  return result;
}

function reorder<T>(items: T[], id: string, beforeId: string, identify: (item: T) => string) {
  const source = items.find(item => identify(item) === id);
  if (!source || id === beforeId || !items.some(item => identify(item) === beforeId)) return items;
  const result = items.filter(item => identify(item) !== id);
  result.splice(result.findIndex(item => identify(item) === beforeId), 0, source);
  return result;
}

export function eventReducer(state: EventLibrary, action: EventAction): EventLibrary {
  if (action.type === "create-event") {
    if (!action.name.trim() || state.events.some(event => event.id === action.id)) return state;
    return { ...state, events: [...state.events, { id: action.id, name: action.name.trim(), sections: [] }], activeEventId: action.id };
  }
  if (action.type === "select-event") return state.events.some(event => event.id === action.id) ? { ...state, activeEventId: action.id } : state;
  return { ...state, events: state.events.map(event => {
    if (action.type === "rename-event") return event.id === action.id && action.name.trim() ? { ...event, name: action.name.trim() } : event;
    if (event.id !== action.eventId) return event;
    if (action.type === "create-section") return action.name.trim() && !event.sections.some(section => section.id === action.id) ? { ...event, sections: [...event.sections, { id: action.id, name: action.name.trim(), tracks: [], playbackMode: "once" }] } : event;
    if (action.type === "delete-section") return { ...event, sections: event.sections.filter(section => section.id !== action.sectionId) };
    if (action.type === "move-section") return { ...event, sections: move(event.sections, event.sections.findIndex(section => section.id === action.sectionId), action.direction) };
    if (action.type === "reorder-section") return { ...event, sections: reorder(event.sections, action.sectionId, action.beforeId, item => item.id) };
    return { ...event, sections: event.sections.map(section => {
      if (section.id !== action.sectionId) return section;
      switch (action.type) {
        case "rename-section": return action.name.trim() ? { ...section, name: action.name.trim() } : section;
        case "set-mode": return { ...section, playbackMode: action.mode };
        case "add-track": return { ...section, tracks: [...section.tracks, action.track] };
        case "remove-track": return { ...section, tracks: section.tracks.filter(track => track.entryId !== action.entryId) };
        case "move-track": return { ...section, tracks: move(section.tracks, section.tracks.findIndex(track => track.entryId === action.entryId), action.direction) };
        case "reorder-track": return { ...section, tracks: reorder(section.tracks, action.entryId, action.beforeId, item => item.entryId) };
      }
    }) };
  }) };
}

export type EditorHistory = { library: EventLibrary; undo: { library: EventLibrary; label: string } | null };

export function editorHistoryReducer(state: EditorHistory, action: EventAction | { type: "undo" }): EditorHistory {
  if (action.type === "undo") return state.undo ? { library: state.undo.library, undo: null } : state;
  let label: string | null = null;
  if (action.type === "delete-section" || action.type === "remove-track") {
    const section = state.library.events.find(event => event.id === action.eventId)?.sections.find(section => section.id === action.sectionId);
    label = action.type === "delete-section" ? section ? `${section.name} removed` : null : section?.tracks.find(track => track.entryId === action.entryId)?.name ?? null;
    if (label && action.type === "remove-track") label += " removed";
  }
  return { library: eventReducer(state.library, action), undo: label ? { library: state.library, label } : null };
}
