export interface WorkoutSet {
  id: string;
  weight: number;
  reps: number;
  effort: "easy" | "medium" | "hard";
  restTime: number;
}

export interface Exercise {
  id: string;
  name: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  name: string;
  date: string;
  exercises: Exercise[];
}
