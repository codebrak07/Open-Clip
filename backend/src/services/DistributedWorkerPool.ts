export type WorkerType = 'analysis' | 'rendering' | 'embedding' | 'inference' | 'export';

export interface TaskJob {
  id: string;
  type: WorkerType;
  payload: any;
}

export class DistributedWorkerPool {
  private static workers: Map<WorkerType, number> = new Map([
    ['analysis', 4],
    ['rendering', 2],
    ['embedding', 4],
    ['inference', 2],
    ['export', 2],
  ]);

  public static async dispatchTask(task: TaskJob): Promise<{ success: boolean; workerId: string }> {
    const workerCount = this.workers.get(task.type) || 1;
    const assignedWorkerId = `${task.type}-worker-${Math.floor(Math.random() * workerCount) + 1}`;
    
    // Simulate background worker execution queue
    return {
      success: true,
      workerId: assignedWorkerId,
    };
  }

  public static getWorkerStats() {
    return Array.from(this.workers.entries()).map(([type, capacity]) => ({
      type,
      capacity,
      active: Math.floor(Math.random() * capacity),
    }));
  }
}
