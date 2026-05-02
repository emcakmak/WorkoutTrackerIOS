import type { Workout } from "./types";

const KEY = "workouts_v2";

export function loadWorkouts(): Workout[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Workout[];
    // Migrate old data: workouts that had top-level `sets` instead of `exercises`
    return parsed.map((w: any) => {
      if (!w.exercises && w.sets) {
        return {
          ...w,
          exercises: [
            {
              id: crypto.randomUUID(),
              name: "Workout",
              sets: w.sets,
            },
          ],
        };
      }
      return { ...w, exercises: w.exercises ?? [] };
    });
  } catch {
    return [];
  }
}

export function saveWorkouts(workouts: Workout[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(workouts));
  } catch {}
}
